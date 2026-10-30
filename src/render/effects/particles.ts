// Motes and feathers: things drifting through the backdrop (and a few feathers in front), on the shared accent clock.
import { clamp } from '../../core/math';
import { rnd } from '../../core/rng';
import { rgba, type RGB } from '../../core/color';
import { register, type Ctx } from './registry';
import { accentClock } from '../../rhythm/accentclock';
import type { RenderFrame } from '../frame';
import { makeCanvas } from '../palette';
import { C2, dot } from './sprite';

/* ---------- motes: specks of light drifting up (on the shared accent clock: they hang in the air on a hit) ---------- */
const MOTES = Array.from({ length: 170 }, (_, i) => ({ x: rnd(i * 3.1), y: rnd(i * 5.7), z: 0.2 + rnd(i * 9.3) * 0.8, s: 0.5 + rnd(i * 2.3), f: 0.5 + rnd(i * 4.4) * 2, p: rnd(i * 6.6) * 6.28, big: i < 26 }));
register({ id: 'motes', label: 'fx.motes', layer: 'backdrop', kind: 'effect', z: 10, params: [{ key: 'amount', label: 'p.amount', kind: 'range', min: 0, max: 2, step: 0.05, def: 1 }],
  draw(g, f, a) { const E = a.bd.E, w = f.W, h = f.H, m = Math.min(w, h), t = accentClock(f.plan.map, f.t), P = f.P, D = dot(f.pal.accent), amt = +a.params.amount, brk = Math.max(0, f.t - (f.plan.musicEnd - 3.5)), n = Math.round(MOTES.length * clamp(amt / 2 * 2, 0, 1));
    for (let i = 0; i < n; i++) { const d = MOTES[i];
      const X = d.x * (w + 2 * E) - E + a.bd.ox * d.z * 2 + Math.sin(t * 0.3 + d.p) * 20 * d.z, Y = ((((d.y - t * 0.006 * d.s * (1 + brk * 0.15)) % 1) + 1) % 1) * (h + 2 * E) - E + a.bd.oy * d.z * 2, tw = 0.55 + 0.45 * Math.sin(t * d.f + d.p);
      if (d.big) { const r = (10 + 30 * d.z) * (m / 720); g.globalAlpha = ((0.04 + 0.07 * d.z) * tw + P * 0.04) * Math.min(1, amt); g.drawImage(D, X - r, Y - r, r * 2, r * 2); }
      else { const r = (1.2 + 3.2 * d.z) * (m / 720); g.globalAlpha = Math.min(1, (0.2 + 0.5 * d.z) * tw + P * 0.3 * d.z) * Math.min(1, amt); g.drawImage(D, X - r * 2, Y - r * 2, r * 4, r * 4); } }
    g.globalAlpha = 1; } });

/* ---------- feathers: on the shared accent clock (they hang in the air on a hit), each falling out and a new one coming ---------- */
let FEATH: { key: string; sharp: HTMLCanvasElement[]; soft: HTMLCanvasElement[] } | null = null;
function makeFeather(seed: number, blur: number, col: RGB) {
  const S = 320, c = makeCanvas(S, S) as HTMLCanvasElement, g = C2(c); if (blur) g.filter = `blur(${blur}px)`; g.translate(S / 2, S * 0.95);
  const len = S * 0.86, wid = len * 0.17, bend = (rnd(seed) - 0.5) * 0.3, pt = (u: number) => [bend * len * u * u, -len * u], tan = (u: number) => { const dx = 2 * bend * len * u, dy = -len, m = Math.hypot(dx, dy); return [dx / m, dy / m]; };
  g.lineCap = 'round';
  for (const side of [-1, 1]) for (let u = 0.06; u < 0.985; u += 0.0085) { if (rnd(seed * 7 + u * 913 + side) < 0.035) u += 0.025;
    const [px, py] = pt(u), [tx, ty] = tan(u), nx = -ty * side, ny = tx * side, env = Math.sin(Math.PI * clamp((u - 0.02) / 0.98)) ** 0.6 * (u < 0.2 ? 1.15 : 1), L = wid * env * (0.85 + 0.3 * rnd(seed + u * 331 + side * 5));
    const an = u < 0.2 ? 0.5 : 0.95, dx = nx * Math.cos(an) + tx * Math.sin(an), dy = ny * Math.cos(an) + ty * Math.sin(an), curl = u < 0.2 ? 0.5 : 0.15;
    g.strokeStyle = rgba(col, u < 0.2 ? 0.25 : 0.45 + 0.25 * rnd(seed + u * 77)); g.lineWidth = u < 0.2 ? 0.7 : 0.9; g.beginPath(); g.moveTo(px, py);
    g.quadraticCurveTo(px + dx * L * 0.6 + tx * L * curl, py + dy * L * 0.6 + ty * L * curl, px + dx * L + tx * L * curl * 1.4, py + dy * L + ty * L * curl * 1.4); g.stroke(); }
  g.strokeStyle = rgba(col, 0.9); g.lineWidth = 2.2; g.beginPath(); g.moveTo(0, len * 0.08); for (let u = 0; u <= 1; u += 0.05) { const [x, y] = pt(u); g.lineTo(x, y); } g.stroke(); return c;
}
const feathers = (f: RenderFrame) => { const key = f.style.accent; if (FEATH && FEATH.key === key) return FEATH; FEATH = { key, sharp: [0, 1, 2, 3].map(k => makeFeather(k * 13 + 3, 0, f.pal.accent)), soft: [0, 1].map(k => makeFeather(k * 29 + 5, 5, f.pal.accent)) }; return FEATH; };
const drawFeather = (g: Ctx, spr: HTMLCanvasElement, x: number, y: number, size: number, rot: number, flip: number, alpha: number) => { g.save(); g.globalAlpha = alpha; g.translate(x, y); g.rotate(rot); g.scale(flip * size / 320, size / 320); g.drawImage(spr, -160, -304); g.restore(); };
const BGF = Array.from({ length: 12 }, (_, i) => ({ x: rnd(i * 4.1 + 1), p: rnd(i * 6.3 + 2), z: 0.25 + rnd(i * 2.9) * 0.75, s: 0.018 + rnd(i * 8.8) * 0.03, f: 0.4 + rnd(i * 1.7) * 0.7, ph: rnd(i * 7.7) * 6.28, r0: (rnd(i * 5.5) - 0.5) * 2.4, k: i % 4 }));
const FGF = Array.from({ length: 3 }, (_, i) => ({ x: 0.15 + i * 0.35 + rnd(i * 3.7) * 0.1, p: rnd(i * 9.1 + 4), s: 0.03 + rnd(i * 2.2) * 0.02, f: 0.3 + rnd(i * 5.1) * 0.4, ph: rnd(i * 1.9) * 6.28, r0: (rnd(i * 8.3) - 0.5) * 2, k: i % 2 }));
register({ id: 'feathers', label: 'fx.feathers', layer: 'backdrop', kind: 'effect', z: 30, draw(g, f, a) {
  const F = feathers(f), w = f.W, h = f.H, m = Math.min(w, h), t = accentClock(f.plan.map, f.t);
  // each one falls slowly out of the bottom of the frame and a new one comes in from the top (its own place, size, sway)
  for (const [i, q0] of BGF.entries()) { const u = q0.p + t * q0.s, fall = Math.floor(u / 1.4), q = fall ? featherAt(i, fall, q0) : q0;
    const y = (u % 1.4 - 0.2) * h + a.bd.oy * q.z, x = (q.x + Math.sin(t * q.f + q.ph) * 0.05) * w + a.bd.ox * q.z * 1.5, rot = q.r0 + Math.sin(t * q.f * 1.3 + q.ph) * 0.55, fl = Math.cos(t * q.f * 0.8 + q.ph);
    drawFeather(g, F.sharp[q.k], x, y, (0.14 + 0.22 * q.z) * m * 1.3, rot, Math.sign(fl || 1) * Math.max(0.2, Math.abs(fl)), (0.15 + 0.4 * q.z) * (0.85 + 0.3 * f.P)); } } });
/** A feather's next fall: the same speed, a new place, depth, sway and turn. */
function featherAt(i: number, n: number, q: (typeof BGF)[number]) { const s = i * 4.1 + n * 7.31;
  return { ...q, x: rnd(s + 1), z: 0.25 + rnd(s + 2.9) * 0.75, f: 0.4 + rnd(s + 1.7) * 0.7, ph: rnd(s + 7.7) * 6.28, r0: (rnd(s + 5.5) - 0.5) * 2.4, k: Math.floor(rnd(s + 3.3) * 4) }; }
register({ id: 'feathers-fg', label: 'fx.feathers', layer: 'foreground', kind: 'effect', z: 1, draw(g, f) {
  if (!f.style.fx.feathers) return; const F = feathers(f), w = f.W, h = f.H, m = Math.min(w, h), t = accentClock(f.plan.map, f.t), fx = f.cam.fx;
  for (const [i, q0] of FGF.entries()) { const u = q0.p + t * q0.s, n = Math.floor(u / 1.6), q = n ? { ...q0, x: 0.1 + rnd(i * 3.7 + n * 5.9) * 0.8, ph: rnd(i * 1.9 + n * 2.3) * 6.28, r0: (rnd(i * 8.3 + n) - 0.5) * 2 } : q0;
    const y = (u % 1.6 - 0.3) * h + fx.y * 3, x = (q.x + Math.sin(t * q.f + q.ph) * 0.08) * w + fx.x * 3, rot = q.r0 + Math.sin(t * q.f * 1.2 + q.ph) * 0.6, fl = Math.cos(t * q.f * 0.7 + q.ph);
    drawFeather(g, F.soft[q.k], x, y, m * 0.95, rot, Math.sign(fl || 1) * Math.max(0.25, Math.abs(fl)), (0.16 + 0.08 * f.P) * f.view.effect); } } });
