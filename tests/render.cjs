// Render tests: the engine in Chromium on the harness page (npm run build:harness first, or this builds it).
//   node tests/render.cjs [check…]     checks: themes, cull, perf, digits, handoff, song
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs'), { execSync } = require('child_process');
const serve = require('./serve.cjs');
const ROOT = path.resolve(__dirname, '..'), DIST = path.join(ROOT, 'dist-harness');
let failed = 0; const ok = (name, pass, detail) => { if (!pass) failed++; console.log(`${pass ? 'pass' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const THEMES = ['liquid', 'gothic', 'cover', 'video', 'c:punch:stage', 'c:glide:minimal', 'c:waltz:geo', 'c:punch:bokeh'];
const spec = th => th.startsWith('c:') ? { theme: 'liquid', cut: th.split(':')[1], bg: th.split(':')[2] } : { theme: th };
const CHECKS = {
  async themes(p) {
    for (const th of THEMES) {
      const r = await p.evaluate(async s => { const ses = await H.open({ ...s, coverUrl: 'cover.jpg' }); const cv = H.engine.canvas, g = cv.getContext('2d', { willReadFrequently: true }), out = [];
        for (const t of [0.6, 3.1, 8.4, 16.6, 21.2, ses.musicEnd + 1.5]) { H.engine.seek(t); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const d = g.getImageData(0, 0, cv.width, cv.height).data; let m = 0, v = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { const y = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; m += y; v += y * y; n++; } m /= n; out.push(Math.sqrt(v / n - m * m)); }
        return out; }, spec(th));
      ok(`themes: ${th} draws a picture at every moment`, r.every(x => x > 2), r.map(x => x.toFixed(1)).join(' '));
    }
  },
  async cull(p) {
    // the culling never removes anything that would be visible: frames with and without it are identical
    const r = await p.evaluate(async () => { const out = []; for (const th of ['liquid', 'cover']) { const ses = await H.open({ theme: th });
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const g = cv.getContext('2d', { willReadFrequently: true }); let worst = 0;
      for (let t = 0.5; t < ses.musicEnd; t += 0.41) { const f = H.engine.frameAt(t, { px: 0.5 }); const draw = on => { H.setCulling(on); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 640, 360); f.vis = undefined; H.drawFrame(g, { ...f }, { sig: ses.sig }); return g.getImageData(0, 0, 640, 360).data; };
        const a = draw(true), b = draw(false); let d = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) d++; worst = Math.max(worst, d); }
      H.setCulling(true); out.push(worst); } return out; });
    ok('cull: never removes a visible word (pixels identical with it off)', r.every(x => x === 0), JSON.stringify(r));
  },
  async perf(p) {
    const r = await p.evaluate(async () => { const out = {}; for (const th of ['liquid', 'gothic', 'cover']) { const ses = await H.open({ theme: th, coverUrl: 'cover.jpg' });
      const f0 = H.engine.frameAt(1); const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const g = cv.getContext('2d'); const ts = [];
      for (let i = 0; i < 90; i++) { const t = 2 + i / 30, f = H.engine.frameAt(t, { px: 1 }); const a = performance.now(); H.drawFrame(g, f, { sig: ses.sig }); ts.push(performance.now() - a); await new Promise(r => setTimeout(r, 0)); }
      ts.sort((a, b) => a - b); out[th] = { med: +ts[45].toFixed(1), p95: +ts[85].toFixed(1) }; } return out; });
    ok('perf: frames draw well inside a frame budget (software canvas, 1280×720)', Object.values(r).every(x => x.med < 40), JSON.stringify(r));
  },
};
(async () => {
  if (!fs.existsSync(path.join(DIST, 'harness.html')) || process.env.BUILD !== '0') execSync('npx vite build --mode harness', { cwd: ROOT, stdio: 'ignore' });
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'cover.jpg'), path.join(DIST, 'cover.jpg'));
  const { server, url } = await serve(DIST); const browser = await chromium.launch();
  const want = process.argv.slice(2), list = want.length ? want : Object.keys(CHECKS);
  for (const k of list) { const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }), p = await ctx.newPage(), errs = [];
    p.on('pageerror', e => errs.push(e.message)); await p.goto(url + '/harness.html'); await p.waitForFunction(() => window.H);
    try { await CHECKS[k](p); } catch (e) { ok(k, false, String(e.message || e).slice(0, 300)); }
    if (errs.length) ok(`${k}: no page errors`, false, errs.slice(0, 3).join(' | '));
    await ctx.close(); }
  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'all passed'); process.exit(failed ? 1 : 0);
})();
