// Renders the Cadenza mark (build/icon.cjs) at every size the platforms ask for and writes:
//   build/icon.png (1024), build/icon.ico            the installer and the exe
//   electron/assets/icon.ico, icon.png, tray.png     the window and the tray
//   src/app/brand/mark.svg                           the mark inside the app
// Windows picks the .ico image drawn for the display scale (16 px at 100 % up to 64 px at 400 %).
//   node build/make-icons.cjs
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const { svg } = require('./icon.cjs');
const ROOT = path.resolve(__dirname, '..'), ICO = [16, 20, 24, 32, 40, 48, 64, 128, 256], ALL = [...ICO, 512, 1024];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const png = {};
  for (const S of ALL) {
    await p.setViewportSize({ width: S, height: S });
    await p.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg(S)}`);
    png[S] = await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: S, height: S } });
  }
  await b.close();
  // an .ico of PNG images (Windows Vista and later)
  const imgs = ICO.map(S => png[S]), head = Buffer.alloc(6 + 16 * ICO.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(ICO.length, 4);
  let off = head.length;
  ICO.forEach((S, i) => { const e = 6 + 16 * i; head.writeUInt8(S >= 256 ? 0 : S, e); head.writeUInt8(S >= 256 ? 0 : S, e + 1); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(off, e + 12); off += imgs[i].length; });
  const ico = Buffer.concat([head, ...imgs]);
  const A = path.join(ROOT, 'electron', 'assets'), M = path.join(ROOT, 'src', 'app', 'brand'); fs.mkdirSync(A, { recursive: true }); fs.mkdirSync(M, { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico); fs.writeFileSync(path.join(__dirname, 'icon.png'), png[1024]);
  fs.writeFileSync(path.join(A, 'icon.ico'), ico); fs.writeFileSync(path.join(A, 'icon.png'), png[512]); fs.writeFileSync(path.join(A, 'tray.png'), png[32]);
  fs.writeFileSync(path.join(M, 'mark.svg'), svg(64));
  console.log('icons:', ICO.join(' '), '+ 512 1024;', (ico.length / 1024).toFixed(0) + ' KB ico');
})().catch(e => { console.error(e); process.exit(1); });
