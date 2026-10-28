// Every font the desktop app can use, copied next to it so it runs fully offline: one stylesheet per family
// (fonts/<family>.css) and its woff2 slices (only the glyph ranges a page uses are ever read). Variable faces keep their
// whole weight range under the plain family name the engine's font stacks ask for.
//   node scripts/fonts.mjs <out dir>        (run after `vite build --mode app`)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), NM = path.join(ROOT, 'node_modules');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist-app', 'fonts'));
// [family, package, static weights (none: the variable face, every weight)]
const FAMILIES = [
  ['Noto Sans TC', '@fontsource-variable/noto-sans-tc'], ['Noto Sans SC', '@fontsource-variable/noto-sans-sc'],
  ['Noto Sans JP', '@fontsource-variable/noto-sans-jp'], ['Noto Sans KR', '@fontsource-variable/noto-sans-kr'],
  ['Noto Serif TC', '@fontsource-variable/noto-serif-tc'], ['Noto Serif SC', '@fontsource-variable/noto-serif-sc'],
  ['Noto Serif JP', '@fontsource-variable/noto-serif-jp'], ['Noto Serif KR', '@fontsource-variable/noto-serif-kr'],
  ['Noto Sans', '@fontsource-variable/noto-sans'], ['Noto Serif', '@fontsource-variable/noto-serif'],
  ['Noto Sans Thai', '@fontsource-variable/noto-sans-thai'], ['Noto Serif Thai', '@fontsource-variable/noto-serif-thai'],
  ['Noto Sans Arabic', '@fontsource-variable/noto-sans-arabic'], ['Noto Naskh Arabic', '@fontsource-variable/noto-naskh-arabic'],
  ['Noto Sans Hebrew', '@fontsource-variable/noto-sans-hebrew'], ['Noto Serif Hebrew', '@fontsource-variable/noto-serif-hebrew'],
  ['Noto Sans Devanagari', '@fontsource-variable/noto-sans-devanagari'], ['Noto Serif Devanagari', '@fontsource-variable/noto-serif-devanagari'],
  ['Source Serif 4', '@fontsource-variable/source-serif-4'],
  ['Zen Maru Gothic', '@fontsource/zen-maru-gothic', ['500', '700']], ['Dela Gothic One', '@fontsource/dela-gothic-one', ['400']], ['DotGothic16', '@fontsource/dotgothic16', ['400']],
];
export const slug = f => f.toLowerCase().replace(/[^a-z0-9]+/g, '-');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
let bytes = 0, files = 0;
for (const [fam, pkg, weights] of FAMILIES) {
  const dir = path.join(NM, pkg), s = slug(fam), sub = path.join(OUT, s); fs.mkdirSync(sub);
  const css = (weights ? weights.map(w => fs.readFileSync(path.join(dir, `${w}.css`), 'utf8')) : [fs.readFileSync(path.join(dir, 'index.css'), 'utf8')]).join('\n');
  const out = css
    .replace(/font-family:\s*'[^']*'/g, `font-family: '${fam}'`)                                  // "Noto Sans TC Variable" → "Noto Sans TC"
    .replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, '')                                  // woff2 only
    .replace(/url\(\.\/files\/([^)]+\.woff2)\)/g, (m, f) => {
      fs.copyFileSync(path.join(dir, 'files', f), path.join(sub, f)); bytes += fs.statSync(path.join(sub, f)).size; files++;
      return `url(./${s}/${f})`; });
  fs.writeFileSync(path.join(OUT, s + '.css'), out);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(FAMILIES.map(([f]) => [f, slug(f)])));
console.log(`fonts: ${FAMILIES.length} families, ${files} files, ${(bytes / 1048576).toFixed(1)} MB → ${path.relative(ROOT, OUT)}`);
