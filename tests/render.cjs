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
  async coverDrawn(p) {
    // the cover theme draws its sleeve: the frame with the cover differs from the one without it over a good part of the picture
    const r = await p.evaluate(async () => { const ses = await H.open({ theme: 'cover', coverUrl: 'cover.jpg' }); const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const g = cv.getContext('2d', { willReadFrequently: true });
      const draw = owner => { const f = H.engine.frameAt(2, { px: 0.5 }); f.coverOwner = owner; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 640, 360); H.drawFrame(g, f, { sig: ses.sig }); return g.getImageData(0, 0, 640, 360).data; };
      const a = draw('backdrop'), b = draw('page'); let d = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) d++; return d / (a.length / 4); });
    ok('cover: the cover theme draws its sleeve', r > 0.04, r.toFixed(3));
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
  // the lyric layer on the GPU (render/gpu.ts) draws what the 2D canvas does: the same frames with it on and off, compared
  // pixel by pixel — the sharp glyphs come from bitmaps there (a hair softer at a size between two of their steps), so
  // a few edge pixels may differ a little, nothing more
  async gpu(p) {
    const r = await p.evaluate(async () => { const out = []; for (const th of ['liquid', 'gothic', 'cover', 'c:punch:stage', 'c:waltz:geo']) {
      const s = th.startsWith('c:') ? { theme: 'liquid', cut: th.split(':')[1], bg: th.split(':')[2] } : { theme: th }, ses = await H.open({ ...s, coverUrl: 'cover.jpg' });
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const g = cv.getContext('2d', { willReadFrequently: true });
      let worst = 0, mean = 0, n = 0, on = false, quads = 0, msOn = 0, msOff = 0;
      for (const t of [1.2, 3.1, 6.4, 9.8, 14.2, 18.5, 22.7]) { const f = H.engine.frameAt(t, { px: 1 });
        const draw = gpu => { H.setGpuLyrics(gpu); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 1280, 720); const a = performance.now(); H.drawFrame(g, { ...f, vis: undefined }, { sig: ses.sig }); const d = g.getImageData(0, 0, 1280, 720).data; return [d, performance.now() - a]; };
        draw(true); draw(false);                                                  // (each path's bitmaps made once)
        const [a, ta] = draw(false), [b, tb] = draw(true); on = on || H.lyrics.GPU_STATS.on; quads = Math.max(quads, H.lyrics.GPU_STATS.quads); msOff += ta; msOn += tb;
        let big = 0, sum = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); sum += d; if (d > 60) big++; }
        worst = Math.max(worst, big / (a.length / 4)); mean += sum / (a.length / 4) / 3; n++; }
      H.setGpuLyrics(true); out.push({ th, on, quads, worst: +(worst * 100).toFixed(3), mean: +(mean / n).toFixed(3), msOn: Math.round(msOn / n), msOff: Math.round(msOff / n) }); } return out; });
    for (const x of r) ok(`gpu: the lyric layer on the GPU draws what the canvas does (${x.th})`, x.on && x.quads > 0 && x.worst < 0.5 && x.mean < 0.6, JSON.stringify(x));
  },
  async perf(p) {
    const r = await p.evaluate(async () => { const out = {}; for (const th of ['liquid', 'gothic', 'cover']) { const ses = await H.open({ theme: th, coverUrl: 'cover.jpg' });
      const f0 = H.engine.frameAt(1); const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const g = cv.getContext('2d'); const ts = [];
      // (each frame finished — one pixel read back — so the raster is paid for in every theme alike: without it only the
      // recording is timed, except in frames where an effect copies the canvas (the glass shards), which then pay for all)
      for (let i = 0; i < 90; i++) { const t = 2 + i / 30, f = H.engine.frameAt(t, { px: 1 }); const a = performance.now(); H.drawFrame(g, f, { sig: ses.sig }); g.getImageData(0, 0, 1, 1); ts.push(performance.now() - a); await new Promise(r => setTimeout(r, 0)); }
      ts.sort((a, b) => a - b); out[th] = { med: +ts[45].toFixed(1), p95: +ts[85].toFixed(1) }; } return out; });
    // (headless Chromium rasterises in software, several times slower than a GPU canvas: the bound is 1.5.1's own cost here
    // — about 80–95 ms a finished frame — with room for noise; a regression past it fails)
    ok('perf: a finished frame costs no more than 1.5.1 did (software canvas, 1280×720)', Object.values(r).every(x => x.med < 115), JSON.stringify(r));
  },
  async glass(p) {
    // the shatter's own cost: the same moments drawn with the glass and, as a separate run, without it (gothic theme,
    // 1280×720, each frame finished — read back — so what is drawn is really paid for, not just recorded)
    const r = await p.evaluate(async () => { const ses = await H.open({ theme: 'gothic', coverUrl: 'cover.jpg' }); const ev = H.engine.frameAt(1).plan.cues.glass[0]; if (!ev) return { n: 0 };
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const g = cv.getContext('2d');
      const gl = H.effects().filter(e => e.id.startsWith('glass')), keep = gl.map(e => e.draw);
      const run = async on => { gl.forEach((e, k) => { e.draw = on ? keep[k] : () => {}; }); const d = [];
        for (let i = 0; i < 30; i++) { const f = H.engine.frameAt(ev.t + 0.02 + i * 0.05, { px: 1 }), a = performance.now(); H.drawFrame(g, f, { sig: ses.sig }); g.getImageData(0, 0, 1, 1); d.push(performance.now() - a); await new Promise(r => setTimeout(r, 0)); }
        d.sort((x, y) => x - y); return +d[15].toFixed(1); };
      await run(true); const off = await run(false), on = await run(true); gl.forEach((e, k) => { e.draw = keep[k]; }); return { n: 1, off, on }; });
    ok('glass: the shatter adds little to a frame', r.n > 0 && r.on < r.off * 1.25 + 4, JSON.stringify(r));
  },
  async gfx(p) {
    // the three picture modes: each draws the song (a real picture, also through a transition's blur), and the cheaper
    // two draw a transition frame at less cost than the default (software canvas, 1280×720, each frame finished)
    const r = await p.evaluate(async () => { const ses = await H.open({ theme: 'gothic', coverUrl: 'cover.jpg' }); const plan = H.engine.frameAt(1).plan, q = plan.passages[0];
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const g = cv.getContext('2d', { willReadFrequently: true }), out = {};
      const sd = () => { const d = g.getImageData(0, 0, 1280, 720).data; let m = 0, v = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { const y = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; m += y; v += y * y; n++; } m /= n; return Math.sqrt(v / n - m * m); };
      for (const mode of ['default', 'optimized', 'lite']) { H.setGfx(mode); const ts = [];
        for (let i = 0; i < 12; i++) { const f = H.engine.frameAt(q.t - 0.05 + i * 0.01, { px: 1 }), a = performance.now(); H.drawFrame(g, f, { sig: ses.sig }); g.getImageData(0, 0, 1, 1); ts.push(performance.now() - a); }
        ts.sort((x, y) => x - y); const tr = sd(); H.drawFrame(g, H.engine.frameAt(8.4, { px: 1 }), { sig: ses.sig }); out[mode] = { ms: +ts[6].toFixed(1), sdTrans: +tr.toFixed(1), sd: +sd().toFixed(1) }; }
      H.setGfx('default'); return { q: !!q, ...out }; });
    ok('gfx: every mode draws the picture, through a transition too; the optimised and lite transitions cost less', r.q && ['default', 'optimized', 'lite'].every(m => r[m].sd > 2 && r[m].sdTrans > 1) && r.optimized.ms < r.default.ms && r.lite.ms < r.default.ms, JSON.stringify(r));
  },
  async export(p) {
    // a short song with audio (a synthetic click track), exported at 360p: the MP4 has the right size, length and a soundtrack
    const r = await p.evaluate(async () => {
      const sr = 48000, dur = 6, ac = new OfflineAudioContext(2, sr * dur, sr), buf = ac.createBuffer(2, sr * dur, sr);
      for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let b = 0; b < dur * 2; b++) { const i0 = Math.round((0.25 + b * 0.5) * sr); for (let i = 0; i < 2000 && i0 + i < d.length; i++) d[i0 + i] += Math.sin(i * 0.05) * Math.exp(-i / 400) * 0.8; } }
      const ses = await H.open({ theme: 'liquid', lyrics: '[00:00.50]第一句 歌詞\n[00:03.00]第二句 歌詞', audio: buf, song: { on: true, title: '測試', artist: '' } });
      const res = await H.exportVideo(H.engine, ses, { res: 360, fps: 24, quality: 'q1', codec: 'avc' });
      // the MP4 read back through the clip reader a video background exports with (mp4box + WebCodecs): frames at the times asked
      let back = null; if (res.ok && res.result && res.result.blob) { const fs = await H.openFrameSource(res.result.blob); if (fs) { back = []; for (const x of [0.2, 2.5, 1.0, 5.0]) { const f = await fs.frameAt(x); back.push([f.cv.width, f.cv.height]); } fs.close(); } else back = 'none'; }
      return { ok: res.ok, w: res.w, h: res.h, size: res.size, audio: res.audio, reason: res.reason, e: res.e, dur: ses.dur, back };
    });
    ok('export: an MP4 at the asked size with its soundtrack', r.ok && r.h === 360 && r.size > 20000 && r.audio !== 'x.silent', JSON.stringify(r));
    ok('export: the MP4 reads back through the clip reader, frame by frame at any time', Array.isArray(r.back) && r.back.length === 4 && r.back.every(([w, h]) => w === 640 && h === 360), JSON.stringify(r.back));
  },
  async exportMode(p) {
    // the live picture's mode is not the export's: an export draws every frame in full quality, the live picture keeps
    // its own mode meanwhile, and the setting changed in the middle of an export holds after it (nothing restores an
    // older value over it)
    const r = await p.evaluate(async () => {
      const ses = await H.open({ theme: 'gothic', coverUrl: 'cover.jpg', lyrics: '[00:00.50]第一句 歌詞\n[00:03.00]第二句 歌詞' }); H.setGfx('lite');
      const seen = new Set(), draw = H.drawFrame; let liveDuring = null;
      // (watch the mode each export frame is drawn in, and draw a live frame in the middle of the export)
      const orig = H.effects().find(e => e.id === 'feathers-fg'), keep = orig.draw; orig.draw = (g, f, a) => { if (g.canvas.height < 400) seen.add(H.gfx()); return keep(g, f, a); };   // (the export's canvas, 144 px: not the live preview's)
      const run = H.exportVideo(H.engine, ses, { res: 144, fps: 12, quality: 'q1', codec: 'avc', audio: false });
      await new Promise(r => setTimeout(r, 300)); liveDuring = H.gfx(); H.setGfx('optimized');
      const res = await run; orig.draw = keep; const after = H.gfx(); H.setGfx('default');
      return { ok: res.ok, seen: [...seen], liveDuring, after };
    });
    ok('export: frames in full quality, the live mode kept meanwhile, a change during the export holds', r.ok && r.seen.length === 1 && r.seen[0] === 'default' && r.liveDuring === 'lite' && r.after === 'optimized', JSON.stringify(r));
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
