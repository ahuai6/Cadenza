// Destructive cases operate only on newly generated profiles and fixtures under the system temporary directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { identifyBuild, initializeProfile, profileRoot } = require('../electron/profile.cjs');

const dev = (version = '4.0.0-alpha.1', generation = 1) =>
  identifyBuild(version, { stage: 'development', generation, schema: 1 });
const stable = (version = '4.0.0', schema = 1) => identifyBuild(version, { stage: 'stable', generation: 1, schema });

function fixture() {
  const temp = fs.realpathSync.native(os.tmpdir());
  const base = fs.mkdtempSync(path.join(temp, 'cadenza-profile-case-'));
  const profile = path.join(base, 'Cadenza');
  fs.mkdirSync(profile);
  const owned = [
    'settings.json',
    'library/db.json',
    'library/songs/song.json',
    'library/rhythm/song.json.gz',
    'models/native/beat_this.onnx',
    'Local Storage/prefs',
    'Network/Cookies',
    'Cache/entry',
  ];
  const file = (name) => path.join(profile, name);
  function put(name, value = 'sentinel') {
    const destination = file(name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, value);
  }
  function seed(value) {
    for (const name of owned) put(name, value);
  }
  function cleared() {
    for (const name of owned) assert.equal(fs.existsSync(file(name)), false, name);
  }
  function preserved(value) {
    for (const name of owned) assert.equal(fs.readFileSync(file(name), 'utf8'), value, name);
  }
  return { base, profile, file, put, seed, cleared, preserved };
}

// Before 4.0.0-alpha.5 every development version change cleared the profile. Since alpha.5 only a new data
// generation does, so testers keep their library from one local build to the next.
test('4.0.0 development clears legacy state, then only a change of generation clears again', () => {
  const f = fixture();
  const outside = path.join(f.base, 'music');
  fs.mkdirSync(outside);
  const assets = ['original.flac', 'track.lrc', 'track.ttml', 'movie.mkv', 'export.mp4'];
  for (const name of assets) fs.writeFileSync(path.join(outside, name), name);
  f.put('export.mp4', 'external export beside the profile');
  f.seed('legacy');
  assert.equal(initializeProfile(f.profile, dev()), 'reset');
  f.cleared();
  f.seed('new');
  assert.equal(initializeProfile(f.profile, dev()), 'keep');
  f.preserved('new');
  assert.equal(initializeProfile(f.profile, dev('4.0.0-alpha.2')), 'keep');
  f.preserved('new');
  assert.equal(initializeProfile(f.profile, dev('4.0.0-alpha.2', 2)), 'reset');
  f.cleared();
  f.seed('second generation');
  for (const version of ['4.0.0-beta.1', '4.0.0-rc.1', '4.0.0', '4.0.0-alpha.1']) {
    assert.equal(initializeProfile(f.profile, dev(version, 2)), 'keep');
    f.preserved('second generation');
  }
  for (const name of assets) assert.equal(fs.readFileSync(path.join(outside, name), 'utf8'), name);
  assert.equal(fs.readFileSync(f.file('export.mp4'), 'utf8'), 'external export beside the profile');
});

test('formal 4.0.0 clears once even at the same program version, then 4.0.1 preserves the data and caches', () => {
  const f = fixture();
  initializeProfile(f.profile, dev('4.0.0'));
  f.seed('test build');
  assert.equal(initializeProfile(f.profile, stable()), 'reset');
  f.cleared();
  f.seed('formal');
  assert.equal(initializeProfile(f.profile, stable()), 'keep');
  assert.equal(initializeProfile(f.profile, stable('4.0.1')), 'keep');
  f.preserved('formal');
  assert.throws(() => initializeProfile(f.profile, dev()), /older than/);
  assert.throws(() => initializeProfile(f.profile, stable()), /older than/);
  f.preserved('formal');
});

test('formal 4.0.0 can also initialize directly from legacy, and manual reset shares the transaction', () => {
  const f = fixture();
  f.seed('legacy');
  assert.equal(initializeProfile(f.profile, stable()), 'reset');
  f.cleared();
  f.seed('current');
  assert.equal(initializeProfile(f.profile, stable(), { reset: true }), 'reset');
  f.cleared();
  f.seed('after reset');
  assert.equal(initializeProfile(f.profile, stable()), 'keep');
  f.preserved('after reset');
});

test('compatible versions only migrate by explicit schema steps, fail closed on a missing step, and allow a clean install', () => {
  const f = fixture();
  f.seed('unversioned');
  assert.throws(() => initializeProfile(f.profile, stable('4.0.1')), /official 4.0.0/);
  f.preserved('unversioned');
  initializeProfile(f.profile, stable());
  f.seed('must survive');
  assert.throws(() => initializeProfile(f.profile, stable('4.0.1', 2)), /No migration/);
  let migrations = 0;
  const next = stable('4.0.1', 2);
  assert.equal(
    initializeProfile(f.profile, next, {
      migrations: {
        1(root) {
          assert.equal(root, f.profile);
          migrations++;
          f.put('library/schema2.json', '{}');
        },
      },
    }),
    'migrate',
  );
  assert.equal(initializeProfile(f.profile, next), 'keep');
  assert.equal(migrations, 1);
  f.preserved('must survive');
  assert.equal(initializeProfile(fixture().profile, stable('4.0.1')), 'keep');
});

test('a process interrupted after retiring one store resumes its journal before initializing', () => {
  const f = fixture();
  f.seed('before interrupt');
  const modulePath = require.resolve('../electron/profile.cjs');
  const interrupted = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const fs = require('node:fs'); const rename = fs.renameSync;
    const lifecycle = require(process.argv[1]);
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (to.includes('retired')) process.exit(86);
    };
    lifecycle.initializeProfile(process.argv[2], lifecycle.identifyBuild('4.0.0-alpha.1'));
  `,
      modulePath,
      f.profile,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(interrupted.status, 86, interrupted.stderr);
  assert.equal(fs.existsSync(f.file('.cadenza-data/pending.json')), true);
  assert.equal(fs.existsSync(f.file('.cadenza-data/current.json')), false);
  assert.equal(initializeProfile(f.profile, dev()), 'keep');
  f.cleared();
  assert.equal(fs.existsSync(f.file('.cadenza-data/pending.json')), false);
  assert.equal(fs.existsSync(f.file('.cadenza-data/retired')), false);
});

test('a linked or misclassified tree fails before a reset and leaves external media in place', () => {
  const f = fixture();
  f.seed('keep during failure');
  const outside = path.join(f.base, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'outside.mp4'), 'outside media');
  const link = f.file('library/linked');
  fs.symlinkSync(outside, link, 'junction');
  assert.throws(() => initializeProfile(f.profile, dev()), /reparse point|profile path is a link/i);
  f.preserved('keep during failure');
  assert.equal(fs.readFileSync(path.join(outside, 'outside.mp4'), 'utf8'), 'outside media');
  fs.unlinkSync(link);
  f.put('library/export.mp4', 'external inside a managed subtree');
  assert.throws(() => initializeProfile(f.profile, dev()), /media found/i);
  assert.equal(fs.readFileSync(f.file('library/export.mp4'), 'utf8'), 'external inside a managed subtree');
  assert.throws(
    () => initializeProfile(f.profile, dev(), { externalModels: f.file('models/native') }),
    /external model/,
  );
  f.preserved('keep during failure');
});

test('profile selection rejects an outside override and a linked canonical root', () => {
  const f = fixture();
  const stub = { getPath: () => f.base };
  assert.equal(profileRoot(stub, {}), f.profile);
  assert.equal(profileRoot(stub, { CADENZA_USER_DATA: path.join(f.base, 'another') }), path.join(f.base, 'another'));
  assert.throws(() => profileRoot(stub, { CADENZA_USER_DATA: path.resolve(os.tmpdir(), '..') }), /temporary directory/);
  const redirected = path.join(f.base, 'redirected');
  fs.mkdirSync(redirected);
  fs.symlinkSync(f.profile, path.join(redirected, 'Cadenza'), 'junction');
  assert.throws(() => profileRoot({ getPath: () => redirected }, {}), /profile path is a link/i);
});

test('an external model directory in a resumed retirement is protected before any purge', () => {
  const f = fixture();
  const external = f.file('.cadenza-data/retired/models/native');
  f.put('.cadenza-data/retired/models/native/user-model.bin', 'external');
  f.put('.cadenza-data/retired/settings.json');
  f.put(
    '.cadenza-data/pending.json',
    JSON.stringify({
      owner: 'app.cadenza.desktop',
      target: dev(),
      phase: 'purge',
      entries: ['models', 'settings.json'],
    }),
  );
  assert.throws(() => initializeProfile(f.profile, dev(), { externalModels: external }), /external model/);
  assert.equal(fs.readFileSync(path.join(external, 'user-model.bin'), 'utf8'), 'external');
  assert.equal(fs.existsSync(f.file('.cadenza-data/retired/settings.json')), true);
  assert.equal(fs.existsSync(f.file('.cadenza-data/pending.json')), true);
});

test('a corrupt or foreign transaction cannot name an outside item', () => {
  const f = fixture();
  f.seed('still here');
  f.put(
    '.cadenza-data/pending.json',
    JSON.stringify({
      owner: 'app.cadenza.desktop',
      target: dev(),
      phase: 'purge',
      entries: ['../outside'],
    }),
  );
  assert.throws(() => initializeProfile(f.profile, dev()), /Invalid pending/);
  f.preserved('still here');
});

test(
  'OS-held store causes a failed transaction, then an unlocked startup recovers',
  { skip: process.platform !== 'win32' },
  async () => {
    const f = fixture();
    f.seed('locked');
    const { spawn } = require('node:child_process');
    const control = path.join(f.base, 'ready');
    const done = path.join(f.base, 'done');
    const code = `
    $ErrorActionPreference = 'Stop'
    $file = [IO.File]::Open($env:CZ_LOCK_PATH, 'Open', 'Read', 'None')
    try {
      [IO.File]::WriteAllText($env:CZ_LOCK_READY, 'ready')
      for ($i = 0; $i -lt 200 -and ![IO.File]::Exists($env:CZ_LOCK_DONE); $i++) { Start-Sleep -Milliseconds 50 }
    } finally { $file.Dispose() }
  `;
    const exe = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const child = spawn(
      exe,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')],
      {
        env: { ...process.env, CZ_LOCK_PATH: f.file('settings.json'), CZ_LOCK_READY: control, CZ_LOCK_DONE: done },
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try {
      for (let n = 0; n < 100 && !fs.existsSync(control); n++) await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(fs.existsSync(control), true, 'exclusive file handle opened');
      assert.throws(() => initializeProfile(f.profile, dev()));
      assert.equal(fs.existsSync(f.file('.cadenza-data/current.json')), false);
    } finally {
      fs.writeFileSync(done, 'done');
      await exited;
    }
    initializeProfile(f.profile, dev());
    f.cleared();
  },
);
