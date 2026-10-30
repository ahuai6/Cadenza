// The library's rhythm analysis, in the background: the main process keeps the queue (songs the player is about to need
// first, then the most recently played and added), this page takes one song at a time, decodes it at the analysis rate
// (22 kHz: a quarter of the memory of a full decode) and runs the rhythm SDK in its worker. One song at a time, with a
// pause between songs and none at all while an export runs, so playback and the interface never compete with it.
import { analyzeInBackground, loudnessInBackground, RHYTHM_VERSION, setRhythmEngine, setModelBase, setNeuralDrums, rhythmEngine, neuralDrums, neuralStatus, type RhythmAnalysis } from '../../rhythm';
import type { Settings } from '../bridge';

/** The rhythm engine as the settings say: the desktop app serves the neural engine's models as cadenza://model/. */
export function applyRhythmSettings(st: Pick<Settings, 'rhythmEngine' | 'rhythmDrums'>) {
  setModelBase('cadenza://model/'); setRhythmEngine(st.rhythmEngine === 'dsp' || st.rhythmEngine === 'neural' ? st.rhythmEngine : 'auto'); setNeuralDrums(st.rhythmDrums !== false);
}
import { Lib, mediaUrl } from '../bridge';
import { lib } from '../state';

let busy = false, paused = false, wake: (() => void) | null = null;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Decode a song's file for analysis only: 22 kHz mono for the built-in analysis (a quarter of the memory of a full
 *  decode); 44.1 kHz stereo when the neural engine will run (HTDemucs separates the drums at that rate, on both channels). */
export async function decodeForAnalysis(id: string, loudnessOnly = false) {
  const r = await fetch(mediaUrl(id)); if (!r.ok) throw new Error('read');
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
    p = (async () => { const buf = decoded || await decodeForAnalysis(id), dur = buf.length / buf.sampleRate;
      const opts = urgent ? { drums: false, timeoutMs: 20_000 } : { timeoutMs: 60_000 + dur * 600 };
      // (the neural engine only, and it did not answer while the player waited: the song plays on a tempo grid, and is
      // analysed again in the background, with the time a background analysis has)
      const a = await analyzeInBackground(buf, k => lib.set({ analysisNow: k }), opts).catch(e => { if (urgent && rhythmEngine() === 'neural') { upgrade.add(id); setTimeout(() => loop(), 30_000); } throw e; }).finally(() => lib.set({ analysisNow: null })); await Lib?.saveAnalysis(id, a);
      // (and a song the GPU did not answer in time, when it can run at all: no second built-in pass on a machine without one)
      if (urgent && (a.stems === 'skipped' ? neuralDrums() : a.engine === 'dsp' && rhythmEngine() !== 'dsp' && (await neuralStatus()).ok)) { upgrade.add(id); setTimeout(() => loop(), 30_000); }
      return a; })();
    inflight.set(id, p); p.finally(() => inflight.delete(id));
  }
  return p;
}
async function loop() {
  if (busy || !Lib) return; busy = true;
  try {
    for (;;) {
      while (paused) await new Promise<void>(r => { wake = r; });
      const job = await Lib.nextAnalysis(RHYTHM_VERSION) || (upgrade.size ? { id: upgrade.values().next().value as string, only: undefined } : null); if (!job) break;
      upgrade.delete(job.id);
      if (job.only === 'loudness') {
        // a song analysed before the volume balance: only how loud it is
        try { await Lib.saveLoudness(job.id, await loudnessInBackground(await decodeForAnalysis(job.id, true))); } catch { await Lib.saveLoudness(job.id, null); }
      } else try { await analyzeNow(job.id); } catch { await Lib.analysisFailed(job.id); }
      await sleep(120);
    }
  } finally { busy = false; }
}
export function startAnalysis() { if (!Lib) return; Lib.onWake(() => loop()); setTimeout(loop, 1500); }
export function pauseAnalysis(on: boolean) { paused = on; if (!on) { wake?.(); wake = null; } }
