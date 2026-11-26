const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createOnlineService, credentialVault } = require('../electron/online.cjs');
const { registerNetease } = require('../electron/online-netease.cjs');

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
  assert.equal(
    service.snapshot().providers.some(({ id }) => id === 'lyricsflow'),
    false,
  );
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

test('NetEase authorizes on the main side and rejects partial playlists and downgraded downloads', async (t) => {
  const credentials = new Map();
  const vault = {
    read: ({ account }) => credentials.get(account),
    save: ({ account }, value) => credentials.set(account, value),
    remove: ({ account }) => credentials.delete(account),
  };
  const service = createOnlineService({ vault });
  registerNetease(service);
  let incomplete = false;
  let codec = 'flac';
  const lyrics = '\n[00:01.00]Original\n\n[00:02.00]\n';
  const translation = '\n[offset:50]\n[00:01.00]Translation\n\n';
  const song = { id: 21, name: 'Fixture', dt: 5000 };
  t.mock.method(globalThis, 'fetch', async (url, { headers }) => {
    switch (new URL(url).pathname) {
      case '/api/login/qrcode/unikey':
        return Response.json({ unikey: 'fixture-qr' });
      case '/api/login/qrcode/client/login':
        return Response.json({ code: 803 }, { headers: { 'Set-Cookie': 'MUSIC_U=fixture-credential; Secure' } });
      case '/api/w/nuser/account/get':
        assert.equal(headers.Cookie, 'MUSIC_U=fixture-credential');
        return Response.json({ profile: { userId: 8, nickname: 'Test listener' } });
      case '/api/v6/playlist/detail':
        return Response.json({
          playlist: { trackCount: 3, trackIds: (incomplete ? [21, 22] : [21, 22, 21]).map((id) => ({ id })) },
        });
      case '/api/v3/song/detail':
        assert.equal(headers.Cookie, 'MUSIC_U=fixture-credential');
        return Response.json({
          songs: [song, { ...song, id: 22 }],
          privileges: [{ id: 21, st: 0, downloadMaxBrLevel: 'lossless' }],
        });
      case '/api/song/enhance/download/url':
        return Response.json({
          data: { id: 21, code: 200, url: 'https://music.126.net/synthetic', size: 4096, encodeType: codec },
        });
      case '/api/song/lyric':
        return Response.json({ lrc: { lyric: lyrics }, tlyric: { lyric: translation } });
      default:
        throw new Error('Unexpected request');
    }
  });

  const invoke = (capability, input, account) =>
    service.invoke({
      provider: 'netease',
      capability,
      owner: 1,
      account,
      input,
    });
  const qr = await invoke('account', { action: 'begin' });
  assert.equal(qr.phase, 'waiting');
  assert.equal((await invoke('account', { action: 'poll', id: qr.id })).phase, 'connected');
  assert.ok(!JSON.stringify(service.snapshot()).includes('fixture-credential'));
  const playlist = () => invoke('playlists', { id: '12', offset: 0 }, '8');
  assert.deepEqual(
    (await playlist()).rows.map(({ ref }) => ref.id),
    ['21', '22', '21'],
  );
  incomplete = true;
  await assert.rejects(playlist(), { code: 'incomplete' });

  const download = () => invoke('download', { id: '21', tier: 'lossless' }, '8');
  assert.deepEqual(await invoke('variants', { id: '21' }, '8'), ['lossless']);
  const lease = await download();
  assert.equal(lease.permission, 'save');
  assert.equal(lease.lyrics.text, lyrics);
  assert.equal(lease.lyrics.auxiliary.translation, translation);
  codec = 'mp3';
  await assert.rejects(download(), { code: 'restricted' });
  await invoke('account', { action: 'logout', account: '8' });
  await assert.rejects(download(), { code: 'sign-in-required' });
  assert.equal(credentials.size, 0);
});
test('Apple Music uses canonical catalog IDs, an isolated LyricsFlow client and explicit provenance', async (t) => {
  const { registerPublicProviders } = require('../electron/online-providers.cjs');
  const service = createOnlineService();
  registerPublicProviders(service, 'fixture-developer-token');
  const calls = [];
  let officialFailure = false;
  let mismatch = false;
  const item = (id) => ({
    id,
    type: 'songs',
    attributes: { name: 'Fixture', durationInMillis: 90000, previews: [{ url: 'https://audio.mzstatic.com/a.m4a' }] },
  });
  t.mock.method(globalThis, 'fetch', async (url, { headers }) => {
    const { hostname, pathname } = new URL(url);
    calls.push({ hostname, pathname, headers });
    if (hostname === 'api.music.apple.com' && officialFailure) return new Response(null, { status: 503 });
    if (pathname.endsWith('/search')) return Response.json({ results: { songs: { data: [item('101')] } } });
    if (pathname.endsWith('/songs/101')) return Response.json({ data: [item(mismatch ? '102' : '101')] });
    throw new Error('Unexpected endpoint');
  });
  assert.deepEqual(
    service.snapshot().providers.map(({ id }) => id),
    ['netease', 'qq', 'kugou', 'apple'],
  );
  const request = (capability, input, account) => service.invoke({ provider: 'apple', capability, input, account });
  const official = await request('search', { query: 'fixture', region: 'jp', offset: 0 });
  assert.equal(official.source, 'apple');
  officialFailure = true;
  const publicCatalog = await request('search', { query: 'other', region: 'jp', offset: 0 });
  assert.equal(publicCatalog.source, 'lyricsflow');
  assert.deepEqual(publicCatalog.rows[0].ref, official.rows[0].ref);
  const audition = await request('preview', { id: '101', region: 'jp' }, 'irrelevant-account');
  assert.equal(audition.permission, 'stream');
  mismatch = true;
  await assert.rejects(request('preview', { id: '101', region: 'jp' }), { code: 'unmatched' });
  await assert.rejects(request('download', { id: '101' }), { code: 'unavailable' });
  assert.ok(
    calls.filter((call) => call.hostname === 'api.trylyricsflow.com').every((call) => !call.headers.Authorization),
  );
  assert.ok(
    calls
      .filter((call) => call.hostname === 'api.music.apple.com')
      .every((call) => call.headers.Authorization === 'Bearer fixture-developer-token'),
  );
});

test('download access checks only require accounts for operations declared authorized', async () => {
  const service = createOnlineService({
    catalog: [],
    vault: {
      read: async () => ({ userToken: 'account-only' }),
    },
  });
  service.register(
    { id: 'public', name: 'Public', capabilities: { download: 'public' } },
    {
      download: (_, { secret }) => secret,
    },
  );
  service.register(
    { id: 'private', name: 'Private', capabilities: { download: 'authorized' } },
    {
      download: (_, { secret }) => secret.userToken,
    },
  );
  assert.equal(service.requireAccess('public', 'download', ''), 'public');
  assert.equal(await service.invoke({ provider: 'public', capability: 'download', account: 'irrelevant' }), null);
  assert.throws(() => service.requireAccess('private', 'download', ''), { code: 'sign-in-required' });
  service.setAccount('private', { id: 'account', name: 'Expired', state: 'expired' });
  assert.throws(() => service.requireAccess('private', 'download', 'account'), { code: 'expired' });
  service.setAccount('private', { id: 'account', name: 'Connected', state: 'connected' });
  assert.equal(
    await service.invoke({ provider: 'private', capability: 'download', account: 'account' }),
    'account-only',
  );
});
