// Run the current Electron shell in copies. Only the OS integration and test appData path are overridden.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const renderer = path.resolve(process.env.CADENZA_PROFILE_RENDERER || path.join(root, 'dist-app'));
const scratch = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cadenza-g1-desktop-'));
const executablePath = require('electron');
const control = '.cadenza-data';
const options = { executablePath, timeout: 30_000 };
const env = { ...process.env };
for (const key of ['CADENZA_USER_DATA', 'CADENZA_NATIVE_MODELS', 'CADENZA_AUDIO_FAKE']) delete env[key];

console.log('G1 desktop fixture:', scratch);

function appFolder(label, version, stage, generation = 1) {
  const dir = path.join(scratch, label);
  fs.mkdirSync(dir);
  fs.cpSync(path.join(root, 'electron'), path.join(dir, 'electron'), { recursive: true });
  fs.symlinkSync(renderer, path.join(dir, 'dist-app'), 'junction');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'cadenza',
      productName: 'Cadenza',
      version,
      main: 'launch.cjs',
    }),
  );
  fs.writeFileSync(path.join(dir, 'electron/profile-build.json'), JSON.stringify({ stage, generation, schema: 1 }));
  fs.writeFileSync(
    path.join(dir, 'launch.cjs'),
    `
    const { app, dialog, globalShortcut } = require('electron');
    app.setPath('appData', process.env.CADENZA_G1_APP_DATA);
    app.setLoginItemSettings = () => {};
    globalShortcut.register = () => false;
    dialog.showErrorBox = (title, body) => console.error(title + ' ' + body);
    require('./electron/main.cjs');
  `,
  );
  return dir;
}

const alpha = appFolder('alpha', '4.0.0-alpha.1', 'development');
const nextGeneration = appFolder('alpha-new-generation', '4.0.0-alpha.1', 'development', 2);
const candidate = appFolder('release-candidate', '4.0.0', 'development', 2);
const formal = appFolder('formal', '4.0.0', 'stable', 2);
const upgrade = appFolder('upgrade', '4.0.1', 'stable', 2);

function scenario(name) {
  const appData = path.join(scratch, name, 'roaming');
  const profile = path.join(appData, 'Cadenza');
  fs.mkdirSync(profile, { recursive: true });
  const childEnv = { ...env, CADENZA_G1_APP_DATA: appData };
  const file = (name) => path.join(profile, name);
  function put(name, value) {
    const p = file(name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(value));
  }
  function seed(tag) {
    put('settings.json', { theme: 'light', closeToTray: false, userSentinel: tag });
    put('library/songs/abc.json', { style: tag });
    put('library/rhythm/abc.json.gz', { cache: tag });
    put('library/db.json', {
      version: 1,
      tracks: {},
      folders: [],
      favorites: ['abc'],
      playlists: [{ name: tag, tracks: ['abc'] }],
      overrides: {},
    });
  }
  function record() {
    return JSON.parse(fs.readFileSync(file(control + '/current.json'), 'utf8')).identity;
  }
  async function run(dir, args = []) {
    const app = await electron.launch({ ...options, args: [dir, '--no-sandbox', ...args], env: childEnv });
    try {
      const window = await app.firstWindow();
      await window.waitForFunction(() => window.__cadenza?.lib?.get().loaded === true);
      return {
        version: await app.evaluate(({ app }) => app.getVersion()),
        empty: await window.evaluate(() => window.__cadenza.lib.get().playlists.length === 0),
        theme: await window.evaluate(() => window.__cadenza.settings.get().theme),
      };
    } finally {
      await app.close();
    }
  }
  return { appData, profile, childEnv, file, put, seed, record, run };
}

test('real desktop opens after legacy, generation and release-stage resets, then preserves formal user data', async () => {
  const f = scenario('lifecycle');
  const predecessor = path.join(f.appData, 'Lyric Motion', 'library');
  fs.mkdirSync(predecessor, { recursive: true });
  const predecessorDb = path.join(predecessor, 'db.json');
  fs.writeFileSync(predecessorDb, JSON.stringify({ playlists: [{ name: 'Do not adopt' }] }));
  const seedExport = Buffer.from('external export');
  fs.writeFileSync(f.file('user-output.mp4'), seedExport);
  f.seed('legacy');
  assert.equal((await f.run(alpha)).empty, true);
  assert.equal(f.record().version, '4.0.0-alpha.1');
  assert.equal(fs.existsSync(f.file('library/songs/abc.json')), false);
  f.seed('alpha');
  assert.deepEqual(await f.run(alpha), { version: '4.0.0-alpha.1', empty: false, theme: 'light' });
  assert.equal((await f.run(nextGeneration)).empty, true);
  assert.equal(f.record().generation, 2);
  f.seed('generation 2');
  assert.equal((await f.run(candidate)).empty, true);
  f.seed('candidate');
  assert.equal((await f.run(formal)).empty, true);
  assert.equal(f.record().stage, 'boundary');
  f.seed('formal');
  assert.equal((await f.run(formal)).empty, false);
  assert.deepEqual(await f.run(upgrade), { version: '4.0.1', empty: false, theme: 'light' });
  assert.equal(JSON.parse(fs.readFileSync(f.file('library/songs/abc.json'))).style, 'formal');
  assert.equal(JSON.parse(fs.readFileSync(f.file('library/rhythm/abc.json.gz'))).cache, 'formal');
  assert.deepEqual(fs.readFileSync(f.file('user-output.mp4')), seedExport);
  assert.match(fs.readFileSync(predecessorDb, 'utf8'), /Do not adopt/);
});

test('the shared Electron lock prevents a secondary reset, even with the legacy lock caller', async () => {
  const f = scenario('single-instance');
  f.seed('running legacy instance');
  const dir = path.join(scratch, 'legacy-lock');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ main: 'index.cjs' }));
  fs.writeFileSync(
    path.join(dir, 'index.cjs'),
    `
    const { app, BrowserWindow } = require('electron');
    const path = require('node:path');
    app.setPath('userData', path.join(process.env.CADENZA_G1_APP_DATA, 'Cadenza'));
    if (!app.requestSingleInstanceLock()) process.exit(2);
    app.whenReady().then(() => {
      global.window = new BrowserWindow({ show: false });
      return window.loadURL('about:blank');
    });
  `,
  );
  const legacy = await electron.launch({ ...options, args: [dir, '--no-sandbox'], env: f.childEnv });
  try {
    await legacy.firstWindow();
    const exit = await new Promise((resolve, reject) => {
      const child = spawn(executablePath, [alpha, '--no-sandbox', '--reset-data'], {
        env: f.childEnv,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(exit, 0);
    assert.equal(fs.existsSync(f.file(control + '/pending.json')), false);
    assert.equal(fs.existsSync(f.file(control + '/current.json')), false);
    assert.match(fs.readFileSync(f.file('settings.json'), 'utf8'), /running legacy instance/);
  } finally {
    await legacy.close();
  }
  assert.equal((await f.run(alpha)).empty, true);
  f.seed('manual reset');
  assert.equal((await f.run(alpha, ['--reset-data'])).empty, true);
  assert.equal(fs.existsSync(f.file('library/songs/abc.json')), false);
});
