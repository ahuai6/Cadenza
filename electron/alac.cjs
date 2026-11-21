// Present indexed ALAC as integer PCM over a seekable, virtual WAVE representation.
// Only call with a file the library or the native open dialog already authorized.
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const { promisify } = require('node:util');
const { byteRange } = require('./file-response.cjs');
const { binPath } = require('./audio.cjs');

const run = promisify(execFile);
const cache = new Map();
const waiting = [];
const maxChildren = 4;
let active = 0;

async function acquire(signal) {
  signal.throwIfAborted();
  if (active < maxChildren) {
    active++;
  } else {
    await new Promise((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener('abort', cancel);
        resolve();
      };
      const cancel = () => {
        waiting.splice(waiting.indexOf(grant), 1);
        reject(signal.reason);
      };
      waiting.push(grant);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  return () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
}

function wave({ frames, rate, channels, bits, mask }) {
  if (
    !Number.isSafeInteger(frames) ||
    frames < 1 ||
    !Number.isInteger(rate) ||
    rate < 1 ||
    rate > 768000 ||
    !Number.isInteger(channels) ||
    channels < 1 ||
    channels > 8 ||
    ![16, 20, 24, 32].includes(bits)
  ) {
    throw new Error('unsupported ALAC parameters');
  }
  const width = Math.ceil(bits / 8);
  const block = channels * width;
  const data = frames * block;
  const extended = bits !== width * 8 || channels > 2;
  const header = Buffer.alloc(extended ? 68 : 44);
  const length = header.length + data + (data % 2);
  if (!Number.isSafeInteger(length) || length - 8 > 0xffffffff) throw new Error('ALAC exceeds RIFF size');
  header.write('RIFF');
  header.writeUInt32LE(length - 8, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(extended ? 40 : 16, 16);
  header.writeUInt16LE(extended ? 0xfffe : 1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * block, 28);
  header.writeUInt16LE(block, 32);
  header.writeUInt16LE(width * 8, 34);
  if (extended) {
    header.writeUInt16LE(22, 36);
    header.writeUInt16LE(bits, 38);
    header.writeUInt32LE(mask <= 0x3ffff ? mask : 0, 40);
    Buffer.from('0100000000001000800000aa00389b71', 'hex').copy(header, 44);
  }
  header.write('data', header.length - 8);
  header.writeUInt32LE(data, header.length - 4);
  return { header, length, block, data };
}

async function probe(file, st, signal) {
  const key = JSON.stringify([file, st.size, st.mtimeMs, st.ctimeMs]);
  const prior = cache.get(key);
  if (prior) return prior;
  const release = await acquire(signal);
  try {
    signal.throwIfAborted();
    const { stdout } = await run(binPath(), ['--alac-info', file], {
      signal,
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 4096,
    });
    const info = wave(JSON.parse(stdout));
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(key, info);
    return info;
  } finally {
    release();
  }
}

async function* payload(file, start, end, { header, block, data }, signal) {
  const prefix = header.subarray(start, Math.min(end, header.length));
  if (prefix.length) yield prefix;
  const from = Math.max(0, start - header.length);
  const to = Math.min(data, end - header.length);
  if (from < to) {
    const first = Math.floor(from / block);
    const count = Math.ceil(to / block) - first;
    const release = await acquire(signal);
    try {
      signal.throwIfAborted();
      const child = spawn(binPath(), ['--alac-pcm', file, String(first), String(count)], {
        signal,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.on('error', () => {}); // exit status or the short output below identifies a failure
      let offset = first * block;
      try {
        for await (const chunk of child.stdout) {
          const part = chunk.subarray(Math.max(0, from - offset), Math.min(chunk.length, Math.max(0, to - offset)));
          if (part.length) yield part;
          offset += chunk.length;
        }
        signal.throwIfAborted();
        if ((await closed) !== 0 || offset !== (first + count) * block) throw new Error('truncated ALAC PCM');
      } finally {
        if (child.exitCode === null) child.kill();
        await closed;
      }
    } finally {
      release();
    }
  }
  if (end > header.length + data) yield Buffer.alloc(1);
}

async function serveAlac(file, req, expected) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'Content-Type': 'audio/wav',
    'Cache-Control': 'no-store',
    'Access-Control-Expose-Headers': 'X-Cadenza-Compressed-Length',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  const st = await fs.stat(file);
  if (!st.isFile()) return new Response(null, { status: 404, headers });
  if (expected && (st.size !== expected.size || st.mtimeMs !== expected.mtime)) {
    return new Response(null, { status: 409, headers });
  }
  headers['X-Cadenza-Compressed-Length'] = String(st.size);
  const info = await probe(file, st, req.signal);
  const value = req.method === 'GET' ? req.headers.get('range') : null;
  const range = value == null ? { start: 0, end: info.length - 1 } : byteRange(value, info.length);
  if (!range) {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${info.length}` } });
  }
  headers['Content-Length'] = String(range.end - range.start + 1);
  if (value != null) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.length}`;
  if (req.method === 'HEAD') return new Response(null, { headers });
  const stop = new AbortController();
  const signal = AbortSignal.any([req.signal, stop.signal]);
  // Keep header-only requests and speculative readers independent from active PCM decoding.
  const chunks = payload(file, range.start, range.end + 1, info, signal);
  const abort = () => {
    void chunks.return().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  const body = new ReadableStream(
    {
      async pull(controller) {
        try {
          signal.throwIfAborted();
          const { value, done } = await chunks.next();
          signal.throwIfAborted();
          if (done) {
            signal.removeEventListener('abort', abort);
            controller.close();
          } else controller.enqueue(value);
        } catch (error) {
          signal.removeEventListener('abort', abort);
          await chunks.return();
          throw error;
        }
      },
      async cancel() {
        stop.abort();
        await chunks.return();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status: value == null ? 200 : 206, headers });
}

module.exports = { serveAlac };
