const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm, symlink } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { sign, generateKeyPairSync, createHash } = require('node:crypto');
const { lyricService, match, krcLanes } = require('../electron/lyric-service.cjs');
const { decodeKrc, encodeKrc, isKrc } = require('../electron/krc.cjs');
const { aiLyrics, readTranslation, validatedResult } = require('../electron/ai-lyrics.cjs');
const { chatgptAuth } = require('../electron/chatgpt-auth.cjs');
const { cleanRetiredMusic } = require('../electron/cleanup-retired-music.cjs');
const { openLibrary } = require('../electron/library-storage.cjs');

async function isolated(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cadenza-lyric-services-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const mockVault = () => {
  const data = new Map();
  const id = ({ domain, provider, account }) => [domain, provider, account].join('/');
  return {
    save: async (scope, value) => data.set(id(scope), value),
    read: async (scope) => data.get(id(scope)),
    remove: async (scope) => data.delete(id(scope)),
  };
};

const sse = (...events) => {
  const data = events
    .map((e) => 'data: ' + (typeof e === 'string' && e === '[DONE]' ? e : JSON.stringify(e)) + '\r\n\r\n')
    .join('');
  const bytes = Buffer.from(data);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.subarray(i, i + 17));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
  );
};
const translation = '{"rows":[{"id":"line-3","translation":"同一个意象"}]}';
const rows = [{ id: 'line-3', text: 'A repeated image' }];
const output = (value) => ({ type: 'response.output_text.delta', delta: value });
const complete = { type: 'response.completed', response: { status: 'completed' } };
const chat = (content, finish_reason = null) => ({ choices: [{ delta: { content }, finish_reason }] });

test('KRC round trips native timestamp, language, blank and unknown rows', () => {
  const languages = Buffer.from(
    JSON.stringify({
      content: [
        { type: 1, lyricContent: [['Translation'], ['']] },
        { type: 0, lyricContent: [['A', 'B'], ['C']] },
      ],
    }),
  ).toString('base64');
  const fixture =
    '[unknown:value]\r\n[language:' + languages + ']\r\n[1300,400]<10,200,0>AB\r\n\r\n[4500,100]<0,100,0>C\r\n';
  const encoded = encodeKrc(fixture);
  assert.equal(isKrc(encoded), true);
  assert.equal(decodeKrc(encoded), fixture);
  assert.throws(() => decodeKrc(encoded, 10));
  assert.deepEqual(krcLanes(fixture), {
    translation: '[0:01.300]Translation\n[0:04.500]',
    transliteration: '[0:01.300]A B\n[0:04.500]C',
  });
});

test('translation requires a terminal event, correct IDs and complete results', async () => {
  assert.equal(await readTranslation(sse(output(translation), complete), 'responses'), translation);
  assert.equal(await readTranslation(sse(chat(translation), chat('', 'stop'), '[DONE]'), 'chat'), translation);
  await assert.rejects(readTranslation(sse(output(translation)), 'responses'), /incomplete/);
  await assert.rejects(readTranslation(sse(chat(translation), chat('', 'length'), '[DONE]'), 'chat'), /incomplete/);
  await assert.rejects(readTranslation(sse({ type: 'error', code: 'insufficient_quota' }), 'responses'), /quota/);
  assert.deepEqual(validatedResult(translation, rows), [{ id: 'line-3', translation: '同一个意象' }]);
  for (const result of [
    '{"rows":[{"id":"line-5","translation":"wrong"}]}',
    '{"rows":[{"id":"line-3","translation":" "}]}',
    '{"rows":[]}',
    '{"rows":[{"id":"line-3","translation":"a"},{"id":"line-3","translation":"b"}]}',
  ])
    assert.throws(() => validatedResult(result, rows), /invalid-result/);
});

test('provider credentials are protected and sent only to the configured service URL', async (t) => {
  const dir = await isolated(t);
  const values = [];
  const ai = aiLyrics(
    dir,
    mockVault(),
    {
      state: async () => ({ connected: true, inference: true }),
      access: async () => 'chatgpt-token',
    },
    async (url, options) => {
      values.push([url, options.headers.Authorization, options.redirect, options.body && JSON.parse(options.body)]);
      if (url.endsWith('/models')) return Response.json({ data: [{ id: 'fixture-model' }] });
      if (url.endsWith('/responses')) return sse(output(translation), complete);
      return sse(chat(translation), chat('', 'stop'), '[DONE]');
    },
  );
  const common = { key: 'isolated-secret', model: 'fixture-model', timeout: 10000, name: 'Test', language: 'zh-Hans' };
  const openai = await ai.save({ ...common, provider: 'openai', base: 'https://wrong.invalid' });
  const deepseek = await ai.save({ ...common, provider: 'deepseek', key: 'isolated-deepseek' });
  const other = await ai.save({ ...common, provider: 'compatible', base: 'https://fixture.invalid/v1' });
  assert.equal((await ai.state()).entries.length, 3);
  assert.doesNotMatch(await readFile(path.join(dir, 'ai-lyrics.json'), 'utf8'), /isolated-secret|isolated-deepseek/);
  assert.deepEqual(await ai.models(openai.id), ['fixture-model']);
  for (const service of ['chatgpt', openai.id, deepseek.id, other.id]) {
    assert.deepEqual(
      await ai.translate('editor', {
        service,
        model: 'fixture-model',
        rows,
        language: 'zh-Hans',
        context: 'fixture',
        instructions: '',
        path: 'do not serialize this',
        unrelatedTrack: 'do not serialize this',
      }),
      [{ id: rows[0].id, translation: '同一个意象' }],
    );
  }
  assert.deepEqual(
    values.map(([url, key, redirect]) => [url, key, redirect]),
    [
      ['https://api.openai.com/v1/models', 'Bearer isolated-secret', 'error'],
      ['https://api.openai.com/v1/responses', 'Bearer chatgpt-token', 'error'],
      ['https://api.openai.com/v1/responses', 'Bearer isolated-secret', 'error'],
      ['https://api.deepseek.com/chat/completions', 'Bearer isolated-deepseek', 'error'],
      ['https://fixture.invalid/v1/chat/completions', 'Bearer isolated-secret', 'error'],
    ],
  );
  assert.equal(values[1][3].store, false);
  assert.equal(values[1][3].stream, true);
  assert.equal(values[3][3].response_format.type, 'json_object');
  assert.doesNotMatch(JSON.stringify(values.map((x) => x[3])), /do not serialize this/);
  await assert.rejects(ai.save({ ...other, base: 'https://changed.invalid', key: '' }), /new-key/);
  await assert.rejects(ai.save({ ...common, provider: 'compatible', base: 'http://fixture.invalid' }), /address/);
});

test('translation cancellation revokes the active request', async (t) => {
  const dir = await isolated(t);
  let started;
  const begin = new Promise((resolve) => {
    started = resolve;
  });
  const ai = aiLyrics(
    dir,
    mockVault(),
    { access: async () => 'fixture' },
    async (_, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        started();
      }),
  );
  const running = ai.translate('editor', {
    service: 'chatgpt',
    model: 'fixture',
    language: 'zh-Hans',
    context: '',
    instructions: '',
    rows,
  });
  await begin;
  ai.cancel('editor');
  await assert.rejects(running, { name: 'AbortError' });
});

test('translation defaults are isolated by service and retained across restart', async (t) => {
  const dir = await isolated(t);
  const vault = mockVault();
  const auth = { state: async () => ({ connected: false }) };
  const ai = aiLyrics(dir, vault, auth);
  const service = await ai.save({
    provider: 'deepseek',
    key: 'fixture-only',
    name: 'Fixture',
    model: 'fixture',
    language: 'zh-Hans',
  });
  const chat = { service: 'chatgpt', model: 'chat-model', language: 'en', instructions: 'context A', timeout: 30000 };
  const deep = { service: service.id, model: 'deep-model', language: 'ja', instructions: 'context B', timeout: 70000 };
  await ai.preferences(chat);
  await ai.preferences(deep);
  const reopened = aiLyrics(dir, vault, auth);
  const { preferences } = await reopened.state();
  assert.equal(preferences.service, service.id);
  assert.deepEqual({ service: 'chatgpt', ...preferences.byService.chatgpt }, chat);
  assert.deepEqual({ service: service.id, ...preferences.byService[service.id] }, deep);
  await assert.rejects(reopened.preferences({ ...deep, timeout: 1000 }), /configuration/);
  await reopened.remove(service.id);
  assert.deepEqual((await reopened.state()).preferences, {
    service: 'chatgpt',
    byService: { chatgpt: preferences.byService.chatgpt },
  });
});

test('ChatGPT login uses PKCE, validates the signed identity, refreshes and revokes', async () => {
  const vault = mockVault();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture' };
  const client = 'oaiapp_fixture';
  const scope = 'openid chatgpt.tokens.use.direct';
  let browser,
    revoked = false,
    refreshes = 0;
  function idToken() {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const msg =
      encode({ alg: 'RS256', kid: 'fixture' }) +
      '.' +
      encode({
        sub: 'fixture-user',
        aud: client,
        iss: 'https://auth.openai.com',
        exp: Math.round(Date.now() / 1000) + 120,
        nonce: browser.searchParams.get('nonce'),
      });
    return msg + '.' + sign('RSA-SHA256', Buffer.from(msg), privateKey).toString('base64url');
  }
  const auth = chatgptAuth(
    vault,
    async (url) => {
      browser = new URL(url);
      assert.equal(browser.origin, 'https://auth.openai.com');
      assert.equal(browser.searchParams.get('client_id'), 'dynamic_agent_client');
      assert.equal(browser.searchParams.get('code_challenge_method'), 'S256');
      const callback = new URL(browser.searchParams.get('redirect_uri'));
      assert.equal(callback.hostname, '127.0.0.1');
      callback.search = new URLSearchParams({ state: 'not-this-attempt', code: 'bad', client_id: client });
      assert.equal((await fetch(callback)).status, 404);
      callback.searchParams.set('state', browser.searchParams.get('state'));
      callback.searchParams.set('code', 'fixture-code');
      assert.equal((await fetch(callback)).status, 200);
    },
    async (url, options) => {
      if (url.endsWith('/jwks.json')) return Response.json({ keys: [jwk] });
      assert.equal(options.body.get('client_id'), client);
      if (url.endsWith('/revoke')) {
        revoked = true;
        assert.equal(options.body.get('token'), 'refresh-2');
        return new Response(null, { status: 204 });
      }
      if (options.body.get('grant_type') === 'refresh_token') {
        refreshes++;
        return Response.json({ access_token: 'current-access', refresh_token: 'refresh-2', expires_in: 3600, scope });
      }
      assert.equal(options.body.get('code'), 'fixture-code');
      assert.equal(
        createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'),
        browser.searchParams.get('code_challenge'),
      );
      return Response.json({
        id_token: idToken(),
        access_token: 'short',
        refresh_token: 'refresh-1',
        expires_in: 10,
        scope,
      });
    },
  );
  await auth.signIn();
  assert.deepEqual(await auth.state(), { connected: true, inference: true });
  assert.deepEqual(await Promise.all([auth.access(), auth.access()]), ['current-access', 'current-access']);
  assert.equal(refreshes, 1);
  await auth.signOut();
  assert.equal(revoked, true);
  assert.deepEqual(await auth.state(), { connected: false, inference: false });
});

test('lyric candidates preserve raw structure, rank by recording and survive independent provider failures', async () => {
  const original = '[00:00.00]words\r\n\r\n[00:03.00]\r\n';
  const http = async (address) => {
    const u = new URL(address);
    if (u.hostname === 'lrclib.net')
      return Response.json([
        { id: 3, trackName: 'Song (Live)', artistName: 'Artist', duration: 118, syncedLyrics: 'live' },
        { id: 4, trackName: 'Song', artistName: 'Artist', duration: 117, syncedLyrics: original },
        { id: 8, trackName: 'Song', artistName: 'Artist', duration: 117, syncedLyrics: original },
      ]);
    if (u.hostname === 'api.trylyricsflow.com') return new Response(null, { status: 503 });
    assert.ok(['c.y.qq.com', 'music.163.com', 'lyrics.kugou.com'].includes(u.hostname));
    throw new Error('offline');
  };
  const result = await lyricService(http)({ title: 'Song', artist: 'Artist', duration: 117 });
  assert.deepEqual(
    result.map(({ id }) => id),
    ['lrclib:4', 'lrclib:3'],
  );
  assert.equal(result[0].synced, original);
  assert.ok(result[1].warnings.includes('version'));
  assert.equal(
    match({ title: 'Song', artist: 'Artist', duration: 120 }, { title: 'Song', artist: 'Artist', duration: 118 }).delta,
    2,
  );
});

test('legacy cleanup touches only retired files and preserves AI, metadata and external references', async (t) => {
  const profile = await isolated(t);
  const dir = path.join(profile, 'library');
  const credentials = path.join(dir, 'credentials');
  await mkdir(credentials, { recursive: true });
  const outside = path.join(profile, 'user-media');
  await mkdir(outside);
  const media = path.join(outside, 'recording.m4a');
  const music = 'music-' + 'a'.repeat(64) + '.secret';
  const ai = 'ai-' + 'a'.repeat(64) + '.secret';
  await writeFile(media, 'untouched');
  await writeFile(path.join(dir, 'online-accounts.json'), JSON.stringify({ path: outside }));
  await writeFile(path.join(dir, 'online-download-preferences.json'), JSON.stringify({ folder: outside }));
  await writeFile(path.join(credentials, music), 'retired');
  await writeFile(path.join(credentials, ai), 'keep');
  const db = path.join(dir, 'db.json');
  const local = {
    version: 2,
    tracks: { a: { id: 'a', path: media } },
    favorites: ['a'],
    playlists: [{ ids: ['a', 'a'] }],
    fieldOrigins: { a: { title: { source: 'manual' } } },
    derived: { cache: { verified: true } },
  };
  await writeFile(db, JSON.stringify({ ...local, sourceLinks: [], mediaVariants: [], recordingMatches: [] }));
  assert.deepEqual(await cleanRetiredMusic(profile), []);
  assert.deepEqual(await cleanRetiredMusic(profile), []);
  await assert.rejects(readFile(path.join(credentials, music)), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(credentials, ai), 'utf8'), 'keep');
  assert.equal(await readFile(media, 'utf8'), 'untouched');
  const reopened = await openLibrary(db);
  for (const [key, value] of Object.entries(local)) assert.deepEqual(reopened[key], value);
  assert.ok(!('sourceLinks' in JSON.parse(await readFile(db, 'utf8'))));
  await rm(credentials, { recursive: true });
  await writeFile(path.join(outside, music), 'external fixture');
  await symlink(outside, credentials, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(await cleanRetiredMusic(profile), ['credentials']);
  assert.equal(await readFile(path.join(outside, music), 'utf8'), 'external fixture');
});
