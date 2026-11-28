// A large synthetic library for the library stress suite: short WAVE files with RIFF INFO tags (title, artist, album,
// track), each with its own noise so every file has its own audio identity. Albums of 12 songs, artists of 4 albums.
const fs = require('node:fs');
const path = require('node:path');

const RATE = 8000;
const SECONDS = 0.25;

function infoChunk(tags) {
  const parts = Object.entries(tags).map(([id, value]) => {
    const text = Buffer.from(value + '\0', 'utf8');
    const pad = text.length % 2;
    const head = Buffer.alloc(8);
    head.write(id, 0, 'ascii');
    head.writeUInt32LE(text.length, 4);
    return Buffer.concat([head, text, Buffer.alloc(pad)]);
  });
  const body = Buffer.concat([Buffer.from('INFO', 'ascii'), ...parts]);
  const head = Buffer.alloc(8);
  head.write('LIST', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function wave(seed, tags) {
  const frames = Math.round(RATE * SECONDS);
  const data = Buffer.alloc(frames * 2);
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < frames; i++) {
    // xorshift noise at a low level: distinct bytes per file
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    data.writeInt16LE(((x & 0xffff) - 0x8000) >> 4, i * 2);
  }
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(RATE, 12);
  fmt.writeUInt32LE(RATE * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const info = infoChunk(tags);
  const dataHead = Buffer.alloc(8);
  dataHead.write('data', 0, 'ascii');
  dataHead.writeUInt32LE(data.length, 4);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + fmt.length + info.length + dataHead.length + data.length, 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, fmt, info, dataHead, data]);
}

/** Write `count` songs under `dir` (artist/album/NN title.wav); returns the file paths. */
function writeBigLibrary(dir, count) {
  const files = [];
  for (let i = 0; i < count; i++) {
    const album = Math.floor(i / 12),
      artist = Math.floor(album / 4),
      no = (i % 12) + 1;
    const folder = path.join(dir, `Artist ${artist}`, `Album ${album}`);
    if (no === 1) fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `${String(no).padStart(2, '0')} Song ${i}.wav`);
    fs.writeFileSync(
      file,
      wave(i + 1, { INAM: `Song ${i}`, IART: `Artist ${artist}`, IPRD: `Album ${album}`, ITRK: String(no) }),
    );
    files.push(file);
  }
  return files;
}

module.exports = { writeBigLibrary };
