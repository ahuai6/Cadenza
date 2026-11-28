// The rhythm SDK: analysis (in a worker), the map every module queries, and the motion signals derived from it.
export * from './types';
export { RhythmPreview } from './preview';
import { checkAnalysis } from './validate';
export { RhythmMap, type BeatPos, type SelectOptions } from './map';
export { Signals, CONE, type RhythmSample, type ConeTuning } from './signals';
export { accentClock } from './accentclock';
export { analyze } from './analyze';
export { loudness, balanceDb, type Loudness } from './loudness';
export {
  setModelBase,
  setNeuralDrums,
  setNativeRuntime,
  neuralRecheck,
  neuralDrums,
  neuralStatus,
  type NeuralRhythm,
  type NeuralOptions,
  type NativeRuntime,
} from './neural';
export const rhythmEngine = () => engineSetting;

import type { RhythmAnalysis, RhythmPreviewUpdate, RhythmTaskStage } from './types';
import type { Loudness } from './loudness';
import { neuralDrums, neuralRhythm, neuralStatus, type NeuralOptions } from './neural';
// bundled inline (a blob: URL), so it also starts from a page loaded from file:// (the desktop app)
import AnalysisWorker from './worker.ts?worker&inline';
import FileAnalysisWorker from './file-analysis.worker.ts?worker&inline';

export function analyzePcm(
  url: string,
  options: {
    duration: number;
    signal: AbortSignal;
    browser?: boolean;
    onlyLoudness?: boolean;
    urgent?: boolean;
    engine?: RhythmEngine;
    preview?: (slice: RhythmPreviewUpdate) => void;
    /** a first reading of the song's opening (with preview only), long before the whole one */
    opening?: (reading: RhythmAnalysis) => void;
    stage?: (stage: RhythmTaskStage) => void;
  },
  progress?: (value: number) => void,
): Promise<{ analysis?: RhythmAnalysis; loudness?: Loudness }> {
  const { signal } = options;
  signal.throwIfAborted();
  const worker = new FileAnalysisWorker();
  const requestedDrums = neuralDrums();
  let separate = requestedDrums;
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(signal.reason);
    };
    const error = (message: string) => {
      finish();
      reject(new Error(message));
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => error(event.message || 'analysis worker failed');
    worker.onmessage = ({ data }) => {
      if (data.error) error(data.error);
      else if (data.analysis || data.loudness) {
        finish();
        resolve(data);
      } else if (data.progress !== undefined) progress?.(data.progress);
      else if (data.stage === 'merge') options.stage?.('merge');
      else if (data.preview) options.preview?.(data.preview);
      else if (data.head) options.opening?.(data.head);
      else if (data.window) {
        options.stage?.('beats');
        const window = data.window as Float32Array[];
        const input = {
          sampleRate: data.sampleRate as number,
          numberOfChannels: window.length,
          getChannelData: (index: number) => window[index],
        };
        const read = () =>
          neuralRhythm(input, undefined, {
            drums: separate,
            urgent: options.urgent,
            timeoutMs: 90000,
            signal,
            onBeats:
              options.preview || options.stage
                ? (neuralBeats) => {
                    if (!signal.aborted) {
                      if (options.preview) worker.postMessage({ neuralBeats });
                      options.stage?.('stems');
                    }
                  }
                : undefined,
          });
        // (one window the engine could not read — its worker lost, no answer in time — is read once more before the
        // song's neural reading is given up: a song of a dozen windows used to fail on any one of them)
        void read()
          .then((neural) => (neural || signal.aborted ? neural : read()))
          .then(
            (neural) => {
              if (neural && !neural.drumsRun) separate = false;
              if (!signal.aborted) {
                options.stage?.('decode');
                worker.postMessage({ neural });
              }
            },
            (reason) => {
              if (!signal.aborted) error(String(reason));
            },
          );
      }
    };
    worker.postMessage({
      url,
      duration: options.duration,
      engine: options.engine ?? engineSetting,
      onlyLoudness: !!options.onlyLoudness,
      browser: !!options.browser,
      drums: requestedDrums,
      preview: !!options.preview,
    });
  });
}

/* Two workers: one for the song about to play, one for the background — the one the player waits on never queues
   behind a song of the library being analysed (each worker takes its jobs one at a time). */
const workers: (Worker | null)[] = [null, null];
let nextId = 1;
const pending = new Map<
  number,
  { res: (a: RhythmAnalysis) => void; rej: (e: Error) => void; prog?: (k: number) => void }
>();
function getWorker(urgent = false): Worker {
  const k = urgent ? 0 : 1,
    have = workers[k];
  if (have) return have;
  const w = new AnalysisWorker();
  w.onmessage = (
    ev: MessageEvent<{ id: number; progress?: number; analysis?: RhythmAnalysis; loudness?: Loudness; error?: string }>,
  ) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    if (ev.data.progress != null) {
      p.prog?.(ev.data.progress);
      return;
    }
    pending.delete(ev.data.id);
    const v = ev.data.analysis || ev.data.loudness;
    if (v) p.res(v as never);
    else p.rej(new Error(ev.data.error || 'analysis failed'));
  };
  return (workers[k] = w);
}
/** Which engine finds the beats: 'auto' (the neural engine where it can run — WebGPU and its models — else the
 *  built-in analysis), 'neural' (the neural engine only: where it cannot run, or does not answer in time, the analysis
 *  fails rather than falling back) or 'dsp' (the built-in analysis only). */
export type RhythmEngine = 'auto' | 'neural' | 'dsp';
let engineSetting: RhythmEngine = 'auto';
export function setRhythmEngine(e: RhythmEngine) {
  engineSetting = e;
}
/** Analyse decoded audio in the background. The channel data is copied, the caller's buffer stays usable. One
 *  interface whichever engine runs: the neural engine's reading (if any) goes into the same analysis, which is
 *  what every module reads; without it the built-in analysis finds the beats itself. */
export async function analyzeInBackground(
  buf: { numberOfChannels: number; sampleRate: number; getChannelData(i: number): Float32Array },
  progress?: (k: number) => void,
  opts: NeuralOptions & { /** this once, another engine than the setting */ engine?: RhythmEngine } = {},
): Promise<RhythmAnalysis> {
  const engine = opts.engine ?? engineSetting;
  const n = Math.min(2, buf.numberOfChannels),
    channels: Float32Array[] = [];
  for (let i = 0; i < n; i++) channels.push(new Float32Array(buf.getChannelData(i)));
  const neural = engine !== 'dsp' ? await neuralRhythm(buf, (k) => progress?.(k * 0.8), opts).catch(() => null) : null,
    k0 = neural ? 0.8 : 0;
  if (engine === 'neural' && !neural) {
    const st = await neuralStatus();
    throw new Error(`neural engine: ${st.ok ? 'no answer in time' : st.reason}`);
  }
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej, prog: progress && ((k) => progress(k0 + (1 - k0) * k)) });
    getWorker(!!opts.urgent).postMessage(
      { id, channels, sampleRate: buf.sampleRate, neural },
      channels.map((c) => c.buffer),
    );
  });
}
/** Measure a song's loudness in the background (a song analysed before the volume balance). */
export function loudnessInBackground(buf: {
  numberOfChannels: number;
  sampleRate: number;
  getChannelData(i: number): Float32Array;
}): Promise<Loudness> {
  const n = Math.min(2, buf.numberOfChannels),
    channels: Float32Array[] = [];
  for (let i = 0; i < n; i++) channels.push(new Float32Array(buf.getChannelData(i)));
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, { res: res as never, rej });
    getWorker().postMessage(
      { id, channels, sampleRate: buf.sampleRate, only: 'loudness' },
      channels.map((c) => c.buffer),
    );
  });
}
/** A cached analysis is usable only if it was made by this version of the analysis and is sound (validate.ts). */
export const isCurrent = (a: unknown, duration?: number): a is RhythmAnalysis => checkAnalysis(a, duration) == null;
export { checkAnalysis } from './validate';
export { analyzeHead, extendHead, HEAD_SECONDS } from './stream';
export { OPENING_SECONDS } from './file-analysis';
