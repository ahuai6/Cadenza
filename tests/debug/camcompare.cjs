// Compare the camera of Lyric Motion 2.1 (the old engine) and Cadenza on the same lyrics: trajectories sampled at 60 Hz in
// frame units, a few motion statistics, and a chart of both. Debug tool:  node tests/debug/camcompare.cjs <out.png> [style]
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const serve = require('../serve.cjs');
const OLD = '/home/user/lyric-motion-app/dist-web/index.html', OUT = process.argv[2] || '/tmp/cam.png', THEME = process.argv[3] || 'cover';
const LRC = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'long.lrc'), 'utf8').split('\n').slice(0, 24).join('\n') + '\n[01:10.00]<01:10.000>１ <01:10.030>２ <01:10.060>３<01:10.090>\n[01:13.00] 結束';
const T0 = 0, T1 = 76, RATE = 60;
const stats = s => { const n = s.length, sp = [], zr = []; for (let i = 1; i < n; i++) { const a = s[i - 1], b = s[i], z = (a.z + b.z) / 2;
    sp.push(Math.hypot(b.x - a.x, b.y - a.y) * z / 1280 * RATE); zr.push(Math.abs(Math.log(b.z / a.z)) * RATE); }
  const srt = [...sp].sort((a, b) => a - b), mean = sp.reduce((a, b) => a + b, 0) / sp.length;
  // jerk: change of acceleration of the screen position, frames/s³
  let jk = 0; for (let i = 2; i < sp.length; i++) jk += Math.abs(sp[i] - 2 * sp[i - 1] + sp[i - 2]) * RATE * RATE; jk /= sp.length;
  return { moving: +(sp.filter(v => v > 0.04).length / sp.length).toFixed(3), still: +(sp.filter(v => v < 0.01).length / sp.length).toFixed(3), mean: +mean.toFixed(3),
    p95: +srt[Math.floor(srt.length * 0.95)].toFixed(3), peakToMean: +(srt[Math.floor(srt.length * 0.99)] / mean).toFixed(2), zoomRate: +(zr.reduce((a, b) => a + b, 0) / zr.length).toFixed(3), jerk: +jk.toFixed(1) };
};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  // old
  const po = await ctx.newPage(); await po.goto('file://' + OLD); await po.waitForFunction(() => window.LM && typeof camAt === 'function', null, { timeout: 30000 });
  const old = await po.evaluate(async ([lrc, th, T0, T1, R]) => { LM.applyPreset(th); await LM.load(lrc, 120, '', true); await new Promise(r => setTimeout(r, 800));
    const out = []; for (let t = T0; t <= T1; t += 1 / R) { const c = camAt(t); out.push({ x: c.x, y: c.y, z: c.z, r: c.r }); } return out; }, [LRC, THEME, T0, T1, RATE]);
  // new
  const { server, url } = await serve(path.join(__dirname, '..', '..', 'dist-harness'));
  const pn = await ctx.newPage(); await pn.goto(url + '/harness.html'); await pn.waitForFunction(() => window.H);
  const neu = await pn.evaluate(async ([lrc, th, T0, T1, R]) => { const s = await H.open({ theme: th, lyrics: lrc, bpm: 120 });
    const out = []; for (let t = T0; t <= T1; t += 1 / R) { const c = H.director.basePose(s.plan.camera, t); out.push({ x: c.x, y: c.y, z: c.z, r: c.r }); } return out; }, [LRC, THEME, T0, T1, RATE]);
  server.close();
  console.log('old', JSON.stringify(stats(old))); console.log('new', JSON.stringify(stats(neu)));
  // chart: screen speed and zoom of both over time
  const pg = await ctx.newPage(); await pg.setViewportSize({ width: 1600, height: 900 });
  await pg.setContent('<canvas id=c width=1600 height=900 style="background:#111"></canvas>');
  await pg.evaluate(([o, n, R]) => { const c = document.getElementById('c').getContext('2d'), W = 1600;
    const draw = (s, col, y0, h, f, max) => { c.strokeStyle = col; c.lineWidth = 1.2; c.beginPath(); s.forEach((p, i) => { if (!i) return; const v = f(s[i - 1], p); const x = i / s.length * W, y = y0 + h - Math.min(1, v / max) * h; i === 1 ? c.moveTo(x, y) : c.lineTo(x, y); }); c.stroke(); };
    const sp = (a, b) => Math.hypot(b.x - a.x, b.y - a.y) * b.z / 1280 * R, zl = (a, b) => Math.log(b.z);
    c.fillStyle = '#888'; c.font = '14px sans-serif'; c.fillText('screen speed (frames/s): orange old, cyan new', 10, 16); c.fillText('log zoom', 10, 466);
    for (const [s, col] of [[o, '#ffa64d'], [n, '#4dd6ff']]) { draw(s, col, 20, 420, sp, 2.5); }
    const zs = [...o, ...n].map(p => Math.log(p.z)), lo = Math.min(...zs), hi = Math.max(...zs);
    for (const [s, col] of [[o, '#ffa64d'], [n, '#4dd6ff']]) draw(s, col, 470, 420, (a, b) => Math.log(b.z) - lo, hi - lo);
    for (let t = 0; t < o.length / R; t += 5) { c.fillStyle = '#444'; c.fillRect(t * R / o.length * W, 0, 1, 900); }
  }, [old, neu, RATE]);
  await pg.screenshot({ path: OUT }); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
