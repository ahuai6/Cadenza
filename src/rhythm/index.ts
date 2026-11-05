// The rhythm SDK: analysis (in a worker), the map every module queries, and the motion signals derived from it.
export * from './types';
import { checkAnalysis } from './validate';
export { RhythmMap, type BeatPos, type SelectOptions } from './map';
export { Signals, CONE, type RhythmSample, type ConeTuning } from './signals';
export { accentClock } from './accentclock';
export { analyze } from './analyze';
export { loudness, balanceDb, type Loudness } from './loudness';
export { setModelBase, setNeuralDrums, setNativeRuntime, neuralRecheck, neuralDrums, neuralStatus, type NeuralRhythm, type NeuralOptions, type NativeRuntime } from './neural';
export const rhythmEngine = () => engineSetting;

import type { RhythmAnalysis } from './types';
import type { Loudness } from './loudness';
import { neuralRhythm, neuralStatus, type NeuralOptions } from './neural';
// bundled inline (a blob: URL), so it also starts from a page loaded from file:// (the desktop app)
import AnalysisWorker from './worker.ts?worker&inline';

/* Two workers: one for the song about to play, one for the background — the one the player waits on never queues
   behind a song of the library being analysed (each worker takes its jobs one at a time). */
const workers: (Worker | null)[] = [null, null]; let nextId = 1;
const pending = new Map<number, { res: (a: RhythmAnalysis) => void; rej: (e: Error) => void; prog?: (k: number) => void }>();
function getWorker(urgent = false): Worker {
  const k = urgent ? 0 : 1, have = workers[k]; if (have) return have;
  const w = new AnalysisWorker();
  w.onmessage = (ev: MessageEvent<{ id: number; progress?: number; analysis?: RhythmAnalysis; loudness?: Loudness; error?: string }>) => {
    const p = pending.get(ev.data.id); if (!p) return;
    if (ev.data.progress != null) { p.prog?.(ev.data.progress); return; }
    pending.delete(ev.data.id);
    const v = ev.data.analysis || ev.data.loudness; if (v) p.res(v as never); else p.rej(new Error(ev.data.error || 'analysis failed'));
  };
  return (workers[k] = w);
}
/** Which engine finds the beats: 'auto' (the neural engine where it can run — WebGPU and its models — else the
 *  built-in analysis), 'neural' (the neural engine only: where it cannot run, or does not answer in time, the analysis
 *  fails rather than falling back) or 'dsp' (the built-in analysis only). */
export type RhythmEngine = 'auto' | 'neural' | 'dsp';
let engineSetting: RhythmEngine = 'auto';
export function setRhythmEngine(e: RhythmEngine) { engineSetting = e; }
/** Analyse decoded audio in the background. The channel data is copied, the caller's buffer stays usable. One
 *  interface whichever engine runs: the neural engine's reading (if any) goes into the same analysis, which is
 *  what every module reads; without it the built-in analysis finds the beats itself. */
export async function analyzeInBackground(buf: { numberOfChannels: number; sampleRate: number; getChannelData(i: number): Float32Array }, progress?: (k: number) => void, opts: NeuralOptions & { /** this once, another engine than the setting */ engine?: RhythmEngine } = {}): Promise<RhythmAnalysis> {
  const engine = opts.engine ?? engineSetting;
  const n = Math.min(2, buf.numberOfChannels), channels: Float32Array[] = [];
  for (let i = 0; i < n; i++) channels.push(new Float32Array(buf.getChannelData(i)));
  const neural = engine !== 'dsp' ? await neuralRhythm(buf, k => progress?.(k * 0.8), opts).catch(() => null) : null, k0 = neural ? 0.8 : 0;
  if (engine === 'neural' && !neural) { const st = await neuralStatus(); throw new Error(`neural engine: ${st.ok ? 'no answer in time' : st.reason}`); }
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej, prog: progress && (k => progress(k0 + (1 - k0) * k)) });
    getWorker(!!opts.urgent).postMessage({ id, channels, sampleRate: buf.sampleRate, neural }, channels.map(c => c.buffer));
  });
}
/** Measure a song's loudness in the background (a song analysed before the volume balance). */
export function loudnessInBackground(buf: { numberOfChannels: number; sampleRate: number; getChannelData(i: number): Float32Array }): Promise<Loudness> {
  const n = Math.min(2, buf.numberOfChannels), channels: Float32Array[] = [];
  for (let i = 0; i < n; i++) channels.push(new Float32Array(buf.getChannelData(i)));
  const id = nextId++;
  return new Promise((res, rej) => { pending.set(id, { res: res as never, rej }); getWorker().postMessage({ id, channels, sampleRate: buf.sampleRate, only: 'loudness' }, channels.map(c => c.buffer)); });
}
/** A cached analysis is usable only if it was made by this version of the analysis and is sound (validate.ts). */
export const isCurrent = (a: unknown, duration?: number): a is RhythmAnalysis => checkAnalysis(a, duration) == null;
export { checkAnalysis } from './validate';
export { analyzeHead, extendHead, HEAD_SECONDS } from './stream';
