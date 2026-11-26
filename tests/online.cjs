const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createOnlineService, credentialVault } = require('../electron/online.cjs');

test('provider capabilities are registered separately from catalog and account credentials', async () => {
  const accesses = [];
  const service = createOnlineService({
    vault: {
      async read(scope) {
        accesses.push(scope);
        return { token: 'private-token' };
      },
    },
  });
  assert.equal(service.snapshot().providers.find(({ id }) => id === 'lyricsflow').capabilities.download, 'unavailable');
  assert.throws(() => service.register({ id: 'bad', capabilities: { download: 'public' } }, {}), { code: 'invalid' });
  service.register(
    { id: 'test', name: 'Provider', capabilities: { search: 'public', playlists: 'authorized' } },
    {
      search: (input, context) => ({ input, authenticated: !!context.secret }),
      playlists: (_, { secret }) => secret.token,
    },
  );
  assert.deepEqual(await service.invoke({ provider: 'test', capability: 'search', input: 'sample' }), {
    input: 'sample',
    authenticated: false,
  });
  await assert.rejects(service.invoke({ provider: 'test', capability: 'playlists' }), { code: 'sign-in-required' });
  service.setAccount('test', { id: 'profile', name: 'Listener', state: 'connected', token: 'private-token' });
  assert.equal(
    await service.invoke({ provider: 'test', capability: 'playlists', account: 'profile' }),
    'private-token',
  );
  assert.deepEqual(accesses, [{ domain: 'music', provider: 'test', account: 'profile' }]);
  assert.ok(!JSON.stringify(service.snapshot()).includes('private-token'));
  await assert.rejects(service.invoke({ provider: 'lyricsflow', capability: 'download', account: 'profile' }), {
    code: 'unavailable',
  });
  await assert.rejects(service.invoke({ provider: 'test', capability: 'constructor' }), { code: 'unavailable' });
  service.register(
    { id: 'lyricsflow', name: 'LyricsFlow', capabilities: { lyrics: 'public' } },
    {
      lyrics: (_, { secret }) => secret,
    },
  );
  assert.equal(await service.invoke({ provider: 'lyricsflow', capability: 'lyrics', account: 'profile' }), null);
  assert.equal(accesses.length, 1);
});

test('window close cancels discovery and previews, leaving explicit downloads and auth to the service', async () => {
  const service = createOnlineService({ catalog: [] });
  const jobs = [];
  function operation(input, { signal }) {
    return new Promise((resolve, reject) => {
      jobs.push({ input, resolve, signal });
      signal.addEventListener('abort', () => reject(new Error('private media URL')), { once: true });
    });
  }
  service.register(
    {
      id: 'test',
      name: 'Provider',
      capabilities: {
        search: 'public',
        preview: 'public',
        account: 'public',
        download: 'public',
      },
    },
    { search: operation, preview: operation, account: operation, download: operation },
  );
  const start = (capability, input) => service.invoke({ provider: 'test', owner: 1, capability, input });
  const old = start('preview', 'old preview');
  const canceledOld = assert.rejects(old, { code: 'cancelled', message: 'cancelled' });
  const current = start('preview', 'current preview');
  const canceledCurrent = assert.rejects(current, { code: 'cancelled' });
  const search = assert.rejects(start('search', 'query'), { code: 'cancelled' });
  const download = start('download', 'keep download');
  const account = start('account', 'keep auth');
  service.closeOwner(1);
  await Promise.all([canceledOld, canceledCurrent, search]);
  assert.equal(jobs[3].signal.aborted, false);
  assert.equal(jobs[4].signal.aborted, false);
  const completed = { track: 'test' };
  jobs[3].resolve(completed);
  assert.equal(await download, completed);
  const shutdown = assert.rejects(account, { code: 'cancelled' });
  service.close();
  await shutdown;
});

test('credential storage is scoped, atomic and fails closed when encryption is unavailable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cadenza-g55-vault-'));
  try {
    let encrypted = true;
    const vault = credentialVault(dir, {
      isEncryptionAvailable: () => encrypted,
      encryptString: (value) => Buffer.from(Buffer.from(value).toString('base64')),
      decryptString: (value) => Buffer.from(value.toString(), 'base64').toString(),
    });
    const music = { domain: 'music', provider: 'test', account: 'one' };
    const ai = { ...music, domain: 'ai' };
    const caseVariant = { ...music, account: 'One' };
    await vault.save(music, { token: 'secret-music' });
    await vault.save(ai, { token: 'secret-ai' });
    await vault.save(caseVariant, { token: 'different-account' });
    assert.deepEqual(await vault.read(music), { token: 'secret-music' });
    assert.deepEqual(await vault.read(ai), { token: 'secret-ai' });
    assert.deepEqual(await vault.read(caseVariant), { token: 'different-account' });
    assert.equal(await vault.read({ ...music, provider: 'other' }), null);
    await assert.rejects(vault.save({ ...music, provider: '../escape' }, {}), { code: 'invalid' });
    encrypted = false;
    await assert.rejects(vault.read(music), { code: 'storage-unavailable' });
    await assert.rejects(vault.save(music, {}), { code: 'storage-unavailable' });
    await vault.remove(music);
    await vault.remove(caseVariant);
    assert.equal((await fs.readdir(dir)).length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
