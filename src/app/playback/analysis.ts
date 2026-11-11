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

import { Lib, mediaUrl } from '../bridge';
import { lib } from '../state';

let busy = false,
  paused = false,
  wake: (() => void) | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Decode a song's file for analysis only: 22 kHz mono for the built-in analysis (a quarter of the memory of a full
 *  decode); 44.1 kHz stereo when the neural engine will run (HTDemucs separates the drums at that rate, on both channels). */
export async function decodeForAnalysis(id: string, loudnessOnly = false) {
  const r = await fetch(mediaUrl(id));
  if (!r.ok) throw new Error('read');
  const neural = !loudnessOnly && rhythmEngine() !== 'dsp' && (await neuralStatus()).ok;
  return new OfflineAudioContext(neural ? 2 : 1, 1, neural ? 44100 : 22050).decodeAudioData(await r.arrayBuffer());
}
/** Songs analysed in a hurry (the player was waiting: the neural engine's beats only, no drum stem), to be analysed
 *  whole once the library's queue is through; the next play of each reads the full analysis. */
const upgrade = new Set<string>();
/** Analyse one song now (the player calls this for a song it needs and the cache does not have). */
const inflight = new Map<string, Promise<RhythmAnalysis>>();
export function analyzeNow(id: string, decoded?: AudioBuffer | null, urgent = false): Promise<RhythmAnalysis> {
  let p = inflight.get(id);
  if (!p) {
    // (needed at once: the beats on the GPU have 20 s, else the built-in analysis answers; the drums come later)
    // (in the background the GPU has a time in proportion to the song — a minute and a little over half the song's own
    // length — then the built-in analysis answers: a slow or stalled GPU never holds the whole library's queue)
    p = (async () => {
      const buf = decoded || (await decodeForAnalysis(id)),
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
        await Lib?.analysisFailed(id, why);
        throw Object.assign(new Error(why), { reported: true });
      }
      await Lib?.saveAnalysis(id, a);
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
    })();
    inflight.set(id, p);
    p.finally(() => inflight.delete(id));
  }
  return p;
}
async function loop() {
  if (busy || !Lib) return;
  busy = true;
  try {
    for (;;) {
      while (paused)
        await new Promise<void>((r) => {
          wake = r;
        });
      const job =
        (await Lib.nextAnalysis(RHYTHM_VERSION)) ||
        (upgrade.size ? { id: upgrade.values().next().value as string, only: undefined } : null);
      // the queue done: the cached analyses not checked yet are read and checked (validate.ts), one at a time — a sound one
      // is remembered as checked, a broken one (cut short, written by a faulty run) goes back to be analysed
      if (!job) {
        if (await verifyCached()) continue;
        break;
      }
      upgrade.delete(job.id);
      if (job.only === 'loudness') {
        // a song analysed before the volume balance: only how loud it is
        try {
          await Lib.saveLoudness(job.id, await loudnessInBackground(await decodeForAnalysis(job.id, true)));
        } catch {
          await Lib.saveLoudness(job.id, null);
        }
      } else
        try {
          await analyzeNow(job.id);
        } catch (e) {
          if (!(e as { reported?: boolean }).reported)
            await Lib.analysisFailed(job.id, String((e as Error)?.message || e).slice(0, 200));
        }
      await sleep(120);
    }
  } finally {
    busy = false;
  }
}
/** Check the cached analyses not yet checked; true when any was sent back to be analysed. */
async function verifyCached(): Promise<boolean> {
  if (!Lib) return false;
  let bad = false;
  for (const id of await Lib.unverified(RHYTHM_VERSION).catch(() => [] as string[])) {
    while (paused)
      await new Promise<void>((r) => {
        wake = r;
      });
    // (no length to compare with here: a tag's duration can be off — that check is made against decoded audio only)
    const a = await Lib.analysis(id, RHYTHM_VERSION).catch(() => null),
      why = checkAnalysis(a);
    if (why) {
      console.warn('[analysis] cached analysis of', id, 'is unsound:', why);
      await Lib.reanalyze([id]);
      bad = true;
    } else await Lib.verified(id, RHYTHM_VERSION);
    await sleep(40);
  }
  return bad;
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
