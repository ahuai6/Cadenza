// A lyric edit may change ©lyr and the byte offsets of MP4 boxes. Check all media payloads
// and the raw bytes of every other iTunes item before replacing the selected file.
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

async function manifest(file) {
  const handle = await fs.open(file, 'r');
  const head = Buffer.alloc(16);
  const chunk = Buffer.alloc(128 * 1024);
  async function hash(start, end) {
    const h = crypto.createHash('sha256');
    for (let offset = start; offset < end; ) {
      const n = Math.min(end - offset, chunk.length);
      const { bytesRead } = await handle.read(chunk, 0, n, offset);
      if (!bytesRead) throw new Error('truncated MP4 payload');
      h.update(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return h.digest('hex');
  }
  async function* boxes(start, end) {
    for (let at = start; at < end; ) {
      const { bytesRead } = await handle.read(head, 0, Math.min(16, end - at), at);
      if (bytesRead < 8) throw new Error('truncated MP4 box');
      const kind = head.toString('latin1', 4, 8);
      let len = head.readUInt32BE(0);
      const header = len === 1 ? 16 : 8;
      if (len === 1) {
        if (bytesRead < 16) throw new Error('truncated extended MP4 box');
        len = Number(head.readBigUInt64BE(8));
      } else if (!len) len = end - at;
      if (!Number.isSafeInteger(len) || len < header || len > end - at) throw new Error('invalid MP4 box size');
      yield { kind, from: at + header, to: at + len };
      at += len;
    }
  }
  const payloads = [];
  const tags = [];
  async function tagsAt(from, to, branch) {
    for await (const box of boxes(from, to)) {
      if (branch === 'ilst') {
        if (box.kind !== '©lyr') tags.push([box.kind, await hash(box.from, box.to)]);
      } else if (box.kind === 'ilst' && branch === 'meta') await tagsAt(box.from, box.to, 'ilst');
      else if (box.kind === 'meta') await tagsAt(box.from + 4, box.to, 'meta');
      else if (box.kind === 'udta' && branch === 'moov') await tagsAt(box.from, box.to, 'udta');
    }
  }
  try {
    for await (const box of boxes(0, (await handle.stat()).size)) {
      if (box.kind === 'mdat') payloads.push(await hash(box.from, box.to));
      else if (box.kind === 'moov') await tagsAt(box.from, box.to, 'moov');
    }
    if (!payloads.length) throw new Error('no MP4 media payload');
    return { payloads, tags: tags.sort() };
  } finally {
    await handle.close();
  }
}

module.exports = { manifest };
