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
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, CADENZA_USER_DATA: profile },
  });
  try {
    const main = await app.firstWindow();
    const errors = [];
    main.on('pageerror', (error) => errors.push(error.message));
    const edit = main.locator(
      ui === 'classic' ? '[data-test=titlebar] [data-test=edit-mode]' : '#win-btns [data-test=edit-mode]',
    );
    const open = main.locator('[data-test=open-hall]');
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
          const vault = load('./electron/online.cjs').credentialVault(dir, safeStorage);
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

    const hallWindow = app.waitForEvent('window');
    await open.click();
    const hall = await hallWindow;
    hall.on('pageerror', (error) => errors.push(error.message));
    await hall.locator('[data-test=music-hall]').waitFor();
    await hall.getByRole('tab', { name: 'Apple Music' }).waitFor();
    assert.deepEqual(
      await hall.evaluate(() => ({
        player: !!window.__cadenza,
        library: !!window.cadenzaLib,
        audio: !!window.cadenzaAudio,
        desktop: !!window.cadenzaDesktop,
        scheme: document.documentElement.dataset.theme,
        api: Object.keys(window.cadenzaHall).sort(),
      })),
      {
        player: false,
        library: false,
        audio: false,
        desktop: false,
        scheme: ui === 'space' ? 'dark' : 'light',
        api: [
          'account',
          'cancel',
          'catalog',
          'downloadAct',
          'downloadAdd',
          'downloadReveal',
          'downloadVariants',
          'downloads',
          'onAppearance',
          'onDownloads',
          'onMaximized',
          'onPreview',
          'playlists',
          'read',
          'stopPreview',
          'window',
        ],
      },
    );
    assert.equal(await get(() => window.cadenzaHall), undefined);
    const hallState = await hall.evaluate(() => window.cadenzaHall.read());
    assert.deepEqual(hallState.downloadPreference, { hasDirectory: true, tier: 'lossless' });
    assert.equal(await hall.evaluate(() => window.cadenzaHall.downloadReveal('fictional-task')), false);

    assert.equal(app.windows().length, 2);
    const tabs = hall.getByRole('tablist').getByRole('tab');
    await tabs.first().focus();
    await hall.keyboard.press('End');
    assert.equal(await tabs.last().getAttribute('aria-selected'), 'true');
    assert.equal(await tabs.last().evaluate((node) => node === document.activeElement), true);
    const search = hall.getByRole('searchbox', { name: 'Search tracks' });
    await search.waitFor();
    assert.equal(await hall.getByRole('button', { name: 'Search', exact: true }).isEnabled(), false);
    assert.equal(
      await hall.locator('[data-test=hall-titlebar]').evaluate((node) => getComputedStyle(node).webkitAppRegion),
      'drag',
    );
    assert.equal(
      await hall.locator('[data-op=max]').evaluate((node) => getComputedStyle(node).webkitAppRegion),
      'no-drag',
    );
    if (ui === 'classic' && process.platform === 'win32' && process.env.CADENZA_NATIVE_WINDOW_DRAG === '1') {
      const window = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('#hall'));
        win.focus();
        return win.getNativeWindowHandle().readBigUInt64LE().toString();
      });
      const moved = nativeDrag(window);
      if (moved === null) console.log('Windows native drag skipped: the test window did not own foreground focus');
      else assert.ok(moved >= 15);
    }
    await hall.screenshot({ path: path.join(scratch, ui + '-discover.png') });
    const max = hall.locator('[data-op=max]');
    await max.click();
    await hall.waitForFunction(() => /restore/i.test(document.querySelector('[data-op=max]').ariaLabel));
    await max.click();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('#hall'))
        .setSize(640, 480);
    });
    await hall.evaluate(() => {
      const root = document.querySelector('[data-test=hall-scroll]');
      window.testRouteTurns = [];
      new MutationObserver((records) => {
        for (const entry of records) {
          if (entry.type === 'attributes') window.testRouteTurns.push(entry.target.dataset.turn);
          else
            for (const node of entry.addedNodes) if (node.dataset?.turn) window.testRouteTurns.push(node.dataset.turn);
        }
      }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-turn'] });
    });
    await hall.getByRole('button', { name: 'Accounts' }).click();
    await hall.getByRole('heading', { name: 'Accounts', level: 1 }).waitFor();
    await hall.getByText('DeepSeek', { exact: true }).waitFor();
    assert.equal(
      await hall.evaluate(() => window.testRouteTurns.includes('out') && window.testRouteTurns.includes('in')),
      true,
    );
    const layout = await hall.locator('[data-test=hall-scroll]').evaluate((node) => {
      node.scrollTo(0, node.scrollHeight);
      return { wide: node.scrollWidth - node.clientWidth, scroll: node.scrollTop, width: innerWidth };
    });
    assert.ok(layout.width <= 640 && layout.wide <= 1 && layout.scroll > 0, JSON.stringify(layout));
    await hall.screenshot({ path: path.join(scratch, ui + '-accounts-compact.png') });
    if (ui === 'classic') {
      await get(() => window.cadenzaDesktop.setSettings({ theme: 'light', tone: 'paper', lang: 'zh-Hans' }));
      await hall.getByRole('heading', { name: '账号管理', level: 1 }).waitFor();
      assert.equal(await hall.evaluate(() => document.documentElement.dataset.tone), 'paper');
      await get(() => window.cadenzaDesktop.setSettings({ tone: 'white' }));
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL().endsWith('#hall'))
          .setSize(1160, 800);
      });
      await hall.getByRole('button', { name: '发现', exact: true }).click();
      await hall.getByRole('tabpanel', { name: 'Apple Music' }).getByRole('searchbox', { name: '歌曲搜索' }).waitFor();
      await hall
        .locator('[data-turn=in]')
        .last()
        .evaluate(async (node) => {
          await Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {})));
        });
      await hall.screenshot({ path: path.join(scratch, 'music-hall-zh-Hans.png') });
    }

    await hall.locator('[data-op=min]').click();
    const minimized = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL().endsWith('#hall'))
          .isMinimized(),
      );
    assert.equal(await minimized(), true);
    await open.evaluate((node) => node.click());
    assert.equal(await minimized(), false);
    assert.equal(app.windows().length, 2);
    const closed = hall.waitForEvent('close');
    await hall
      .locator('[data-op=close]')
      .click()
      .catch((error) => {
        if (!hall.isClosed()) throw error;
      });
    await closed;
    assert.equal(app.windows().length, 1);
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
    const next = app.waitForEvent('window');
    await open.click();
    const reopened = await next;
    await reopened.getByRole('tab', { name: 'Apple Music' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Pass isolated Electron', ui, layout);
  } finally {
    await app.close();
  }
}

function nativeDrag(window) {
  assert.match(window, /^\d+$/);
  const code = `
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    Add-Type @'
    using System;
    using System.Runtime.InteropServices;
    public static class HallFrameTest {
      [StructLayout(LayoutKind.Sequential)] public struct Box { public int L, T, R, B; }
      [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
      [DllImport("user32")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
      [DllImport("user32")] public static extern IntPtr GetForegroundWindow();
      [DllImport("user32")] public static extern bool GetWindowRect(IntPtr win, out Box box);
      [DllImport("user32")] public static extern uint GetDpiForWindow(IntPtr win);
      [DllImport("user32")] public static extern bool GetCursorPos(out Point point);
      [DllImport("user32")] public static extern bool SetCursorPos(int x, int y);
      [DllImport("user32")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    }
'@
    [void][HallFrameTest]::SetThreadDpiAwarenessContext([IntPtr](-4))
    $testWindow = [IntPtr]([Int64]'WINDOW_HANDLE')
    if ([HallFrameTest]::GetForegroundWindow() -ne $testWindow) { Write-Output 'not-focused'; exit }
    $dpi = [HallFrameTest]::GetDpiForWindow($testWindow) / 96.0
    $before = New-Object HallFrameTest+Box
    $after = New-Object HallFrameTest+Box
    $cursor = New-Object HallFrameTest+Point
    [void][HallFrameTest]::GetWindowRect($testWindow, [ref]$before)
    [void][HallFrameTest]::GetCursorPos([ref]$cursor)
    $x = $before.L + [int](150 * $dpi)
    $y = $before.T + [int](27 * $dpi)
    $pressed = $false
    try {
      [void][HallFrameTest]::SetCursorPos($x, $y)
      if ([HallFrameTest]::GetForegroundWindow() -ne $testWindow) { Write-Output 'not-focused'; exit }
      [HallFrameTest]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
      $pressed = $true
      foreach ($step in 1..6) {
        Start-Sleep -Milliseconds 35
        [void][HallFrameTest]::SetCursorPos($x + $step * 7, $y + $step * 5)
      }
    } finally {
      if ($pressed) { [HallFrameTest]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }
      [void][HallFrameTest]::SetCursorPos($cursor.X, $cursor.Y)
    }
    [void][HallFrameTest]::GetWindowRect($testWindow, [ref]$after)
    $after.L - $before.L
  `.replace('WINDOW_HANDLE', window);
  const result = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 },
  ).trim();
  if (result === 'not-focused') return null;
  const moved = Number(result);
  console.log('Windows native drag displacement', moved);
  return moved;
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
