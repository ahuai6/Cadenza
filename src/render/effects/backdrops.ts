// The backdrops (one per theme): liquid fields, bokeh, gothic papercut, geometric construction, stage, minimal, video.
import { clamp, lerp, D2R } from '../../core/math';
import { eIO } from '../../core/ease';
import { rnd } from '../../core/rng';
import { mix, rgba, hexOf, K3, type RGB } from '../../core/color';
import { register, type Ctx } from './registry';
import { MV_LOOK, type RenderFrame } from '../frame';
import { makeCanvas } from '../palette';
import { basePose } from '../../director/camera';

const C2 = (c: HTMLCanvasElement | OffscreenCanvas) => (c as HTMLCanvasElement).getContext('2d')!;
const lowSize = (cv: HTMLCanvasElement, W0: number, H0: number, base: number) => { const lw = base, lh = Math.max(8, Math.round(base * H0 / W0)); if (cv.width !== lw || cv.height !== lh) { cv.width = lw; cv.height = lh; } return [lw, lh]; };

/* ---------- liquid: large regions of colour keep pressing into one another; computed on a small grid ---------- */
const LIQ = Array.from({ length: 7 }, (_, i) => ({ cx: 0.5 + (rnd(i * 2.7) - 0.5) * 0.7, cy: 0.5 + (rnd(i * 3.9) - 0.5) * 0.6, ax: 0.22 + rnd(i * 4.4) * 0.2, ay: 0.18 + rnd(i * 5.8) * 0.16,
  fx: 0.05 + rnd(i * 6.1) * 0.05, fy: 0.04 + rnd(i * 7.3) * 0.05, px: rnd(i * 8.8) * 6.28, py: rnd(i * 9.1) * 6.28, r: 0.26 + rnd(i * 1.3) * 0.14, k: i % 4 }));
const lq = makeCanvas(64, 36) as HTMLCanvasElement, lqx = C2(lq); let LQI: ImageData | null = null, LQKEY = '';
function renderLiquid(f: RenderFrame, Ev: number, ox: number, oy: number) {
  const w = f.W, h = f.H, W0 = w + 2 * Ev, H0 = h + 2 * Ev, gw = Math.max(48, Math.min(200, Math.round(W0 / 7))), gh = Math.max(27, Math.round(gw * H0 / W0));
  const P = f.P, sp = 0.6 + 0.5 * (f.style.m.speed ?? 1), t = f.t, key = [t, w, h, Ev, ox, oy, P, sp, f.style.bg, f.style.bg2, f.style.accent, f.style.flash].join('|');
  if (key === LQKEY && lq.width === gw && lq.height === gh) return lq;
  LQKEY = key; if (lq.width !== gw || lq.height !== gh) { lq.width = gw; lq.height = gh; LQI = null; }
  if (!LQI) LQI = lqx.createImageData(gw, gh);
  const D = LQI.data, m = Math.max(w, h), n = LIQ.length, B0 = f.pal.bg, tone = f.pal.dark ? 0.42 : 0.3;
  const cols = [f.pal.accent, f.pal.flash, f.pal.bg2, mix(f.pal.accent, f.pal.bg2, 0.5)].map(c => mix(B0, c, tone));
  const bx = new Float64Array(n), by = new Float64Array(n), br = new Float64Array(n), be = new Float64Array(n), cR = new Float64Array(n), cG = new Float64Array(n), cB = new Float64Array(n);
  LIQ.forEach((b, i) => { bx[i] = w * (b.cx + b.ax * Math.sin(t * b.fx * sp * 2.2 + b.px)) + ox * 0.2; by[i] = h * (b.cy + b.ay * Math.sin(t * b.fy * sp * 2.2 + b.py)) + oy * 0.2;
    const r = m * b.r * (1 + P * 0.02 * (i % 2 ? 1 : -1)); br[i] = r * r; be[i] = r * r * 0.02; const c = cols[b.k]; cR[i] = c[0]; cG[i] = c[1]; cB[i] = c[2]; });
  const sx = W0 / gw, sy = H0 / gh;
  for (let j = 0, o = 0; j < gh; j++) { const y = -Ev + (j + 0.5) * sy;
    for (let i = 0; i < gw; i++, o += 4) { const x = -Ev + (i + 0.5) * sx; let cr = 0, cg = 0, cb = 0, cw = 0, w1 = 0, w2 = 0;
      for (let q = 0; q < n; q++) { const dx = x - bx[q], dy = y - by[q], fq = br[q] / (dx * dx + dy * dy + be[q]), wt = fq * fq * fq; cr += cR[q] * wt; cg += cG[q] * wt; cb += cB[q] * wt; cw += wt; if (wt > w1) { w2 = w1; w1 = wt; } else if (wt > w2) w2 = wt; }
      const r2 = 2 * w2 / (w1 + w2), seam = r2 ** 4, sh = (1 + 0.06 * seam) / cw;
      D[o] = Math.min(255, cr * sh); D[o + 1] = Math.min(255, cg * sh); D[o + 2] = Math.min(255, cb * sh); D[o + 3] = 255; } }
  lqx.putImageData(LQI, 0, 0); return lq;
}
register({ id: 'liquid', label: 'bg.liquid', layer: 'backdrop', kind: 'backdrop', draw(g, f, a) {
  const low = renderLiquid(f, a.bd.Ev, a.bd.ox, a.bd.oy); g.imageSmoothingEnabled = true; (g as any).imageSmoothingQuality = 'high'; g.drawImage(low, -a.bd.Ev, -a.bd.Ev, f.W + 2 * a.bd.Ev, f.H + 2 * a.bd.Ev); } });

/* ---------- bokeh: soft out-of-focus discs drifting through haze ---------- */
const bk = makeCanvas(200, 120) as HTMLCanvasElement, bkx = C2(bk);
const DISCS = Array.from({ length: 24 }, (_, i) => ({ x: rnd(i * 2.1 + 9), y: rnd(i * 3.9 + 8), z: 0.2 + rnd(i * 5.3 + 7) * 0.8, r: 0.03 + rnd(i * 7.1 + 6) * 0.1, k: i % 3, f: 0.3 + rnd(i * 1.3) * 0.8, p: rnd(i * 8.2) * 6.28 }));
register({ id: 'bokeh', label: 'bg.bokeh', layer: 'backdrop', kind: 'backdrop', draw(g, f, a) {
  const E = a.bd.E, [lw, lh] = lowSize(bk, f.W + 2 * E, f.H + 2 * E, 200), c = bkx, P = f.P, t = f.t, pal = f.pal;
  const cols = [pal.accent, mix(pal.accent, [255, 255, 255], 0.6), pal.flash];
  const gr = c.createLinearGradient(0, 0, 0, lh); gr.addColorStop(0, hexOf(mix(pal.bg, pal.bg2, 0.15))); gr.addColorStop(1, hexOf(mix(pal.bg, pal.bg2, 0.75)));
  c.globalCompositeOperation = 'source-over'; c.fillStyle = gr; c.fillRect(0, 0, lw, lh); c.globalCompositeOperation = pal.dark ? 'lighter' : 'source-over';
  for (const d of DISCS) { const x = (((d.x + Math.sin(t * d.f * 0.2 + d.p) * 0.04 + a.bd.ox * d.z * 0.0015) % 1) + 1) % 1 * lw, y = (((d.y - t * 0.008 * (0.4 + d.z) + a.bd.oy * d.z * 0.0015) % 1) + 1) % 1 * lh;
    const r = d.r * lw * (0.7 + d.z * 0.8) * (1 + P * 0.08 * d.z), al = (0.18 + 0.32 * d.z) * (0.8 + 0.2 * Math.sin(t * d.f + d.p)), rg = c.createRadialGradient(x, y, 0, x, y, r), col = cols[d.k];
    rg.addColorStop(0, rgba(col, al)); rg.addColorStop(0.72, rgba(col, al * 0.85)); rg.addColorStop(1, rgba(col, 0)); c.fillStyle = rg; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  c.globalCompositeOperation = 'source-over'; g.imageSmoothingEnabled = true; (g as any).imageSmoothingQuality = 'high'; g.drawImage(bk, -E, -E, f.W + 2 * E, f.H + 2 * E); } });

/* ---------- stage and minimal ---------- */
register({ id: 'stage', label: 'bg.stage', layer: 'backdrop', kind: 'backdrop', draw(g, f, a) {
  const { W: w, H: h } = f, B = f.pal.bg, B2 = f.pal.bg2, I = f.I, P = f.P, E = a.bd.E, gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, hexOf(mix(B, B2, 0.04))); gr.addColorStop(0.45, hexOf(mix(B, B2, 0.2 + I * 0.15))); gr.addColorStop(0.66, hexOf(mix(B, B2, 0.55 + I * 0.3 + P * 0.25 * I))); gr.addColorStop(0.661, hexOf(mix(B, B2, 0.12))); gr.addColorStop(1, hexOf(mix(B, B2, 0.32)));
  g.fillStyle = gr; g.fillRect(-E, -E, w + 2 * E, h + 2 * E); } });
function radialBase(g: Ctx, f: RenderFrame, E: number, geo: boolean) {
  const { W: w, H: h } = f, M = Math.max(w, h), gr = g.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, M * 0.9);
  gr.addColorStop(0, hexOf(mix(f.pal.bg, f.pal.bg2, geo ? 0.05 : 0.08 + f.P * 0.12 * f.I))); gr.addColorStop(1, hexOf(mix(f.pal.bg, f.pal.bg2, geo ? 0.35 : 0.55 + f.I * 0.15)));
  g.fillStyle = gr; g.fillRect(-E, -E, w + 2 * E, h + 2 * E);
}
register({ id: 'minimal', label: 'bg.minimal', layer: 'backdrop', kind: 'backdrop', draw(g, f, a) { radialBase(g, f, a.bd.E, false); } });

/* ---------- geometric: faint construction lines behind; cut-out shapes inverting the whole frame, one composition a bar ---------- */
export function geoPattern(f: RenderFrame, barOffset = 0) {
  const map = f.plan.map, p = map.beatAt(f.t), b = p.bar + barOffset, seed = b * 17.31 + 3, start = map.barTime(b);
  const startT = Math.max(0, start), lv = map.level(startT);
  return { b, seed, start: startT, on: rnd(seed + 5) < 0.55 + 0.45 * (0.35 + 0.65 * lv), type: Math.floor(rnd(seed) * 11), ang: (rnd(seed + 1) - 0.5) * 24, pos: rnd(seed + 2) - 0.5, pos2: rnd(seed + 6) - 0.5, wid: rnd(seed + 3), corner: Math.floor(rnd(seed + 4) * 4),
    e: barOffset === 0 ? eIO(clamp((p.inBar + p.phase) * p.len / 0.55)) : 1 };
}
register({ id: 'geo', label: 'bg.geo', layer: 'backdrop', kind: 'backdrop', draw(g, f, a) {
  radialBase(g, f, a.bd.E, true);
  const G = geoPattern(f), w = f.W, h = f.H, R0 = Math.hypot(w, h), m = Math.min(w, h);
  g.save(); g.translate(w / 2, h / 2); g.rotate(G.ang * D2R); g.strokeStyle = rgba(f.pal.accent, 0.1); g.lineWidth = 1;
  for (let k = -8; k <= 8; k++) { const x = k * R0 * 0.08 + G.pos * R0 * 0.1; g.beginPath(); g.moveTo(x, -R0); g.lineTo(x, R0); g.stroke(); }
  g.beginPath(); g.arc(G.pos * w * 0.3, G.pos2 * h * 0.3, m * 0.42, 0, Math.PI * 2); g.stroke(); g.restore(); } });
function geoShapes(g: Ctx, G: ReturnType<typeof geoPattern>, e: number, w: number, h: number) {
  const R0 = Math.hypot(w, h), m = Math.min(w, h), cx = G.pos * w * 0.32, cy = G.pos2 * h * 0.28, diag = Math.atan2(h, w) * (G.corner % 2 ? 1 : -1);
  const half = (ang: number, off: number) => { g.save(); g.rotate(ang); g.fillRect(lerp(R0, off, e), -R0, R0 * 2, R0 * 2); g.restore(); };
  const disc = (x: number, y: number, r: number) => { g.beginPath(); g.arc(x, y, Math.max(0, r), 0, Math.PI * 2); g.fill(); };
  const ring = (x: number, y: number, r1: number, r2: number) => { g.beginPath(); g.arc(x, y, Math.max(0, r1), 0, Math.PI * 2); g.arc(x, y, Math.max(0, r2), 0, Math.PI * 2, true); g.fill(); };
  const cornerXY = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]][G.corner];
  switch (G.type) {
    case 0: half(diag, G.pos * m * 0.15); break;
    case 1: disc(cx, cy, e * m * (0.3 + G.wid * 0.22)); break;
    case 2: half(diag, G.pos * m * 0.1); disc(cx, cy, e * m * (0.26 + G.wid * 0.18)); break;
    case 3: { const r = e * m * (0.36 + G.wid * 0.14); ring(cx, cy, r, r * 0.66); break; }
    case 4: { const bw = w * (0.16 + G.wid * 0.22); g.save(); g.rotate(diag); g.fillRect(-bw / 2 + G.pos * w * 0.3, lerp(-R0 * 3, -R0, e), bw, R0 * 2); g.restore(); break; }
    case 5: { const [x, y] = cornerXY; g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.sign(x) * w * 1.1 * e, y); g.lineTo(x, y - Math.sign(y) * h * 1.4 * e); g.closePath(); g.fill(); break; }
    case 6: { const [x, y] = cornerXY; disc(x, y, e * m * (0.7 + G.wid * 0.3)); break; }
    case 7: { const n = 4 + Math.floor(G.wid * 5), bw = w / (n * 2); g.save(); g.rotate(diag * 0.5); for (let k = 0; k < n; k++) { const x = (k - n / 2) * bw * 2 + G.pos * bw; g.fillRect(x, lerp(k % 2 ? R0 : -R0 * 3, -R0, e), bw, R0 * 2); } g.restore(); break; }
    case 8: { const bw = w * 0.14 * (1 + G.wid); g.save(); g.rotate(diag); g.fillRect(-bw / 2, lerp(R0 * 2, -R0, e), bw, R0 * 2); g.rotate(-2 * diag); g.fillRect(-bw / 2, lerp(-R0 * 3, -R0, e), bw, R0 * 2); g.restore(); break; }
    case 9: g.beginPath(); g.arc(cx, h / 2, e * m * (0.45 + G.wid * 0.2), Math.PI, 0); g.closePath(); g.fill(); break;
    default: { const r = e * m * (0.42 + G.wid * 0.1); disc(cx, cy, r * 0.42); ring(cx, cy, r, r * 0.7); }
  }
}
register({ id: 'geo-front', label: 'bg.geo', layer: 'foreground', kind: 'effect', z: 5, draw(g, f) {
  if (f.style.bgStyle !== 'geo') return; const calm = f.cam.calm * f.view.effect; if (calm <= 0.01) return;
  const w = f.W, h = f.H, G = geoPattern(f), Gp = geoPattern(f, -1), cam = f.cam.cont;
  const one = (P: ReturnType<typeof geoPattern>, e: number) => { if (!P.on || e <= 0.001) return;
    const c0 = basePose(f.plan.camera, P.start), s = cam.z * 0.35;      // pinned to the world: they slide and turn with the camera
    g.save(); g.translate(w / 2, h / 2); g.rotate((f.cam.fx.r - cam.r) * D2R); g.translate((c0.x - cam.x) * s, (c0.y - cam.y) * s); g.rotate(P.ang * D2R); g.scale(1 + f.P * 0.012, 1 + f.P * 0.012); geoShapes(g, P, e, w, h); g.restore(); };
  g.save(); g.globalCompositeOperation = 'difference'; g.fillStyle = '#ffffff'; one(Gp, (1 - G.e) * calm); one(G, G.e * calm); g.restore(); } });

/* ---------- gothic: deep red; papercut vines and roses, foreground chains, drifting petals ---------- */
let GOTH: any = null;
function roseSil(g: Ctx, x: number, y: number, r: number, rot: number, col: RGB) {
  g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = rgba(col, 1); g.beginPath();
  for (let k = 0; k <= 84; k++) { const a = k / 84 * 6.283, rr = r * (0.86 + 0.14 * Math.abs(Math.sin(a * 3.5)) ** 0.6); k ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.fill(); g.globalCompositeOperation = 'destination-out'; g.lineCap = 'round'; g.lineWidth = r * 0.075; g.beginPath();
  for (let a = 0.6; a < 15.5; a += 0.12) { const rr = r * 0.055 * a; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.stroke();
  g.lineWidth = r * 0.06; for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283 + 0.5; g.beginPath(); g.arc(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, r * 0.62, a + 0.9, a + 1.9); g.stroke(); }
  g.restore();
}
export function gothicSprites(f: RenderFrame) {
  const key = f.style.bg + f.style.accent + f.style.text; if (GOTH && GOTH.key === key) return GOTH;
  const P = f.pal, sil = mix(P.bg, K3, 0.68), bloom = mix(P.accent, K3, 0.38), bloomFar = mix(P.accent, P.bg, 0.35);
  const vc = makeCanvas(1024, 1024) as HTMLCanvasElement, vg = C2(vc); vg.lineCap = 'round'; vg.lineJoin = 'round'; const roses: [number, number, number, number][] = [];
  for (let v = 0; v < 7; v++) { const side = v % 4, s0 = rnd(v * 3.7 + 1);
    let x = side === 0 ? 0 : side === 1 ? 1024 : s0 * 1024, y = side === 2 ? 1024 : side === 3 ? 0 : s0 * 1024, a = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? -Math.PI / 2 : Math.PI / 2;
    a += (rnd(v * 5.1) - 0.5) * 0.9; const len = 420 + rnd(v * 2.3) * 380, steps = 60; let wdt = 10; vg.fillStyle = vg.strokeStyle = rgba(sil, 1);
    for (let i = 0; i < steps; i++) { const nx = x + Math.cos(a) * len / steps, ny = y + Math.sin(a) * len / steps; a += Math.sin(i * 0.35 + v) * 0.09 + (rnd(v * 31 + i) - 0.5) * 0.12;
      vg.lineWidth = wdt; vg.beginPath(); vg.moveTo(x, y); vg.lineTo(nx, ny); vg.stroke();
      if (i % 4 === 2) { const ta = a + (i % 8 < 4 ? 1.3 : -1.3); vg.beginPath(); vg.moveTo(nx - Math.cos(a) * wdt * 0.7, ny - Math.sin(a) * wdt * 0.7); vg.lineTo(nx + Math.cos(ta) * wdt * 2, ny + Math.sin(ta) * wdt * 2); vg.lineTo(nx + Math.cos(a) * wdt * 0.7, ny + Math.sin(a) * wdt * 0.7); vg.fill(); }
      if (i % 7 === 5) { const la = a + (i % 14 < 7 ? 0.8 : -0.8), L = wdt * 5; vg.save(); vg.translate(nx, ny); vg.rotate(la); vg.beginPath(); vg.moveTo(0, 0); vg.quadraticCurveTo(L * 0.5, -L * 0.32, L, 0); vg.quadraticCurveTo(L * 0.5, L * 0.32, 0, 0); vg.fill(); vg.restore(); }
      if (i === Math.floor(steps * 0.55) && rnd(v * 9.9) < 0.8) roses.push([nx, ny, 30 + rnd(v * 4.4) * 24, rnd(v) * 6]);
      x = nx; y = ny; wdt = Math.max(2, wdt * 0.975); }
    vg.lineWidth = 2.4; vg.beginPath(); for (let k = 0; k < 40; k++) { const r = 26 * (1 - k / 40); vg.lineTo(x + Math.cos(a + k * 0.32) * r, y + Math.sin(a + k * 0.32) * r); } vg.stroke();
    roses.push([x, y, 34 + rnd(v * 6.6) * 28, rnd(v * 2) * 6]); }
  roses.forEach(([x, y, r, rot], k) => roseSil(vg, x, y, r, rot, k % 3 === 1 ? sil : bloom));
  const rc = makeCanvas(256, 256) as HTMLCanvasElement; roseSil(C2(rc), 128, 128, 120, 0.3, bloomFar);
  const pc = makeCanvas(48, 48) as HTMLCanvasElement, pg = C2(pc); pg.fillStyle = rgba(bloom, 1); pg.beginPath(); pg.moveTo(24, 4); pg.quadraticCurveTo(44, 24, 24, 44); pg.quadraticCurveTo(32, 24, 24, 4); pg.fill();
  GOTH = { key, vines: vc, rose: rc, petal: pc, chain: mix(P.bg, K3, 0.82), rim: mix(P.accent, P.text, 0.35) }; return GOTH;
}
const PETALS = Array.from({ length: 14 }, (_, i) => ({ x: rnd(i * 7.1 + 3), p: rnd(i * 3.3 + 9), s: 0.03 + rnd(i * 5.9) * 0.04, f: 0.4 + rnd(i * 2.2) * 0.8, ph: rnd(i * 8.8) * 6.28, z: 0.4 + rnd(i * 1.9) * 0.6 }));
register({ id: 'gothic', label: 'bg.gothic', layer: 'backdrop', kind: 'backdrop', draw(g, f, a) {
  const Gs = gothicSprites(f), P = f.P, w = f.W, h = f.H, m = Math.min(w, h), t = f.t, E = a.bd.Ev, ox = a.bd.ox, oy = a.bd.oy;
  const flick = 0.94 + 0.06 * Math.sin(t * 7.1) * Math.sin(t * 3.3 + 1) + 0.03 * P, gr = g.createRadialGradient(w / 2, h * 0.42, m * 0.05, w / 2, h * 0.5, Math.max(w, h) * 0.85);
  gr.addColorStop(0, hexOf(mix(f.pal.bg2, K3, 1 - flick))); gr.addColorStop(0.55, hexOf(f.pal.bg)); gr.addColorStop(1, hexOf(mix(f.pal.bg, K3, 0.7))); g.fillStyle = gr; g.fillRect(-E, -E, w + 2 * E, h + 2 * E);
  for (let k = 0; k < 3; k++) { const x = (0.16 + k * 0.34 + rnd(k * 3.1) * 0.1) * w + ox * 0.15, y = (0.22 + rnd(k * 7.7) * 0.56) * h + oy * 0.15, r = m * (0.16 + rnd(k * 2.2) * 0.1) * (1 + P * 0.015);
    g.save(); g.globalAlpha = 0.3; g.translate(x, y); g.rotate(t * 0.02 * (k % 2 ? 1 : -1) + k); g.drawImage(Gs.rose, -r, -r, r * 2, r * 2); g.restore(); }
  g.save(); g.translate(w / 2 + ox * 0.35, h / 2 + oy * 0.35); g.rotate(Math.sin(t * 0.21) * 0.012); const vs = Math.max(w, h) * 1.15 / 1024 * (1 + P * 0.006); g.drawImage(Gs.vines, -512 * vs, -512 * vs, 1024 * vs, 1024 * vs); g.restore();
  for (const pt of PETALS) { const y = ((pt.p + t * pt.s) % 1.3 - 0.15) * h + oy * pt.z, x = (pt.x + Math.sin(t * pt.f + pt.ph) * 0.04) * w + ox * pt.z, sz = m * 0.022 * (0.6 + pt.z);
    g.save(); g.globalAlpha = 0.4 + 0.45 * pt.z; g.translate(x, y); g.rotate(t * pt.f + pt.ph); g.scale(Math.cos(t * pt.f * 1.3 + pt.ph), 1); g.drawImage(Gs.petal, -sz, -sz, sz * 2, sz * 2); g.restore(); }
  g.globalAlpha = 1; } });
const calmOf = (f: RenderFrame) => f.cam.calm * (1 - f.rs.still);
const FCHAINS = [{ y0: -0.02, y1: 0.4, sag: 0.1, ph: 0.4, k: 1 }, { y0: 1.12, y1: 0.66, sag: 0.07, ph: 2.1, k: -1 }];
register({ id: 'gothic-chains', label: 'bg.gothic', layer: 'foreground', kind: 'effect', z: 3, draw(g, f) {
  if (f.style.bgStyle !== 'gothic' || f.view.effect <= 0.01) return;
  // the chains are heavy: they answer the downbeat only (a slight drop and swing out that settles over the bar), never
  // every beat or eighth, and they turn with the frame only a little
  const rs = f.rs, down = rs.inBar === 0 && rs.bar >= 0 ? Math.exp(-rs.phase * 2.2) * (0.4 + 0.6 * rs.level) * calmOf(f) : 0;
  const Gs = gothicSprites(f), w = f.W, h = f.H, m = Math.min(w, h), link = m * 0.085, step = link * 0.8, calm = f.cam.calm, cam = f.cam.cont, t = f.t, roll = f.cam.fx.r - cam.r;
  g.save(); g.globalAlpha = f.view.effect; g.translate(w / 2, h / 2); g.rotate(roll * 0.06 * D2R); g.translate(-w / 2, -h / 2);
  for (const ch of FCHAINS) {
    const sw = Math.sin(t * 0.5 + ch.ph) * 0.012 + Math.sin(t * 1.3 + ch.ph * 2) * 0.005 + down * 0.008 * ch.k, A = [-w * 0.15, (ch.y0 + sw) * h], Bp = [w * 1.15, (ch.y1 - sw) * h], C = [w * 0.5, ((ch.y0 + ch.y1) / 2 + ch.sag * (1 + 0.15 * Math.sin(t * 0.7 + ch.ph) + 0.14 * down)) * h];
    const pts: number[][] = [], N = 160; let tot = 0;
    for (let i = 0; i <= N; i++) { const u = i / N, x = (1 - u) ** 2 * A[0] + 2 * u * (1 - u) * C[0] + u * u * Bp[0], y = (1 - u) ** 2 * A[1] + 2 * u * (1 - u) * C[1] + u * u * Bp[1]; if (i) tot += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]); pts.push([x, y, tot]); }
    const dir = Math.atan2(Bp[1] - A[1], Bp[0] - A[0]), slide = ((cam.x * Math.cos(dir) + cam.y * Math.sin(dir)) * cam.z * 1.6 * ch.k) % (step * 2); let seg = 0;
    for (let d = -slide - step * 2; d < tot + step; d += step) { if (d < 0) continue; while (seg < N - 1 && pts[seg + 1][2] < d) seg++;
      const p0 = pts[seg], p1 = pts[seg + 1], fr = (d - p0[2]) / Math.max(1e-6, p1[2] - p0[2]), x = p0[0] + (p1[0] - p0[0]) * fr, y = p0[1] + (p1[1] - p0[1]) * fr, ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      const face = ((Math.round((d + slide) / step) % 2) + 2) % 2 === 0; g.save(); g.translate(x, y); g.rotate(ang);
      if (face) { g.strokeStyle = rgba(Gs.chain, 0.96); g.lineWidth = link * 0.2; g.beginPath(); g.ellipse(0, 0, link * 0.58, link * 0.3, 0, 0, 6.283); g.stroke();
        g.strokeStyle = rgba(Gs.rim, 0.32 * calm + 0.1); g.lineWidth = Math.max(1, link * 0.03); g.beginPath(); g.ellipse(0, -link * 0.02, link * 0.66, link * 0.38, 0, 3.5, 5.9); g.stroke(); }
      else { g.fillStyle = rgba(Gs.chain, 0.97); g.beginPath(); g.roundRect(-link * 0.62, -link * 0.09, link * 1.24, link * 0.18, link * 0.09); g.fill(); g.fillStyle = rgba(Gs.rim, 0.25 * calm + 0.08); g.fillRect(-link * 0.5, -link * 0.09, link, Math.max(1, link * 0.025)); }
      g.restore(); } }
  g.restore(); } });

/* ---------- video: a clip graded into a backdrop that sits well behind the lyrics; also the song's MV ---------- */
const VSM = makeCanvas(96, 54) as HTMLCanvasElement, VSX = VSM.getContext('2d', { willReadFrequently: true })!, VTN = makeCanvas(24, 14) as HTMLCanvasElement, VTX = VTN.getContext('2d', { willReadFrequently: true })!;
export function drawVideo(g: Ctx, f: RenderFrame, src: { frame: CanvasImageSource | null; w: number; h: number } | null, A: number, grade: { dark: number; blur: number; desat: number }, roll: number, zoom: number, ox: number, oy: number, E: number, placeholder: boolean, fit = false) {
  const w = f.W, h = f.H, B = f.pal.bg, B2 = f.pal.bg2, v = src?.frame, ok = !!v; if (!ok && !placeholder) return;
  const a = Math.abs(roll * D2R), cw = (w * Math.abs(Math.cos(a)) + h * Math.abs(Math.sin(a))) / Math.min(1, zoom), chh = (w * Math.abs(Math.sin(a)) + h * Math.abs(Math.cos(a))) / Math.min(1, zoom);
  // parallax: the backdrop lags the camera a little (it never looks back across a transition cut)
  const t = f.t; let tb = Math.max(0, t - 0.7); for (const p of f.plan.passages) if (p.t <= t && p.t > tb) tb = p.t;
  const c0 = basePose(f.plan.camera, t), c1 = basePose(f.plan.camera, tb), lagx = clamp((c1.x - c0.x) * c0.z * 0.1, -w * 0.04, w * 0.04), lagy = clamp((c1.y - c0.y) * c0.z * 0.1, -h * 0.04, h * 0.04), lz = Math.max(1, (c0.z / c1.z) ** 0.12);
  const sw = ok ? src!.w : 16, sh = ok ? src!.h : 9, k = Math.max(cw / sw, chh / sh) * (fit ? 1.015 : 1.09 * lz) * (1 + f.P * (fit ? 0.002 : 0.004)), dw = sw * k, dh = sh * k, mo = fit ? 0.15 : 1, dx = w / 2 - dw / 2 + (lagx + ox * 0.25) * mo, dy = h / 2 - dh / 2 + (lagy + oy * 0.25) * mo;
  const sm = VSM.width, smh = Math.max(27, Math.round(sm * sh / sw)); if (VSM.height !== smh) VSM.height = smh;
  if (ok) VSX.drawImage(v!, 0, 0, sm, smh);
  else { const gr = VSX.createLinearGradient(0, 0, sm, smh); gr.addColorStop(0, hexOf(mix(B, B2, 0.25))); gr.addColorStop(1, hexOf(B)); VSX.fillStyle = gr; VSX.fillRect(0, 0, sm, smh);
    for (let i = 0; i < 4; i++) { const x = sm * (0.5 + 0.4 * Math.sin(t * 0.13 * (i + 1) + i * 2)), y = smh * (0.5 + 0.35 * Math.cos(t * 0.11 * (i + 1) + i)), r = sm * (0.22 + 0.08 * i), q = VSX.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, rgba(i % 2 ? f.pal.accent : B2, 0.55)); q.addColorStop(1, rgba(B2, 0)); VSX.fillStyle = q; VSX.fillRect(0, 0, sm, smh); } }
  VTX.drawImage(VSM, 0, 0, VTN.width, VTN.height);
  let Lm = 0.15, Sm = 0.3;
  if (ok) { const d = VTX.getImageData(0, 0, VTN.width, VTN.height).data; let l = 0, sa = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); l += 0.2126 * r * r + 0.7152 * gg * gg + 0.0722 * b * b; sa += mx > 0 ? (mx - mn) / mx : 0; n++; } Lm = l / n; Sm = sa / n; }
  const dark = grade.dark, target = 0.035 + 0.07 * (1 - dark), expo = clamp(target / Math.max(1e-3, Lm * (1 - dark * 0.82) ** 2), 0.35, 1), desatE = clamp(grade.desat + Math.max(0, Sm - 0.4) * 0.9);
  g.save(); g.globalAlpha = A; g.fillStyle = hexOf(mix(B, K3, 0.4)); g.fillRect(Math.min(dx, -E), Math.min(dy, -E), Math.max(dw, w + 2 * E), Math.max(dh, h + 2 * E));
  g.imageSmoothingEnabled = true; (g as any).imageSmoothingQuality = 'high';
  if (ok) { g.drawImage(v!, dx, dy, dw, dh); if (grade.blur > 0) { g.globalAlpha = A * Math.min(1, grade.blur * 1.15); g.drawImage(VSM, dx, dy, dw, dh); } } else g.drawImage(VSM, dx, dy, dw, dh);
  g.globalAlpha = A;
  if (desatE > 0) { g.globalCompositeOperation = 'saturation'; g.fillStyle = rgba([128, 128, 128], desatE * 0.85); g.fillRect(dx, dy, dw, dh); }
  g.globalCompositeOperation = 'soft-light'; g.fillStyle = rgba(B2, 0.35); g.fillRect(dx, dy, dw, dh);
  g.globalCompositeOperation = 'multiply'; const R = Math.hypot(w, h) * 0.62, vg = g.createRadialGradient(w / 2, h * 0.46, R * 0.1, w / 2, h * 0.5, R), ec = Math.sqrt(expo);
  vg.addColorStop(0, rgba([255, 255, 255].map(x => Math.round(x * (1 - dark * 0.82) * ec)) as RGB, 1)); vg.addColorStop(1, rgba([255, 255, 255].map(x => Math.round(x * (1 - Math.min(0.97, dark * 1.25)) * ec)) as RGB, 1)); g.fillStyle = vg; g.fillRect(dx, dy, dw, dh);
  g.globalCompositeOperation = 'source-over'; g.fillStyle = rgba(mix(B, K3, 0.3), dark * 0.18); g.fillRect(dx, dy, dw, dh);
  g.globalCompositeOperation = 'screen'; g.globalAlpha = A * (0.1 + 0.05 * (1 - dark) + f.P * 0.02); g.drawImage(VTN, dx, dy, dw, dh);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = A; const fl = g.createLinearGradient(0, h * 0.62, 0, h); fl.addColorStop(0, 'rgba(0,0,0,0)'); fl.addColorStop(1, 'rgba(0,0,0,.35)'); g.fillStyle = fl; g.fillRect(dx, h * 0.62, dw, Math.max(0, dy + dh - h * 0.62));
  g.restore();
}
register({ id: 'video', label: 'bg.video', layer: 'backdrop', kind: 'backdrop', draw(g, f, a) {
  const st = f.style, open = 1 - (a.bd.rest ?? 0); drawVideo(g, f, f.media.video, 1, { dark: (st.vidDark ?? 0.6) * open, blur: st.vidBlur ?? 0.35, desat: st.vidDesat ?? 0.35 }, a.bd.roll, a.bd.zoom, a.bd.ox, a.bd.oy, a.bd.E, true, a.bd.fit); } });
/** MV mode: the song's own video over the theme's backdrop, fading in with a soft focus pull; the backdrop's own effects
 *  (motes, feathers, rings…) and everything in front stay above it. */
register({ id: 'mv', label: 'mv', layer: 'backdrop', kind: 'effect', z: -1, draw(g, f, a) {
  const mv = f.media.mv; if (!mv || mv.k <= 0 || !mv.frame) return; const k = mv.k * mv.k * (3 - 2 * mv.k), blurPx = (1 - k) * 22;
  if (blurPx > 0.3) g.filter = `blur(${(blurPx * f.px).toFixed(1)}px)`;
  const L = f.media.mvLook || MV_LOOK, open = 1 - (a.bd.rest ?? 0);
  drawVideo(g, f, mv, k, { dark: L.dark * open, blur: L.blur, desat: L.desat }, a.bd.roll, a.bd.zoom, a.bd.ox, a.bd.oy, a.bd.E, false, a.bd.fit); g.filter = 'none'; } });
