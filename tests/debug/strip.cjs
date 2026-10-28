// Frames of a moment as a contact sheet:  node tests/debug/strip.cjs <out.png> <theme> <t0> <t1> <fps> [lyrics file]
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const serve = require('../serve.cjs');
const [OUT, TH = 'cover', A = '0', B = '1', FPS = '30', LF] = process.argv.slice(2);
const LRC = LF ? fs.readFileSync(LF, 'utf8') : undefined;
(async () => {
  const { server, url } = await serve(path.join(__dirname, '..', '..', 'dist-harness'));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto(url + '/harness.html'); await p.waitForFunction(() => window.H);
  const png = await p.evaluate(async ([th, lrc, a, z, fps]) => {
    const s = await H.open({ theme: th, lyrics: lrc, bpm: 120 }); await document.fonts.ready; await new Promise(r => setTimeout(r, 1500));
    const n = Math.round((z - a) * fps) + 1, cols = 6, w = 426, h = 240, sheet = document.createElement('canvas'); sheet.width = cols * w; sheet.height = Math.ceil(n / cols) * (h + 18);
    const sg = sheet.getContext('2d'); sg.fillStyle = '#000'; sg.fillRect(0, 0, sheet.width, sheet.height);
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const g = cv.getContext('2d');
    for (let i = 0; i < n; i++) { const t = a + i / fps, f = H.engine.frameAt(t, { px: 1 }); f.vis = undefined; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 1280, 720); H.drawFrame(g, f, { sig: s.sig });
      const x = (i % cols) * w, y = Math.floor(i / cols) * (h + 18); sg.drawImage(cv, x, y, w, h); sg.fillStyle = '#fff'; sg.font = '13px sans-serif'; sg.fillText(t.toFixed(3), x + 4, y + h + 14); }
    return sheet.toDataURL('image/png');
  }, [TH, LRC, +A, +B, +FPS]);
  fs.writeFileSync(OUT, Buffer.from(png.split(',')[1], 'base64')); await b.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
