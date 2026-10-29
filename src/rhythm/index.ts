// The rhythm SDK: analysis (in a worker), the map every module queries, and the motion signals derived from it.
export * from './types';
export { RhythmMap, type BeatPos, type SelectOptions } from './map';
export { Signals, CONE, type RhythmSample, type ConeTuning } from './signals';
export { analyze } from './analyze';
export { loudness, balanceDb, type Loudness } from './loudness';

import type { RhythmAnalysis } from './types';
import type { Loudness } from './loudness';
import { RHYTHM_VERSION } from './types';
// bundled inline (a blob: URL), so it also starts from a page loaded from file:// (the desktop app)
import AnalysisWorker from './worker.ts?worker&inline';

let worker: Worker | null = null, nextId = 1;
const pending = new Map<number, { res: (a: RhythmAnalysis) => void; rej: (e: Error) => void; prog?: (k: number) => void }>();
function getWorker(): Worker {
  if (worker) return worker;
  worker = new AnalysisWorker();
  worker.onmessage = (ev: MessageEvent<{ id: number; progress?: number; analysis?: RhythmAnalysis; loudness?: Loudness; error?: string }>) => {
    const p = pending.get(ev.data.id); if (!p) return;
    if (ev.data.progress != null) { p.prog?.(ev.data.progress); return; }
    pending.delete(ev.data.id);
    const v = ev.data.analysis || ev.data.loudness; if (v) p.res(v as never); else p.rej(new Error(ev.data.error || 'analysis failed'));
  };
  return worker;
}
/** Analyse decoded audio in the background. The channel data is copied, the caller's buffer stays usable. */
export function analyzeInBackground(buf: { numberOfChannels: number; sampleRate: number; getChannelData(i: number): Float32Array }, progress?: (k: number) => void): Promise<RhythmAnalysis> {
  const n = Math.min(2, buf.numberOfChannels), channels: Float32Array[] = [];
  for (let i = 0; i < n; i++) channels.push(new Float32Array(buf.getChannelData(i)));
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej, prog: progress });
    getWorker().postMessage({ id, channels, sampleRate: buf.sampleRate }, channels.map(c => c.buffer));
  });
}
/** Measure a song's loudness in the background (a song analysed before the volume balance). */
export function loudnessInBackground(buf: { numberOfChannels: number; sampleRate: number; getChannelData(i: number): Float32Array }): Promise<Loudness> {
  const n = Math.min(2, buf.numberOfChannels), channels: Float32Array[] = [];
  for (let i = 0; i < n; i++) channels.push(new Float32Array(buf.getChannelData(i)));
  const id = nextId++;
  return new Promise((res, rej) => { pending.set(id, { res: res as never, rej }); getWorker().postMessage({ id, channels, sampleRate: buf.sampleRate, only: 'loudness' }, channels.map(c => c.buffer)); });
}
/** A cached analysis is usable only if it was made by this version of the analysis. */
export const isCurrent = (a: unknown): a is RhythmAnalysis => !!a && typeof a === 'object' && (a as RhythmAnalysis).version === RHYTHM_VERSION && Array.isArray((a as RhythmAnalysis).beats);
