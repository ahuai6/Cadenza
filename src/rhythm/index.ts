// The rhythm SDK: analysis (in a worker), the map every module queries, and the motion signals derived from it.
export * from './types';
export { RhythmMap, type BeatPos, type SelectOptions } from './map';
export { Signals, CONE, type RhythmSample, type ConeTuning } from './signals';
export { analyze } from './analyze';

import type { RhythmAnalysis } from './types';
import { RHYTHM_VERSION } from './types';
// bundled inline (a blob: URL), so it also starts from a page loaded from file:// (the desktop app)
import AnalysisWorker from './worker.ts?worker&inline';

let worker: Worker | null = null, nextId = 1;
const pending = new Map<number, { res: (a: RhythmAnalysis) => void; rej: (e: Error) => void; prog?: (k: number) => void }>();
function getWorker(): Worker {
  if (worker) return worker;
  worker = new AnalysisWorker();
  worker.onmessage = (ev: MessageEvent<{ id: number; progress?: number; analysis?: RhythmAnalysis; error?: string }>) => {
    const p = pending.get(ev.data.id); if (!p) return;
    if (ev.data.progress != null) { p.prog?.(ev.data.progress); return; }
    pending.delete(ev.data.id);
    if (ev.data.analysis) p.res(ev.data.analysis); else p.rej(new Error(ev.data.error || 'analysis failed'));
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
/** A cached analysis is usable only if it was made by this version of the analysis. */
export const isCurrent = (a: unknown): a is RhythmAnalysis => !!a && typeof a === 'object' && (a as RhythmAnalysis).version === RHYTHM_VERSION && Array.isArray((a as RhythmAnalysis).beats);
