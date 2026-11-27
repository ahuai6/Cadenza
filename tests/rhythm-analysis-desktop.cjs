const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { _electron } = require('playwright');
const { initializeProfile, identifyBuild } = require('../electron/profile.cjs');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-g6-analysis-'));
const music = path.join(scratch, 'music');
const profile = path.join(scratch, 'profile');
const baseline = process.argv.includes('--baseline');
const seconds = Number(process.env.CADENZA_ANALYSIS_SECONDS) || 900;
const wave = path.join(music, 'Long click.wav');
const alias = path.join(music, 'Long click copy.wav');
const small = path.join(music, 'Short click.flac');
const opus = path.join(music, 'Opus click.opus');
fs.mkdirSync(music);
fs.mkdirSync(profile);
const signal = 'sin(2*PI*92*t)*exp(-65*mod(t\\,0.5))*0.7';
const generate = (file, duration, codec, rate) =>
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=' + signal + ':s=' + rate + ':d=' + duration,
    '-c:a',
    codec,
    file,
  ]);
generate(wave, seconds, 'pcm_s32le', 22050);
fs.copyFileSync(wave, alias);
generate(small, 12, 'flac', 48000);
generate(opus, 12, 'libopus', 48000);
initializeProfile(profile, identifyBuild(require('../package.json').version));
fs.mkdirSync(path.join(profile, 'library'), { recursive: true });
fs.writeFileSync(
  path.join(profile, 'library', 'db.json'),
  JSON.stringify({
    version: 2,
    folders: [music],
    tracks: {},
    favorites: [],
    playlists: [],
    overrides: {},
    derived: {},
  }),
);
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ closeToTray: false, rhythmEngine: 'dsp' }));

async function launch() {
  const exe = process.env.CADENZA_TEST_EXE;
  return _electron.launch({
    executablePath: exe || require('electron'),
    args: exe ? [] : [root],
    env: { ...process.env, CADENZA_USER_DATA: profile },
  });
}
async function until(check, message, timeout = 120000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(message);
}
async function main() {
  let app = await launch();
  try {
    let win = await app.firstWindow();
    const errors = [];
    win.on('pageerror', (error) => errors.push(error.message));
    await win.waitForFunction(() => window.__cadenza?.lib.get().tracks.length === 4);
    const tracks = await win.evaluate(() => window.__cadenza.lib.get().tracks);
    const long = tracks.find((t) => t.title === 'Long click');
    const copy = tracks.find((t) => t.title === 'Long click copy');
    if (!baseline)
      await win.evaluate(() => {
        const engine = window.__cadenza.engine;
        engine.clock.warm();
        const ctx = engine.clock.ctx;
        const tap = ctx.createAnalyser();
        tap.fftSize = 1024;
        const quiet = ctx.createGain();
        quiet.gain.value = 0.04;
        tap.connect(quiet).connect(ctx.destination);
        engine.audioRoute(tap);
        const pcm = new Float32Array(tap.fftSize);
        window.analysisTestSignal = () => {
          tap.getFloatTimeDomainData(pcm);
          return pcm.some((v) => Math.abs(v) > 0.025);
        };
      });
    const waitStart = performance.now();
    await win.evaluate((id) => {
      void window.__cadenza.api.playIds([id], 0);
    }, long.id);
    await win.waitForFunction(() => window.__cadenza.api.playback.get().phase === 'playing');
    const playMs = performance.now() - waitStart;
    if (baseline) {
      await until(
        () =>
          win.evaluate(async () =>
            (await window.cadenzaLib.taskDetails()).recent.some((row) => /budget/.test(row.reason)),
          ),
        'baseline did not report the historical file budget',
      );
      console.log(
        JSON.stringify({
          baseline,
          seconds,
          fileBytes: fs.statSync(wave).size,
          playMs,
          tasks: await win.evaluate(() => window.cadenzaLib.taskDetails()),
        }),
      );
      return;
    }
    await win.waitForFunction(() => window.analysisTestSignal(), undefined, { timeout: 15000 });
    const signalMs = performance.now() - waitStart;
    assert.notEqual(
      await win.evaluate((id) => window.__cadenza.lib.get().tracks.find((track) => track.id === id).analyzed, long.id),
      4,
    );
    await win.waitForFunction(
      () =>
        window.__cadenza.player.get().session?.map?.a?.source === 'unavailable' ||
        window.__cadenza.player.get().session?.analysis?.version === 4,
    );
    const sizes = [];
    let measuring = true;
    const memory = (async () => {
      while (measuring && sizes.length < 840) {
        sizes.push(
          await app.evaluate(({ app }) => app.getAppMetrics().map(({ type, memory }) => [type, memory.privateBytes])),
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    })();
    void memory.catch(() => {});
    const seekStart = performance.now();
    await win.evaluate((at) => window.__cadenza.api.seekFile(at), seconds - 2);
    await win.waitForFunction((at) => window.__cadenza.api.playback.time() >= at - 0.2, seconds - 2);
    const seekMs = performance.now() - seekStart;
    await win.waitForFunction(
      () => window.__cadenza.lib.get().tracks.every((t) => t.audioContentId && t.analyzed === 4),
      undefined,
      { timeout: 420000 },
    );
    measuring = false;
    await memory;
    const doneMs = performance.now() - waitStart;
    const evidence = await win.evaluate(
      async ([a, b]) => {
        const [first, second] = await Promise.all([window.cadenzaLib.analysis(a, 4), window.cadenzaLib.analysis(b, 4)]);
        return { first, second, tasks: await window.cadenzaLib.taskDetails() };
      },
      [long.id, copy.id],
    );
    assert.deepEqual(evidence.first, evidence.second);
    assert.ok(evidence.first.beats.length > seconds);
    const nearEnd = evidence.first.beats.filter((t) => t > seconds - 3 && t < seconds - 0.5);
    assert.ok(nearEnd.length > 2 && nearEnd.every((t) => Math.abs(t * 2 - Math.round(t * 2)) < 0.2));
    assert.equal(
      evidence.tasks.counters.decodeCompleted,
      2,
      'one native read of the long-content alias pair and one FLAC',
    );
    assert.deepEqual(errors, []);
    const peak = (kind) =>
      Math.max(
        ...sizes
          .flat()
          .filter(([type]) => type === kind)
          .map(([, kb]) => kb),
      );
    const cacheDir = path.join(profile, 'library', 'rhythm-v2');
    const cacheBytes = fs
      .readdirSync(cacheDir)
      .filter((file) => file.endsWith('.gz'))
      .map((file) => fs.statSync(path.join(cacheDir, file)).size);
    console.log(
      JSON.stringify({
        seconds,
        playMs,
        signalMs,
        seekMs,
        doneMs,
        fileBytes: fs.statSync(wave).size,
        cacheBytes,
        nearEnd,
        rendererPrivateKiB: peak('Tab'),
        mainPrivateKiB: peak('Browser'),
        tasks: evidence.tasks,
      }),
    );
    await app.close();
    app = await launch();
    win = await app.firstWindow();
    await win.waitForFunction(
      () => {
        const tracks = window.__cadenza?.lib.get().tracks;
        return tracks?.length === 4 && tracks.every((t) => t.analyzed === 4);
      },
      undefined,
      { timeout: 120000 },
    );
    assert.ok(await win.evaluate((id) => window.cadenzaLib.analysis(id, 4), long.id));
    assert.equal((await win.evaluate(() => window.cadenzaLib.taskDetails())).counters.decodeStreams, 0);
    console.log('Pass persistent cache reuse with zero native decode after restart', scratch);
    if (process.argv.includes('--invalidate')) {
      await app.evaluate(() => {
        const { Readable } = process.getBuiltinModule('node:stream');
        const toWeb = Readable.toWeb;
        Readable.toWeb = (stream, options) => {
          const readable = toWeb.call(Readable, stream, options);
          if (options?.strategy?.highWaterMark !== 256 * 1024) return readable;
          Readable.toWeb = toWeb;
          return readable.pipeThrough(
            new TransformStream({
              async transform(chunk, controller) {
                await new Promise((resolve) => setTimeout(resolve, 80));
                controller.enqueue(chunk);
              },
            }),
          );
        };
      });
      const revoked = await win.evaluate(async (id) => {
        const before = await window.cadenzaLib.analysisToken(id);
        const reading = await window.cadenzaLib.analysis(id, 4);
        await window.cadenzaLib.reanalyze([id]);
        return before && reading && !(await window.cadenzaLib.saveAnalysis(id, reading, before));
      }, long.id);
      assert.equal(revoked, true);
      await until(
        () =>
          win.evaluate(
            async () =>
              window.__cadenza.lib.get().analysisTask.phase === 'rhythm' &&
              (await window.cadenzaLib.taskDetails()).counters.decodeStreams > 0,
          ),
        'native rhythm decode did not start',
      );
      assert.equal(await win.evaluate(() => window.cadenzaLib.clearCaches()), true);
      await until(
        () =>
          win.evaluate(async () => {
            const details = await window.cadenzaLib.taskDetails();
            return details.cached === 4 && details.counters.decodeCompleted >= 2;
          }),
        'cache did not rebuild after cleaning',
      );
      const rebuilt = await win.evaluate(() => window.cadenzaLib.taskDetails());
      assert.equal(rebuilt.failed, 0);
      assert.ok(
        rebuilt.counters.decodeStreams > rebuilt.counters.decodeCompleted,
        'clearing a running job cancels its native stream: ' + JSON.stringify(rebuilt.counters),
      );
      console.log('Pass retired write, cancellation on clear, and cache rebuild', JSON.stringify(rebuilt.counters));
    }
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error, 'Evidence:', scratch);
  process.exitCode = 1;
});
