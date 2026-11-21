// A/B diagnostic for G2 and later, using graph signal rather than media events or device audibility.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');

const [root, out, mode] = process.argv.slice(2);
if (!process.env.CADENZA_BASELINE_ROOT || !out) throw new Error('Use an isolated baseline directory');
const scratch = fs.realpathSync(process.env.CADENZA_BASELINE_ROOT);
if (path.dirname(out) !== scratch || fs.existsSync(out)) throw new Error('Use an isolated baseline directory');
const profile = path.join(out, 'profile');
const music = path.join(out, 'music');
const N = 20;
const hifi = mode === '--hifi';
const rate = 48_000;
const tones = [375, 750, 1125];

function fixture(name, hz) {
  const size = rate * 12 * 2;
  const wave = Buffer.alloc(44 + size);
  wave.write('RIFF');
  wave.writeUInt32LE(36 + size, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(rate, 24);
  wave.writeUInt32LE(rate * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(size, 40);
  for (let n = 0; n < size / 2; n++) {
    wave.writeInt16LE(Math.round(7000 * Math.sin((2 * Math.PI * hz(n / rate) * n) / rate)), 44 + 2 * n);
  }
  fs.writeFileSync(path.join(music, name), wave);
}

async function fakeContinuity(page, dump) {
  const { setTimeout: delay } = require('node:timers/promises');
  const raw = path.join(dump, 'endpoint-1-48000-i16-ex.raw');
  const block = Buffer.alloc(256 * 4);
  let offset = 0;
  const id = await page.evaluate(() => {
    const { api, lib, pauseAnalysis } = window.__cadenza;
    pauseAnalysis(true, 'native continuity probe');
    api.setMode('stop');
    api.setVolume(1);
    return [...lib.get().tracks].sort((a, b) => a.file.localeCompare(b.file)).map((x) => x.id);
  });
  async function until(check) {
    const started = performance.now();
    while (performance.now() - started < 7000) {
      if (fs.existsSync(raw)) {
        const fd = fs.openSync(raw, 'r');
        try {
          while (fs.readSync(fd, block, 0, block.length, offset) === block.length) {
            let sign = 0;
            let crossings = 0;
            let peak = 0;
            for (let i = 0; i < block.length; i += 4) {
              const sample = block.readInt16LE(i);
              peak = Math.max(peak, Math.abs(sample));
              if (Math.abs(sample) < 100) continue;
              if (sign && sign !== Math.sign(sample)) crossings++;
              sign = Math.sign(sample);
            }
            const frame = offset / 4;
            offset += block.length;
            const tone = peak < 400 ? -1 : crossings >= 10 ? 2 : crossings >= 6 ? 1 : 0;
            const result = check(tone, frame);
            if (result !== undefined) return result;
          }
        } finally {
          fs.closeSync(fd);
        }
      }
      await delay(6);
    }
    throw new Error('Simulated PCM marker timed out');
  }
  const start = () => page.evaluate((ids) => window.__cadenza.api.playIds(ids, 0, { album: true }), id);
  const rows = [];
  for (let n = 0; n < N; n++) {
    await start();
    await until((tone) => (tone === 0 ? true : undefined));
    await delay(400);
    const seekStart = Date.now();
    await page.evaluate(() => window.__cadenza.api.seekFile(11.45));
    await until((tone) => (tone === 1 ? true : undefined));
    const seek = Date.now() - seekStart;
    let lastOld;
    const gap = await until((tone, frame) => {
      if (tone === 1) lastOld = frame;
      if (tone === 2 && lastOld !== undefined) return ((frame - lastOld - 256) * 1000) / rate;
    });
    await start();
    await until((tone) => (tone === 0 ? true : undefined));
    await delay(400);
    const switched = Date.now();
    await page.evaluate(() => window.__cadenza.api.playQueueAt(1));
    await until((tone) => (tone === 2 ? true : undefined));
    rows.push({ seek, gap, preloaded: Date.now() - switched });
  }
  await page.evaluate(() => window.__cadenza.api.stopPlayback());
  return rows;
}

async function run() {
  fs.mkdirSync(music, { recursive: true });
  fs.mkdirSync(profile);
  const { identifyBuild, initializeProfile } = require(path.join(root, 'electron/profile.cjs'));
  initializeProfile(profile, identifyBuild(require(path.join(root, 'package.json')).version));
  fixture('a.wav', (t) => (t < 6 ? tones[0] : tones[1]));
  fixture('b.wav', () => tones[2]);
  fs.mkdirSync(path.join(profile, 'library'));
  fs.writeFileSync(path.join(profile, 'library/db.json'), JSON.stringify({ version: 1, folders: [music], tracks: {} }));
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      lang: 'en',
      rhythmEngine: 'dsp',
      closeToTray: false,
      audioOut: hifi ? 'hifi' : 'standard',
      ...(hifi ? { audioMode: 'exclusive', fixedVolume: true } : {}),
      prerender: true,
    }),
  );
  const env = { ...process.env, CADENZA_USER_DATA: profile };
  delete env.CADENZA_AUDIO_FAKE;
  const dump = path.join(out, 'fake-dac');
  if (hifi) {
    fs.mkdirSync(dump);
    env.CADENZA_AUDIO_FAKE = 'rates=48000;fmts=i16;dump=' + path.join(dump, 'endpoint');
  }
  const app = await _electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, '--no-sandbox'],
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__cadenza?.lib.get().tracks.length === 2);
    const graphContinuity = () =>
      page.evaluate(
        async ({ tones, N }) => {
          const { api, lib, engine, pauseAnalysis } = window.__cadenza;
          const ids = [...lib.get().tracks].sort((a, b) => a.file.localeCompare(b.file)).map((x) => x.id);
          pauseAnalysis(true, 'continuity probe');
          api.setMode('stop');
          api.setVolume(1);
          engine.clock.warm();
          const ctx = engine.clock.ctx;
          await ctx.resume();
          const tap = ctx.createAnalyser(),
            silent = ctx.createGain();
          tap.fftSize = 1024;
          tap.smoothingTimeConstant = 0;
          silent.gain.value = 0;
          tap.connect(silent);
          silent.connect(ctx.destination);
          engine.audioRoute(tap);
          const data = new Float32Array(tap.frequencyBinCount);
          const bins = tones.map((f) => Math.round((f * tap.fftSize) / ctx.sampleRate));
          const sample = () => {
            tap.getFloatFrequencyData(data);
            return bins.map((b) => Math.max(data[b - 1], data[b], data[b + 1]) > -49);
          };
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const until = async (check) => {
            const start = performance.now();
            for (;;) {
              const value = check(sample(), performance.now());
              if (value !== undefined) return value;
              if (performance.now() - start > 7000) throw new Error('Graph marker timed out');
              await sleep(6);
            }
          };
          const result = [];
          for (let n = 0; n < N; n++) {
            await api.playIds(ids, 0, { album: true });
            await until(([a]) => a || undefined);
            await sleep(1800);
            const started = performance.now();
            api.seekFile(11.45);
            const seek = await until(([, a], time) => (a ? time - started : undefined));
            let end, next;
            const gap = await until(([, a, b], time) => {
              if (!a) end ??= time;
              if (b) next ??= time;
              if (end !== undefined && next !== undefined) return next - end;
            });
            await api.playIds(ids, 0, { album: true });
            await until(([a]) => a || undefined);
            await sleep(1800);
            const switched = performance.now();
            void api.playQueueAt(1);
            const preloaded = await until(([, , b], time) => (b ? time - switched : undefined));
            result.push({ seek, gap, preloaded });
          }
          api.stopPlayback();
          return result;
        },
        { N, tones },
      );
    const rows = await (hifi ? fakeContinuity(page, dump) : graphContinuity());
    const summary = Object.fromEntries(
      ['seek', 'gap', 'preloaded'].map((metric) => {
        const values = rows.map((r) => r[metric]).sort((a, b) => a - b);
        return [
          metric,
          {
            p50: values[Math.ceil(values.length * 0.5) - 1],
            p95: values[Math.ceil(values.length * 0.95) - 1],
          },
        ];
      }),
    );
    assert.equal(rows.length, N);
    console.log(JSON.stringify(summary));
    fs.writeFileSync(path.join(out, 'continuity.json'), JSON.stringify({ rows, summary }, null, 2) + '\n');
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
