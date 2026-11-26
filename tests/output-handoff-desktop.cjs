const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const { identifyBuild, initializeProfile } = require('../electron/profile.cjs');

const root = path.join(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-handoff-'));
const music = path.join(scratch, 'music');
const real = process.argv.includes('--real');
fs.mkdirSync(music);
for (const [filename, codec, rate] of [
  ['fixture.flac', 'flac', 48000],
  ['fixture.mp3', 'libmp3lame', 44100],
  ['aac.m4a', 'aac', 48000],
  ['alac.m4a', 'alac', 44100],
]) {
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `aevalsrc=0.03*if(lt(t\\,4)\\,sin(2*PI*375*t)\\,sin(2*PI*1125*t)):s=${rate}:d=14`,
      '-c:a',
      codec,
      path.join(music, filename),
    ],
    { windowsHide: true },
  );
}
function frequency(buffer, rate, channels, hz) {
  const count = Math.floor(buffer.length / channels / 2);
  let x = 0,
    y = 0;
  for (let i = 0; i < count; i++) {
    const value = buffer.readInt16LE(i * channels * 2) / 32768;
    x += value * Math.cos((i * 2 * Math.PI * hz) / rate);
    y += value * Math.sin((i * 2 * Math.PI * hz) / rate);
  }
  return (2 * Math.hypot(x, y)) / count;
}
async function run(mode) {
  const profile = path.join(scratch, mode);
  fs.mkdirSync(profile);
  initializeProfile(profile, identifyBuild(require('../package.json').version));
  fs.mkdirSync(path.join(profile, 'library'));
  fs.writeFileSync(path.join(profile, 'library', 'db.json'), JSON.stringify({ version: 1, folders: [music] }));
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      audioOut: 'standard',
      audioMode: mode,
      rhythmEngine: 'dsp',
      closeToTray: false,
      fixedVolume: false,
      volBalance: false,
      prerender: false,
    }),
  );
  const env = { ...process.env, CADENZA_USER_DATA: profile };
  delete env.CADENZA_AUDIO_FAKE;
  if (!real) env.CADENZA_AUDIO_FAKE = 'rates=44100,48000;fmts=i16;dump=' + path.join(profile, 'pcm');
  const app = await _electron.launch({
    executablePath: process.env.CADENZA_TEST_EXE || require('electron'),
    args: process.env.CADENZA_TEST_EXE ? [] : [root],
    env,
  });
  try {
    const win = await app.firstWindow();
    const wait = (fn, arg) => win.waitForFunction(fn, arg, { timeout: 15000 });
    await wait(() => window.__cadenza?.lib.get().tracks.length === 4);
    await win.evaluate(() => {
      const { engine, pauseAnalysis } = window.__cadenza;
      pauseAnalysis(true, 'handoff-test');
      engine.clock.warm();
      const ctx = engine.clock.ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      const quiet = ctx.createGain();
      quiet.gain.value = 0.08;
      analyser.connect(quiet).connect(ctx.destination);
      engine.audioRoute(analyser);
      const bins = new Float32Array(analyser.frequencyBinCount);
      window.signalAt = (hz) => {
        analyser.getFloatFrequencyData(bins);
        return bins[Math.round((hz * analyser.fftSize) / ctx.sampleRate)] > -63;
      };
      window.events = [];
      window.cadenzaAudio.onEvent((event) => window.events.push(event));
    });
    const signal = (hz) => wait((f) => window.signalAt(f), hz);
    const route = (name) =>
      wait((r) => {
        const state = window.__cadenza.api.playback.get();
        return state.route === r && state.phase === 'playing';
      }, name);
    for (const name of ['fixture.flac', 'fixture.mp3', 'aac.m4a', 'alac.m4a']) {
      if (real && name !== 'fixture.flac') continue;
      const start = await win.evaluate(async (file) => {
        const { api, lib, setSettings } = window.__cadenza;
        await setSettings({ audioOut: 'standard' });
        const id = lib.get().tracks.find((t) => t.file === file).id;
        await api.playIds([id], 0);
        return api.playback.get().target;
      }, name);
      await route('std');
      await signal(375);
      const up = await win.evaluate(async () => {
        const { setSettings, api } = window.__cadenza;
        const at = api.playback.time();
        const start = performance.now();
        await setSettings({ audioOut: 'hifi' });
        return { at, time: api.playback.time(), deltaMs: performance.now() - start };
      });
      await route('hifi');
      const native = await win.evaluate(() => window.events.filter((e) => e.ev === 'device' && e.open).at(-1));
      assert.ok(native);
      const beforeSeek = await win.evaluate(() => window.events.filter((e) => e.ev === 'pos' && e.run).at(-1));
      await win.evaluate(() => window.__cadenza.api.seekFile(7));
      const afterSeek = await wait(
        (old) =>
          window.events.find(
            (e) =>
              e.ev === 'pos' &&
              e.run &&
              e.processEpoch === old.processEpoch &&
              e.runId > old.runId &&
              e.seq === old.seq &&
              e.t >= 6.99,
          ),
        beforeSeek,
      );
      const observation = await afterSeek.jsonValue();
      await route('hifi');
      if (!real) {
        const raw = fs
          .readdirSync(profile)
          .filter((f) => f.endsWith('.raw'))
          .map((f) => path.join(profile, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
        assert.ok(raw);
        await new Promise((resolve) => setTimeout(resolve, 260));
        const bytes = fs.readFileSync(raw);
        const channels = native.ch || 2;
        const tail = bytes.subarray(bytes.length - Math.min(bytes.length, Math.floor(native.rate / 12) * channels * 2));
        assert.ok(
          frequency(tail, native.rate, channels, 1125) > 0.003,
          'native PCM after seek must contain the later tone',
        );
      }
      const down = await win.evaluate(async () => {
        const { setSettings, api } = window.__cadenza;
        const at = api.playback.time();
        const start = performance.now();
        await setSettings({ audioOut: 'standard' });
        return { at, time: api.playback.time(), deltaMs: performance.now() - start, target: api.playback.get().target };
      });
      await route('std');
      await signal(1125);
      assert.deepEqual(down.target, start);
      assert.ok(down.time >= down.at - 0.03 && down.time < down.at + 0.5);
      await win.evaluate(() => window.__cadenza.api.seekFile(2));
      await route('std');
      await signal(375);
      console.log(
        JSON.stringify({ name, mode, real, exclusive: native.exclusive, up, down, nativeSeek: observation.t }),
      );
    }
    await win.evaluate(async () => {
      const { setSettings, api } = window.__cadenza;
      api.toggle();
      const first = setSettings({ audioOut: 'hifi' });
      api.seekFile(8);
      const second = setSettings({ audioOut: 'standard' });
      await Promise.all([first, second]);
      if (api.playback.get().intent || api.playback.time() !== 8)
        throw new Error('paused handoff lost latest intent or seek');
      api.toggle();
    });
    await route('std');
    await signal(1125);
  } finally {
    await app.close();
  }
}
(async () => {
  await run('shared');
  await run('exclusive');
  console.log('Evidence:', scratch);
})().catch((error) => {
  console.error(error);
  console.error('Evidence:', scratch);
  process.exitCode = 1;
});
