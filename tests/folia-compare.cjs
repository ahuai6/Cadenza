// How close Cadenza's Folia styles are to Folia itself: the same lyrics, theme and times drawn by Folia's own runtimes
// with real Pixi (tests/folia-ref, built inside a Folia checkout) and by Cadenza's port, compared frame by frame.
//   node tests/folia-compare.cjs <folia checkout> <out dir> [sonnet,tempera] [step s]
// The checkout needs Folia's visualizer dependencies (pixi.js, framer-motion, react, react-dom, lucide-react,
// @chenglou/pretext, vite) at the versions its lockfile pins; npx vite build --mode harness first for Cadenza's side.
// Per frame: the share of the picture whose ink (anything off the ground colour) both sides agree on (IoU), and the
// mean colour difference at full size and at 1/8 (the composition, without antialiasing and glyph-edge noise).
// Software WebGL (the test machines') drops frames and loses its GPU process on long runs, so each side runs in a
// browser of its own, reopened every so often and whenever a frame comes back blank or the page is gone.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const serve = require('./serve.cjs');

const ROOT = path.resolve(__dirname, '..');
const [folia, OUT, modesArg, stepArg] = process.argv.slice(2);
if (!folia || !OUT) {
  console.error('usage: node tests/folia-compare.cjs <folia checkout> <out dir> [modes] [step]');
  process.exit(2);
}
const MODES = (modesArg || 'sonnet,tempera').split(',');
const STEP = +(stepArg || 0.5);
const W = 1280,
  H = 720;
// Each frame on fresh pages by default: Folia's scenes keep some state from the frames drawn before (springs, the
// scenes already built), so a frame drawn after a different history is not the same frame.
const REOPEN_EVERY = +(process.env.REOPEN_EVERY || 1);
// One theme for both sides: Cadenza's look reaches Folia as these four colours and a font (src/folia/adapt.ts).
const THEME = {
  name: 'Compare',
  backgroundColor: '#15131c',
  primaryColor: '#f2eee8',
  accentColor: '#e0607a',
  secondaryColor: '#7aa6d8',
  fontStyle: 'sans',
  fontFamily: 'WenQuanYi Zen Hei',
  fontFamilyStack: ['WenQuanYi Zen Hei'],
  animationIntensity: 'normal',
};
const META = { title: '示範曲', artist: '測試樂團', album: '第一張' };
const GL_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];

async function launch(url, ready) {
  const br = await chromium.launch({ args: GL_ARGS });
  const p = await br.newPage({ viewport: { width: W, height: H } });
  // Folia draws some of its details with Math.random (a decoration's depth, guide particles, the start of an
  // animated stroke), so Folia differs from itself run to run; both sides get the same seeded stream instead,
  // restarted before the engine is made and before each frame.
  await p.addInitScript(() => {
    let a = 1;
    window.__reseed = (n) => (a = n >>> 0 || 1);
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  p.on('pageerror', (e) => console.log('page error:', e.message));
  await p.goto(url);
  await p.waitForFunction(ready);
  return { br, p };
}

/** One side of the comparison: (re)opened on demand, drawing a frame at t into a screenshot. */
class Side {
  constructor(name, open, draw) {
    this.name = name;
    this.openFn = open;
    this.drawFn = draw;
    this.s = null;
    this.frames = 0;
  }
  async open() {
    if (this.s) await this.s.br.close().catch(() => {});
    this.s = await this.openFn();
    this.frames = 0;
  }
  async shot(t, ok) {
    for (let tries = 0; tries < 4; tries++) {
      try {
        if (!this.s || this.frames++ >= REOPEN_EVERY) await this.open();
        await this.drawFn(this.s.p, t);
        const png = await this.s.p.screenshot({ type: 'png' });
        if (await ok(png)) return png;
      } catch (e) {
        console.log(`${this.name} page lost:`, String(e.message || e).split('\n')[0]);
      }
      await this.open().catch((e) => console.log(`${this.name} reopen failed:`, String(e.message || e)));
    }
    throw new Error(`${this.name}: no frame at ${t}`);
  }
  async close() {
    if (this.s) await this.s.br.close().catch(() => {});
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // Folia's side: the reference page, built inside the checkout so its imports resolve as upstream's do
  const refDir = path.join(folia, 'ref-harness');
  fs.mkdirSync(refDir, { recursive: true });
  for (const f of ['index.html', 'main.ts', 'vite.config.mjs'])
    fs.copyFileSync(path.join(__dirname, 'folia-ref', f), path.join(refDir, f));
  execFileSync(
    'node',
    [path.join(folia, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'ref-harness/vite.config.mjs'],
    { cwd: folia, stdio: 'inherit' },
  );
  const a = await serve(path.join(refDir, 'dist'));
  const b = await serve(path.join(ROOT, 'dist-harness'));

  // the lyrics as Cadenza's model has them (the demo song), handed to both sides
  const lyr = await launch(b.url + '/harness.html', () => window.H);
  const song = await lyr.p.evaluate(async () => {
    const s = await H.open({ theme: 'cover' });
    return { lines: H.folia.foliaLines(s.plan.doc), dur: s.plan.dur };
  });
  await lyr.br.close();

  // the measuring page draws no WebGL at all
  const cmpB = await chromium.launch();
  const cmp = await cmpB.newPage();
  await cmp.goto(b.url + '/harness.html');
  const decode = (fn, arg) => cmp.evaluate(fn, arg);
  /** how much of a picture is off the ground colour, and whether it is all black (a dropped frame) */
  const look = (png) =>
    decode(
      async ({ s, bg }) => {
        const i = new Image();
        await new Promise((r) => {
          i.onload = r;
          i.src = 'data:image/png;base64,' + s;
        });
        const c = new OffscreenCanvas(160, 90),
          g = c.getContext('2d');
        g.drawImage(i, 0, 0, 160, 90);
        const d = g.getImageData(0, 0, 160, 90).data;
        const bgc = [1, 3, 5].map((k) => parseInt(bg.slice(k, k + 2), 16));
        let m = 0,
          ink = 0;
        for (let k = 0; k < d.length; k += 4) {
          m = Math.max(m, d[k], d[k + 1], d[k + 2]);
          if (Math.max(...[0, 1, 2].map((q) => Math.abs(d[k + q] - bgc[q]))) > 24) ink++;
        }
        return { black: m < 4, ink: ink / (d.length / 4) };
      },
      { s: png.toString('base64'), bg: THEME.backgroundColor },
    );

  const report = {};
  for (const mode of MODES) {
    const refOpts = {
      mode,
      lines: song.lines,
      theme: THEME,
      seed: 'compare',
      bg: THEME.backgroundColor,
      transparent: true,
      ...META,
    };
    const ref = new Side(
      'folia',
      async () => {
        const s = await launch(a.url + '/index.html', () => window.REF);
        await s.p.evaluate((o) => (window.__reseed(7), window.REF.open(o)), refOpts);
        return s;
      },
      (p, t) => p.evaluate((t) => (window.__reseed(Math.round(t * 1000)), window.REF.frame(t)), t),
    );
    const cz = new Side(
      'cadenza',
      async () => {
        const s = await launch(b.url + '/harness.html', () => window.H);
        await s.p.evaluate(
          async ({ mode, lines, theme, dur, meta }) => {
            const c = document.createElement('canvas');
            c.id = 'cmp';
            c.width = 1280;
            c.height = 720;
            Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '99' });
            document.body.appendChild(c);
            H.engine.canvas.style.display = 'none';
            const spec = {
              seed: 'compare',
              lines,
              theme,
              duration: dur,
              instrumental: false,
              fontScale: 1,
              still: false,
              transparent: true,
              beatFx: false,
              credits: true,
              tuning: {},
              ...meta,
            };
            window.__reseed(7);
            window.__eng =
              mode === 'tempera'
                ? new H.folia.TemperaEngine({ ...spec, coverColors: [] })
                : new H.folia.SonnetEngine(spec);
            for (let i = 0; i < 100 && !window.__eng.ready; i++) await new Promise((r) => setTimeout(r, 30));
          },
          { mode, lines: song.lines, theme: THEME, dur: song.dur, meta: META },
        );
        return s;
      },
      (p, t) =>
        p.evaluate(
          ({ t, bg }) => {
            const g = document.getElementById('cmp').getContext('2d');
            const gl = H.folia.pixi.glRunner();
            window.__reseed(Math.round(t * 1000));
            // (several frames: the pre-rolled scenes are built as they would be by then, as on Folia's side)
            for (let i = 0; i < 3; i++) {
              g.setTransform(1, 0, 0, 1, 0, 0);
              g.globalAlpha = 1;
              g.globalCompositeOperation = 'source-over';
              g.fillStyle = bg;
              g.fillRect(0, 0, 1280, 720);
              window.__eng.draw(g, { t, W: 1280, H: 720, px: 1, alpha: 1, playing: false });
            }
            // (the filter context lost mid-frame: the picture is missing its filtered parts)
            if (!gl.ok) throw new Error('GPU context lost');
          },
          { t, bg: THEME.backgroundColor },
        ),
    );
    const rows = [];
    for (let t = 0.25; t < song.dur; t += STEP) {
      let B = await cz.shot(t, async (png) => !(await look(png)).black).catch((e) => console.log(e.message));
      if (!B) continue;
      let inkB = (await look(B)).ink;
      // (Folia's picture all black, or nearly empty where Cadenza's is not: a dropped frame, drawn again)
      const A = await ref
        .shot(t, async (png) => {
          const la = await look(png);
          return !la.black && !(inkB > 0.004 && la.ink < inkB * 0.15);
        })
        .catch(async () => {
          console.log(`folia: kept an empty frame at ${t.toFixed(2)} (it never drew)`);
          return ref.s.p.screenshot({ type: 'png' });
        });
      // (Cadenza's nearly empty where Folia's is not: drawn again on a fresh page, once)
      const inkA = (await look(A)).ink;
      if (inkA > 0.004 && inkB < inkA * 0.15) {
        await cz.open().catch(() => {});
        const again = await cz.shot(t, async (png) => !(await look(png)).black).catch(() => null);
        if (again) {
          B = again;
          inkB = (await look(B)).ink;
        }
      }
      const m = await decode(
        async ({ a, b, bg }) => {
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
            g.imageSmoothingQuality = 'high';
            g.drawImage(img, 0, 0, w, h);
            return g.getImageData(0, 0, w, h).data;
          };
          const bgc = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
          const measure = (w, h) => {
            const da = px(ia, w, h),
              db = px(ib, w, h);
            let sum = 0,
              inter = 0,
              uni = 0;
            for (let i = 0; i < da.length; i += 4) {
              let d = 0,
                ea = 0,
                eb = 0;
              for (let k = 0; k < 3; k++) {
                d += Math.abs(da[i + k] - db[i + k]);
                ea = Math.max(ea, Math.abs(da[i + k] - bgc[k]));
                eb = Math.max(eb, Math.abs(db[i + k] - bgc[k]));
              }
              sum += d / 3;
              if (ea > 30 && eb > 30) inter++;
              if (ea > 30 || eb > 30) uni++;
            }
            return { mean: sum / (da.length / 4) / 255, iou: uni ? inter / uni : 1 };
          };
          return { full: measure(1280, 720), coarse: measure(160, 90) };
        },
        { a: A.toString('base64'), b: B.toString('base64'), bg: THEME.backgroundColor },
      );
      const tag = `${mode}-${t.toFixed(2)}`;
      fs.writeFileSync(path.join(OUT, `${tag}-folia.png`), A);
      fs.writeFileSync(path.join(OUT, `${tag}-cadenza.png`), B);
      rows.push({ t: +t.toFixed(2), ...m });
      console.log(
        `${tag}  ink IoU ${(m.full.iou * 100).toFixed(1)}%  coarse IoU ${(m.coarse.iou * 100).toFixed(1)}%  mean diff ${(m.full.mean * 100).toFixed(2)}% / coarse ${(m.coarse.mean * 100).toFixed(2)}%`,
      );
    }
    await ref.close();
    await cz.close();
    const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
    const median = (f) => {
      const v = rows.map(f).sort((x, y) => x - y);
      return v[v.length >> 1];
    };
    report[mode] = {
      frames: rows.length,
      iou: avg((r) => r.full.iou),
      coarseIou: avg((r) => r.coarse.iou),
      medianCoarseIou: median((r) => r.coarse.iou),
      mean: avg((r) => r.full.mean),
      coarseMean: avg((r) => r.coarse.mean),
      rows,
    };
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
    console.log(
      `== ${mode}: ${rows.length} frames, ink IoU ${(report[mode].iou * 100).toFixed(1)}%, coarse IoU ${(report[mode].coarseIou * 100).toFixed(1)}% (median ${(report[mode].medianCoarseIou * 100).toFixed(1)}%), mean diff ${(report[mode].mean * 100).toFixed(2)}%`,
    );
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  await cmpB.close();
  a.server.close();
  b.server.close();
})();
