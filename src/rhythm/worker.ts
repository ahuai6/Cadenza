// The analysis runs here, off the page's thread: samples in, RhythmAnalysis out (with progress).
import { analyze } from './analyze';

self.onmessage = (ev: MessageEvent<{ id: number; channels: Float32Array[]; sampleRate: number }>) => {
  const { id, channels, sampleRate } = ev.data;
  try {
    const a = analyze(channels, sampleRate, { progress: k => (self as unknown as Worker).postMessage({ id, progress: k }) });
    (self as unknown as Worker).postMessage({ id, analysis: a });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: String((e as Error)?.message || e) });
  }
};
