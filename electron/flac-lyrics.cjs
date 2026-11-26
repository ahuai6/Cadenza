const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function chunks(body) {
  let at = 0;
  function length() {
    if (at + 4 > body.length) throw new Error('Invalid Vorbis comment');
    const size = body.readUInt32LE(at);
    at += 4;
    return size;
  }
  function bytes(size) {
    if (at + size > body.length) throw new Error('Invalid Vorbis comment length');
    const value = body.subarray(at, at + size);
    at += size;
    return value;
  }
  const vendor = bytes(length());
  const count = length();
  if (count > (body.length - at) / 4) throw new Error('Invalid Vorbis comment count');
  const comments = Array.from({ length: count }, () => bytes(length()));
  if (at !== body.length) throw new Error('Unknown Vorbis comment suffix');
  return { vendor, comments };
}
const keyOf = (value) => {
  const delimiter = value.indexOf(61);
  return delimiter < 0 ? '' : value.subarray(0, delimiter).toString('ascii');
};
async function header(file) {
  const handle = await fs.promises.open(file);
  let at = 0;
  async function read(length) {
    const result = Buffer.alloc(length);
    if ((await handle.read(result, 0, length, at)).bytesRead !== length) throw new Error('Truncated FLAC metadata');
    at += length;
    return result;
  }
  try {
    if (!(await read(4)).equals(Buffer.from('fLaC'))) throw new Error('Unsupported FLAC header');
    const blocks = [];
    let last;
    do {
      const data = await read(4);
      last = data[0] & 128;
      const type = data[0] & 127;
      if (at > 64 * 1024 * 1024 || blocks.length >= 1024) throw new Error('FLAC metadata exceeds limit');
      blocks.push({ type, body: await read(data.readUIntBE(1, 3)) });
    } while (!last);
    if (blocks.filter((block) => block.type === 4).length > 1) throw new Error('Multiple Vorbis comment blocks');
    return { blocks, audio: at };
  } finally {
    await handle.close();
  }
}
function lyricFields(comments) {
  const occurrence = new Map();
  return comments.flatMap((item, index) => {
    const key = keyOf(item);
    const canonical = key.toUpperCase();
    if (!/^(TTML|LYRICS?|UNSYNCEDLYRICS)$/.test(canonical)) return [];
    const i = occurrence.get(canonical) || 0;
    occurrence.set(canonical, i + 1);
    return [{ id: 'flac:' + canonical + ':' + i, key, index }];
  });
}
async function fields(file) {
  const comments = (await header(file)).blocks.find((b) => b.type === 4);
  if (!comments) return [];
  const values = chunks(comments.body).comments;
  return lyricFields(values).flatMap(({ id, key, index }) => {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(values[index].subarray(key.length + 1));
      return [{ id, key, text }];
    } catch {
      return []; // An opaque field is retained byte-for-byte.
    }
  });
}
function int(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}
async function hashAudio(file, start) {
  const hash = createHash('sha256');
  for await (const bytes of fs.createReadStream(file, { start })) hash.update(bytes);
  return hash.digest('hex');
}
async function write(file, target, destination, text) {
  const { blocks, audio } = await header(file);
  let index = blocks.findIndex((block) => block.type === 4);
  if (index < 0) {
    index = blocks.length;
    blocks.push({ type: 4, body: Buffer.concat([int(7), Buffer.from('Cadenza'), int(0)]) });
  }
  const { vendor, comments } = chunks(blocks[index].body);
  if (target.startsWith('flac:')) {
    const field = lyricFields(comments).find((item) => item.id === target);
    if (!field) throw new Error('Lyrics field no longer exists');
    if (text === null) comments.splice(field.index, 1);
    else comments[field.index] = Buffer.from(field.key + '=' + text);
  } else {
    const key = target === 'new:ttml' ? 'TTML' : target === 'new:lrc' ? 'LYRICS' : null;
    if (!key || text === null || comments.some((value) => keyOf(value).toUpperCase() === key))
      throw new Error('Select the existing lyrics field');
    comments.push(Buffer.from(key + '=' + text));
  }
  blocks[index].body = Buffer.concat([
    int(vendor.length),
    vendor,
    int(comments.length),
    ...comments.flatMap((value) => [int(value.length), value]),
  ]);
  const metadata = [Buffer.from('fLaC')];
  for (const [i, block] of blocks.entries()) {
    const data = Buffer.alloc(4);
    data[0] = block.type | (i === blocks.length - 1 ? 128 : 0);
    data.writeUIntBE(block.body.length, 1, 3);
    metadata.push(data, block.body);
  }
  const hash = createHash('sha256');
  const output = fs.createWriteStream(destination, { flags: 'wx' });
  const content = async function* () {
    yield* metadata;
    for await (const bytes of fs.createReadStream(file, { start: audio })) {
      hash.update(bytes);
      yield bytes;
    }
  };
  await pipeline(content(), output);
  const written = await header(destination);
  if (
    written.blocks.length !== blocks.length ||
    written.blocks.some((block, i) => block.type !== blocks[i].type || !block.body.equals(blocks[i].body)) ||
    (await hashAudio(destination, written.audio)) !== hash.digest('hex')
  )
    throw new Error('FLAC verification failed');
}
module.exports = { fields, write };
