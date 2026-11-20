// Build a committed snapshot and run its checks without opening the installed app or its profile.
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const source = path.resolve(__dirname, '../..');
const baseline = '4157fd8ceb7404811c57c29ea3f7f4d133f5af4b';
const suites = ['playback', 'render', 'gpu', 'space', 'desktop', 'native', 'desktop-hifi', 'folia'];
const requested = process.argv.slice(2);
if (requested.some((name) => !suites.includes(name))) {
  console.error('Usage: node tests/baseline/run.cjs [playback|render|gpu|space|desktop|native|desktop-hifi|folia …]');
  process.exit(2);
}
const selected = requested.length ? [...new Set(requested)] : suites;
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-baseline-')));
const snapshot = path.join(root, 'snapshot');
const tools = path.resolve(
  process.env.CADENZA_BASELINE_TOOLS ||
    process.env.NODE_PATH?.split(path.delimiter)[0] ||
    path.join(source, 'node_modules'),
);
const settings = {
  ...process.env,
  NODE_PATH: tools,
  TEMP: root,
  TMP: root,
  TMPDIR: root,
  APPDATA: path.join(root, 'roaming'),
  LOCALAPPDATA: path.join(root, 'local'),
  XDG_CONFIG_HOME: path.join(root, 'roaming'),
  XDG_CACHE_HOME: path.join(root, 'local'),
  PYTHONDONTWRITEBYTECODE: '1',
  PLAYWRIGHT_BROWSERS_PATH:
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA, 'ms-playwright')
      : path.join(os.homedir(), '.cache', 'ms-playwright')),
  CADENZA_BASELINE_ROOT: root,
};
for (const key of [
  'CADENZA_USER_DATA',
  'CADENZA_AUDIO_FAKE',
  'CADENZA_NATIVE_MODELS',
  'ELECTRON_RUN_AS_NODE',
  'NODE_OPTIONS',
])
  delete settings[key];
for (const dir of [snapshot, settings.APPDATA, settings.LOCALAPPDATA]) fs.mkdirSync(dir);

const report = {
  baseline,
  startedAt: new Date().toISOString(),
  system: { node: process.version, os: os.release(), platform: process.platform, cpu: os.cpus()[0]?.model },
  suites: {},
};
const reportFile = path.join(root, 'report.json');
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log(`Baseline workspace: ${root}`);

function run(name, command, args, options = {}) {
  const file = path.join(root, `${name}.log`);
  const fd = fs.openSync(file, 'w');
  let result;
  try {
    result = spawnSync(command, args, {
      cwd: snapshot,
      env: settings,
      windowsHide: true,
      timeout: 20 * 60_000,
      stdio: ['ignore', fd, fd],
      ...options,
    });
  } finally {
    fs.closeSync(fd);
  }
  const status = result.status === 0 ? 'passed' : result.status === 2 ? 'blocked' : 'failed';
  console.log(`${status}: ${name} (${file})`);
  return { status, log: path.basename(file), exitCode: result.status, error: result.error?.message };
}

function requireSuccess(result) {
  if (result.status !== 'passed') throw new Error(`Setup failed. See ${result.log}`);
}

function archive(repo, ref, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const tar = path.join(root, `${path.basename(destination)}.tar`);
  execFileSync('git', ['-C', repo, 'archive', '--format=tar', '-o', tar, ref], { windowsHide: true });
  execFileSync('tar', ['-xf', path.relative(destination, tar)], { cwd: destination, windowsHide: true });
  fs.unlinkSync(tar);
}

function linkPackages(deps, target) {
  fs.mkdirSync(target);
  for (const entry of fs.readdirSync(deps, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
    fs.symlinkSync(path.join(deps, entry.name), path.join(target, entry.name), 'junction');
  }
}

function prepare() {
  archive(source, baseline, snapshot);
  const deps = path.join(source, 'node_modules');
  linkPackages(deps, path.join(snapshot, 'node_modules'));
  const lock = JSON.parse(fs.readFileSync(path.join(snapshot, 'package-lock.json'), 'utf8'));
  const versions = ['electron', 'vite', 'react', 'typescript', 'three'];
  report.dependencies = Object.fromEntries(
    versions.map((name) => {
      const installed = JSON.parse(fs.readFileSync(path.join(deps, name, 'package.json'), 'utf8')).version;
      if (installed !== lock.packages[`node_modules/${name}`].version)
        throw new Error(`Installed ${name} differs from the baseline lockfile`);
      return [name, installed];
    }),
  );
  try {
    const pkg = require.resolve('playwright/package.json', { paths: [path.dirname(tools), snapshot] });
    report.dependencies.playwright = JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
  } catch {
    throw new Error(
      'Install Playwright in an external tools directory and set CADENZA_BASELINE_TOOLS to its node_modules',
    );
  }
  const startMain = path.join(snapshot, 'electron', 'main.cjs');
  const guard = path.join(__dirname, 'guard.cjs');
  // Legacy suites use the same main entry. Install the test guard in the disposable snapshot only.
  fs.copyFileSync(guard, path.join(snapshot, 'electron', 'baseline-guard.cjs'));
  const main = fs.readFileSync(startMain, 'utf8');
  const strict = /^(['"])use strict\1;[^\r\n]*\r?\n/.exec(main);
  const insert = strict?.[0].length || 0;
  fs.writeFileSync(startMain, main.slice(0, insert) + "require('./baseline-guard.cjs');\n" + main.slice(insert));
  if (selected.includes('desktop')) {
    const { models } = JSON.parse(fs.readFileSync(path.join(snapshot, 'src/rhythm/neural/models.json')));
    const destination = path.join(snapshot, 'models');
    fs.mkdirSync(destination);
    report.models = [];
    for (const { file, sha256 } of Object.values(models)) {
      const input = path.join(source, 'models', file);
      if (!fs.existsSync(input)) continue;
      const body = fs.readFileSync(input);
      if (createHash('sha256').update(body).digest('hex') !== sha256)
        throw new Error(`Baseline model checksum: ${file}`);
      fs.writeFileSync(path.join(destination, file), body);
      report.models.push(file);
    }
  }
  const exe = process.platform === 'win32' ? 'cadenza-audio.exe' : 'cadenza-audio';
  const nativeRoot = path.join('native', 'cadenza-audio', 'target');
  const input = [
    process.env.CADENZA_BASELINE_NATIVE,
    path.join(source, nativeRoot, 'release', exe),
    path.join(source, nativeRoot, 'x86_64-pc-windows-gnu', 'release', exe),
  ].find((p) => p && fs.existsSync(p));
  if (input) {
    const output = path.join(snapshot, nativeRoot, 'release');
    fs.mkdirSync(output, { recursive: true });
    fs.copyFileSync(input, path.join(output, exe));
    report.native = {
      provenance: 'prebuilt; verify against the baseline source separately',
      sha256: createHash('sha256').update(fs.readFileSync(input)).digest('hex'),
    };
  }
  return !!input;
}

function desktopLibrary() {
  const cache = path.join(snapshot, 'tests', '.cache');
  fs.mkdirSync(cache, { recursive: true });
  if (!fs.realpathSync(cache).startsWith(snapshot + path.sep)) throw new Error('Fixture cache escaped the snapshot');
  const gen = path.join(snapshot, 'tests', 'fixtures', 'gen');
  const python = process.env.CADENZA_BASELINE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  for (const generator of ['synth.py', 'synth2.py'])
    requireSuccess(run(generator, python, [path.join(gen, generator)], { cwd: cache }));
  const sh = process.env.CADENZA_BASELINE_SH || 'sh';
  const unix = (p) => p.replaceAll('\\', '/');
  const pythonPath = execFileSync(python, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  requireSuccess(
    run(
      'library',
      sh,
      [
        '-c',
        'python3() { "$CADENZA_BASELINE_PYTHON_PATH" "$@"; }; script=$1; shift; . "$script"',
        'baseline',
        unix(path.join(gen, 'library.sh')),
        unix(cache),
      ],
      { env: { ...settings, CADENZA_BASELINE_PYTHON_PATH: unix(pythonPath) } },
    ),
  );
}

function folia() {
  const repo = process.env.CADENZA_BASELINE_FOLIA;
  if (!repo)
    return { status: 'blocked', reason: 'Pinned Folia checkout with reference dependencies is not configured' };
  const upstream = JSON.parse(fs.readFileSync(path.join(snapshot, 'src/folia/upstream.json')));
  report.foliaUpstream = upstream.commit;
  const checkout = path.join(root, 'folia');
  archive(path.resolve(repo), upstream.commit, checkout);
  linkPackages(path.join(path.resolve(repo), 'node_modules'), path.join(checkout, 'node_modules'));
  // Reference tooling was tied to a Linux checkout path in 3.6.0.
  // Only the test launcher/config changes; the reference drawing and Cadenza are still pinned.
  for (const test of ['folia-ref/vite.config.mjs', 'folia-compare.cjs', 'folia-bg-compare.cjs'])
    fs.copyFileSync(path.join(source, 'tests', test), path.join(snapshot, 'tests', test));
  const comparison = path.join(root, 'folia-comparison');
  const results = {};
  for (const [kind, args] of [
    ['scenes', ['sonnet,tempera', '0.5']],
    ['beat', ['sonnet-beat,tempera-beat', '2.1']],
    ['stage', []],
    ['bg', []],
  ]) {
    const test = kind === 'stage' || kind === 'bg' ? `folia-${kind}-compare` : 'folia-compare';
    results[kind] = run(`folia-${kind}`, process.execPath, [
      `tests/${test}.cjs`,
      checkout,
      path.join(comparison, kind),
      ...args,
    ]);
  }
  return { status: Object.values(results).every((item) => item.status === 'passed') ? 'passed' : 'failed', results };
}

try {
  const native = prepare();
  const usesApp = selected.some((name) => ['playback', 'desktop', 'desktop-hifi', 'space'].includes(name));
  const usesHarness = selected.some((name) => ['render', 'gpu', 'folia'].includes(name));
  const vite = 'node_modules/vite/bin/vite.js';
  if (usesApp) {
    requireSuccess(run('build-app', process.execPath, [vite, 'build', '--mode', 'app']));
    requireSuccess(run('copy-fonts', process.execPath, ['scripts/fonts.mjs', 'dist-app/fonts']));
  }
  if (usesHarness) {
    requireSuccess(run('build-harness', process.execPath, [vite, 'build', '--mode', 'harness']));
    fs.copyFileSync(path.join(snapshot, 'tests/fixtures/cover.jpg'), path.join(snapshot, 'dist-harness/cover.jpg'));
  }
  for (const name of selected) {
    const shots = path.join(root, name);
    if (name === 'playback')
      report.suites[name] = run(name, process.execPath, [path.join(__dirname, 'playback.cjs'), snapshot, shots]);
    else if (name === 'gpu')
      report.suites[name] = run(name, process.execPath, [path.join(__dirname, 'gpu.cjs'), snapshot, shots + '.json']);
    else if (name === 'folia') report.suites[name] = folia();
    else if (!native && ['native', 'desktop-hifi'].includes(name))
      report.suites[name] = { status: 'blocked', reason: 'No native binary supplied' };
    else {
      const args = ['render', 'native'].includes(name) ? [] : [shots];
      const suite = name === 'native' ? 'hifi' : name;
      // The desktop suite edits its fixtures. Recreate them before the next desktop suite.
      if (name === 'desktop' || name === 'desktop-hifi') desktopLibrary();
      report.suites[name] = run(name, process.execPath, [`tests/${suite}.cjs`, ...args], {
        env: { ...settings, BUILD: '0' },
      });
    }
    save();
  }
} catch (error) {
  report.setupError = error.message;
  console.error(report.setupError);
} finally {
  report.finishedAt = new Date().toISOString();
  save();
  console.log(`Results: ${reportFile}`);
  process.exitCode =
    report.setupError || Object.values(report.suites).some((item) => item.status === 'failed')
      ? 1
      : Object.values(report.suites).some((item) => item.status === 'blocked')
        ? 2
        : 0;
}
