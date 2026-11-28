// The library at scale (4.0.0 phase 2): a synthetic library of CADENZA_STRESS_SONGS songs (default 10000) is scanned
// from an empty profile. Measured over three windows — the scan; 30 s afterwards while the songs' audio identities are
// still being worked out (each one a change of the library) and a play is counted; a relaunch — how long each takes,
// how much the main process's event loop and the page's main thread are held up, how many library updates reach the
// page, the largest memory of each process, and how long a counted play takes to show. Needs a Playwright that Node can
// resolve (NODE_PATH). CADENZA_STRESS_CHECK=1 reads the index back from disk after every save and compares it with the
// one in memory (a correctness run: it slows the main process). CADENZA_STRESS_ASSERT=1 asserts the budgets (they hold
// on the development machine; numbers on other hardware are for comparison). Background analysis is held throughout:
// the suite is about the index.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { identifyBuild, initializeProfile } = require('../electron/profile.cjs');
const { writeBigLibrary } = require('./fixtures/big-library.cjs');

const root = path.join(__dirname, '..');
const COUNT = Number(process.env.CADENZA_STRESS_SONGS || 10000);
const SCAN_LIMIT_MS = 15 * 60 * 1000;
const BUSY_MS = 30 * 1000;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-stress-'));
const profile = path.join(scratch, 'profile');
const music = path.join(scratch, 'music');

/** Measure in the main process from now: its event-loop delay and every process's largest working set. */
function startMain(app) {
  return app.evaluate(({ app }) => {
    const { monitorEventLoopDelay } = process.mainModule.require('node:perf_hooks');
    const m = globalThis.__stress;
    if (m) {
      m.loop.disable();
      clearInterval(m.timer);
    }
    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
    const peak = {};
    const sample = () => {
      for (const p of app.getAppMetrics()) {
        const mb = Math.round(p.memory.workingSetSize / 1024);
        peak[p.type] = Math.max(peak[p.type] || 0, mb);
      }
    };
    sample();
    globalThis.__stress = { loop, peak, timer: setInterval(sample, 1000) };
  });
}
function stopMain(app) {
  return app.evaluate(() => {
    const { loop, peak, timer } = globalThis.__stress;
    clearInterval(timer);
    loop.disable();
    const ms = (n) => +(n / 1e6).toFixed(1);
    return { loopP99: ms(loop.percentile(99)), loopMax: ms(loop.max), peakMB: peak };
  });
}

/** Measure in the page from now: long tasks and library updates. */
function startPage(page) {
  return page.evaluate(() => {
    const w = window;
    w.__stressObserver?.disconnect();
    w.__stressOff?.();
    w.__stress = { long: [], updates: 0 };
    w.__stressObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__stress.long.push(e.duration);
    });
    w.__stressObserver.observe({ type: 'longtask' });
    w.__stressOff = w.__cadenza.lib.subscribe((next, prev) => {
      if (next.tracks !== prev.tracks || next.playlists !== prev.playlists || next.favorites !== prev.favorites)
        w.__stress.updates++;
    });
  });
}
function stopPage(page) {
  return page.evaluate(() => {
    const s = window.__stress;
    window.__stressObserver.disconnect();
    window.__stressOff();
    const long = s.long.slice().sort((a, b) => a - b);
    return {
      updates: s.updates,
      longTasks: long.length,
      longTotalMs: Math.round(long.reduce((a, b) => a + b, 0)),
      longestMs: Math.round(long.at(-1) || 0),
    };
  });
}

/** what the main process said about its index being out of step with the disk (CADENZA_STORE_CHECK) */
const storeErrors = [];
async function launch() {
  const env = { ...process.env, CADENZA_USER_DATA: profile };
  // (reading the index back after every save is slow at scale: a correctness run, not a timing one)
  if (process.env.CADENZA_STRESS_CHECK === '1') env.CADENZA_STORE_CHECK = '1';
  const app = await _electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox'], env });
  app.process().stderr.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.includes('[library store]')) storeErrors.push(line);
  });
  const page = await app.firstWindow();
  page.on('crash', () => console.log('the page crashed'));
  await page.waitForFunction(() => window.__cadenza?.pauseAnalysis && window.__cadenza.lib, null, { timeout: 60000 });
  await page.evaluate(() => window.__cadenza.pauseAnalysis(true, 'stress'));
  return { app, page };
}
/** how many songs the page shows (null: the page did not answer within 10 s, or is gone) */
const shown = (page) =>
  Promise.race([
    page.evaluate(() => window.__cadenza.lib.get().tracks.length).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
  ]);

async function main() {
  fs.mkdirSync(profile);
  fs.mkdirSync(music);
  initializeProfile(profile, identifyBuild(require('../package.json').version));
  let t = Date.now();
  writeBigLibrary(music, COUNT);
  console.log(`wrote ${COUNT} songs in ${Date.now() - t} ms`);
  fs.mkdirSync(path.join(profile, 'library'));
  fs.writeFileSync(
    path.join(profile, 'library', 'db.json'),
    JSON.stringify({ version: 2, folders: [music], tracks: {}, favorites: [], playlists: [], overrides: {} }),
  );
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({ closeToTray: false, rhythmEngine: 'dsp', audioOut: 'standard', lang: 'en' }),
  );
  const results = { songs: COUNT };
  let { app, page } = await launch();
  try {
    await startMain(app);
    await startPage(page);
    t = Date.now();
    let count = 0,
      silent = 0;
    while (Date.now() - t < SCAN_LIMIT_MS) {
      const now = await shown(page);
      if (now === null) {
        // (the page stopped answering: noted, and given up on after a minute)
        if (++silent >= 6) break;
        continue;
      }
      silent = 0;
      count = now;
      if (count >= COUNT) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    results.scan = {
      ms: Date.now() - t,
      shown: count,
      pageAnswering: silent === 0,
      ...(await stopMain(app)),
      page: silent === 0 ? await stopPage(page) : null,
    };
    console.log('scan', JSON.stringify(results.scan));
    assert.equal(count, COUNT, 'every song reached the page');

    // the identities are still being worked out: the library changes song by song, as it does for a new library
    await startMain(app);
    await startPage(page);
    const id = await page.evaluate(() => window.__cadenza.lib.get().tracks[0].id);
    await page.waitForTimeout(BUSY_MS / 2);
    // a counted play, from the call to the page showing it
    const play = await page.evaluate(async (id) => {
      const { lib } = window.__cadenza;
      const t0 = performance.now();
      await window.cadenzaLib.played(id);
      while (!(lib.get().tracks.find((x) => x.id === id)?.plays >= 1)) {
        if (performance.now() - t0 > 20000) return null;
        await new Promise((r) => setTimeout(r, 5));
      }
      return Math.round(performance.now() - t0);
    }, id);
    await page.waitForTimeout(BUSY_MS / 2);
    results.busy = { ms: BUSY_MS, playShownMs: play, ...(await stopMain(app)), page: await stopPage(page) };
    console.log('busy', JSON.stringify(results.busy));
    assert.ok(play !== null, 'a counted play reached the page');
    // the page's library, kept by updates, is the library the main process holds
    const differs = await page.evaluate(async () => {
      const shownNow = window.__cadenza.lib.get();
      const whole = await window.cadenzaLib.get();
      const byId = new Map(shownNow.tracks.map((t) => [t.id, JSON.stringify(t)]));
      const off = whole.tracks.filter((t) => byId.get(t.id) !== JSON.stringify(t)).length;
      return { off, count: [shownNow.tracks.length, whole.tracks.length] };
    });
    results.busy.pageInStep = differs;
    console.log('in step', JSON.stringify(differs));
    // (identities still being worked out may land between the two reads: a few songs may differ by that)
    assert.ok(differs.count[0] === differs.count[1] && differs.off <= 3, 'the page shows the library as it is');

    // the songs' list draws about a screen of rows; its end is reached by scrolling, and the playing song is found
    const list = await page.evaluate(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const rows = () => document.querySelectorAll('[role="list"] [role="listitem"]');
      const scroller = document.querySelector('[data-scroll]');
      const drawn = rows().length;
      scroller.scrollTop = scroller.scrollHeight;
      await frame();
      const last = rows()[rows().length - 1]?.querySelector('span')?.textContent;
      scroller.scrollTop = 0;
      await frame();
      const ids = window.__cadenza.lib.get().tracks.map((t) => t.id);
      await window.__cadenza.api.playIds(ids, Math.floor(ids.length / 2), { play: false });
      await frame();
      // the playing song, halfway down: not drawn until the list is scrolled to it
      document.querySelector('[aria-label="Show the playing song"]')?.click();
      for (let i = 0; i < 30 && !document.querySelector('[role="list"] [data-cur="true"]'); i++) await frame();
      const found = document.querySelector('[role="list"] [data-cur="true"]');
      const r = found?.getBoundingClientRect(),
        v = scroller.getBoundingClientRect();
      return { drawn, last, located: !!found && r.top >= v.top && r.bottom <= v.bottom };
    });
    results.list = list;
    console.log('list', JSON.stringify(list));
    assert.ok(list.drawn < 200, 'the songs list draws only the rows near the view');
    assert.equal(list.last, String(COUNT), 'scrolled to the end, the last row is drawn');
    assert.ok(list.located, 'the playing song is found in the list, though its row was not drawn');
  } finally {
    await app.close();
  }
  const dir = path.join(profile, 'library');
  results.files = Object.fromEntries(
    fs.readdirSync(dir).flatMap((f) => (/^db\./.test(f) ? [[f, fs.statSync(path.join(dir, f)).size]] : [])),
  );

  // relaunch: from the index on disk to the library on the page
  t = Date.now();
  ({ app, page } = await launch());
  try {
    await page.waitForFunction((n) => window.__cadenza.lib.get().tracks.length >= n, COUNT, {
      timeout: 120000,
      polling: 50,
    });
    const plays = await page.evaluate(() => window.__cadenza.lib.get().tracks.reduce((a, x) => a + (x.plays || 0), 0));
    results.relaunch = { ms: Date.now() - t, playsKept: plays };
    console.log('relaunch', JSON.stringify(results.relaunch));
    assert.equal(plays, 1, 'the counted play was kept across the relaunch');
  } finally {
    await app.close();
  }
  console.log('files', JSON.stringify(results.files));
  assert.deepEqual(storeErrors, [], 'the index on disk was always the one in memory');
  fs.writeFileSync(path.join(scratch, 'results.json'), JSON.stringify(results, null, 2));
  if (process.env.CADENZA_STRESS_ASSERT === '1') {
    assert.ok(results.busy.loopMax < 100, 'the main process is never held up 100 ms while the library changes');
    assert.ok(results.busy.page.longestMs < 100, 'the page is never held up 100 ms while the library changes');
    assert.ok(results.busy.playShownMs < 500, 'a counted play shows within 0.5 s');
    assert.ok(results.busy.peakMB.Tab < 1024, 'the page stays under 1 GB');
  }
  console.log('Evidence:', scratch);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
