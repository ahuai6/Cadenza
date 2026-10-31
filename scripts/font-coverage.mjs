// Bake which characters each lyric face has of its own (the font picker lists first the faces that show every
// character of a song's lyrics). Read off the bundled font files themselves: each face's slices (fonts/<family>/*.woff2,
// listed by its stylesheet) are WOFF2, whose character map (cmap, never transformed) is read out of the Brotli stream
// — the stylesheets' unicode-range would not do: CJK faces share one slicing, so a range names characters a face lacks.
// Written as ranges, each "start,length" in base 36 after the one before (deltas), joined by ';'. The Noto faces (cjk:
// their cut follows the lyrics' script) are not listed: they show every script.
// Run after a change to the faces:  npm run build:app && node scripts/font-coverage.mjs
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), FONTS = path.join(ROOT, 'dist-app/fonts');
const OUT = path.join(ROOT, 'src/app/ui/font-previews/coverage.json');
if (!fs.existsSync(FONTS)) throw new Error('dist-app/fonts missing: npm run build:app first');
const src = fs.readFileSync(path.join(ROOT, 'src/text/fonts.ts'), 'utf8');
const slug = f => f.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const faces = [...src.matchAll(/^\s+(\w+): \{ family: '([^']+)'.*?\bq: (?:g\('([^']+)'|'([^':]+))[^\n]*$/gm)].map(m => ({ key: m[1], fam: m[3] || decodeURIComponent(m[4]).replace(/\+/g, ' '), cjk: /cjk: true/.test(m[0]) }));
/** The characters a WOFF2 file maps to a glyph (its cmap: format 4 or 12). */
function woff2Chars(buf) {
  // (a plain sfnt under the .woff2 name — some faces are bundled so — has its tables where its directory says)
  const sig = buf.readUInt32BE(0); let cmap = null;
  if (sig === 0x00010000 || sig === 0x4f54544f) { const n = buf.readUInt16BE(4); for (let i = 0; i < n; i++) { const r = 12 + i * 16; if (buf.toString('latin1', r, r + 4) === 'cmap') cmap = buf.subarray(buf.readUInt32BE(r + 8), buf.readUInt32BE(r + 8) + buf.readUInt32BE(r + 12)); } return cmapChars(cmap); }
  if (buf.toString('latin1', 0, 4) !== 'wOF2') return [];
  const n = buf.readUInt16BE(12); let o = 48;
  const u128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const b = buf[o++]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) break; } return v; };
  const tabs = []; for (let i = 0; i < n; i++) { const fl = buf[o++], tag = fl & 0x3f; if (tag === 63) o += 4; const ver = fl >> 6, orig = u128();
    const transformed = tag === 10 || tag === 11 ? ver !== 3 : ver !== 0; const len = transformed ? u128() : orig; tabs.push({ tag, len }); }
  const data = zlib.brotliDecompressSync(buf.subarray(o, o + buf.readUInt32BE(20))); let at = 0;
  for (const t of tabs) { if (t.tag === 0) cmap = data.subarray(at, at + t.len); at += t.len; }
  return cmapChars(cmap);
}
/** The characters a cmap table maps to a glyph (its format 12 subtable, else format 4). */
function cmapChars(cmap) {
  if (!cmap) return [];
  const out = [], recs = cmap.readUInt16BE(2); let best = -1, bestFmt = 0;
  for (let i = 0; i < recs; i++) { const pl = cmap.readUInt16BE(4 + i * 8), en = cmap.readUInt16BE(6 + i * 8), off = cmap.readUInt32BE(8 + i * 8), fmt = cmap.readUInt16BE(off);
    if ((pl === 3 || pl === 0) && (fmt === 12 || (fmt === 4 && bestFmt !== 12))) { best = off; bestFmt = fmt; } }
  if (best < 0) return [];
  if (bestFmt === 12) { const ng = cmap.readUInt32BE(best + 12); for (let i = 0; i < ng; i++) { const g = best + 16 + i * 12, s0 = cmap.readUInt32BE(g), e0 = cmap.readUInt32BE(g + 4), gid = cmap.readUInt32BE(g + 8); out.push([gid ? s0 : s0 + 1, e0]); } }
  else { const segX2 = cmap.readUInt16BE(best + 6), seg = segX2 / 2, ends = best + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ros = deltas + segX2;
    for (let i = 0; i < seg; i++) { const e = cmap.readUInt16BE(ends + i * 2), st = cmap.readUInt16BE(starts + i * 2), d = cmap.readInt16BE(deltas + i * 2), ro = cmap.readUInt16BE(ros + i * 2);
      for (let c = st; c <= e && c !== 0xffff; c++) { let gid; if (!ro) gid = (c + d) & 0xffff; else { const p = ros + i * 2 + ro + (c - st) * 2; gid = cmap.readUInt16BE(p); if (gid) gid = (gid + d) & 0xffff; }
        if (gid) out.push([c, c]); } } }
  return out;
}
const out = {};
for (const f of faces) {
  if (f.cjk) continue;
  const css = path.join(FONTS, slug(f.fam) + '.css'); if (!fs.existsSync(css)) { console.warn('no stylesheet for', f.key, f.fam); continue; }
  const rs = [];
  for (const m of fs.readFileSync(css, 'utf8').matchAll(/url\(\.\/([^)]+\.woff2)\)/g)) rs.push(...woff2Chars(fs.readFileSync(path.join(FONTS, m[1]))));
  rs.sort((x, y) => x[0] - y[0]); const merged = [];
  for (const [s, e] of rs) { const l = merged[merged.length - 1]; if (l && s <= l[1] + 1) l[1] = Math.max(l[1], e); else merged.push([s, e]); }
  let prev = 0; out[f.key] = merged.map(([s, e]) => { const d = s - prev; prev = e; return d.toString(36) + ',' + (e - s).toString(36); }).join(';');
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(Object.keys(out).length, 'faces,', (fs.statSync(OUT).size / 1024).toFixed(0), 'KB');
