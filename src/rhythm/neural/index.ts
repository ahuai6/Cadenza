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
  w.onmessage = (ev: MessageEvent<{ id: number; progress?: number; result?: unknown; error?: string }>) => {
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
let status: Promise<{ ok: boolean; device?: string; reason?: string }> | null = null;
export function neuralStatus() {
  return (status ??= (async () => {
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
export interface NeuralOptions { /** separate the drums (default: the setting) */ drums?: boolean; /** give up after this long (ms): the worker is dropped, the GPU let go */ timeoutMs?: number }
export async function neuralRhythm(buf: AudioLike, progress?: (k: number) => void, opts: NeuralOptions = {}): Promise<NeuralRhythm | null> {
  const st = await neuralStatus(); if (!st.ok || !base) return null;
  let tm: ReturnType<typeof setTimeout> | null = null;
  try {
    const [left, right] = await at441(buf);
    const run = call<NeuralRhythm>({ kind: 'analyse', base, left, right, drums: opts.drums ?? drumsOn }, [left.buffer, right.buffer], progress);
    if (!opts.timeoutMs) return await run;
    return await Promise.race([run, new Promise<never>((_, rej) => { tm = setTimeout(() => rej(new Error(`no answer in ${opts.timeoutMs} ms`)), opts.timeoutMs); })]);
  } catch (e) {
    console.warn('[neural] analysis failed, the built-in analysis takes over:', (e as Error).message);
    drop();          // (a lost device or a failed pipeline leaves nothing worth keeping: the next song gets a fresh worker)
    return null;
  } finally { if (tm) clearTimeout(tm); }
}
