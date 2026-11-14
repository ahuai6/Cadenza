// Turns the installer's PNGs (draw.cjs) into the 24-bit BMPs NSIS can show, in build/installer/out (not kept in git).
// Run by build/installer.nsh while the installer is compiled, so the release build needs nothing else installed.
// Reads only what draw.cjs writes: 8-bit RGB or RGBA, not interlaced.
//   node build/installer/bmp.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function readPng(file) {
  const b = fs.readFileSync(file);
  let o = 8,
    w = 0,
    h = 0,
    ch = 0;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o),
      type = b.toString('ascii', o + 4, o + 8),
      d = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      const depth = d[8],
        color = d[9],
        lace = d[12];
      if (depth !== 8 || (color !== 2 && color !== 6) || lace) throw new Error(`${file}: not 8-bit RGB(A)`);
      ch = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)),
    row = w * ch,
    px = Buffer.alloc(row * h);
  // (undo each row's filter)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (row + 1)],
      src = raw.subarray(y * (row + 1) + 1, (y + 1) * (row + 1)),
      out = px.subarray(y * row, (y + 1) * row),
      up = y ? px.subarray((y - 1) * row, y * row) : null;
    for (let i = 0; i < row; i++) {
      const a = i >= ch ? out[i - ch] : 0,
        u = up ? up[i] : 0,
        c = up && i >= ch ? up[i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += u;
      else if (f === 3) v += (a + u) >> 1;
      else if (f === 4) {
        const p = a + u - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - u),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c;
      }
      out[i] = v & 255;
    }
  }
  return { w, h, ch, px };
}

function writeBmp(file, { w, h, ch, px }) {
  const row = Math.ceil((w * 3) / 4) * 4,
    b = Buffer.alloc(54 + row * h);
  b.write('BM', 0);
  b.writeUInt32LE(b.length, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(row * h, 34);
  b.writeInt32LE(2835, 38);
  b.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * ch,
        d = 54 + y * row + x * 3;
      b[d] = px[s + 2];
      b[d + 1] = px[s + 1];
      b[d + 2] = px[s];
    }
  fs.writeFileSync(file, b);
}

const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(__dirname)) {
  if (!f.endsWith('.png')) continue;
  const dst = path.join(out, f.replace(/\.png$/, '.bmp'));
  const src = path.join(__dirname, f);
  if (fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs) continue;
  writeBmp(dst, readPng(src));
  n++;
}
console.log(`installer pictures: ${n} written to ${out}`);
