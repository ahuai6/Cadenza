// Motes and feathers: things drifting through the backdrop (and a few feathers in front), on the shared accent clock.
import { clamp } from '../../core/math';
import { rnd } from '../../core/rng';
import { rgba, mix, K3, W3, type RGB } from '../../core/color';
import { register, type Ctx } from './registry';
import { accentClock } from '../../rhythm/accentclock';
import type { RenderFrame } from '../frame';
import { makeCanvas } from '../palette';
import { C2, dot } from './sprite';
import { stagger, band, lifeFade, loop } from './drift';

/* ---------- motes: specks of light drifting up (on the shared accent clock: they hang in the air on a hit) ---------- */
// (into the song's last seconds they rise a little faster, up to about twice their pace: the extra is the speed-up's own
// integral, added to their clock — a speed multiplied into the whole song's time raced them at many times their pace as
// it grew, the further into the song the more: some thirty times at three minutes)
// (spread by drift.ts: each in its own band across the frame, their rises staggered — never bunched; faded at the wrap)
const MOTES = Array.from({ length: 170 }, (_, i) => ({ z: 0.2 + rnd(i * 9.3) * 0.8, s: 0.5 + rnd(i * 2.3), f: 0.5 + rnd(i * 4.4) * 2, p: rnd(i * 6.6) * 6.28, big: i % 7 === 0 }));
register({ id: 'motes', label: 'fx.motes', layer: 'backdrop', kind: 'effect', z: 10, params: [{ key: 'amount', label: 'p.amount', kind: 'range', min: 0, max: 2, step: 0.05, def: 1 }],
  draw(g, f, a) { const E = a.bd.E, w = f.W, h = f.H, m = Math.min(w, h), t = accentClock(f.plan.map, f.t), P = f.P, D = dot(f.pal.accent), amt = +a.params.amount, brk = Math.max(0, f.t - (f.plan.musicEnd - 3.5)), n = Math.round(MOTES.length * clamp(amt / 2 * 2, 0, 1));
    for (let i = 0; i < n; i++) { const d = MOTES[i], L = loop(t + 0.075 * brk * brk, 0.006 * d.s, stagger(i, n)), fade = lifeFade(L.u, 0.08, 0.08);
      const X = band(i, n, L.life) * (w + 2 * E) - E + a.bd.ox * d.z * 2 + Math.sin(t * 0.3 + d.p) * 20 * d.z, Y = (1 - L.u) * (h + 2 * E) - E + a.bd.oy * d.z * 2, tw = 0.55 + 0.45 * Math.sin(t * d.f + d.p);
      if (d.big) { const r = (10 + 30 * d.z) * (m / 720); g.globalAlpha = ((0.04 + 0.07 * d.z) * tw + P * 0.04) * Math.min(1, amt) * fade; g.drawImage(D, X - r, Y - r, r * 2, r * 2); }
      else { const r = (1.2 + 3.2 * d.z) * (m / 720); g.globalAlpha = Math.min(1, (0.2 + 0.5 * d.z) * tw + P * 0.3 * d.z) * Math.min(1, amt) * fade; g.drawImage(D, X - r * 2, Y - r * 2, r * 4, r * 4); } }
    g.globalAlpha = 1; } });

/* ---------- feathers: on the shared accent clock (they hang in the air on a hit), each falling out and a new one coming.
   Behind the backdrop's own elements (deep: the cover, a rose, the disc stand in front of them), each faded in at the
   top and out before the bottom, in its own band across the frame. A feather has a body: the vane shaded from the
   shaft out (darker at the root, lighter at the tips), barbs of varied tone with a few splits, a lit edge along the
   shaft — and it casts a soft shadow on what is behind it. ---------- */
type Feather = { c: HTMLCanvasElement; sh: HTMLCanvasElement };
let FEATH: { key: string; sharp: Feather[]; soft: Feather[] } | null = null;
function makeFeather(seed: number, blur: number, col: RGB): Feather {
  const S = 320, c = makeCanvas(S, S) as HTMLCanvasElement, g = C2(c); if (blur) g.filter = `blur(${blur}px)`; g.translate(S / 2, S * 0.95);
  const len = S * 0.86, wid = len * 0.17, bend = (rnd(seed) - 0.5) * 0.3, pt = (u: number) => [bend * len * u * u, -len * u], tan = (u: number) => { const dx = 2 * bend * len * u, dy = -len, m = Math.hypot(dx, dy); return [dx / m, dy / m]; };
  const dark = mix(col, K3, 0.45) as RGB, light = mix(col, W3, 0.35) as RGB;
  // the vane's body: a soft fill under the barbs, from the shaft (deeper) to the edge (paler and thinner)
  for (const side of [-1, 1]) { g.beginPath(); const [x0, y0] = pt(0.06); g.moveTo(x0, y0);
    for (let u = 0.06; u <= 0.99; u += 0.02) { const [px, py] = pt(u), [tx, ty] = tan(u), nx = -ty * side, ny = tx * side, env = Math.sin(Math.PI * clamp((u - 0.02) / 0.98)) ** 0.6, L = wid * env * 0.95;
      g.lineTo(px + (nx * 0.82 + tx * 0.57) * L, py + (ny * 0.82 + ty * 0.57) * L); }
    for (let u = 0.99; u >= 0.06; u -= 0.02) { const [px, py] = pt(u); g.lineTo(px, py); }
    const gr = g.createLinearGradient(0, 0, side * wid, 0); gr.addColorStop(0, rgba(dark, 0.34)); gr.addColorStop(0.6, rgba(col, 0.2)); gr.addColorStop(1, rgba(light, 0.06));
    g.fillStyle = gr; g.fill(); }
  g.lineCap = 'round';
  for (const side of [-1, 1]) for (let u = 0.06; u < 0.985; u += 0.0085) { if (rnd(seed * 7 + u * 913 + side) < 0.035) u += 0.025;     // (a split in the vane)
    const [px, py] = pt(u), [tx, ty] = tan(u), nx = -ty * side, ny = tx * side, env = Math.sin(Math.PI * clamp((u - 0.02) / 0.98)) ** 0.6 * (u < 0.2 ? 1.15 : 1), L = wid * env * (0.85 + 0.3 * rnd(seed + u * 331 + side * 5));
    const an = u < 0.2 ? 0.5 : 0.95, dx = nx * Math.cos(an) + tx * Math.sin(an), dy = ny * Math.cos(an) + ty * Math.sin(an), curl = u < 0.2 ? 0.5 : 0.15;
    // each barb its own tone: darker at its root, lit towards its tip (a gradient along it), some catching the light
    const tone = rnd(seed + u * 77 + side), ex = px + dx * L + tx * L * curl * 1.4, ey = py + dy * L + ty * L * curl * 1.4, bg = g.createLinearGradient(px, py, ex, ey);
    const a0 = u < 0.2 ? 0.22 : 0.5 + 0.25 * tone; bg.addColorStop(0, rgba(dark, a0)); bg.addColorStop(0.55, rgba(col, a0 * 0.9)); bg.addColorStop(1, rgba(tone > 0.8 ? light : col, a0 * 0.55));
    g.strokeStyle = bg; g.lineWidth = u < 0.2 ? 0.7 : 0.8 + 0.4 * tone; g.beginPath(); g.moveTo(px, py);
    g.quadraticCurveTo(px + dx * L * 0.6 + tx * L * curl, py + dy * L * 0.6 + ty * L * curl, ex, ey); g.stroke(); }
  // the shaft, and its lit edge
  g.strokeStyle = rgba(dark, 0.95); g.lineWidth = 2.4; g.beginPath(); g.moveTo(0, len * 0.08); for (let u = 0; u <= 1; u += 0.05) { const [x, y] = pt(u); g.lineTo(x, y); } g.stroke();
  g.strokeStyle = rgba(light, 0.6); g.lineWidth = 0.8; g.beginPath(); g.moveTo(0.8, len * 0.06); for (let u = 0; u <= 0.95; u += 0.05) { const [x, y] = pt(u); g.lineTo(x + 0.8, y); } g.stroke();
  // its shadow: the feather's own shape, dark and soft
  const sh = makeCanvas(S, S) as HTMLCanvasElement, q = C2(sh); q.filter = `blur(${6 + blur}px)`; q.drawImage(c, 0, 0); q.filter = 'none'; q.globalCompositeOperation = 'source-in'; q.fillStyle = '#000'; q.fillRect(0, 0, S, S);
  return { c, sh };
}
const feathers = (f: RenderFrame) => { const key = f.style.accent; if (FEATH && FEATH.key === key) return FEATH; FEATH = { key, sharp: [0, 1, 2, 3].map(k => makeFeather(k * 13 + 3, 0, f.pal.accent)), soft: [0, 1].map(k => makeFeather(k * 29 + 5, 5, f.pal.accent)) }; return FEATH; };
const drawFeather = (g: Ctx, spr: Feather, x: number, y: number, size: number, rot: number, flip: number, alpha: number, shadow = 0.3) => {
  const k = size / 320; if (alpha < 0.003) return;
  // (the shadow falls down and to the right, a little away from the feather, as from a light above the frame)
  g.save(); g.globalAlpha = alpha * shadow; g.translate(x + size * 0.035, y + size * 0.06); g.rotate(rot); g.scale(flip * k, k); g.drawImage(spr.sh, -160, -304); g.restore();
  g.save(); g.globalAlpha = alpha; g.translate(x, y); g.rotate(rot); g.scale(flip * k, k); g.drawImage(spr.c, -160, -304); g.restore(); };
const BGF = Array.from({ length: 12 }, (_, i) => ({ z: 0.25 + rnd(i * 2.9) * 0.75, s: 0.018 + rnd(i * 8.8) * 0.03, f: 0.4 + rnd(i * 1.7) * 0.7, ph: rnd(i * 7.7) * 6.28, r0: (rnd(i * 5.5) - 0.5) * 2.4, k: i % 4 }));
const FGF = Array.from({ length: 3 }, (_, i) => ({ s: 0.03 + rnd(i * 2.2) * 0.02, f: 0.3 + rnd(i * 5.1) * 0.4, ph: rnd(i * 1.9) * 6.28, r0: (rnd(i * 8.3) - 0.5) * 2, k: i % 2 }));
register({ id: 'feathers', label: 'fx.feathers', layer: 'backdrop', kind: 'effect', z: 30, deep: true, draw(g, f, a) {
  const F = feathers(f), w = f.W, h = f.H, m = Math.min(w, h), t = accentClock(f.plan.map, f.t), n = BGF.length;
  // each one falls slowly through the frame (1.4 frame heights from above it to below it), faded in and out at the ends,
  // and the next one comes in somewhere else in its own band, at its own depth, sway and turn
  for (const [i, q0] of BGF.entries()) { const L = loop(t, q0.s, stagger(i, n), 1.4), s0 = i * 4.1 + L.life * 7.31;
    const q = L.life ? { ...q0, z: 0.25 + rnd(s0 + 2.9) * 0.75, f: 0.4 + rnd(s0 + 1.7) * 0.7, ph: rnd(s0 + 7.7) * 6.28, r0: (rnd(s0 + 5.5) - 0.5) * 2.4, k: Math.floor(rnd(s0 + 3.3) * 4) } : q0;
    const y = (L.u * 1.4 - 0.2) * h + a.bd.oy * q.z, x = (band(i, n, L.life, 0.04, 0.96) + Math.sin(t * q.f + q.ph) * 0.05) * w + a.bd.ox * q.z * 1.5, rot = q.r0 + Math.sin(t * q.f * 1.3 + q.ph) * 0.55, fl = Math.cos(t * q.f * 0.8 + q.ph);
    drawFeather(g, F.sharp[q.k], x, y, (0.14 + 0.22 * q.z) * m * 1.3, rot, Math.sign(fl || 1) * Math.max(0.2, Math.abs(fl)), (0.26 + 0.5 * q.z) * (0.85 + 0.3 * f.P) * lifeFade(L.u, 0.1, 0.22)); } } });
register({ id: 'feathers-fg', label: 'fx.feathers', layer: 'foreground', kind: 'effect', z: 1, draw(g, f) {
  if (!f.style.fx.feathers) return; const F = feathers(f), w = f.W, h = f.H, m = Math.min(w, h), t = accentClock(f.plan.map, f.t), fx = f.cam.fx, n = FGF.length;
  for (const [i, q0] of FGF.entries()) { const L = loop(t, q0.s, stagger(i, n), 1.6), q = L.life ? { ...q0, ph: rnd(i * 1.9 + L.life * 2.3) * 6.28, r0: (rnd(i * 8.3 + L.life) - 0.5) * 2 } : q0;
    const y = (L.u * 1.6 - 0.3) * h + fx.y * 3, x = (band(i, n, L.life, 0.08, 0.92) + Math.sin(t * q.f + q.ph) * 0.08) * w + fx.x * 3, rot = q.r0 + Math.sin(t * q.f * 1.2 + q.ph) * 0.6, fl = Math.cos(t * q.f * 0.7 + q.ph);
    drawFeather(g, F.soft[q.k], x, y, m * 0.95, rot, Math.sign(fl || 1) * Math.max(0.25, Math.abs(fl)), (0.16 + 0.08 * f.P) * f.view.effect * lifeFade(L.u, 0.12, 0.25), 0.18); } } });
