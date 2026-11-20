// How close Cadenza's Folia backgrounds are to Folia's own: each background mounted as Folia mounts it (its React
// layer, tests/folia-ref/bg.tsx, built inside a Folia checkout) and drawn by Cadenza (src/folia/backgrounds.ts), with the
// same colours and cover, compared picture for picture: first held still, then moving — the common one's drifting shapes
// and particles and the Monet picture's drift, each side stopped at the same moments (Folia's are browser animations,
// paused and set to the moment; the shapes' layout drawn on both sides from the same seed).
//   node tests/folia-bg-compare.cjs <folia checkout> <out dir>
// It builds the reference page inside the checkout (ref-harness, from tests/folia-ref); npx vite build --mode harness
// first for Cadenza's side.
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
// moving: [Folia's kind, Cadenza's draw, settings, Folia's tuning, the moments compared (s)]
const MOVING = [
  ['common', 'drawCommon', { cover: false, shapes: true, vignette: false }, {}, [1, 7, 13.5, 29, 61]],
  ['monet', 'drawMonet', { drift: true }, { backgroundDriftEnabled: true }, [0.5, 6, 17, 40]],
];
const GL = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const refDir = path.join(folia, 'ref-harness'),
    refDist = path.join(refDir, 'dist');
  fs.mkdirSync(refDir, { recursive: true });
  for (const f of ['index.html', 'main.ts', 'bg.html', 'bg.tsx', 'vite.config.mjs'])
    fs.copyFileSync(path.join(__dirname, 'folia-ref', f), path.join(refDir, f));
  require('child_process').execFileSync(
    'node',
    [path.join(folia, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'ref-harness/vite.config.mjs'],
    { cwd: folia, stdio: 'inherit' },
  );
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
  const drawB = (fn, params, t, still) =>
    pb.evaluate(
      ({ fn, theme, params, t, still }) => {
        const g = document.getElementById('cmp').getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, 1280, 720);
        H.folia.backgrounds[fn](
          g,
          {
            t,
            dt: 1 / 60,
            x: 0,
            y: 0,
            w: 1280,
            h: 720,
            px: 1,
            playing: false,
            still,
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
      { fn, theme: THEME, params, t, still },
    );
  const measure = (A, B) =>
    pb.evaluate(
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
      await drawB(fn, params, 0, true);
      await wait(60);
    }
    B = await pb.screenshot({ type: 'png' });
    const tag = `${kind}-${Object.values(params).join('-') || 'default'}`;
    fs.writeFileSync(path.join(OUT, `${tag}-folia.png`), A);
    fs.writeFileSync(path.join(OUT, `${tag}-cadenza.png`), B);
    const m = await measure(A, B);
    report.push({ tag, ...m });
    console.log(`${tag}  mean diff ${(m.full * 100).toFixed(2)}% / coarse ${(m.coarse * 100).toFixed(2)}%`);
  }
  // (the moving ones on a 1080p page, measured at 720 like the rest: Cadenza sizes Folia's CSS pixels as a 1080p page's,
  // so the shapes only line up against a page of that size)
  const pm = await br.newPage({ viewport: { width: 1920, height: 1080 } });
  pm.on('pageerror', (e) => console.log('page error:', e.message));
  await pm.goto(a.url + '/bg.html');
  await pm.waitForFunction(() => window.BG);
  // (a first mount: the animation library reads randoms of its own the first time, which would shift the seeded layout)
  await pm.evaluate((theme) => window.BG.show('common', { theme, moving: true }), THEME);
  await wait(500);
  for (const [kind, fn, params, tuning, times] of MOVING) {
    await pm.evaluate(
      ({ kind, theme, tuning }) => {
        window.BG.seed(1);
        return window.BG.show(kind, { theme, cover: 'cover.jpg', tuning, moving: true });
      },
      { kind, theme: THEME, tuning },
    );
    await wait(4000);
    // (Cadenza's side warms up the same way: the cover, the worker's picture)
    for (let i = 0; i < 40; i++) {
      await drawB(fn, params, 0, false);
      await wait(60);
    }
    for (const t of times) {
      const n = await pm.evaluate((ms) => window.BG.seek(ms), t * 1000);
      await wait(150);
      const A = await pm.screenshot({ type: 'png' });
      await drawB(fn, params, t, false);
      const B = await pb.screenshot({ type: 'png' });
      const tag = `moving-${kind}-${t}s`;
      fs.writeFileSync(path.join(OUT, `${tag}-folia.png`), A);
      fs.writeFileSync(path.join(OUT, `${tag}-cadenza.png`), B);
      const m = await measure(A, B);
      report.push({ tag, animations: n, ...m });
      console.log(
        `${tag}  mean diff ${(m.full * 100).toFixed(2)}% / coarse ${(m.coarse * 100).toFixed(2)}%  (${n} animations)`,
      );
    }
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  await br.close();
  a.server.close();
  b.server.close();
})();
