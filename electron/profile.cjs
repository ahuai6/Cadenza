// Bootstrap runs while the existing Cadenza profile lock is held, before any service can open the profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const build = require('./profile-build.json');

const CONTROL = '.cadenza-data';
const OWNER = 'app.cadenza.desktop';
const CURRENT = 'current.json';
const PENDING = 'pending.json';
const RETIRED = 'retired';
// The root also holds Electron's singleton lock. Only these application/Chromium stores are eligible for retirement.
const OWNED = [
  'settings.json',
  'library',
  'models',
  'blob_storage',
  'Cache',
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Dictionaries',
  'Extension State',
  'File System',
  'GPUCache',
  'GPUPersistentCache',
  'GrShaderCache',
  'IndexedDB',
  'Local Storage',
  'Network',
  'Partitions',
  'Service Worker',
  'Session Storage',
  'ShaderCache',
  'Shared Dictionary',
  'SharedStorage',
  'WebStorage',
  'Cookies',
  'Cookies-journal',
  'Local State',
  'Preferences',
  'Secure Preferences',
  'TransportSecurity',
  'Trust Tokens',
  'Trust Tokens-journal',
  'Reporting and NEL',
  'Reporting and NEL-journal',
  'declarative_performance_observer.db',
  'declarative_performance_observer.db-journal',
  'DIPS',
  'DIPS-journal',
  'Crashpad',
  'logs',
  'DevToolsActivePort',
];
const owned = new Set(OWNED.map((name) => name.toLowerCase()));
const media =
  '\\.(mp3|m4a|m4p|aac|flac|ogg|oga|opus|wav|aiff|ape|wma|alac|mka|dsf|dff|ncm|mflac|mgg|kgm|lrc|ttml|srt|mp4|mkv|webm|mov|avi|m4v|wmv|flv|mpg|mpeg|ts|m2ts)$';
const mediaName = new RegExp(media, 'i');

const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const inDir = (base, p) => {
  const relative = path.relative(key(base), key(p));
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

function stat(p) {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return null;
  }
}

function plain(p, expectDirectory) {
  const entry = stat(p);
  if (!entry) return null;
  if (entry.isSymbolicLink() || key(fs.realpathSync.native(p)) !== key(p))
    throw new Error(`A profile path is a link or has changed: ${p}`);
  if (expectDirectory ? !entry.isDirectory() : !entry.isFile()) throw new Error(`Unexpected profile entry: ${p}`);
  return entry;
}

function visit(base, items, walk = false, remove = false) {
  for (const p of items) {
    if (p === base || !inDir(base, p)) throw new Error(`Profile path outside its directory: ${p}`);
  }
  if (process.platform === 'win32') {
    // lstat covers junctions and symbolic links. Windows attributes also catch other reparse tags and placeholders.
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    const script = fs.readFileSync(path.join(__dirname, 'profile-windows.ps1'), 'utf8');
    const result = spawnSync(
      powershell,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      {
        input: JSON.stringify({ base, items, walk, remove, media }),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const message = result.stdout?.trim() || result.stderr?.replace(/#< CLIXML[\s\S]*/, '').trim();
      throw new Error(message || 'Windows profile inspection failed');
    }
    return;
  }
  function inspect(p) {
    const entry = stat(p);
    if (!entry || !plain(p, entry.isDirectory())) throw new Error(`Profile entry disappeared: ${p}`);
    if (entry.isDirectory()) {
      if (walk) for (const name of fs.readdirSync(p)) inspect(path.join(p, name));
      if (remove) fs.rmdirSync(p);
    } else {
      if (walk && mediaName.test(p)) throw new Error(`Media found in a managed profile directory: ${p}`);
      if (remove) fs.unlinkSync(p);
    }
  }
  plain(base, true);
  items.forEach(inspect);
}

function directory(p) {
  if (!plain(p, true)) fs.mkdirSync(p);
  plain(p, true);
}

function profileRoot(app, env = process.env) {
  const temp = fs.realpathSync.native(os.tmpdir());
  const parent = fs.realpathSync.native(app.getPath('appData'));
  const override = env.CADENZA_USER_DATA;
  let root = path.join(parent, 'Cadenza');
  if (override) {
    if (!path.isAbsolute(override)) throw new Error('The test profile path must be absolute');
    root = path.resolve(override);
    if (root === temp || !inDir(temp, root))
      throw new Error('The test profile must be inside the system temporary directory');
  }
  if (key(fs.realpathSync.native(path.dirname(root))) !== key(path.dirname(root)))
    throw new Error('The profile parent directory points elsewhere');
  directory(root);
  visit(root, []);
  return root;
}

const positive = (n) => Number.isSafeInteger(n) && n > 0;
const triplet = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[\da-z.-]+)?$/i.exec(version);
  return match ? match.slice(1).map(Number) : null;
};

function identifyBuild(version, config = build) {
  const parts = triplet(version);
  if (!parts || !positive(config.generation) || !positive(config.schema))
    throw new Error('Invalid application profile version');
  const [major, minor, patch] = parts;
  let stage;
  if (major === 4 && minor === 0 && patch === 0 && config.stage === 'development') stage = 'development';
  else if (version === '4.0.0' && config.stage === 'stable') stage = 'boundary';
  else if ((major > 4 || (major === 4 && (minor > 0 || patch > 0))) && config.stage === 'stable') stage = 'compatible';
  else throw new Error('The release stage does not match the application version');
  return { version, stage, generation: config.generation, schema: config.schema };
}

function validIdentity(value) {
  if (!value || !['development', 'boundary', 'compatible'].includes(value.stage)) return false;
  try {
    const config = { ...value, stage: value.stage === 'development' ? 'development' : 'stable' };
    return identifyBuild(value.version, config).stage === value.stage;
  } catch {
    return false;
  }
}

const same = (a, b) =>
  a?.version === b.version && a.stage === b.stage && a.generation === b.generation && a.schema === b.schema;
const downgrade = (a, b) => {
  const prior = triplet(a.version);
  return triplet(b.version).some((n, i, next) => n < prior[i] && next.slice(0, i).every((m, j) => m === prior[j]));
};

function action(previous, next, reset) {
  if (previous && previous.stage !== 'development' && (next.stage === 'development' || downgrade(previous, next)))
    throw new Error('This build is older than the current stable profile');
  if (next.stage === 'compatible') {
    if (!previous || previous.stage === 'development')
      throw new Error('Initialize the profile in the official 4.0.0 release before upgrading');
    if (!reset && previous.schema > next.schema) throw new Error('This build cannot open the newer profile schema');
    return reset ? 'reset' : previous.schema < next.schema ? 'migrate' : 'keep';
  }
  if (
    reset ||
    !previous ||
    previous.stage !== next.stage ||
    previous.generation !== next.generation ||
    (next.stage === 'development' && previous.version !== next.version)
  )
    return 'reset';
  if (previous.schema !== next.schema)
    throw new Error('Increment the data generation when the 4.0.0 profile schema changes');
  return 'keep';
}

function read(p) {
  if (!plain(p, false)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function write(p, value) {
  const tmp = p + '.tmp';
  // A crash can leave an unpublished temporary file. It must still be a regular file before replacement.
  if (plain(tmp, false)) fs.unlinkSync(tmp);
  const fd = fs.openSync(tmp, 'wx');
  try {
    fs.writeFileSync(fd, JSON.stringify(value) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, p);
}

const managed = (root) => fs.readdirSync(root).filter((name) => owned.has(name.toLowerCase()));

function validateJournal(pending) {
  return (
    pending &&
    pending.owner === OWNER &&
    validIdentity(pending.target) &&
    ['retire', 'purge'].includes(pending.phase) &&
    Array.isArray(pending.entries) &&
    new Set(pending.entries.map((name) => (typeof name === 'string' ? name.toLowerCase() : name))).size ===
      pending.entries.length &&
    pending.entries.every((name) => typeof name === 'string' && owned.has(name.toLowerCase()))
  );
}

function protectExternal(root, retired, entries, external) {
  if (!external) return;
  const configured = path.resolve(external);
  const candidates = stat(configured) ? [configured, fs.realpathSync.native(configured)] : [configured];
  const scheduled = [retired, ...entries.map((name) => path.join(root, name))];
  if (scheduled.some((item) => candidates.some((dir) => inDir(item, dir) || inDir(dir, item))))
    throw new Error('An external model directory overlaps data scheduled for clearing');
}

// Caller owns the Electron single-instance lock for root. Migrations must be safe to retry until their schema is recorded.
function initializeProfile(root, next, { reset = false, externalModels, migrations = {} } = {}) {
  if (!validIdentity(next)) throw new Error('Invalid target profile version');
  const control = path.join(root, CONTROL);
  const currentFile = path.join(control, CURRENT);
  const pendingFile = path.join(control, PENDING);
  const retired = path.join(control, RETIRED);
  directory(control);
  const controlEntries = fs.readdirSync(control);
  const permitted = new Set([CURRENT, PENDING, CURRENT + '.tmp', PENDING + '.tmp', RETIRED]);
  if (controlEntries.some((name) => !permitted.has(name)))
    throw new Error('Unexpected data in the profile control directory');
  visit(root, [control, ...controlEntries.map((name) => path.join(control, name))]);

  function recover(pending) {
    if (!validateJournal(pending)) throw new Error('Invalid pending profile transaction');
    protectExternal(root, retired, pending.entries, externalModels);
    if (pending.phase === 'retire') {
      directory(retired);
      const moving = [];
      for (const name of pending.entries) {
        const from = path.join(root, name);
        const to = path.join(retired, name);
        if (stat(from)) {
          if (stat(to)) throw new Error(`A profile item exists in both locations: ${name}`);
          moving.push(from);
        } else if (!stat(to)) {
          throw new Error(`A profile item is missing during retirement: ${name}`);
        }
      }
      visit(root, [retired]);
      if (moving.length) visit(root, moving, true);
      for (const from of moving) fs.renameSync(from, path.join(retired, path.basename(from)));
      pending = { ...pending, phase: 'purge' };
      write(pendingFile, pending);
    }
    if (stat(retired)) {
      plain(retired, true);
      const allowed = new Set(pending.entries.map((name) => name.toLowerCase()));
      if (fs.readdirSync(retired).some((name) => !allowed.has(name.toLowerCase())))
        throw new Error('Unexpected data in the retirement directory');
      visit(control, [retired], true, true);
    }
    write(currentFile, { owner: OWNER, identity: pending.target });
    fs.unlinkSync(pendingFile);
  }

  let current = read(currentFile);
  function checkCurrent() {
    if (current && (current.owner !== OWNER || !validIdentity(current.identity)))
      throw new Error('Invalid current profile record');
  }
  checkCurrent();
  const pending = read(pendingFile);
  if (pending) {
    if (!validateJournal(pending)) throw new Error('Invalid pending profile transaction');
    action(pending.target, next, false); // An older binary must not finish a newer stable transaction.
    recover(pending);
    current = read(currentFile);
    checkCurrent();
  } else if (stat(retired)) {
    throw new Error('Profile retirement directory has no recovery record');
  }
  const previous = current?.identity;
  if (!previous && next.stage === 'compatible' && !managed(root).length) {
    write(currentFile, { owner: OWNER, identity: next });
    return 'keep';
  }
  const operation = action(previous, next, reset && !pending);
  if (operation === 'reset') {
    const entries = managed(root);
    protectExternal(root, retired, entries, externalModels);
    if (entries.length)
      visit(
        root,
        entries.map((name) => path.join(root, name)),
        true,
      );
    const journal = { owner: OWNER, target: next, phase: 'retire', entries };
    write(pendingFile, journal);
    recover(journal);
  } else if (operation === 'migrate') {
    for (let schema = previous.schema; schema < next.schema; schema++) {
      if (typeof migrations[schema] !== 'function') throw new Error(`No migration for profile schema ${schema}`);
    }
    for (let schema = previous.schema; schema < next.schema; schema++) {
      migrations[schema](root);
      write(currentFile, { owner: OWNER, identity: { ...next, schema: schema + 1 } });
    }
  } else if (!same(previous, next)) {
    write(currentFile, { owner: OWNER, identity: next });
  }
  return operation;
}

module.exports = { profileRoot, identifyBuild, initializeProfile };
