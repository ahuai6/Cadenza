import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const load = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const manifest = load('../docs/online-upstreams.json');
const packageJson = load('../package.json');
const lock = load('../package-lock.json');

for (const [name, version] of Object.entries(manifest.packages)) {
  assert.equal(packageJson.dependencies?.[name], version, name + ' must match the reviewed version');
  assert.equal(lock.packages?.['node_modules/' + name]?.version, version, name + ' lockfile mismatch');
}
console.log('Online dependency pins match package.json and package-lock.json.');

if (process.argv.includes('--check-remote')) {
  async function json(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error' });
    if (!response.ok) throw new Error(new URL(url).hostname + ' returned HTTP ' + response.status);
    return response.json();
  }
  const observe = async (name) => {
    const data = await json('https://registry.npmjs.org/' + name.replace('/', '%2f') + '/latest');
    const reviewed = manifest.packages[name];
    console.log(name, 'latest', data.version, reviewed ? 'pinned ' + reviewed : '(research only)');
    if (reviewed && data.version !== reviewed) console.warn(name, 'new release requires an adapter review');
  };
  const checkCatalogs = async () => {
    const require = createRequire(import.meta.url);
    const { createOnlineService } = require('../electron/online.cjs');
    const { registerPublicProviders } = require('../electron/online-providers.cjs');
    const { registerNetease } = require('../electron/online-netease.cjs');
    const service = createOnlineService();
    registerPublicProviders(service);
    registerNetease(service);
    await Promise.all(
      [
        ['qq', 'search', { query: '周杰伦', offset: 0 }],
        ['qq', 'collection', { namespace: 'albums', id: '0024bjiL2aocxT', offset: 0 }],
        ['qq', 'lyrics', { namespace: 'songs', id: '001zMQr71F1Qo8' }],
        ['kugou', 'charts', {}],
        ['kugou', 'recommendations', {}],
        ['kugou', 'collection', { namespace: 'charts', id: '8888', offset: 25 }],
        ['netease', 'collection', { namespace: 'albums', id: '172276', offset: 0 }],
      ].map(async ([provider, capability, input]) => {
        const result = await service.invoke({ provider, capability, input });
        assert.ok(
          result.rows?.length || (capability === 'lyrics' && result.format === 'lrc' && result.text),
          provider + ' ' + capability,
        );
        console.log(provider, capability, result.rows?.length ?? result.format);
      }),
    );
  };
  const checkLyricsFlow = async () => {
    const flow = manifest.lyricsFlow;
    const api = await json(flow.url);
    assert.equal(api.info?.version, flow.version, 'LyricsFlow protocol version changed');
    for (const [route, required] of Object.entries(flow.paths)) {
      const names = api.paths?.[route]?.get?.parameters?.map(({ name }) => name) || [];
      assert.ok(
        required.every((name) => names.includes(name)),
        'LyricsFlow contract changed for ' + route,
      );
    }
    console.log('LyricsFlow', flow.version, 'expected endpoint parameters present.');
  };
  const checks = await Promise.allSettled([
    ...[...Object.keys(manifest.packages), ...manifest.observePackages].map(observe),
    checkLyricsFlow(),
    checkCatalogs(),
  ]);
  for (const check of checks) {
    if (check.status === 'rejected') {
      console.error(check.reason.message);
      process.exitCode = 1;
    }
  }
  const head = execFileSync('git', ['ls-remote', manifest.kugou.repository, 'HEAD'], {
    encoding: 'utf8',
    timeout: 12000,
    windowsHide: true,
  })
    .trim()
    .split(/\s/)[0];
  console.log('KuGouMusicApi HEAD', head, 'reviewed', manifest.kugou.observedHead);
}
