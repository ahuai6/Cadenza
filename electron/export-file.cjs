const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function stamp(file) {
  try {
    const s = await fs.lstat(file, { bigint: true });
    if (!s.isFile()) throw new Error('output is not an ordinary file');
    return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function openExport(file, chosenStamp) {
  if ((await stamp(file)) !== chosenStamp) throw new Error('output changed after selection');
  const tmp = path.join(path.dirname(file), `.cadenza-export-${randomUUID()}.partial`);
  const handle = await fs.open(tmp, 'wx');
  let chain = Promise.resolve();
  let finished = false;
  async function dispose() {
    await handle.close().catch(() => {});
    await fs.rm(tmp, { force: true });
  }
  return {
    write(data, position) {
      if (finished) throw new Error('export ended');
      if (!Number.isSafeInteger(position) || position < 0 || !ArrayBuffer.isView(data))
        throw new Error('invalid export write');
      const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const write = chain.then(async () => {
        for (let off = 0; off < bytes.length; ) {
          const { bytesWritten } = await handle.write(bytes, off, bytes.length - off, position + off);
          if (!bytesWritten) throw new Error('empty export write');
          off += bytesWritten;
        }
      });
      chain = write;
      return write;
    },
    async close() {
      if (finished) throw new Error('export ended');
      finished = true;
      try {
        await chain;
        const { size } = await handle.stat();
        if (!size) throw new Error('empty export');
        await handle.sync();
        await handle.close();
        if ((await stamp(file)) !== chosenStamp) throw new Error('output changed during export');
        if (chosenStamp == null) {
          // A file appearing during export never grants permission to overwrite it.
          await fs.link(tmp, file);
        } else await fs.rename(tmp, file);
        return size;
      } finally {
        await dispose();
      }
    },
    async abort() {
      if (finished) return;
      finished = true;
      await chain.catch(() => {});
      await dispose();
    },
  };
}

module.exports = { openExport, stamp };
