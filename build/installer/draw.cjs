// Draws Cadenza's own installer: three full-window pictures (welcome, installing, done) and the buttons cut from them,
// at each display scale Windows uses, as PNGs next to this file; and layout.nsh, the places of the live controls laid
// over them (the install folder, links, progress), so the pictures and build/installer.nsh agree to the pixel.
// The PNGs are turned into the BMPs NSIS reads at build time (bmp.cjs). Words: docs/COPY.md, 安裝程式.
//   node build/installer/draw.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { squircle } = require('../icon.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const W = 720,
  H = 450,
  SCALES = [1, 1.25, 1.5, 2];
// (logical pixels at 100 %; NSIS multiplies by the display scale)
const L = {
  close: [680, 14, 26, 26],
  path: [56, 312, 236, 22],
  change: [300, 312, 52, 22],
  install: [56, 360, 152, 46],
  version: [56, 420, 220, 18],
  bar: [56, 386, 250, 4],
  open: [56, 360, 176, 46],
  done: [248, 372, 64, 22],
};
const WIN = { cx: 524, cy: 236, r: 178 };

const font = (p) => `file://${path.join(ROOT, 'node_modules', p)}`;
const CREAM = '#fff6ee';

function windowArt() {
  const { cx, cy, r } = WIN,
    w = 15,
    inner = r - w / 2,
    D = Math.PI / 180,
    a0 = 34 * D,
    a1 = -40 * D;
  const pt = (a, rr = r) => [cx + rr * Math.cos(a), cy - rr * Math.sin(a)];
  const [x0, y0] = pt(a0),
    [x1, y1] = pt(a1);
  const sun = pt(-3 * D);
  // a few made-up lines of lyrics inside the window, and the hills seen from the viewing window
  const bar = (y, x0, x1, o) =>
    `<line x1="${cx + x0}" y1="${cy + y}" x2="${cx + x1}" y2="${cy + y}" stroke="${CREAM}" stroke-opacity="${o}" stroke-width="7" stroke-linecap="round"/>`;
  return `
  <svg class="art" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="sky" x1="0" y1="${cy - inner}" x2="0" y2="${cy + inner}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#7d88e8"/><stop offset=".46" stop-color="#e98bb5"/><stop offset=".78" stop-color="#ffb784"/><stop offset="1" stop-color="#ffd2a1"/></linearGradient>
      <linearGradient id="rim" x1="${cx - r}" y1="${cy + r}" x2="${cx + r}" y2="${cy - r}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#fff3e8"/><stop offset="1" stop-color="#ffd9c2"/></linearGradient>
      <radialGradient id="glow" cx="${sun[0]}" cy="${sun[1]}" r="260" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ffd7a8" stop-opacity=".55"/><stop offset=".3" stop-color="#ff9fb4" stop-opacity=".16"/><stop offset="1" stop-color="#ff9fb4" stop-opacity="0"/></radialGradient>
      <linearGradient id="beam" x1="${sun[0]}" y1="${sun[1]}" x2="${cx - r}" y2="${H}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ffe6cc" stop-opacity=".22"/><stop offset="1" stop-color="#ffe6cc" stop-opacity="0"/></linearGradient>
      <clipPath id="win"><circle cx="${cx}" cy="${cy}" r="${inner + 0.5}"/></clipPath>
    </defs>
    <path d="M${sun[0] - 30} ${sun[1] - 24}L${sun[0] + 22} ${sun[1] + 30}L${cx - r * 0.2} ${H}L${cx - r * 1.3} ${H}Z" fill="url(#beam)"/>
    <circle cx="${cx}" cy="${cy}" r="${inner}" fill="url(#sky)"/>
    <g clip-path="url(#win)">
      <path d="M${cx - r} ${cy + 96} C ${cx - 90} ${cy + 60}, ${cx - 20} ${cy + 104}, ${cx + 60} ${cy + 78} S ${cx + 150} ${cy + 66}, ${cx + r} ${cy + 88} L ${cx + r} ${cy + r} L ${cx - r} ${cy + r} Z" fill="#c98aa6" fill-opacity=".55"/>
      <path d="M${cx - r} ${cy + 126} C ${cx - 60} ${cy + 104}, ${cx + 40} ${cy + 136}, ${cx + r} ${cy + 112} L ${cx + r} ${cy + r} L ${cx - r} ${cy + r} Z" fill="#a8708f" fill-opacity=".6"/>
      ${bar(-74, -118, 18, 0.95)}${bar(-40, -138, 70, 0.7)}${bar(-6, -104, -6, 0.45)}
      <circle cx="${cx - 112}" cy="${cy + 30}" r="4" fill="${CREAM}" fill-opacity=".8"/>
      <circle cx="${cx - 98}" cy="${cy + 30}" r="4" fill="${CREAM}" fill-opacity=".55"/>
      <circle cx="${cx - 84}" cy="${cy + 30}" r="4" fill="${CREAM}" fill-opacity=".3"/>
    </g>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
    <path d="M${x0} ${y0} A ${r} ${r} 0 1 0 ${x1} ${y1}" fill="none" stroke="url(#rim)" stroke-width="${w}" stroke-linecap="round"/>
    <circle cx="${sun[0]}" cy="${sun[1]}" r="13" fill="#fff8f0"/>
  </svg>`;
}

// (a few faint stars, always the same)
function stars() {
  let s = 7,
    out = '';
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 46; k++) {
    const x = rnd() * W,
      y = rnd() * H * 0.62,
      d = Math.hypot(x - WIN.cx, y - WIN.cy);
    if (d < WIN.r + 14) continue;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.5 + rnd() * 0.9).toFixed(2)}" fill="${CREAM}" fill-opacity="${(0.15 + rnd() * 0.4).toFixed(2)}"/>`;
  }
  return `<svg class="art" width="${W}" height="${H}">${out}</svg>`;
}

const button = ([x, y, w, h], text) =>
  `<div class="btn" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${h / 2}px">${text}</div>`;
const mark = (S) => {
  const { svg } = require('../icon.cjs');
  return svg(S, 'ins');
};

function page(kind) {
  const left = {
    welcome: `
      <div class="mark">${mark(40)}</div>
      <div class="word">Cadenza</div>
      <div class="tag">你自己的音樂庫：<br>歌曲播放時，歌詞跟著音樂移動。</div>
      <div class="small" style="top:${L.path[1] - 22}px">安裝位置</div>
      ${button(L.install, '安裝')}`,
    progress: `
      <div class="mark">${mark(40)}</div>
      <div class="title">正在安裝</div>
      <div class="sub">把 Cadenza 放到這台電腦上，<br>只需要一分鐘左右。</div>
      <div class="track" style="left:${L.bar[0]}px;top:${L.bar[1]}px;width:${L.bar[2]}px;height:${L.bar[3]}px"></div>`,
    finish: `
      <div class="mark">${mark(40)}</div>
      <div class="title">Cadenza 已安裝</div>
      <div class="sub">打開 Cadenza，加入放音樂的資料夾，<br>就可以開始聽。你的音樂庫、歌單和設定<br>都留在這台電腦上。</div>
      ${button(L.open, '打開 Cadenza')}`,
  }[kind];
  return `<!doctype html><html><head><meta charset="utf-8">
  <link rel="stylesheet" href="${font('@fontsource-variable/fraunces/index.css')}">
  <link rel="stylesheet" href="${font('@fontsource-variable/noto-serif-tc/index.css')}">
  <link rel="stylesheet" href="${font('@fontsource-variable/noto-sans-tc/index.css')}">
  <style>
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
    .stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;
      background: radial-gradient(120% 90% at 78% 110%, rgba(255,183,132,.34), rgba(255,183,132,0) 55%),
                  linear-gradient(160deg, #2c2356 0%, #1c1739 48%, #120f26 100%);}
    .art{position:absolute;left:0;top:0}
    .mark{position:absolute;left:56px;top:40px;width:40px;height:40px}
    .word{position:absolute;left:54px;top:96px;font-family:'Fraunces Variable',serif;font-size:58px;font-weight:420;
      font-variation-settings:'opsz' 96,'SOFT' 60;letter-spacing:-.01em;color:${CREAM};line-height:1}
    .tag{position:absolute;left:56px;top:178px;font-family:'Noto Serif TC Variable',serif;font-size:16px;font-weight:450;
      line-height:1.75;color:rgba(255,246,238,.82);letter-spacing:.02em}
    .title{position:absolute;left:56px;top:110px;font-family:'Noto Serif TC Variable',serif;font-size:32px;font-weight:560;
      color:${CREAM};letter-spacing:.04em;line-height:1.2}
    .sub{position:absolute;left:56px;top:166px;font-family:'Noto Serif TC Variable',serif;font-size:15px;font-weight:450;
      line-height:1.8;color:rgba(255,246,238,.78);letter-spacing:.02em}
    .small{position:absolute;left:56px;font-family:'Noto Sans TC Variable',sans-serif;font-size:12px;font-weight:500;
      letter-spacing:.18em;color:rgba(255,246,238,.5)}
    .btn{position:absolute;display:flex;align-items:center;justify-content:center;
      background:linear-gradient(120deg,#ffd9b0 0%,#ffb784 48%,#f79ab0 100%);
      box-shadow:0 8px 22px -8px rgba(255,159,180,.55), inset 0 1px 0 rgba(255,255,255,.55);
      font-family:'Noto Sans TC Variable',sans-serif;font-size:16px;font-weight:650;letter-spacing:.12em;color:#1a1534}
    .track{position:absolute;border-radius:2px;background:rgba(255,246,238,.14)}
  </style></head><body><div class="stage">${stars()}${windowArt()}${left}</div></body></html>`;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-installer-'));
  const b = await chromium.launch();
  for (const s of SCALES) {
    const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: s });
    for (const kind of ['welcome', 'progress', 'finish']) {
      const f = path.join(tmp, kind + '.html');
      fs.writeFileSync(f, page(kind));
      await p.goto('file://' + f);
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(150);
      const tag = String(Math.round(s * 100));
      await p.screenshot({ path: path.join(__dirname, `${kind}-${tag}.png`) });
      // (the buttons, cut from the same picture, so they sit on it without a seam)
      for (const [name, r] of Object.entries({ welcome: { install: L.install }, finish: { open: L.open } }[kind] || {}))
        await p.screenshot({ path: path.join(__dirname, `${name}-${tag}.png`), clip: { x: r[0], y: r[1], width: r[2], height: r[3] } });
    }
    await p.close();
  }
  // the uninstaller's side picture (164 × 314 at 100 %, drawn at twice that; Windows fits it to its place)
  {
    const p = await b.newPage({ viewport: { width: 164, height: 314 }, deviceScaleFactor: 2 });
    const f = path.join(tmp, 'side.html');
    fs.writeFileSync(
      f,
      page('welcome')
        .replace(/<body>[\s\S]*<\/body>/, `<body><div class="stage side">${stars()}${windowArt()}<div class="word" style="left:0;right:0;top:236px;text-align:center;font-size:30px">Cadenza</div></div></body>`)
        .replace('</style>', '.side{width:164px;height:314px}.side .art{transform-origin:0 0;transform:translate(-110px,40px) scale(.36)}</style>'),
    );
    await p.goto('file://' + f);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(__dirname, 'side-100.png') });
    await p.close();
  }
  await b.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  // the same places for NSIS
  const lines = [
    '; Written by build/installer/draw.cjs: where the live controls sit on the pictures, in pixels at 100 %.',
    `!define CZ_W ${W}`,
    `!define CZ_H ${H}`,
    ...Object.entries(L).flatMap(([k, [x, y, w, h]]) => [`!define CZ_${k}_X ${x}`, `!define CZ_${k}_Y ${y}`, `!define CZ_${k}_W ${w}`, `!define CZ_${k}_H ${h}`]),
  ];
  fs.writeFileSync(path.join(__dirname, 'layout.nsh'), lines.join('\n') + '\n');
  console.log('installer pictures:', SCALES.join(' '), '×', 3, '+ buttons');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
