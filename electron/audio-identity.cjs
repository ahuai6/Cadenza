const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const { promisify } = require('node:util');
const { audioTables } = require('./mp4-integrity.cjs');

const run = promisify(execFile);
const prefix = 'audio-sha256-v1:';
const validId = (value) => typeof value === 'string' && /^audio-sha256-v1:[0-9a-f]{64}$/.test(value);
const fileKey = (st) => (st.ino ? `${st.dev}:${st.ino}:${st.birthtimeMs}` : null);
const revision = (st) => `${fileKey(st) ?? '-'}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;

async function fingerprint(binary, file, expected, signal) {
  signal?.throwIfAborted();
  const before = await fs.stat(file);
  if (!before.isFile() || revision(before) !== expected) throw new Error('audio source changed');
  const { stdout } = await run(binary, ['--audio-identity', file], {
    signal,
    timeout: 5 * 60 * 1000,
    maxBuffer: 4096,
    windowsHide: true,
  });
  const { container, digest } = JSON.parse(stdout);
  if (typeof container !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) throw new Error('invalid audio identity');
  const config = container === 'isomp4' ? await audioTables(file) : null;
  signal?.throwIfAborted();
  if (revision(await fs.stat(file)) !== expected) throw new Error('audio source changed');
  return (
    prefix +
    createHash('sha256')
      .update(JSON.stringify([container, digest, config]))
      .digest('hex')
  );
}

module.exports = { fingerprint, validId, fileKey, revision };
