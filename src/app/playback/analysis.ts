// The library's rhythm analysis, in the background: the main process keeps the queue (songs the player is about to need
// first, then the most recently played and added), this page takes one song at a time, decodes it at the analysis rate
// (22 kHz: a quarter of the memory of a full decode) and runs the rhythm SDK in its worker. One song at a time, with a
// pause between songs and none at all while an export runs, so playback and the interface never compete with it.
import {
  analyzeInBackground,
  checkAnalysis,
  loudnessInBackground,
  RHYTHM_VERSION,
  rhythmEngine,
  neuralDrums,
  neuralStatus,
  type RhythmAnalysis,
} from '../../engine';

import { Lib, mediaUrl, type AnalysisToken } from '../bridge';
import { lib, settings, trackOf } from '../state';

let busy = false,
  requested = false,
  paused = false,
  wake: (() => void) | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fileBudget = 64 * 1024 * 1024;
const pcmBudget = 128 * 1024 * 1024;

/** Automatic full-file PCM is an optional analysis resource. Workshop and export use their explicit offline decode. */
export async function decodeForAnalysis(
  id: string,
  loudnessOnly = false,
  signal?: AbortSignal,
  actualDuration?: number,
) {
  const track = trackOf(id);
  const neural = !loudnessOnly && rhythmEngine() !== 'dsp' && (await neuralStatus()).ok;
  const rate = neural ? 44100 : 22050;
  const duration = actualDuration || track?.duration || 0;
  // decodeAudioData retains the input's channel count, independent of the context's output layout.
  const estimated = duration * Math.max(rate, track?.sampleRate || 48000) * (track?.channels || 8) * 4;
  if (!(duration > 0)) throw new Error('analysis duration unavailable');
  if (estimated > pcmBudget) throw new Error('analysis PCM budget');
  signal?.throwIfAborted();
  const r = await fetch(mediaUrl(id, track?.mediaRevision), { signal });
  if (!r.ok) throw new Error('read');
  const size = Number(r.headers.get('content-length'));
  const compressed = r.headers.get('x-cadenza-compressed-length');
  const fileSize = compressed === null ? size : Number(compressed);
  if (!(size > 0 && fileSize > 0) || fileSize > fileBudget || size > pcmBudget + 128) {
    await r.body?.cancel();
    throw new Error('analysis file budget');
  }
  const data = await r.arrayBuffer();
  signal?.throwIfAborted();
  return new OfflineAudioContext(neural ? 2 : 1, 1, rate).decodeAudioData(data);
}
/** Songs analysed in a hurry (the player was waiting: the neural engine's beats only, no drum stem), to be analysed
 *  whole once the library's queue is through; the next play of each reads the full analysis. */
const upgrade = new Set<string>();
/** Analyse one song now (the player calls this for a song it needs and the cache does not have). */
const inflight = new Map<string, Promise<RhythmAnalysis>>();
export function analyzeNow(
  id: string,
  {
    decoded,
    urgent = false,
    duration,
    granted,
  }: { decoded?: AudioBuffer | null; urgent?: boolean; duration?: number; granted?: AnalysisToken } = {},
): Promise<RhythmAnalysis> {
  const input = trackOf(id)?.mediaRevision;
  const { rhythmRuntime, rhythmDevice } = settings.get();
  const key = JSON.stringify([id, input, rhythmEngine(), neuralDrums(), rhythmRuntime, rhythmDevice]);
  let p = inflight.get(key);
  if (!p) {
    // (needed at once: the beats on the GPU have 20 s, else the built-in analysis answers; the drums come later)
    // (in the background the GPU has a time in proportion to the song — a minute and a little over half the song's own
    // length — then the built-in analysis answers: a slow or stalled GPU never holds the whole library's queue)
    p = (async () => {
      const issued = granted ?? (await Lib?.analysisToken(id));
      const token = issued?.source === input ? issued : null;
      try {
        const buf = decoded || (await decodeForAnalysis(id, false, undefined, duration)),
          dur = buf.length / buf.sampleRate;
        const opts = urgent ? { drums: false, timeoutMs: 20_000, urgent: true } : { timeoutMs: 60_000 + dur * 600 };
        // (the neural engine only, and it did not answer while the player waited: the song plays on a tempo grid, and is
        // analysed again in the background, with the time a background analysis has)
        lib.set({ analysisFor: id });
        let a = await analyzeInBackground(buf, (k) => lib.set({ analysisNow: k, analysisFor: id }), opts)
          .catch((e) => {
            if (urgent && rhythmEngine() === 'neural') {
              upgrade.add(id);
              setTimeout(() => loop(), 30_000);
            }
            throw e;
          })
          .finally(() => lib.set({ analysisFor: null, analysisNow: null }));
        // (a reading that is not sound — rhythm/validate.ts — is never kept: the built-in analysis has one more go, and a
        // song it cannot read either is marked failed, with why, instead of being analysed again and again)
        let why = checkAnalysis(a, dur);
        if (why && a.engine !== 'dsp') {
          console.warn('[analysis]', id, why, '— the built-in analysis tries');
          a = await analyzeInBackground(buf, undefined, { ...opts, engine: 'dsp' });
          why = checkAnalysis(a, dur);
        }
        if (why) {
          console.warn('[analysis]', id, why);
          throw new Error(why);
        }
        if (token) await Lib?.saveAnalysis(id, a, token);
        // (and a song the GPU did not answer in time, when it can run at all: no second built-in pass on a machine without one)
        if (
          urgent &&
          (a.stems === 'skipped'
            ? neuralDrums()
            : a.engine === 'dsp' && rhythmEngine() !== 'dsp' && (await neuralStatus()).ok)
        ) {
          upgrade.add(id);
          setTimeout(() => loop(), 30_000);
        }
        return a;
      } catch (error) {
        if (token) await Lib?.analysisFailed(id, String((error as Error)?.message || error).slice(0, 200), token);
        throw error;
      }
    })();
    inflight.set(key, p);
    const done = () => inflight.delete(key);
    void p.then(done, done);
  }
  return p;
}
async function loop() {
  if (!Lib) return;
  if (busy) {
    requested = true;
    return;
  }
  busy = true;
  requested = false;
  const blocked = new Set<string>();
  try {
    for (;;) {
      await waitIfPaused();
      const job =
        (await Lib.nextAnalysis(RHYTHM_VERSION, [...blocked])) ||
        (() => {
          const id = [...upgrade].find((id) => !blocked.has(id));
          return id ? { id, only: undefined } : null;
        })();
      // the queue done: the cached analyses not checked yet are read and checked (validate.ts), one at a time — a sound one
      // is remembered as checked, a broken one (cut short, written by a faulty run) goes back to be analysed
      if (!job) {
        if (await verifyCached()) continue;
        break;
      }
      if (!trackOf(job.id)?.audioContentId) {
        blocked.add(job.id);
        continue;
      }
      const token = await Lib.analysisToken(job.id);
      // A watcher or later scan will wake the queue with the current file. Avoid spinning on stale paths.
      if (!token || token.source !== trackOf(job.id)?.mediaRevision) {
        blocked.add(job.id);
        continue;
      }
      await waitIfPaused();
      upgrade.delete(job.id);
      lib.set({ analysisTask: { phase: job.only || 'rhythm', id: job.id } });
      if (job.only === 'loudness') {
        try {
          await Lib.saveLoudness(job.id, await loudnessInBackground(await decodeForAnalysis(job.id, true)), token);
        } catch {
          await Lib.saveLoudness(job.id, null, token);
        }
      } else await analyzeNow(job.id, { granted: token }).catch(() => {});
      lib.set({ analysisTask: { phase: 'idle', id: null } });
      await sleep(120);
    }
  } catch (error) {
    console.warn('[library analysis]', error);
  } finally {
    busy = false;
    lib.set({ analysisTask: { phase: 'idle', id: null } });
    if (requested) void loop();
  }
}
/** Check the cached analyses not yet checked; true when any was sent back to be analysed. */
async function verifyCached(): Promise<boolean> {
  if (!Lib) return false;
  let bad = false;
  for (const id of await Lib.unverified(RHYTHM_VERSION).catch(() => [] as string[])) {
    await waitIfPaused();
    // (no length to compare with here: a tag's duration can be off — that check is made against decoded audio only)
    const token = await Lib.analysisToken(id);
    if (!token) continue;
    lib.set({ analysisTask: { phase: 'validate', id } });
    const a = await Lib.analysis(id, RHYTHM_VERSION).catch(() => null),
      why = checkAnalysis(a);
    if (why) {
      console.warn('[analysis] cached analysis of', id, 'is unsound:', why);
      await Lib.reanalyze([id]);
      bad = true;
    } else await Lib.verified(id, RHYTHM_VERSION, token);
    lib.set({ analysisTask: { phase: 'idle', id: null } });
    await sleep(40);
  }
  return bad;
}
async function waitIfPaused() {
  while (paused) {
    lib.set({ analysisTask: { phase: 'paused', id: null } });
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
}
export function startAnalysis() {
  if (!Lib) return;
  Lib.onWake(() => loop());
  setTimeout(loop, 1500);
}
/** Hold the library's queue (between songs) for a reason — an export, or the effect lyrics on screen while a song plays
 *  (the picture and the analysis would share the GPU: the picture stuttered) — until no reason is left. */
const holds = new Set<string>();
export function pauseAnalysis(on: boolean, why = 'export') {
  if (on) holds.add(why);
  else holds.delete(why);
  paused = holds.size > 0;
  if (!paused) {
    wake?.();
    wake = null;
  }
}
