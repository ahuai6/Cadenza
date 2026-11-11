// Bake the font picker's previews: each face's name, in each interface language, drawn once in its own face into one
// image per language (white on clear, tinted by the page: kit uses it as a mask) with where each name sits. The picker
// then shows pictures — it never has to load thirty faces, most of them large CJK ones, just to be opened.
// Run after a change to the faces or their names:  npm run build:app && node scripts/font-previews.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url),
  { chromium } = require('playwright'),
  serve = require('../tests/serve.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  OUT = path.join(ROOT, 'src/app/ui/font-previews');
const DIST = path.join(ROOT, 'dist-harness'),
  FONTS = path.join(ROOT, 'dist-app/fonts');
if (!fs.existsSync(FONTS)) throw new Error('dist-app/fonts missing: npm run build:app first');
execSync('npx vite build --mode harness', { cwd: ROOT, stdio: 'ignore' });
if (!fs.existsSync(path.join(DIST, 'fonts'))) fs.symlinkSync(FONTS, path.join(DIST, 'fonts'), 'dir');
const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/dict.json'), 'utf8'));
const SCALE = 2,
  SIZE = 15,
  ROW = 22,
  MAXW = 260; // (css px: the picker's 15 px names, a row 22 px high, at most 260 px wide)
const { server, url } = await serve(DIST);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url + '/harness.html');
await page.waitForFunction(() => window.H);
const index = { scale: SCALE, row: ROW, width: MAXW, langs: {} };
fs.mkdirSync(OUT, { recursive: true });
for (const [lang] of dict.langs) {
  const names = Object.fromEntries(
    Object.keys(dict.dict[lang])
      .filter((k) => k.startsWith('fontn.'))
      .map((k) => [k.slice(6), dict.dict[lang][k]]),
  );
  const r = await page.evaluate(
    async ({ names, lang, SCALE, SIZE, ROW, MAXW }) => {
      window.CADENZA_FONTS = '/fonts/';
      const { FONTS, fontStack, ensureFont } = H.fonts,
        keys = Object.keys(FONTS).filter((k) => names[k]);
      for (const k of keys) await ensureFont(k, names[k], lang);
      await document.fonts.ready;
      const cv = document.createElement('canvas');
      cv.width = MAXW * SCALE;
      cv.height = keys.length * ROW * SCALE;
      const g = cv.getContext('2d'),
        at = {};
      keys.forEach((k, i) => {
        const st = fontStack(k, names[k], lang);
        g.font = `${st.w} ${SIZE * SCALE}px ${st.stack}`;
        g.textBaseline = 'middle';
        g.fillStyle = '#fff';
        const w = Math.min(MAXW * SCALE, Math.ceil(g.measureText(names[k]).width) + 2);
        g.save();
        g.beginPath();
        g.rect(0, i * ROW * SCALE, w, ROW * SCALE);
        g.clip();
        g.fillText(names[k], 1, (i + 0.5) * ROW * SCALE);
        g.restore();
        at[k] = [i, Math.ceil(w / SCALE)];
      });
      return { png: cv.toDataURL('image/webp', 1), at };
    },
    { names, lang, SCALE, SIZE, ROW, MAXW },
  );
  fs.writeFileSync(path.join(OUT, lang + '.webp'), Buffer.from(r.png.split(',')[1], 'base64'));
  index.langs[lang] = r.at;
  console.log(lang, Object.keys(r.at).length, 'names');
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
await browser.close();
server.close();
