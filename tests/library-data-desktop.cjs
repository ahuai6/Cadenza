// The library's data in the desktop app (4.0.0 phase 2):
// - what an earlier build kept in the page's localStorage (saved looks and motion styles, the workshop project, listening
//   choices per song, the last queue) is taken over by the main process once, the old copies left where they were, and an
//   item changed afterwards is not replaced by them again; a saved look changes only while editing is on;
// - a counted play and a new favourite survive the app being killed (the journal written after each change), and a
//   clean close leaves the whole index in db.json with an empty journal.
// Needs a Playwright that Node can resolve (NODE_PATH).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const { identifyBuild, initializeProfile } = require('../electron/profile.cjs');
const { writeBigLibrary } = require('./fixtures/big-library.cjs');

const root = path.join(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-library-data-'));
const profile = path.join(scratch, 'profile');
const music = path.join(scratch, 'music');
const libraryDir = path.join(profile, 'library');
const keptDir = path.join(libraryDir, 'kept');

async function launch() {
  const env = { ...process.env, CADENZA_USER_DATA: profile, CADENZA_STORE_CHECK: '1' };
  const app = await _electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox'], env });
  const errors = [];
  app.process().stderr.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) if (/\[(library store|kept)\]/.test(line)) errors.push(line);
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__cadenza?.lib?.get().tracks.length === 24, null, { timeout: 60000 });
  return { app, page, errors };
}

async function main() {
  fs.mkdirSync(profile);
  fs.mkdirSync(music);
  initializeProfile(profile, identifyBuild(require('../package.json').version));
  writeBigLibrary(music, 24);
  fs.mkdirSync(libraryDir);
  fs.writeFileSync(
    path.join(libraryDir, 'db.json'),
    JSON.stringify({ version: 2, folders: [music], tracks: {}, favorites: [], playlists: [], overrides: {} }),
  );
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({ closeToTray: false, rhythmEngine: 'dsp', audioOut: 'standard', lang: 'en' }),
  );

  // 1. an earlier build's copies in the page
  let { app, page, errors } = await launch();
  const ids = await page.evaluate(() => window.__cadenza.lib.get().tracks.map((t) => t.id));
  const theme = { id: 't1', name: 'Paper', style: { preset: 'custom', id: 't1', name: 'Paper' } };
  const legacy = {
    themes: [theme],
    motions: [{ id: 'm1', name: 'Slow', motion: { cut: 'drift' } }],
    last: { q: ids.slice(0, 3), i: 1 },
    project: { app: 'cadenza', lyrics: '[00:01.00]Line', name: 'Draft' },
    [`song-presets:${ids[4]}`]: [{ kind: 'look', id: 'vinyl' }],
  };
  await page.evaluate((legacy) => {
    for (const [k, v] of Object.entries(legacy)) localStorage.setItem('cz-' + k, JSON.stringify(v));
  }, legacy);
  await app.close();
  // (as if this profile had only been opened by an earlier build)
  fs.rmSync(keptDir, { recursive: true, force: true });

  ({ app, page, errors } = await launch());
  try {
    const seen = await page.evaluate(async (id) => {
      const K = window.cadenzaKept;
      return {
        themes: await K.get('themes'),
        motions: await K.get('motions'),
        queue: await K.get('queue'),
        project: await K.get('project'),
        choices: await K.get('choices'),
        stillInPage:
          localStorage.getItem('cz-themes') !== null && localStorage.getItem('cz-song-presets:' + id) !== null,
      };
    }, ids[4]);
    assert.deepEqual(seen.themes, [theme], 'saved looks taken over');
    assert.equal(seen.motions[0].id, 'm1', 'motion styles taken over');
    assert.deepEqual(seen.queue, legacy.last, 'the last queue taken over');
    assert.equal(seen.project.name, 'Draft', 'the workshop project taken over');
    assert.deepEqual(seen.choices, { [ids[4]]: legacy[`song-presets:${ids[4]}`] }, 'listening choices taken over');
    assert.ok(seen.stillInPage, "the earlier build's copies are left for it");
    assert.ok(fs.existsSync(path.join(keptDir, 'moved.json')));
    // a saved look is an edit: refused while editing is off
    assert.equal(
      await page.evaluate(() => window.cadenzaKept.set('themes', [])),
      false,
      'looks change only in editing',
    );
    // the queue changes as the listener plays: the new one stays, though the old copy is still in the page (after the
    // app has restored the last queue, which it keeps again as it does so)
    await page.waitForFunction(() => window.__cadenza.player.get().queue.length === 3);
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate((id) => window.cadenzaKept.set('queue', { q: [id], i: 0 }), ids[5]), true);
  } finally {
    await app.close();
  }
  ({ app, page, errors } = await launch());
  try {
    assert.deepEqual(await page.evaluate(() => window.cadenzaKept.get('themes')), [theme], 'the look was not changed');
    assert.deepEqual(
      await page.evaluate(() => window.cadenzaKept.get('queue')),
      { q: [ids[5]], i: 0 },
      'a changed item is not taken over again from the old copy',
    );
    console.log('pass kept items taken over once from the page, old copies left, later changes kept, edits gated');

    // 2. a counted play and a favourite, then the app killed before it can close
    await page.evaluate(async (ids) => {
      await window.cadenzaLib.played(ids[0]);
      await window.cadenzaLib.favorite(ids[1], true);
    }, ids);
    // (the save follows a change within half a second)
    await page.waitForTimeout(1500);
    assert.ok(fs.statSync(path.join(libraryDir, 'db.journal')).size > 0, 'the change went to the journal');
    assert.deepEqual(errors, []);
  } finally {
    // (the whole process tree at once, as a crash or a forced end in the task manager leaves it)
    const exited = new Promise((resolve) => app.process().once('exit', resolve));
    execFileSync('taskkill', ['/PID', String(app.process().pid), '/T', '/F'], { stdio: 'ignore' });
    await exited;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  ({ app, page, errors } = await launch());
  try {
    const kept = await page.evaluate((ids) => {
      const L = window.__cadenza.lib.get();
      return { plays: L.tracks.find((t) => t.id === ids[0]).plays, favorites: L.favorites };
    }, ids);
    assert.equal(kept.plays, 1, 'the counted play survived the kill');
    assert.deepEqual(kept.favorites, [ids[1]], 'the favourite survived the kill');
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
  const index = JSON.parse(fs.readFileSync(path.join(libraryDir, 'db.json'), 'utf8'));
  assert.equal(index.tracks[ids[0]].plays, 1, 'a clean close leaves the whole index in db.json');
  assert.equal(fs.readFileSync(path.join(libraryDir, 'db.journal'), 'utf8'), '', '…and an empty journal');
  console.log('pass changes survive a kill through the journal; a clean close folds them into db.json');
  console.log('Evidence:', scratch);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
