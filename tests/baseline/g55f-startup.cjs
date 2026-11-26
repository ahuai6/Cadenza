const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');

async function sample(executable, pass) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-g55f-startup-'));
  const profile = path.join(dir, 'profile');
  const netlog = path.join(dir, 'startup.json');
  const started = performance.now();
  const app = await _electron.launch({
    executablePath: executable,
    args: ['--log-net-log=' + netlog],
    env: { ...process.env, CADENZA_USER_DATA: profile },
  });
  let result;
  try {
    const win = await app.firstWindow();
    await win.waitForFunction(() => window.__cadenza?.lib.get().tracks.length === 0);
    const readyMs = Math.round(performance.now() - started);
    await win.waitForTimeout(1500);
    const metrics = await app.evaluate(({ app }) =>
      app.getAppMetrics().map(({ type, memory }) => ({
        type,
        privateKiB: memory.privateBytes ?? null,
        workingSetKiB: memory.workingSetSize,
      })),
    );
    result = { pass, readyMs, windows: app.windows().length, metrics };
  } finally {
    await app.close();
  }
  const traffic = JSON.parse(fs.readFileSync(netlog, 'utf8'));
  const requestType = traffic.constants.logEventTypes.URL_REQUEST_START_JOB;
  const http = traffic.events.filter(
    ({ type, params }) => type === requestType && /^https?:\/\//i.test(params?.url || ''),
  );
  return {
    ...result,
    externalRequests: http.length,
    externalHosts: [...new Set(http.map(({ params }) => new URL(params.url).hostname))],
  };
}

async function main() {
  const executables = process.argv.slice(2).map((file) => path.resolve(file));
  assert.ok(
    executables.length >= 1,
    'Pass the unpacked Cadenza.exe path, optionally preceded by the baseline executable.',
  );
  for (const executable of executables) {
    const asarBytes = fs.statSync(path.join(path.dirname(executable), 'resources', 'app.asar')).size;
    const result = [];
    for (let pass = 1; pass <= 3; pass++) result.push(await sample(executable, pass));
    console.log(JSON.stringify({ executable, asarBytes, result }));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
