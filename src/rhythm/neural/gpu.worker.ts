/// <reference types="@webgpu/types" />
// The neural engine's thread: its own WebGPU device and the two models on it, Beat This! (beats and downbeats) and
// HTDemucs (the drum stem), each loaded on first use. One request is a whole song: 44.1 kHz stereo in, NeuralRhythm
// out (with progress). Every chunk and segment runs with 'auto' slicing — one stage on the GPU at a time, cut finer
// wherever a stage outlasts a 120 Hz frame — so the lyrics drawn on the same GPU keep their frames.
// The worker's structure follows Folia's src/workers/beatThisGpu.worker.ts (https://github.com/chthollyphile/folia-major,
// AGPL-3.0). Part of Cadenza, AGPL-3.0-only (LICENSE, NOTICE.md).
import { BeatThisWgsl, type BeatThisWgslManifest } from './wgsl/beatthis-runtime';
import { HtdemucsWgsl, type HtdemucsWgslManifest } from './wgsl/htdemucs-runtime';
import { runPercussiveEnergy } from './wgsl/percussive';
import { melSpectrogram } from './mel';
import { splitForModel, aggregateChunks, beatsFromLogits } from './grid';
import { computeBeatAccents, formatBeatMeter } from './accents';
import { separateStems, pickDrumHits, drumCoverage, energyFrames, halve, DRUMLESS_COVERAGE } from './drums';
import { voiceLevel, VOICE_RATE } from './vocals';
import { loadModel } from './weights';
import type { NeuralRhythm } from './types';

type Req =
  | { id: number; kind: 'probe' }
  | {
      id: number;
      kind: 'analyse';
      base: string;
      left: Float32Array;
      right: Float32Array;
      drums: boolean;
      native?: { label: string; segment: number };
    }
  | { id: number; kind: 'dispose' };

let device: GPUDevice | null = null,
  label = '',
  f16 = false,
  lost: string | null = null;
let beatThis: BeatThisWgsl | null = null,
  demucs: HtdemucsWgsl | null = null,
  demucsIdle: ReturnType<typeof setTimeout> | null = null;
const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);
/* The networks run natively (desktop: electron/infer.cjs, through the page — rhythm/neural/index.ts): each pass asked of
   the page, answered as a message of its own. Everything around the passes (the mel spectrogram, the windows, the
   segments, what is read from the answers) is this worker's either way. */
let nextRpc = 1;
const rpcs = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
function native<T>(op: 'beat' | 'separate', args: Record<string, Float32Array>): Promise<T> {
  const rpc = nextRpc++;
  return new Promise<T>((res, rej) => {
    rpcs.set(rpc, { res, rej });
    post({ rpc, op, args });
  });
}
/** A Beat This! window as the native graph takes it: 1500 frames, a shorter one padded after its end. */
const window1500 = (data: Float32Array) => {
  if (data.length === 1500 * 128) return data;
  const w = new Float32Array(1500 * 128);
  w.set(data);
  return w;
};

async function openDevice(): Promise<GPUDevice> {
  if (lost) throw new Error(lost);
  if (device) return device;
  if (!navigator.gpu) throw new Error('no WebGPU in this worker');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  f16 = adapter.features.has('shader-f16');
  const d = await adapter.requestDevice({
    requiredFeatures: f16 ? ['shader-f16'] : [],
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  d.lost.then((info) => {
    lost = `device lost (${info.reason}): ${info.message}`;
    beatThis = null;
    demucs = null;
    device = null;
  });
  label = `${adapter.info?.vendor || 'gpu'} ${adapter.info?.architecture || ''}`.trim() + (f16 ? ' f16' : '');
  return (device = d);
}

async function analyse(r: Extract<Req, { kind: 'analyse' }>): Promise<NeuralRhythm> {
  const nat = r.native,
    t0 = performance.now(),
    prog = (k: number) => post({ id: r.id, progress: k });
  // (natively, the GPU here is only wanted for the percussive energy — and done without where there is none)
  const dev = nat ? await openDevice().catch(() => null) : await openDevice(),
    who = nat ? nat.label : label;
  // the beats: Beat This! over the 22.05 kHz mono mix, in 30 s chunks
  if (!nat && !beatThis) {
    const { weights, manifest } = await loadModel<BeatThisWgslManifest>(r.base, 'beat_this');
    beatThis = await BeatThisWgsl.create(dev!, weights, manifest, { f16: f16 ? 'storage' : undefined });
  }
  const n = r.left.length,
    mix = new Float32Array(n);
  for (let i = 0; i < n; i++) mix[i] = (r.left[i] + r.right[i]) / 2;
  const mel = melSpectrogram(halve(mix));
  prog(0.1);
  const chunks = splitForModel(mel),
    preds = [];
  for (let k = 0; k < chunks.length; k++) {
    const c = chunks[k];
    const out = nat
      ? await native<{ beat: Float32Array; downbeat: Float32Array }>('beat', { spect: window1500(c.data) })
      : await beatThis!.run(c.data, { slice: 'auto' });
    preds.push({
      start: c.start,
      frames: c.frames,
      beat: out.beat.slice(0, c.frames),
      downbeat: out.downbeat.slice(0, c.frames),
    });
    prog(0.1 + (0.25 * (k + 1)) / chunks.length);
  }
  const track = aggregateChunks(preds, mel.frames),
    grid = beatsFromLogits(track.beat, track.downbeat);
  let energy = null;
  if (dev)
    try {
      energy = await runPercussiveEnergy(dev, mel.data, mel.frames);
    } catch (e) {
      console.warn('[neural] percussive energy failed', e);
    }
  const A = computeBeatAccents(mel, grid.beats, grid.downbeats, energy, track.beat);
  const tBeats = performance.now() - t0;
  prog(0.4);
  console.info(`[neural] beats: ${formatBeatMeter(A.meter, A.pulse)} | ${who} | ${tBeats.toFixed(0)} ms`);
  // the drums: HTDemucs' drum stem, segment by segment, then the hits off its spectrogram
  let drums: NeuralRhythm['drums'] = null,
    drumless = false,
    drumsRun = false,
    voice: NeuralRhythm['voice'] = null;
  const t1 = performance.now();
  if (r.drums) {
    try {
      if (demucsIdle) {
        clearTimeout(demucsIdle);
        demucsIdle = null;
      }
      // (the drums and the voice: two iSTFTs of the four; f16 GEMMs where the device has them — Folia: the same drum
      // hits, a tenth faster)
      // (natively: a longer segment, the native graph's own — its drum and vocal stems handed back)
      let st: Float32Array[] | null;
      if (nat)
        st = await separateStems(
          r.left,
          r.right,
          (l, rr) => native<{ left: Float32Array; right: Float32Array }[]>('separate', { left: l, right: rr }),
          (k) => prog(0.4 + 0.58 * k),
          undefined,
          nat.segment,
        );
      else {
        if (!demucs) {
          const { weights, manifest } = await loadModel<HtdemucsWgslManifest>(r.base, 'htdemucs');
          demucs = await HtdemucsWgsl.create(dev!, weights, manifest, { sources: [0, 3], f16 });
        }
        const D = demucs;
        st = await separateStems(
          r.left,
          r.right,
          async (l, rr) => (await D.run(l, rr, { slice: 'auto' })).stems,
          (k) => prog(0.4 + 0.58 * k),
        );
      }
      const stem = st?.[0];
      // the voice: where it sings (the lyrics are cut where it breathes)
      if (st?.[1]) {
        const v = voiceLevel(st[1], mix);
        voice = v ? { rate: VOICE_RATE, v } : null;
        console.info(`[neural] voice: ${v ? `${v.length} frames` : 'none'}`);
      }
      if (stem) {
        drumsRun = true;
        const coverage = drumCoverage(energyFrames(stem), energyFrames(mix));
        drumless = coverage < DRUMLESS_COVERAGE;
        if (!drumless) {
          const h = pickDrumHits(melSpectrogram(halve(stem)));
          drums = {
            times: h.times.map((t) => +t.toFixed(4)),
            strengths: h.strengths.map((s) => +s.toFixed(3)),
            kinds: h.kinds,
            coverage: +coverage.toFixed(3),
          };
        }
        console.info(
          `[neural] drums: ${drumless ? 'drumless' : `${drums!.times.length} hits`} | coverage ${coverage.toFixed(3)} | ${(performance.now() - t1).toFixed(0)} ms`,
        );
      }
    } catch (e) {
      console.warn('[neural] drum stem failed', e);
    }
    // (HTDemucs holds ~350 MB on the GPU: let go a minute after the last song)
    if (!nat)
      demucsIdle = setTimeout(() => {
        demucs?.destroy();
        demucs = null;
        demucsIdle = null;
      }, 60_000);
  }
  prog(1);
  return {
    model: `beat_this final0 · ${who}`,
    beats: grid.beats.map((t) => +t.toFixed(4)),
    downbeats: grid.downbeats.map((t) => +t.toFixed(4)),
    impact: A.impact,
    low: A.low,
    mid: A.mid,
    high: A.high,
    rhythmic: A.rhythmic,
    pulse: A.pulse,
    confidence: A.confidence,
    trackScale: A.trackScale,
    group: A.meter.group,
    usual: A.meter.usual,
    drums,
    drumless,
    drumsRun,
    voice,
    ms: { beats: Math.round(tBeats), drums: Math.round(performance.now() - t1) },
  };
}

self.onmessage = async (ev: MessageEvent<Req | { rpc: number; result?: unknown; error?: string }>) => {
  // (a native pass answered)
  if ('rpc' in ev.data) {
    const p = rpcs.get(ev.data.rpc);
    if (!p) return;
    rpcs.delete(ev.data.rpc);
    if (ev.data.error != null) p.rej(new Error(ev.data.error));
    else p.res(ev.data.result);
    return;
  }
  const r = ev.data;
  try {
    if (r.kind === 'probe') {
      await openDevice();
      post({ id: r.id, result: label });
      return;
    }
    if (r.kind === 'dispose') {
      beatThis?.destroy();
      demucs?.destroy();
      beatThis = demucs = null;
      device?.destroy();
      device = null;
      post({ id: r.id, result: true });
      return;
    }
    post({ id: r.id, result: await analyse(r) });
  } catch (e) {
    post({ id: r.id, error: String((e as Error)?.message ?? e) });
  }
};
