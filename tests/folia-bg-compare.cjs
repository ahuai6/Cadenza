// How close Cadenza's Folia backgrounds are to Folia's own: each background mounted as Folia mounts it (its React
// layer, tests/folia-ref/bg.tsx, built inside a Folia checkout) and drawn by Cadenza (src/folia/backgrounds.ts), with the
// same colours and cover, both held still, compared picture for picture.
//   node tests/folia-bg-compare.cjs <folia checkout> <out dir>
// The reference build is the one tests/folia-compare.cjs makes (ref-harness/dist, with bg.html); npx vite build --mode
// harness first for Cadenza's side.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const serve = require('./serve.cjs');

const ROOT = path.resolve(__dirname, '..');
const [folia, OUT] = process.argv.slice(2);
if (!folia || !OUT) {
  console.error('usage: node tests/folia-bg-compare.cjs <folia checkout> <out dir>');
  process.exit(2);
}
const W = 1280,
  H = 720;
const THEME = {
  backgroundColor: '#15131c',
  primaryColor: '#f2eee8',
  accentColor: '#e0607a',
  secondaryColor: '#7aa6d8',
};
// what is compared: held-still settings both sides can be given alike (no drift, no shapes, no time running)
const CASES = [
  ['common', 'drawCommon', { cover: true, shapes: false, vignette: false }],
  ['latent', 'drawLatent', { beat: false }],
  ['latent', 'drawLatent', { display: 'mesh' }],
  ['sora', 'drawSora', {}],
  ['monet', 'drawMonet', { drift: false }],
  ['nomand', 'drawNomand', { effect: 'dithering' }],
  ['nomand', 'drawNomand', { effect: 'fluted-glass' }],
  ['nomand', 'drawNomand', { effect: 'paper-texture' }],
  ['nomand', 'drawNomand', { effect: 'halftone-dots' }],
  ['nomand', 'drawNomand', { effect: 'lens-distortion' }],
];
const GL = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const refDist = path.join(folia, 'ref-harness', 'dist');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'cover.jpg'), path.join(refDist, 'cover.jpg'));
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'cover.jpg'), path.join(ROOT, 'dist-harness', 'cover.jpg'));
  const a = await serve(refDist);
  const b = await serve(path.join(ROOT, 'dist-harness'));
  const br = await chromium.launch({ args: GL });
  const pa = await br.newPage({ viewport: { width: W, height: H } });
  const pb = await br.newPage({ viewport: { width: W, height: H } });
  for (const p of [pa, pb]) p.on('pageerror', (e) => console.log('page error:', e.message));
  await pa.goto(a.url + '/bg.html');
  await pa.waitForFunction(() => window.BG);
  await pb.goto(b.url + '/harness.html');
  await pb.waitForFunction(() => window.H);
  await pb.evaluate(async () => {
    const c = document.createElement('canvas');
    c.id = 'cmp';
    c.width = 1280;
    c.height = 720;
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '99' });
    document.body.appendChild(c);
    H.engine.canvas.style.display = 'none';
    const img = new Image();
    img.src = 'cover.jpg';
    await img.decode();
    window.__cover = img;
  });
  const report = [];
  for (const [kind, fn, params] of CASES) {
    // Folia's tuning names for the same settings
    const tuning =
      kind === 'latent'
        ? { enhancedBeatResponse: params.beat ?? true, displayMode: params.display ?? 'both' }
        : kind === 'monet'
          ? { backgroundDriftEnabled: false }
          : kind === 'nomand'
            ? { effect: params.effect }
            : {};
    await pa.evaluate(({ kind, theme, tuning }) => window.BG.show(kind, { theme, cover: 'cover.jpg', tuning }), {
      kind,
      theme: THEME,
      tuning,
    });
    // (the image shaders load the cover and build themselves first; the monet picture is made in a worker)
    // (the common one fades its cover in over a second and a half)
    await wait(kind === 'monet' || kind === 'nomand' || kind === 'common' ? 4000 : 1200);
    const A = await pa.screenshot({ type: 'png' });
    let B;
    for (let i = 0; i < 40; i++) {
      // (a few frames: the cover's picture and the image shaders load first)
      await pb.evaluate(
        ({ fn, theme, params }) => {
          const g = document.getElementById('cmp').getContext('2d');
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.clearRect(0, 0, 1280, 720);
          H.folia.backgrounds[fn](
            g,
            {
              t: 0,
              dt: 1 / 60,
              x: 0,
              y: 0,
              w: 1280,
              h: 720,
              px: 1,
              playing: false,
              still: true,
              theme,
              daylight: false,
              cover: window.__cover,
              coverKey: 'cover.jpg',
              coverColors: [],
              bands: { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0, power: 0 },
              seed: 1,
            },
            params,
          );
        },
        { fn, theme: THEME, params },
      );
      await wait(60);
    }
    B = await pb.screenshot({ type: 'png' });
    const tag = `${kind}-${Object.values(params).join('-') || 'default'}`;
    fs.writeFileSync(path.join(OUT, `${tag}-folia.png`), A);
    fs.writeFileSync(path.join(OUT, `${tag}-cadenza.png`), B);
    const m = await pb.evaluate(
      async ({ a, b }) => {
        const load = (s) =>
          new Promise((r) => {
            const i = new Image();
            i.onload = () => r(i);
            i.src = 'data:image/png;base64,' + s;
          });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        const px = (img, w, h) => {
          const c = new OffscreenCanvas(w, h),
            g = c.getContext('2d');
          g.drawImage(img, 0, 0, w, h);
          return g.getImageData(0, 0, w, h).data;
        };
        const meas = (w, h) => {
          const da = px(ia, w, h),
            db = px(ib, w, h);
          let s = 0;
          for (let i = 0; i < da.length; i += 4)
            s += (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3;
          return s / (da.length / 4) / 255;
        };
        return { full: meas(1280, 720), coarse: meas(160, 90) };
      },
      { a: A.toString('base64'), b: B.toString('base64') },
    );
    report.push({ tag, ...m });
    console.log(`${tag}  mean diff ${(m.full * 100).toFixed(2)}% / coarse ${(m.coarse * 100).toFixed(2)}%`);
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  await br.close();
  a.server.close();
  b.server.close();
})();
