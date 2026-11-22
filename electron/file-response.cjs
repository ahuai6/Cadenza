const fs = require('node:fs/promises');
const { Readable, addAbortSignal } = require('node:stream');
const { revision } = require('./audio-identity.cjs');

const chunkBytes = 64 * 1024;
const cors = { 'Access-Control-Allow-Origin': '*' };

function byteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match || !(match[1] || match[2]) || !size) return null;
  const first = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const last = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return first <= last ? { start: first, end: last } : null;
}

/** Serve only an already-authorized file. The same open file supplies both headers and body. */
async function serveFile(file, req, type, expected = null) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...cors, Allow: 'GET, HEAD' } });
  }
  let handle;
  try {
    req.signal?.throwIfAborted();
    handle = await fs.open(file, 'r');
    const st = await handle.stat();
    if (!st.isFile()) return new Response(null, { status: 404, headers: cors });
    if (
      expected &&
      (st.size !== expected.size ||
        st.mtimeMs !== expected.mtime ||
        (expected.sourceStamp && revision(st) !== expected.sourceStamp))
    ) {
      return new Response(null, { status: 409, headers: cors });
    }
    const size = st.size;
    const headers = {
      ...cors,
      'Accept-Ranges': 'bytes',
      'Content-Type': type,
      'Cache-Control': expected ? 'no-store' : 'no-cache',
    };
    const value = req.method === 'GET' ? req.headers.get('range') : null;
    const range = value != null ? byteRange(value, size) : { start: 0, end: size - 1 };
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' },
      });
    }
    headers['Content-Length'] = String(range.end - range.start + 1);
    if (value != null) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    if (!size || req.method === 'HEAD') return new Response(null, { headers });
    req.signal?.throwIfAborted();
    const stream = handle.createReadStream({ ...range, highWaterMark: chunkBytes });
    handle = null; // Owned by the read stream from here on, including on abort and consumer cancellation.
    if (req.signal) addAbortSignal(req.signal, stream);
    const body = Readable.toWeb(stream, {
      strategy: { highWaterMark: chunkBytes, size: (chunk) => chunk.byteLength },
    });
    return new Response(body, { status: value != null ? 206 : 200, headers });
  } catch (error) {
    if (req.signal?.aborted) throw error;
    if (['ENOENT', 'ENOTDIR', 'EISDIR', 'EACCES', 'EPERM'].includes(error.code)) {
      return new Response(null, { status: 404, headers: cors });
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

module.exports = { serveFile, byteRange };
