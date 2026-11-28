// Isolated throughput observation. Use an explicitly licensed read-only music corpus.
// node tests/g8-library-bench.cjs <audio folder> <report.json> [dsp|auto|neural] [seconds]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron } = require('playwright');
const { initializeProfile, identifyBuild } = require('../electron/profile.cjs');

const [directory, output, mode = 'auto', seconds = '180'] = process.argv.slice(2);
assert.ok(directory && output && ['dsp', 'auto', 'neural'].includes(mode));
const audio = fs.realpathSync(directory);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-g8-library-'));
const root = path.resolve(__dirname, '..');
const waitMs = Math.max(5, Number(seconds) || 180) * 1000;
const exe = process.env.CADENZA_TEST_EXE;
initializeProfile(profile, identifyBuild(require('../package.json').version));
fs.mkdirSync(path.join(profile, 'library'), { recursive: true });
fs.writeFileSync(
  path.join(profile, 'library/db.json'),
  JSON.stringify({
    version: 2,
    folders: [audio],
    tracks: {},
    favorites: [],
    playlists: [],
    overrides: {},
    derived: {},
  }),
);
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({
    closeToTray: false,
    rhythmEngine: mode,
    rhythmRuntime: process.env.CADENZA_BENCH_NATIVE === '1' ? 'auto' : 'webgpu',
    rhythmDrums: process.env.CADENZA_BENCH_BEATS_ONLY !== '1',
  }),
);

async function run() {
  const start = performance.now();
  const flags = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];
  const launch = () =>
    _electron.launch({
      executablePath: exe || require('electron'),
      args: exe ? flags : [root, ...flags],
      env: { ...process.env, CADENZA_USER_DATA: profile },
    });
  let app = await launch();
  const observations = [];
  const known = new Set();
  const completed = [];
  const upgrades = [];
  let warm;
  let previousTask;
  let wake;
  let backend;
  const report = () =>
    fs.writeFileSync(
      output,
      JSON.stringify({ mode, audio, profile, backend, observations, completed, upgrades, warm }, null, 2),
    );
  try {
    const win = await app.firstWindow();
    await win.waitForFunction(() => window.__cadenza?.lib.get().loaded);
    backend = await win.evaluate(async () => {
      const native = await window.cadenzaInfer?.status();
      const adapter = await navigator.gpu?.requestAdapter();
      return {
        native,
        adapter: adapter ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture } : null,
      };
    });
    while (performance.now() - start < waitMs) {
      const row = await win.evaluate(async () => {
        const state = window.__cadenza.lib.get();
        return {
          jobs: await window.cadenzaLib.taskDetails(),
          task: state.analysisTask,
          fraction: state.analysisNow,
          tracks: state.tracks.map(({ id, duration, analyzed, title }) => ({ id, duration, analyzed, title })),
        };
      });
      const ms = Math.round(performance.now() - start);
      if (previousTask?.phase === 'upgrade' && previousTask.id !== row.task.id) {
        const analysis = await win.evaluate((id) => window.cadenzaLib.analysis(id, 4), previousTask.id);
        if (analysis) upgrades.push({ ms, id: previousTask.id, engine: analysis.engine, drums: analysis.stems });
      }
      previousTask = row.task;
      for (const t of row.tracks) {
        if (!t.analyzed || known.has(t.id)) continue;
        const analysis = await win.evaluate((id) => window.cadenzaLib.analysis(id, 4), t.id);
        if (!analysis) continue;
        known.add(t.id);
        completed.push({ ms, title: t.title, duration: t.duration, engine: analysis.engine, drums: analysis.stems });
      }
      const state = [
        row.task.phase,
        row.task.stage,
        row.task.id,
        row.fraction,
        row.jobs.pending,
        row.jobs.cached,
        row.jobs.unresolved,
      ];
      if (String(state) !== wake || observations.length === 0) {
        wake = String(state);
        observations.push({ ms, total: row.tracks.length, task: row.task, fraction: row.fraction, ...row.jobs });
        report();
      }
      if (
        row.tracks.length &&
        known.size === row.tracks.length &&
        row.task.phase === 'idle' &&
        (mode !== 'auto' || process.env.CADENZA_BENCH_STOP_AT_BASIC === '1')
      )
        break;
      await delay(500);
    }
    if (process.env.CADENZA_BENCH_CHECK_WARM === '1') {
      await app.close();
      app = await launch();
      const page = await app.firstWindow();
      await page.waitForFunction(() => window.__cadenza?.lib.get().loaded);
      await delay(2000);
      warm = await page.evaluate(() => window.cadenzaLib.taskDetails());
    }
    report();
    console.log(JSON.stringify({ output, profile, mode, analyzed: completed.length, last: observations.at(-1) }));
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
