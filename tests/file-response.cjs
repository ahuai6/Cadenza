const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { serveFile } = require('../electron/file-response.cjs');

let root, file, empty;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cadenza-ranges-'));
  file = path.join(root, 'audio.wav');
  empty = path.join(root, 'empty.wav');
  await fs.writeFile(file, '0123456789');
  await fs.writeFile(empty, '');
});
after(async () => {
  for (const name of await fs.readdir(root)) await fs.unlink(path.join(root, name));
  await fs.rmdir(root);
});

function request(range, method = 'GET', signal) {
  return new Request('cadenza://media/test', { method, headers: range ? { Range: range } : {}, signal });
}
const read = (range, method) => serveFile(file, request(range, method), 'audio/wav');

test('whole files and HEAD share length and type, without reading a HEAD body', async () => {
  const [get, head] = await Promise.all([read(), read('bytes=4-6', 'HEAD')]);
  assert.equal(get.status, 200);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.equal(head.headers.get('content-type'), 'audio/wav');
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(head.body, null);
  assert.equal(await get.text(), '0123456789');
});

test('bounded, open-ended and suffix ranges use inclusive byte positions', async () => {
  for (const [range, expected, body] of [
    ['bytes=4-6', '4-6', '456'],
    ['bytes=8-', '8-9', '89'],
    ['bytes=8-999999999999999999999999999', '8-9', '89'],
    ['bytes=-2', '8-9', '89'],
    ['bytes=-999999999999999999999999999', '0-9', '0123456789'],
  ]) {
    const res = await read(range);
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes ${expected}/10`);
    assert.equal(res.headers.get('content-length'), String(body.length));
    assert.equal(await res.text(), body);
  }
});

test('unsatisfiable, malformed, multipart and empty ranges have no body', async () => {
  for (const range of ['bytes=10-', 'bytes=5-3', 'bytes=-0', 'bytes=-', 'bytes=1-2,4-5', 'xbytes=1-2']) {
    const res = await read(range);
    assert.equal(res.status, 416, range);
    assert.equal(res.headers.get('content-range'), 'bytes */10');
    assert.equal(res.body, null);
  }
  const res = await serveFile(empty, request('bytes=0-'), 'audio/wav');
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), 'bytes */0');
});

test('changed, missing, non-file and non-read requests have explicit status', async () => {
  const st = await fs.stat(file);
  assert.equal((await serveFile(file, request(), 'audio/wav', { size: st.size, mtime: st.mtimeMs - 1 })).status, 409);
  assert.equal((await serveFile(path.join(root, 'missing'), request(), 'audio/wav')).status, 404);
  assert.equal((await serveFile(root, request(), 'audio/wav')).status, 404);
  assert.equal((await read(null, 'POST')).status, 405);
});

test('client cancellation and signal abort release a transfer without consuming the rest', async () => {
  const big = path.join(root, 'large.wav');
  await fs.writeFile(big, 'sample');
  await fs.truncate(big, 16 * 1024 * 1024);
  const first = (await serveFile(big, request(), 'audio/wav')).body.getReader();
  assert.equal((await first.read()).value.byteLength, 64 * 1024);
  await first.cancel();
  const controller = new AbortController();
  const second = (await serveFile(big, request(null, 'GET', controller.signal), 'audio/wav')).body.getReader();
  await second.read();
  controller.abort();
  await assert.rejects(second.closed, { name: 'AbortError' });
  await assert.rejects(serveFile(big, request(null, 'GET', controller.signal), 'audio/wav'), { name: 'AbortError' });
  await fs.rename(big, path.join(root, 'released.wav'));
});
