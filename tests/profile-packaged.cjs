// Launch the portable executable and an extracted installer payload against the same isolated Windows profile.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { chromium } = require('playwright');

const portable = process.env.CADENZA_PROFILE_PORTABLE;
const payload = process.env.CADENZA_PROFILE_INSTALLER_PAYLOAD;
const scratch = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cadenza-g1-packaged-'));
const profile = path.join(scratch, 'profile');
fs.mkdirSync(profile);
const env = { ...process.env, CADENZA_USER_DATA: profile };
delete env.CADENZA_AUDIO_FAKE;
delete env.CADENZA_NATIVE_MODELS;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
console.log('G1 packaged fixture:', scratch);

async function open(exe, args = []) {
  const portFile = path.join(profile, 'DevToolsActivePort');
  if (fs.existsSync(portFile)) fs.unlinkSync(portFile);
  const child = spawn(exe, ['--remote-debugging-port=0', '--no-sandbox', ...args], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  let code;
  let error;
  child.once('error', (e) => {
    error = e;
  });
  child.once('exit', (exit) => {
    code = exit;
  });
  let browser;
  try {
    for (let i = 0; i < 400; i++) {
      if (error) throw error;
      if (code !== undefined) throw new Error(`The package exited before opening the renderer (${code})`);
      if (fs.existsSync(portFile)) break;
      await wait(100);
    }
    const port = +fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
    assert.ok(port > 0);
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || (await context.waitForEvent('page'));
    await page.waitForFunction(() => window.__cadenza?.lib?.get().loaded === true);
    return page.evaluate(() => ({
      version: window.__cadenza.settings.get().version,
      theme: window.__cadenza.settings.get().theme,
      playlists: window.__cadenza.lib.get().playlists.length,
    }));
  } finally {
    if (browser) {
      const session = await browser.newBrowserCDPSession().catch(() => null);
      await session?.send('Browser.close').catch(() => {});
      await browser.close().catch(() => {});
    }
    for (let i = 0; i < 60 && code === undefined && !error; i++) await wait(100);
    // Terminate only the process tree launched for this freshly created fixture.
    if (code === undefined && child.pid) {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    }
  }
}

test('both Windows package forms share the same reset and keep decisions', { timeout: 240_000 }, async () => {
  assert.ok(portable && payload, 'Set the two executable paths for the isolated package test');
  const settings = path.join(profile, 'settings.json');
  const cache = path.join(profile, 'library', 'rhythm', 'abc.json.gz');
  const output = path.join(profile, 'user-export.mp4');
  fs.writeFileSync(output, 'external export');
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark', userSentinel: 'legacy' }));
  assert.equal((await open(portable)).version, '4.0.0-alpha.1');
  assert.equal(fs.existsSync(settings), false);
  fs.writeFileSync(settings, JSON.stringify({ theme: 'light', closeToTray: false }));
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, 'cache sentinel');
  assert.equal((await open(payload)).theme, 'light');
  assert.equal(fs.readFileSync(cache, 'utf8'), 'cache sentinel');
  assert.equal((await open(payload, ['--reset-data'])).playlists, 0);
  assert.equal(fs.existsSync(cache), false);
  assert.equal(fs.readFileSync(output, 'utf8'), 'external export');
});
