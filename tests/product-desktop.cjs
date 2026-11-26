const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const { identifyBuild, initializeProfile } = require('../electron/profile.cjs');

const root = path.join(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-g55-product-'));
const music = path.join(scratch, 'music');
fs.mkdirSync(music);
execFileSync('ffmpeg', [
  '-hide_banner',
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=48',
  '-metadata',
  'title=Fixture Tone',
  '-c:a',
  'pcm_s16le',
  path.join(music, 'tone.wav'),
]);
const source = '[00:01.00]Fixture lyric\n\n[00:06.00]\n';
fs.writeFileSync(path.join(music, 'tone.lrc'), source);

async function run(ui) {
  const profile = path.join(scratch, ui);
  fs.mkdirSync(profile);
  initializeProfile(profile, identifyBuild(require('../package.json').version));
  fs.mkdirSync(path.join(profile, 'library'), { recursive: true });
  fs.writeFileSync(
    path.join(profile, 'library', 'online-download-preferences.json'),
    JSON.stringify({ folder: music, tier: 'lossless' }),
  );
  fs.writeFileSync(
    path.join(profile, 'library', 'db.json'),
    JSON.stringify({
      version: 1,
      folders: [music],
      tracks: {},
      favorites: [],
      playlists: [],
      overrides: {},
    }),
  );
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      lang: 'en',
      ui,
      rhythmEngine: 'dsp',
      closeToTray: false,
      ...(ui === 'space' ? { theme: 'dark', tone: 'paper' } : {}),
    }),
  );
  const app = await _electron.launch({
    executablePath: process.env.CADENZA_TEST_EXE || require('electron'),
    args: process.env.CADENZA_TEST_EXE ? [] : [root],
    env: { ...process.env, CADENZA_USER_DATA: profile },
  });
  try {
    const main = await app.firstWindow();
    const errors = [];
    main.on('pageerror', (error) => errors.push(error.message));
    const edit = main.locator(
      ui === 'classic' ? '[data-test=titlebar] [data-test=edit-mode]' : '#win-btns [data-test=edit-mode]',
    );
    const ready = (value) =>
      main.waitForFunction((value) => {
        const button = document.querySelector('[data-test=edit-mode]');
        return button?.getAttribute('aria-pressed') === value && !button.disabled;
      }, String(value));
    const get = (fn, value) => main.evaluate(fn, value);
    await main.waitForFunction(() => window.__cadenza?.lib.get().tracks.length === 1);
    const id = await get(() => window.__cadenza.lib.get().tracks[0].id);
    await edit.waitFor();
    assert.equal(await edit.getAttribute('aria-pressed'), 'false');
    assert.equal(await get((id) => window.cadenzaLib.editMeta(id, { title: 'Blocked' }), id), false);
    assert.equal(await get((id) => window.cadenzaLib.setSong(id, { lshift: 200 }), id), false);
    assert.equal(await get((id) => window.cadenzaLib.setCover(id, { reset: true }), id), false);
    assert.equal((await get((id) => window.cadenzaLib.writeLyrics(id, 'Blocked', 'lrc'), id)).why, 'editing-disabled');
    assert.equal(await get(() => window.__cadenza.api.useLyrics('Blocked'), null), false);
    assert.ok(await get((id) => window.cadenzaLib.playlist('create', 'Everyday', [id]), id));
    await get((id) => window.__cadenza.api.playIds([id], 0), id);
    await main.waitForFunction(
      () => window.__cadenza.api.playback.get().phase === 'playing' && !!window.__cadenza.player.get().session,
    );
    await get(() => {
      const { player, api } = window.__cadenza;
      window.productEvidence = {
        session: player.get().session,
        generation: api.playback.get().generation,
        position: api.playback.time(),
      };
    });
    await edit.click();
    await ready(true);
    assert.equal(
      await get(() => {
        const { api, player } = window.__cadenza,
          saved = window.productEvidence;
        return (
          player.get().session === saved.session &&
          api.playback.get().generation === saved.generation &&
          api.playback.get().phase === 'playing'
        );
      }),
      true,
    );

    if (ui === 'classic') {
      if (process.platform === 'win32') {
        const encrypted = await app.evaluate(async ({ app, safeStorage }, root) => {
          const load = process.getBuiltinModule('node:module').createRequire(root + '/package.json');
          const path = load('node:path'),
            fs = load('node:fs/promises');
          const dir = path.join(app.getPath('userData'), 'library', 'credentials');
          const vault = load('./electron/credential-vault.cjs').credentialVault(dir, safeStorage);
          const scope = { domain: 'ai', provider: 'synthetic', account: 'fixture' };
          const value = 'synthetic secret for local Windows encryption';
          await vault.save(scope, { value });
          const stored = await vault.read(scope);
          const bytes = await fs.readFile(path.join(dir, (await fs.readdir(dir))[0]));
          await vault.remove(scope);
          return stored.value === value && !bytes.includes(Buffer.from(value));
        }, root);
        assert.equal(encrypted, true);
      }
      const row = main.getByText('Fixture Tone', { exact: true }).first();
      await row.click({ button: 'right' });
      const menu = main.locator('[role=menu]');
      const meta = menu.getByText(/song information|edit.*(tags|info)|metadata/i);
      await meta.first().click();
      const modal = main.locator('[data-test=modal][data-kind=meta]');
      const title = modal.locator('input').first();
      await title.fill('Kept draft');
      await main.keyboard.press('Control+Shift+E');
      await ready(false);
      await modal.getByText('Turn on Edit mode to make changes.').waitFor();
      assert.equal(await get((id) => window.cadenzaLib.editMeta(id, { title: 'Blocked again' }), id), false);
      await modal.getByRole('button', { name: 'Edit mode' }).click();
      await title.waitFor();
      assert.equal(await title.inputValue(), 'Kept draft');
      await modal.locator('button[type=submit]').click();
      await main.waitForFunction(() => window.__cadenza.lib.get().tracks[0].title === 'Kept draft');
      await edit.click();
      await ready(false);
      await main.getByText('Kept draft', { exact: true }).first().click({ button: 'right' });
      await menu.first().waitFor();
      assert.equal(await meta.count(), 0);
      assert.match(await menu.first().innerText(), /Play|Queue/);
      await main.keyboard.press('Escape');
      await get(() => window.__cadenza.api.chooseSongPreset({ kind: 'look', id: 'vinyl' }));
      assert.equal(await get(() => window.__cadenza.player.get().session.style.preset), 'vinyl');
      assert.equal(await get((id) => window.cadenzaLib.song(id), id), null);
      await edit.click();
      await ready(true);
      await get(() => window.__cadenza.api.setLyricOffset(60));
      await edit.click();
      await ready(false);
      const persisted = await get((id) => window.cadenzaLib.song(id), id);
      assert.equal(persisted.lshift, 60);
      assert.equal(persisted.style, undefined);
    } else {
      await edit.click();
      await ready(false);
      await main.locator('#p-extra button').first().click();
      const panel = main.locator('[data-test=space-lyrics]');
      await panel.waitFor();
      assert.equal(await panel.locator('textarea').count(), 0);
      await main.keyboard.press('Control+Shift+E');
      await ready(true);
      // The edit button is the only non-close command in the lyrics panel's header.
      await panel.locator('header button').first().click();
      const draft = panel.locator('textarea');
      await draft.fill(source + '\n[00:08.00]Unsaved');
      await main.keyboard.press('Control+Shift+E');
      await ready(false);
      await draft.waitFor({ state: 'detached' });
      await main.keyboard.press('Control+Shift+E');
      await ready(true);
      await draft.waitFor();
      assert.equal(await draft.inputValue(), source + '\n[00:08.00]Unsaved');
      assert.equal(fs.readFileSync(path.join(music, 'tone.lrc'), 'utf8'), source);
    }

    assert.equal(await main.locator('[data-test=open-hall]').count(), 0);
    assert.equal(await get(() => !!window.cadenzaHall || 'openMusicHall' in window.cadenzaDesktop), false);
    assert.equal(app.windows().length, 1);
    assert.equal(await get(() => window.__cadenza.api.playback.get().phase), 'playing');
    assert.deepEqual(errors, []);
    console.log('Pass isolated Electron', ui);
  } finally {
    await app.close();
  }
}

(async () => {
  const modes = process.argv[2] ? [process.argv[2]] : ['classic', 'space'];
  for (const mode of modes) await run(mode);
  console.log('Evidence:', scratch);
})().catch((error) => {
  console.error(error);
  console.log('Evidence:', scratch);
  process.exitCode = 1;
});
