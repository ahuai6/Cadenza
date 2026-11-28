// The native inference process (an Electron utility process): the rhythm engine's two networks, Beat This! and
// HTDemucs, run by ONNX Runtime on the machine's own GPU — DirectML on Windows, CoreML on macOS, the CPU elsewhere —
// in place of the page's WebGPU kernels. It runs the networks only; what goes in and what is read from their answers
// (the mel spectrogram, the windows and segments, the beats, the drum hits, the voice) stay the page's (src/rhythm/neural).
// One request at a time, from the main process (inferHost.cjs): 'beat' (one 1500-frame mel window → beat and downbeat
// logits) and 'separate' (one HTDemucs segment, 44.1 kHz stereo → the drum and vocal stems). A session is made on first
// use; the first time on a machine its optimised graph is written beside the models, so later it opens in a moment.
// The models: Beat This! final0 (MIT, CPJKU; ONNX export musetric/beat-this-onnx), HTDemucs (MIT, Meta; ONNX export
// StemSplitio/htdemucs-onnx). Part of Cadenza, AGPL-3.0-only (LICENSE, NOTICE.md).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let ort = null,
  dir = '',
  eps = [],
  epName = 'cpu';
const sessions = new Map();
// A network the GPU provider cannot run here goes to the CPU. HTDemucs on DirectML runs out of memory on some machines
// in its closing inverse STFT (a ConvTranspose over the whole segment, 8007000E on an 8 GB laptop RTX 3070 Ti, with or
// without the optimised graph), where Beat This! runs: the stems are then separated on the CPU (about 2–5 s a 7.8 s
// segment), with few threads so the machine stays free for playback and the picture. Noted beside the models, so a
// later process goes to the CPU at once; a new choice of device forgets it (inferHost.cjs).
const onCpu = new Set();
/** threads for a network moved to the CPU: a background job, never most of the machine */
const CPU_THREADS = Math.max(2, Math.min(4, Math.floor(os.cpus().length / 4)));
const unusable = (name) => path.join(dir, 'cache', `${name}-${epName}-${ort.env.versions?.common || 'ort'}.unusable`);
/** The execution providers to try, best first (the CPU always last). */
function providers(pref) {
  if (pref === 'cpu') return ['cpu'];
  return process.platform === 'win32' ? ['dml', 'cpu'] : process.platform === 'darwin' ? ['coreml', 'cpu'] : ['cpu'];
}
async function session(name) {
  if (sessions.has(name)) return sessions.get(name);
  const file = path.join(dir, name + '.onnx');
  if (!fs.existsSync(file)) throw new Error(`model missing: ${name}`);
  if (epName !== 'cpu' && fs.existsSync(unusable(name))) onCpu.add(name);
  const cpu = epName === 'cpu' || onCpu.has(name),
    provider = cpu ? 'cpu' : epName;
  // (the graph optimised once per machine, provider and runtime: opening the raw HTDemucs graph takes half a minute)
  const cache = path.join(dir, 'cache', `${name}-${provider}-${ort.env.versions?.common || 'ort'}.onnx`);
  const base = {
    executionProviders: cpu ? ['cpu'] : eps,
    logSeverityLevel: 3,
    ...(provider === 'dml' ? { enableMemPattern: false, executionMode: 'sequential' } : {}),
    ...(onCpu.has(name) ? { intraOpNumThreads: CPU_THREADS } : {}),
  };
  let s;
  if (fs.existsSync(cache)) {
    try {
      s = await ort.InferenceSession.create(cache, { ...base, graphOptimizationLevel: 'disabled' });
    } catch (e) {
      fs.rmSync(cache, { force: true });
    }
  }
  if (!s) {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    s = await ort.InferenceSession.create(file, {
      ...base,
      graphOptimizationLevel: 'all',
      optimizedModelFilePath: cache,
    });
  }
  sessions.set(name, s);
  return s;
}
async function init({ modelsDir, prefer }) {
  dir = modelsDir;
  ort ??= require('onnxruntime-node');
  for (const list of [providers(prefer), ['cpu']]) {
    // (a provider that cannot start here — no DirectML device, an old driver — leaves the CPU)
    try {
      eps = list;
      epName = list[0];
      for (const s of sessions.values()) await s.release();
      sessions.clear();
      await session('beat_this');
      return { ep: epName };
    } catch (e) {
      if (list.length === 1) throw e;
    }
  }
}
async function beat({ spect }) {
  const s = await session('beat_this'),
    o = await s.run({ spect: new ort.Tensor('float32', spect, [1, 1500, 128]) });
  return { beat: o.beat.data, downbeat: o.downbeat.data };
}
/** One segment (SEGMENT samples a channel) → the drum and vocal stems, each [left, right]. */
const SEGMENT = 343980,
  N = SEGMENT;
async function separate({ left, right }) {
  const mix = new Float32Array(2 * N);
  mix.set(left.subarray(0, N), 0);
  mix.set(right.subarray(0, N), N);
  const input = () => ({ mix: new ort.Tensor('float32', mix, [1, 2, N]) });
  let result;
  try {
    result = await (await session('htdemucs')).run(input());
  } catch (e) {
    if (epName === 'cpu' || onCpu.has('htdemucs')) throw e;
    // (the GPU provider cannot run it here: on the CPU from now on, this segment first)
    console.warn('[infer] htdemucs on', epName, 'failed, on the CPU instead:', String(e?.message || e).slice(-160));
    onCpu.add('htdemucs');
    try {
      fs.mkdirSync(path.dirname(unusable('htdemucs')), { recursive: true });
      fs.writeFileSync(unusable('htdemucs'), String(e?.message || e));
    } catch {
      /* noted for this process only */
    }
    await sessions.get('htdemucs')?.release();
    sessions.delete('htdemucs');
    result = await (await session('htdemucs')).run(input());
  }
  const out = result.stems.data; // [1, 4 (drums, bass, other, vocals), 2, N]
  const stem = (k) => ({
    left: out.slice(k * 2 * N, (k * 2 + 1) * N),
    right: out.slice((k * 2 + 1) * N, (k * 2 + 2) * N),
  });
  return [stem(0), stem(3)];
}
const ops = {
  init,
  beat,
  separate,
  async release() {
    for (const s of sessions.values()) await s.release();
    sessions.clear();
    return true;
  },
  /** which networks run where (for the status and the tests) */
  async where() {
    return { ep: epName, cpu: [...onCpu] };
  },
};
process.parentPort?.on('message', async ({ data: m }) => {
  try {
    const result = await ops[m.op](m.args || {});
    process.parentPort.postMessage({ id: m.id, result });
  } catch (e) {
    process.parentPort.postMessage({ id: m.id, error: String((e && e.message) || e) });
  }
});

// (the same operations, for the tests: tests/neural.cjs with NATIVE runs them in Node, in place of the utility process)
module.exports = ops;
