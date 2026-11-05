// The neural rhythm engine, as the rest of Cadenza sees it: `neuralRhythm(audio)` answers a NeuralRhythm, or null
// whenever it cannot run here (no WebGPU, no model files, a failed run) — never an error, and the caller keeps the
// built-in analysis. The analysis itself (src/rhythm/analyze.ts) turns it into the one RhythmAnalysis every module
// reads, so nothing downstream knows or cares which engine found the beats.
// Where the models are is the host's to say (`setModelBase`): the desktop app serves them as cadenza://model/, a
// test page from its own folder. Without a base the engine is off (the web build's workshop).
// Part of Cadenza, AGPL-3.0-only (LICENSE, NOTICE.md); the engine is ported from Folia (NOTICE.md).
import type { NeuralRhythm } from './types';
import { STEM_RATE } from './drums';
import GpuWorker from './gpu.worker.ts?worker&inline';

export type { NeuralRhythm } from './types';
export interface AudioLike { numberOfChannels: number; sampleRate: number; length?: number; getChannelData(i: number): Float32Array }

let base: string | null = null, drumsOn = true;
/** Where the model files are (a URL ending in '/'), or null to switch the engine off. */
export function setModelBase(url: string | null) { if (url !== base) { base = url; status = null; } }
/** The networks run natively instead (the desktop app's electron/infer.cjs: ONNX Runtime on the machine's own GPU): one
 *  Beat This! window (1500 frames × 128 mel bins → beat and downbeat logits) and one HTDemucs segment (`segment` samples
 *  a channel, 44.1 kHz stereo → the drum and the vocal stems) a call. Everything around the passes stays the worker's. */
export interface NativeRuntime {
  label: string; segment: number;
  beat(spect: Float32Array): Promise<{ beat: Float32Array; downbeat: Float32Array }>;
  separate(left: Float32Array, right: Float32Array): Promise<{ left: Float32Array; right: Float32Array }[]>;
  /** can it run now (its models there) */ ready(): Promise<boolean>;
}
let nativeRt: NativeRuntime | null = null;
/** The native runtime to use, or null for the WebGPU kernels. */
export function setNativeRuntime(rt: NativeRuntime | null) { nativeRt = rt; status = null; }
/** Ask again whether the engine can run here (its models downloaded since, its device changed). */
export function neuralRecheck() { status = null; }
/** Whether the drum stem is separated too (the heavier half: ~350 MB of GPU memory while it runs). */
export function setNeuralDrums(on: boolean) { drumsOn = on; }
export const neuralDrums = () => drumsOn;

let worker: Worker | null = null, nextId = 1, idle: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void; prog?: (k: number) => void }>();
/** The worker, and its device and models with it, go after two idle minutes (the GPU memory back at once). */
const IDLE_MS = 120_000;
function getWorker(): Worker {
  if (idle) { clearTimeout(idle); idle = null; }
  if (worker) return worker;
  const w = new GpuWorker();
  w.onmessage = (ev: MessageEvent<{ id: number; progress?: number; result?: unknown; error?: string; rpc?: number; op?: 'beat' | 'separate'; args?: Record<string, Float32Array> }>) => {
    // (a pass the worker asks of the native runtime: answered to it as a message of its own)
    if (ev.data.rpc != null) { const { rpc, op, args } = ev.data, rt = nativeRt;
      const job = !rt ? Promise.reject(new Error('no native runtime')) : op === 'beat' ? rt.beat(args!.spect) : rt.separate(args!.left, args!.right);
      job.then(result => w.postMessage({ rpc, result }), e => w.postMessage({ rpc, error: String((e as Error)?.message ?? e) })); return; }
    const p = pending.get(ev.data.id); if (!p) return;
    if (ev.data.progress != null) { p.prog?.(ev.data.progress); return; }
    pending.delete(ev.data.id); if (!pending.size) armIdle();
    if (ev.data.error != null) p.rej(new Error(ev.data.error)); else p.res(ev.data.result);
  };
  w.onerror = e => { for (const p of pending.values()) p.rej(new Error(e.message || 'neural worker failed')); pending.clear(); drop(); };
  return (worker = w);
}
function armIdle() { if (idle) clearTimeout(idle); idle = setTimeout(() => { if (!pending.size && worker) { const w = worker; call({ kind: 'dispose' }).finally(() => w.terminate()); worker = null; } }, IDLE_MS); }
function drop() { worker?.terminate(); worker = null; for (const p of pending.values()) p.rej(new Error('neural worker dropped')); pending.clear(); }
function call<T>(msg: object, transfer: Transferable[] = [], prog?: (k: number) => void): Promise<T> {
  const id = nextId++, w = getWorker();
  return new Promise<T>((res, rej) => { pending.set(id, { res, rej, prog }); w.postMessage({ ...msg, id }, transfer); });
}

/** Can the engine run here: a model base, WebGPU with an adapter, and the Beat This! file reachable. Asked once a
 *  session (the machine does not change); `reason` says why not. */
let status: Promise<{ ok: boolean; device?: string; reason?: string; native?: boolean }> | null = null;
export function neuralStatus() {
  return (status ??= (async () => {
    // (natively: its models downloaded is all it needs)
    if (nativeRt) { try { if (await nativeRt.ready()) return { ok: true, device: nativeRt.label, native: true }; } catch { /* the WebGPU kernels then */ } }
    if (!base) return { ok: false, reason: 'no models here' };
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return { ok: false, reason: 'no WebGPU' };
    try { const r = await fetch(new URL('beat_this-wgsl.bin', base).href, { method: 'HEAD' }); if (!r.ok) return { ok: false, reason: `model missing (${r.status})` }; }
    catch { return { ok: false, reason: 'model missing' }; }
    try { return { ok: true, device: await call<string>({ kind: 'probe' }) }; }
    catch (e) { return { ok: false, reason: String((e as Error).message) }; }
  })());
}

/** The song at 44.1 kHz stereo (HTDemucs' rate; Beat This! takes it halved): the browser's own resampler when the
 *  file is at another rate. */
async function at441(buf: AudioLike): Promise<[Float32Array, Float32Array]> {
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  if (buf.sampleRate === STEM_RATE) return [new Float32Array(L), new Float32Array(R)];
  const len = Math.ceil(L.length * STEM_RATE / buf.sampleRate), ctx = new OfflineAudioContext(2, len, STEM_RATE);
  const src = ctx.createBuffer(2, L.length, buf.sampleRate); src.copyToChannel(L as Float32Array<ArrayBuffer>, 0); src.copyToChannel(R as Float32Array<ArrayBuffer>, 1);
  const node = ctx.createBufferSource(); node.buffer = src; node.connect(ctx.destination); node.start();
  const out = await ctx.startRendering(); return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
}

/** The neural engine's reading of a song, or null when it cannot run here (see neuralStatus) or the run fails. */
export interface NeuralOptions {
  /** separate the drums (default: the setting) */ drums?: boolean;
  /** give up after this long (ms) of running — waiting in the queue does not count: the worker is dropped, the GPU let go */ timeoutMs?: number;
  /** the song about to play: it goes ahead of the songs waiting in the background */ urgent?: boolean;
}
/* One song at a time: the worker's networks keep their buffers between runs, so two songs at once would write over
   each other's (and a timeout on one would drop the worker under the other). Requests wait their turn — an urgent one
   ahead of the rest, in order among themselves — and an urgent one does not wait behind a background song: that run is
   stopped (the worker dropped with it) and goes back to the front of the background songs, to run again after. */
type Turn = { urgent: boolean; go: () => void };
const queue: Turn[] = [];
let running: { urgent: boolean; stopped: boolean; onStop: () => void } | null = null;
function turn(urgent: boolean, again = false): Promise<() => void> {
  return new Promise(res => {
    const go = () => { let done = false; running = { urgent, stopped: false, onStop: noop }; res(() => { if (done) return; done = true; running = null; queue.shift()?.go(); }); };
    if (!running) { go(); return; }
    const at = urgent || again ? queue.findIndex(q => !q.urgent) : -1, item = { urgent, go };
    if (at < 0) queue.push(item); else queue.splice(at, 0, item);
    if (urgent && !running.urgent && !running.stopped) { running.stopped = true; running.onStop(); }
  });
}
const noop = () => {};
const PREEMPTED = 'preempted by the song about to play';
export async function neuralRhythm(buf: AudioLike, progress?: (k: number) => void, opts: NeuralOptions = {}): Promise<NeuralRhythm | null> {
  const st = await neuralStatus(); if (!st.ok) return null;
  const native = nativeRt && st.native ? { label: nativeRt.label, segment: nativeRt.segment } : undefined;
  if (!native && !base) return null;
  for (let again = false; ; again = true) {
    const release = await turn(!!opts.urgent, again);
    let tm: ReturnType<typeof setTimeout> | null = null; const me = running!;
    try {
      const [left, right] = await at441(buf); if (me.stopped) throw new Error(PREEMPTED);
      const run = call<NeuralRhythm>({ kind: 'analyse', base, left, right, drums: opts.drums ?? drumsOn, native }, [left.buffer, right.buffer], progress);
      const stop = new Promise<never>((_, rej) => { me.onStop = () => rej(new Error(PREEMPTED)); });
      const limit = opts.timeoutMs ? [new Promise<never>((_, rej) => { tm = setTimeout(() => rej(new Error(`no answer in ${opts.timeoutMs} ms`)), opts.timeoutMs); })] : [];
      return await Promise.race([run, stop, ...limit]);
    } catch (e) {
      if (me.stopped) { if (me.onStop !== noop) drop(); continue; }   // (stopped for the song about to play: its worker goes, this song runs again after)
      drop();          // (a lost device or a failed pipeline leaves nothing worth keeping: the next song gets a fresh worker)
      console.warn('[neural] analysis failed, the built-in analysis takes over:', (e as Error).message);
      return null;
    } finally { if (tm) clearTimeout(tm); release(); }
  }
}
