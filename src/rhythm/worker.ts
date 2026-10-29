// The analysis runs here, off the page's thread: samples in, RhythmAnalysis out (with progress).
import { analyze } from './analyze';
import { loudness } from './loudness';
import type { NeuralRhythm } from './neural/types';

self.onmessage = (ev: MessageEvent<{ id: number; channels: Float32Array[]; sampleRate: number; only?: 'loudness'; neural?: NeuralRhythm | null }>) => {
  const { id, channels, sampleRate, only, neural } = ev.data;
  try {
    // (a song analysed before the volume balance: only its loudness is measured)
    if (only === 'loudness') { (self as unknown as Worker).postMessage({ id, loudness: loudness(channels, sampleRate) }); return; }
    const a = analyze(channels, sampleRate, { neural, progress: k => (self as unknown as Worker).postMessage({ id, progress: k }) });
    (self as unknown as Worker).postMessage({ id, analysis: a });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: String((e as Error)?.message || e) });
  }
};
