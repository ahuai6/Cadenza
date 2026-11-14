// Draws the installer's own pictures from the Cadenza mark (build/icon.cjs) and writes them as 24-bit BMPs, the only
// kind NSIS shows:
//   build/installer-sidebar.bmp  164×314  the welcome and finish pages (installer and uninstaller)
//   build/installer-header.bmp   150×57   the top of every other page
// Drawn at twice the size and scaled down in the page, so the edges are smooth at 100 % display scale.
//   node build/make-installer.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { svg } = require('./icon.cjs');

const SERIF = `'Fraunces', 'Source Serif 4', Georgia, 'DejaVu Serif', serif`;
const sidebar = (W, H) => `
<div style="width:${W}px;height:${H}px;position:relative;overflow:hidden;
  background:linear-gradient(172deg,#2e2457 0%,#1a1534 55%,#100d22 100%);font-family:${SERIF}">
  <div style="position:absolute;left:0;right:0;bottom:0;height:${H * 0.42}px;
    background:linear-gradient(180deg,rgba(125,136,232,0) 0%,rgba(233,139,181,.28) 55%,rgba(255,183,132,.55) 100%)"></div>
  <div style="position:absolute;left:${W * 0.18}px;right:${W * 0.18}px;bottom:${H * 0.1}px;height:1px;background:rgba(255,246,238,.35)"></div>
  <div style="position:absolute;left:50%;top:${H * 0.13}px;transform:translateX(-50%)">${svg(W * 0.52, 'sb')}</div>
  <div style="position:absolute;left:0;right:0;top:${H * 0.13 + W * 0.52 + H * 0.05}px;text-align:center;
    color:#fff6ee;font-size:${W * 0.15}px;letter-spacing:.02em">Cadenza</div>
  ${[0.62, 0.47, 0.3]
    .map(
      (w, i) =>
        `<div style="position:absolute;left:${(W * (1 - w)) / 2}px;width:${W * w}px;top:${H * (0.66 + i * 0.045)}px;height:${W * 0.022}px;
          border-radius:99px;background:rgba(255,246,238,${0.5 - i * 0.14})"></div>`,
    )
    .join('')}
</div>`;
// the header sits on the page's own white band: the mark and the name, left aligned like the page title beside it
const header = (W, H) => `
<div style="width:${W}px;height:${H}px;background:#ffffff;display:flex;align-items:center;gap:${W * 0.06}px;padding-left:${W * 0.08}px;
  box-sizing:border-box;font-family:${SERIF};color:#1a1534;font-size:${H * 0.34}px">
  ${svg(H * 0.66, 'hd')}<span>Cadenza</span>
</div>`;

function bmp(w, h, rgba) {
  const row = Math.ceil((w * 3) / 4) * 4,
    size = 54 + row * h,
    b = Buffer.alloc(size);
  b.write('BM', 0);
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(row * h, 34);
  b.writeInt32LE(2835, 38);
  b.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4,
        d = 54 + y * row + x * 3;
      b[d] = rgba[s + 2];
      b[d + 1] = rgba[s + 1];
      b[d + 2] = rgba[s];
    }
  return b;
}

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage();
  for (const [name, W, H, draw] of [
    ['installer-sidebar', 164, 314, sidebar],
    ['installer-header', 150, 57, header],
  ]) {
    await p.setViewportSize({ width: W * 2, height: H * 2 });
    await p.setContent(`<style>html,body{margin:0}</style><div id=a>${draw(W * 2, H * 2)}</div>`);
    await p.evaluate(() => document.fonts.ready);
    const png = await p.screenshot({ clip: { x: 0, y: 0, width: W * 2, height: H * 2 } });
    // scale down in a canvas and read the pixels back
    const px = await p.evaluate(
      async ([src, W, H]) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, W, H);
        return Array.from(g.getImageData(0, 0, W, H).data);
      },
      ['data:image/png;base64,' + png.toString('base64'), W, H],
    );
    fs.writeFileSync(path.join(__dirname, name + '.bmp'), bmp(W, H, px));
    console.log(name, W + '×' + H);
  }
  await br.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
