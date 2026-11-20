// The Pixi-compatible stage against real Pixi: each scene below is built from one source by both (Folia's reference
// page with Pixi 8, and Cadenza's harness with src/folia/pixi) and the two pictures compared.
//   node tests/folia-stage-compare.cjs <folia checkout with ref-harness/dist built> <out dir>
// (tests/folia-compare.cjs builds the reference page; run it once first.)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const serve = require('./serve.cjs');

const ROOT = path.resolve(__dirname, '..');
const [folia, OUT] = process.argv.slice(2);
const BG = '#15131c';
const FONT = 'WenQuanYi Zen Hei';

// Each scene: a function of the Pixi module returning a container. Written once, run by both sides.
const SCENES = {
  'text-outline-giant': `(P) => { const c = new P.Container(); const t = new P.Text({ text: '清', style: new P.TextStyle({ fontFamily: '${FONT}', fontSize: 616, fill: 'transparent', stroke: { color: '#e0607a', width: 3.7 }, align: 'center' }) }); t.anchor.set(0.5); t.alpha = 0.2; t.scale.set(1.33); t.position.set(640, 360); c.addChild(t); return c; }`,
  'text-fill-glow': `(P) => { const c = new P.Container(); const t = new P.Text({ text: '光落在', style: new P.TextStyle({ fontFamily: '${FONT}', fontSize: 120, fontWeight: '700', fill: '#f2eee8', dropShadow: { color: '#e0607a', alpha: 0.8, blur: 21.6, distance: 0 }, padding: 54, align: 'center' }) }); t.anchor.set(0.5); t.position.set(640, 360); c.addChild(t); return c; }`,
  'text-tint-screen': `(P) => { const c = new P.Container(); const st = new P.TextStyle({ fontFamily: '${FONT}', fontSize: 160, fill: '#f2eee8' }); const a = new P.Text({ text: '窗', style: st }); a.tint = 0x00ffff; a.blendMode = 'screen'; a.anchor.set(0.5); a.alpha = 0.8; a.position.set(630, 360); const b = new P.Text({ text: '窗', style: st }); b.tint = 0xff0044; b.blendMode = 'screen'; b.anchor.set(0.5); b.alpha = 0.8; b.position.set(650, 360); c.addChild(a, b); return c; }`,
  'text-spacing-wrap': `(P) => { const c = new P.Container(); const t = new P.Text({ text: 'MORNING LIGHT FALLS BY THE WINDOW AND STAYS', style: new P.TextStyle({ fontFamily: '${FONT}', fontSize: 30, fill: '#7aa6d8', letterSpacing: 6, wordWrap: true, wordWrapWidth: 420, align: 'center' }) }); t.position.set(420, 260); c.addChild(t); return c; }`,
  'graphics-strokes': `(P) => { const g = new P.Graphics(); g.moveTo(100, 100).lineTo(500, 160).lineTo(300, 400).stroke({ color: 0xf2eee8, width: 2, alpha: 0.8 }); g.circle(800, 300, 120).stroke({ color: 0xe0607a, width: 6 }); g.moveTo(600, 600).bezierCurveTo(700, 400, 900, 700, 1100, 500).stroke({ color: 0x7aa6d8, width: 3 }); g.moveTo(200, 600).quadraticCurveTo(300, 450, 450, 620).stroke({ color: 0xffffff, width: 1, alpha: 0.5 }); g.arc(1000, 150, 80, 0, Math.PI * 1.3).stroke({ color: 0xf2eee8, width: 4 }); return g; }`,
  'graphics-fills': `(P) => { const g = new P.Graphics(); g.rect(80, 80, 300, 200).fill({ color: 0xe0607a, alpha: 0.6 }).stroke({ color: 0xffffff, width: 3 }); g.poly([500, 100, 900, 120, 800, 420, 520, 380]).fill({ color: 0x7aa6d8 }); g.poly([600, 180, 760, 190, 700, 320]).cut(); g.roundRect(950, 400, 250, 180, 30).fill({ color: 0xf2eee8, alpha: 0.3 }); g.ellipse(250, 520, 160, 70).fill({ color: 0x99ccaa }); return g; }`,
  'graphics-gradient': `(P) => { const g = new P.Graphics(); const fg = new P.FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, colorStops: [{ offset: 0, color: '#e0607a' }, { offset: 1, color: '#7aa6d8' }], textureSpace: 'local' }); g.poly([200, 100, 1000, 150, 900, 600, 300, 550]).fill({ fill: fg, alpha: 0.9 }); return g; }`,
  'blur-halo': `(P) => { const c = new P.Container(); const halo = new P.Container(); const t = new P.Text({ text: '慢慢走', style: new P.TextStyle({ fontFamily: '${FONT}', fontSize: 140, fill: '#f2eee8' }) }); t.anchor.set(0.5); t.position.set(640, 360); halo.addChild(t); halo.filters = [new P.BlurFilter({ strength: 4.6, quality: 2, kernelSize: 5 })]; halo.alpha = 0.4; halo.blendMode = 'screen'; const t2 = new P.Text({ text: '慢慢走', style: new P.TextStyle({ fontFamily: '${FONT}', fontSize: 140, fill: '#f2eee8' }) }); t2.anchor.set(0.5); t2.position.set(640, 360); c.addChild(halo, t2); return c; }`,
  'blur-strong': `(P) => { const c = new P.Container(); const g = new P.Graphics().rect(440, 260, 400, 200).fill(0xe0607a).circle(640, 360, 60).fill(0xffffff); c.addChild(g); const b = new P.BlurFilter({ strength: 18, quality: 1, kernelSize: 5 }); b.repeatEdgePixels = true; c.filters = [b]; c.filterArea = new P.Rectangle(0, 0, 1280, 720); return c; }`,
  'color-matrix': `(P) => { const c = new P.Container(); c.addChild(new P.Graphics().rect(200, 200, 300, 300).fill(0x7aa6d8).rect(600, 200, 300, 300).fill(0xe0607a)); const m = new P.ColorMatrixFilter(); m.contrast(0.5, false); c.filters = [m]; c.filterArea = new P.Rectangle(0, 0, 1280, 720); return c; }`,
  'custom-filter': `(P) => { const c = new P.Container(); c.addChild(new P.Graphics().rect(300, 200, 680, 320).fill(0xf2eee8).circle(640, 360, 100).fill(0xe0607a)); const frag = 'in vec2 vTextureCoord; out vec4 finalColor; uniform sampler2D uTexture; uniform highp vec4 uInputSize; uniform highp vec4 uOutputFrame; uniform float uAmount; void main(){ vec2 o = vec2(uAmount * uInputSize.z, 0.0); vec4 c = texture(uTexture, vTextureCoord + o); float band = step(0.5, fract(vTextureCoord.y * uInputSize.y / uOutputFrame.w * 8.0)); finalColor = vec4(c.rgb * (0.6 + 0.4 * band), c.a); }'; const vert = 'in vec2 aPosition; out vec2 vTextureCoord; uniform vec4 uInputSize; uniform vec4 uOutputFrame; uniform vec4 uOutputTexture; void main(void){ vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy; position.x = position.x * (2.0 / uOutputTexture.x) - 1.0; position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z; gl_Position = vec4(position, 0.0, 1.0); vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw); }'; const u = new P.UniformGroup({ uAmount: { value: 40, type: 'f32' } }); const f = new P.Filter({ glProgram: P.GlProgram.from({ vertex: vert, fragment: frag, name: 'cmp' }), resources: { u }, resolution: 'inherit', padding: 0 }); c.filters = [f]; c.filterArea = new P.Rectangle(0, 0, 1280, 720); return c; }`,
  'mask-rect': `(P) => { const c = new P.Container(); const g = new P.Graphics(); for (let i = -400; i < 800; i += 24) g.moveTo(300 + i, 150).lineTo(300 + i + 400, 550).stroke({ color: 0xf2eee8, width: 2, alpha: 0.6 }); const m = new P.Graphics().rect(300, 150, 500, 400).fill({ color: 0xffffff }); g.mask = m; c.addChild(g, m); return c; }`,
  'nested-transform': `(P) => { const outer = new P.Container(); outer.pivot.set(640, 360); outer.position.set(660, 350); outer.rotation = 0.12; outer.scale.set(1.2); const inner = new P.Container(); inner.position.set(200, 120); inner.alpha = 0.7; const g = new P.Graphics().rect(0, 0, 300, 160).fill(0x7aa6d8).moveTo(0, 0).lineTo(300, 160).stroke({ color: 0xffffff, width: 3 }); inner.addChild(g); const t = new P.Text({ text: '街道', style: new P.TextStyle({ fontFamily: '${FONT}', fontSize: 90, fill: '#f2eee8' }) }); t.position.set(500, 300); t.rotation = -0.3; outer.addChild(inner, t); return outer; }`,
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const a = await serve(path.join(folia, 'ref-harness', 'dist'));
  const b = await serve(path.join(ROOT, 'dist-harness'));
  const open = async (url, ready) => {
    const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    const p = await br.newPage({ viewport: { width: 1280, height: 720 } });
    p.on('pageerror', (e) => console.log('page error:', e.message));
    await p.goto(url);
    await p.waitForFunction(ready);
    return { br, p };
  };
  const ref = await open(a.url + '/index.html', () => window.REF);
  const cz = await open(b.url + '/harness.html', () => window.H);
  await cz.p.evaluate(() => {
    H.engine.setView('hidden');
    H.engine.canvas.style.display = 'none';
    const c = document.createElement('canvas');
    c.id = 'cmp';
    c.width = 1280;
    c.height = 720;
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '99' });
    document.body.appendChild(c);
  });
  const rows = [];
  for (const [name, src] of Object.entries(SCENES)) {
    await ref.p.evaluate(({ src, bg }) => window.REF.scene(src, bg), { src, bg: BG });
    const A = await ref.p.screenshot({ type: 'png' });
    await cz.p.evaluate(
      ({ src, bg }) => {
        const P = H.folia.pixi;
        const root = new Function('PIXI', 'return (' + src + ')(PIXI)')(P);
        const g = document.getElementById('cmp').getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = bg;
        g.fillRect(0, 0, 1280, 720);
        new P.StageRenderer().render(root, g, { width: 1280, height: 720, resolution: 1, clear: false });
      },
      { src, bg: BG },
    );
    const B = await cz.p.screenshot({ type: 'png' });
    const m = await cz.p.evaluate(
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
          g.drawImage(img, 0, 0, w, h);
          return g.getImageData(0, 0, w, h).data;
        };
        const bgc = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
        const measure = (w, h) => {
          const da = px(ia, w, h),
            db = px(ib, w, h);
          let sum = 0,
            inter = 0,
            uni = 0,
            inkA = 0,
            inkB = 0;
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
            inkA += ea;
            inkB += eb;
            if (ea > 24 && eb > 24) inter++;
            if (ea > 24 || eb > 24) uni++;
          }
          return { mean: sum / (da.length / 4) / 255, iou: uni ? inter / uni : 1, ink: inkB / Math.max(1, inkA) };
        };
        return { full: measure(1280, 720), coarse: measure(160, 90) };
      },
      { a: A.toString('base64'), b: B.toString('base64'), bg: BG },
    );
    fs.writeFileSync(path.join(OUT, `${name}-pixi.png`), A);
    fs.writeFileSync(path.join(OUT, `${name}-stage.png`), B);
    rows.push({ name, ...m });
    console.log(
      `${name.padEnd(20)} IoU ${(m.full.iou * 100).toFixed(1)}%  coarse ${(m.coarse.iou * 100).toFixed(1)}%  ink ratio ${m.full.ink.toFixed(2)}  mean diff ${(m.full.mean * 100).toFixed(2)}%`,
    );
  }
  fs.writeFileSync(path.join(OUT, 'stage-report.json'), JSON.stringify(rows, null, 1));
  await ref.br.close();
  await cz.br.close();
  a.server.close();
  b.server.close();
})();
