// A lyric edit may change ©lyr and the byte offsets of MP4 boxes. Check all media payloads
// and the raw bytes of every other iTunes item before replacing the selected file.
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

async function inspect(file, fn) {
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
  const read = async (at, n) => {
    const data = Buffer.alloc(n);
    if ((await handle.read(data, 0, n, at)).bytesRead !== n) throw new Error('truncated MP4 field');
    return data;
  };
  try {
    return await fn(boxes(0, (await handle.stat()).size), boxes, hash, read);
  } finally {
    await handle.close();
  }
}

async function manifest(file) {
  return inspect(file, async (top, boxes, hash) => {
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
    for await (const box of top) {
      if (box.kind === 'mdat') payloads.push(await hash(box.from, box.to));
      else if (box.kind === 'moov') await tagsAt(box.from, box.to, 'moov');
    }
    if (!payloads.length) throw new Error('no MP4 media payload');
    return { payloads, tags: tags.sort() };
  });
}

// The media data and offset maps are consumed by the demuxer. Include the audio track's
// own interpretation tables here, including edit lists which the demuxer may not expose.
async function audioTables(file) {
  return inspect(file, async (top, boxes, hash, read) => {
    const audio = [];
    let movieScale = 0;
    const nested = new Set(['edts', 'mdia', 'minf', 'stbl']);
    const semantic = new Set(['elst', 'stts', 'ctts', 'sgpd', 'sbgp']);
    async function visit(parent, track) {
      for await (const box of boxes(parent.from, parent.to)) {
        const { kind, from, to } = box;
        if (nested.has(kind)) await visit(box, track);
        else if (parent.kind === 'mdia' && kind === 'hdlr' && to - from >= 12)
          track.audio = (await read(from + 8, 4)).toString('latin1') === 'soun';
        else if (parent.kind === 'trak' && kind === 'tkhd' && to - from >= 4)
          track.flags = (await read(from, 4)).readUInt32BE(0) & 0xffffff;
        else if (parent.kind === 'stbl' && kind === 'stsd' && to - from >= 16) {
          const data = await read(from + 4, 12);
          track.entry = data.readUInt32BE(0) === 1 ? data.toString('latin1', 8, 12) : null;
        } else if (semantic.has(kind)) track.tables.push([kind, from, to]);
      }
    }
    for await (const outer of top) {
      if (outer.kind !== 'moov') continue;
      for await (const box of boxes(outer.from, outer.to)) {
        if (box.kind === 'mvhd') {
          const version = (await read(box.from, 1))[0];
          const offset = version === 1 ? 20 : 12;
          if (version > 1 || box.to - box.from < offset + 4) throw new Error('invalid MP4 movie timebase');
          movieScale = (await read(box.from + offset, 4)).readUInt32BE(0);
        }
        if (box.kind !== 'trak') continue;
        const track = { audio: false, flags: 0, tables: [] };
        await visit(box, track);
        if (!track.audio) continue;
        const tables = [];
        for (const [kind, from, to] of track.tables) tables.push([kind, await hash(from, to)]);
        // The probe supplies codec-private data, excluding nominal bitrate fields. The current
        // demuxer does not expose per-packet description changes, so require a single description.
        if (!track.entry) throw new Error('unsupported MP4 audio descriptions');
        audio.push({ flags: track.flags, entry: track.entry, tables });
      }
    }
    if (!audio.length) throw new Error('missing MP4 audio tables');
    return { movieScale, audio };
  });
}

module.exports = { manifest, audioTables };
