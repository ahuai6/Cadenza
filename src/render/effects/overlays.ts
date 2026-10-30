// Effects switched on per theme: drawn in the backdrop's space (motes, feathers, floor grid, spectrum, beat rings, glass
// cracks), in the lyric world (glyph contours, lyric frames, stars), in front (shards, feathers) or over the screen
// (grain, vignette, scan lines).
import { clamp, sstep, D2R, lerp, angDiff } from '../../core/math';
import { eOut, eIO, eSine } from '../../core/ease';
import { rnd } from '../../core/rng';
import { mix, rgba, K3, W3, type RGB } from '../../core/color';
import { register, type Ctx } from './registry';
import { accentClock } from './clock';
import type { RenderFrame } from '../frame';
import { makeCanvas } from '../palette';
import { project, NO_FX } from '../../director/project';
import { basePose } from '../../director/camera';
import { boxIn } from '../../director/layout';
import { fontStack } from '../../text/fonts';
import { graphemes, isLatin } from '../../lyrics/script';
import { TIN_SPEC } from '../../director/words';
import type { PLine } from '../../director/types';
import { gfx, cheapBlurDraw } from '../gfx';

const C2 = (c: HTMLCanvasElement | OffscreenCanvas) => (c as HTMLCanvasElement).getContext('2d')!;
let DOT: { key: string; c: HTMLCanvasElement } | null = null;
const dot = (col: RGB) => { const key = col.join(); if (DOT && DOT.key === key) return DOT.c; const c = makeCanvas(64, 64) as HTMLCanvasElement, g = C2(c), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, rgba(col, 1)); r.addColorStop(0.3, rgba(col, 0.55)); r.addColorStop(1, rgba(col, 0)); g.fillStyle = r; g.fillRect(0, 0, 64, 64); DOT = { key, c }; return c; };

/* ---------- motes: specks of light drifting up (on the shared accent clock: they hang in the air on a hit) ---------- */
const MOTES = Array.from({ length: 170 }, (_, i) => ({ x: rnd(i * 3.1), y: rnd(i * 5.7), z: 0.2 + rnd(i * 9.3) * 0.8, s: 0.5 + rnd(i * 2.3), f: 0.5 + rnd(i * 4.4) * 2, p: rnd(i * 6.6) * 6.28, big: i < 26 }));
register({ id: 'motes', label: 'fx.motes', layer: 'backdrop', kind: 'effect', z: 10, params: [{ key: 'amount', label: 'p.amount', kind: 'range', min: 0, max: 2, step: 0.05, def: 1 }],
  draw(g, f, a) { const E = a.bd.E, w = f.W, h = f.H, m = Math.min(w, h), t = accentClock(f), P = f.P, D = dot(f.pal.accent), amt = +a.params.amount, brk = Math.max(0, f.t - (f.plan.musicEnd - 3.5)), n = Math.round(MOTES.length * clamp(amt / 2 * 2, 0, 1));
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
  const F = feathers(f), w = f.W, h = f.H, m = Math.min(w, h), t = accentClock(f);
  // each one falls slowly out of the bottom of the frame and a new one comes in from the top (its own place, size, sway)
  for (const [i, q0] of BGF.entries()) { const u = q0.p + t * q0.s, fall = Math.floor(u / 1.4), q = fall ? featherAt(i, fall, q0) : q0;
    const y = (u % 1.4 - 0.2) * h + a.bd.oy * q.z, x = (q.x + Math.sin(t * q.f + q.ph) * 0.05) * w + a.bd.ox * q.z * 1.5, rot = q.r0 + Math.sin(t * q.f * 1.3 + q.ph) * 0.55, fl = Math.cos(t * q.f * 0.8 + q.ph);
    drawFeather(g, F.sharp[q.k], x, y, (0.14 + 0.22 * q.z) * m * 1.3, rot, Math.sign(fl || 1) * Math.max(0.2, Math.abs(fl)), (0.15 + 0.4 * q.z) * (0.85 + 0.3 * f.P)); } } });
/** A feather's next fall: the same speed, a new place, depth, sway and turn. */
function featherAt(i: number, n: number, q: (typeof BGF)[number]) { const s = i * 4.1 + n * 7.31;
  return { ...q, x: rnd(s + 1), z: 0.25 + rnd(s + 2.9) * 0.75, f: 0.4 + rnd(s + 1.7) * 0.7, ph: rnd(s + 7.7) * 6.28, r0: (rnd(s + 5.5) - 0.5) * 2.4, k: Math.floor(rnd(s + 3.3) * 4) }; }
register({ id: 'feathers-fg', label: 'fx.feathers', layer: 'foreground', kind: 'effect', z: 1, draw(g, f) {
  if (!f.style.fx.feathers) return; const F = feathers(f), w = f.W, h = f.H, m = Math.min(w, h), t = accentClock(f), fx = f.cam.fx;
  for (const [i, q0] of FGF.entries()) { const u = q0.p + t * q0.s, n = Math.floor(u / 1.6), q = n ? { ...q0, x: 0.1 + rnd(i * 3.7 + n * 5.9) * 0.8, ph: rnd(i * 1.9 + n * 2.3) * 6.28, r0: (rnd(i * 8.3 + n) - 0.5) * 2 } : q0;
    const y = (u % 1.6 - 0.3) * h + fx.y * 3, x = (q.x + Math.sin(t * q.f + q.ph) * 0.08) * w + fx.x * 3, rot = q.r0 + Math.sin(t * q.f * 1.2 + q.ph) * 0.6, fl = Math.cos(t * q.f * 0.7 + q.ph);
    drawFeather(g, F.soft[q.k], x, y, m * 0.95, rot, Math.sign(fl || 1) * Math.max(0.25, Math.abs(fl)), (0.16 + 0.08 * f.P) * f.view.effect); } } });

/* ---------- floor grid (the ground, under every other backdrop effect) and spectrum ---------- */
register({ id: 'grid', label: 'fx.grid', layer: 'backdrop', kind: 'effect', z: 3, draw(g, f, a) {
  const E = a.bd.E, w = f.W, h = f.H, hy = h * 0.66, mx = w / 2, A = f.pal.accent, I = f.I, P = f.P, t = f.t, brk = Math.max(0, t - (f.plan.musicEnd - 3.5));
  g.save(); g.beginPath(); g.rect(-E, hy, w + 2 * E, h - hy + E); g.clip(); const off = brk <= 0 ? eOut(f.rs.phase) : (t * 0.7) % 1, NL = 16;
  for (let j = 0; j < NL; j++) { const z = (j + off) / NL, y = hy + (h + E * 0.5 - hy) * z ** 2.3; g.strokeStyle = rgba(A, z * (0.14 + 0.24 * I) * (0.7 + 0.6 * P)); g.lineWidth = 0.6 + z * 1.6;
    g.setLineDash(brk ? [w * 0.03 * (1 + z * 3), brk * w * 0.012 * (0.3 + z)] : []); g.beginPath(); g.moveTo(-E, y); g.lineTo(w + E, y); g.stroke(); }
  g.setLineDash([]); g.lineWidth = 1; g.strokeStyle = rgba(A, (0.06 + 0.1 * I) * (1 - clamp(brk / 6) * 0.7));
  g.beginPath(); for (let k = -40; k <= 40; k++) { g.moveTo(mx + k * w * 0.012, hy); g.lineTo(mx + k * w * 0.165, h + E * 0.5); } g.stroke(); g.restore();
  g.fillStyle = rgba(A, 0.3 + 0.45 * I * (0.6 + 0.4 * P)); g.fillRect(-E, hy - 1, w + 2 * E, 2); } });
/* the spectrum: the song's own (the analysis's coarse bands, low in the middle to high at the sides), so the bars move
   with what is really playing; a small, steady texture between neighbouring bars; the pulse only without analysis */
const SPEC: number[] = [];
register({ id: 'eq', label: 'fx.eq', layer: 'backdrop', kind: 'effect', z: 15, draw(g, f, a) {
  const E = a.bd.E, w = f.W, h = f.H, hy = h * 0.66, bw = w / 48, i0 = -Math.ceil(E / bw), i1 = 48 + Math.ceil(E / bw), A = f.pal.accent, I = f.I, P = f.P, t = f.t;
  const sp = f.plan.map.spec(t, SPEC), nb = sp ? sp.length : 0;
  for (let i = i0; i < i1; i++) { const fq = Math.min(1, Math.abs(i - 23.5) / 24);
    let v: number;
    if (sp && nb) { const x = fq * (nb - 1), k = Math.floor(x), u = x - k, b = sp[k] * (1 - u) + sp[Math.min(nb - 1, k + 1)] * u, tex = 0.88 + 0.12 * Math.sin(i * 2.17 + Math.floor(t * 8) * 0.9);
      v = b * tex * (0.55 + 0.45 * I); }
    else v = (0.25 + 0.75 * I) * (P * (1 - fq) * 0.9 + 0.35 * Math.abs(Math.sin(t * 2.7 + i * 0.9)) * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.37 + t * 0.8))));
    const bh = v * h * 0.13;
    g.fillStyle = rgba(A, 0.1 + 0.3 * P * (1 - fq * 0.5)); g.fillRect(i * bw + 1, hy - bh, bw - 2, bh); g.fillStyle = rgba(A, 0.035); g.fillRect(i * bw + 1, hy, bw - 2, bh * 0.6); } } });

/* ---------- beat rings: one per rhythmic event, launched on it, bigger on strong accents and downbeats ----------
   Each ring is light in three depths, never a flat tube: a wide faint falloff on both sides (a radial gradient that
   fades to nothing either way), a tighter inner glow, and a fine core whose brightness varies round the circle (a
   slowly turning sheen, as light catches it). A strong accent warms the ring towards the flash colour and blooms a
   soft glow at the centre that swells and fades within the beat. Blended as light (screen) on a dark theme.
   Where they come from: from behind what stands in the background — the cover (the cover theme draws them itself,
   under the sleeve), the record (under the disc), the horizon of door frames or of the floor grid (at its vanishing
   point, under them). With nothing there, a glowing woofer of light in the middle makes them: it pushes out with the
   low end as a speaker's cone does and every ring leaves its rim. */
export function drawRings(g: Ctx, f: RenderFrame, mx: number, cy: number, r0 = 0) {
  const map = f.plan.map, L = 1.6 * map.beatLen(f.t), M = Math.max(f.W, f.H), A = f.pal.accent, hot = mix(A, f.pal.flash, 0.55), I = f.I, t = f.t, dark = f.pal.dark;
  const ring = (R: number, wd: number, col: RGB, al: number) => { if (al < 0.003 || wd < 0.3) return; const ri = Math.max(0, R - wd), gr = g.createRadialGradient(mx, cy, ri, mx, cy, R + wd);
    const c = (k: number) => rgba(col, al * k); gr.addColorStop(0, c(0)); gr.addColorStop(0.3, c(0.25)); gr.addColorStop(0.5, c(1)); gr.addColorStop(0.7, c(0.25)); gr.addColorStop(1, c(0));
    g.fillStyle = gr; g.beginPath(); g.arc(mx, cy, R + wd, 0, 6.283); if (ri > 0) g.arc(mx, cy, ri, 0, 6.283, true); g.fill('evenodd'); };
  g.save(); g.globalCompositeOperation = dark ? 'screen' : 'source-over';
  for (const e of map.eventsIn(t - L, t, 1)) { const u = (t - e.t) / L; if (u < 0 || u >= 1) continue;
    const down = !e.off && Math.round(e.pos) % map.meter === 0, strong = e.tier === 2 && e.s >= 1.15, wgt = clamp((down ? 0.75 : 0.4) * (0.6 + 0.25 * clamp(e.s, 0, 2.4)) + (e.tier === 2 ? 0.35 : 0), 0.25, 1.4);
    const r = 1 - (1 - u) ** 2.5, al = (1 - u) ** 1.25 * Math.min(1, u * 20) * wgt * (0.6 + 0.4 * I), R = r0 + (0.05 + 0.7 * r) * M * 0.75 * (0.8 + 0.2 * wgt), lw = (2 + 3.2 * wgt) * (1 - 0.35 * u) * (M / 1280);
    const col = strong ? hot : A;
    ring(R, lw * (strong ? 9 : 6) * (1 + u * 0.6), col, 0.16 * al);                     // the wide falloff, spreading as it travels
    ring(R, lw * 2.2, strong ? mix(hot, [255, 255, 255], 0.2) : col, 0.32 * al);          // the inner glow
    // the core: fine, its light varying round the circle
    if (typeof (g as CanvasRenderingContext2D).createConicGradient === 'function') { const cg = (g as CanvasRenderingContext2D).createConicGradient(t * 0.25 + e.t, mx, cy), hi = mix(col, [255, 255, 255], 0.45);
      for (const [k, v] of [[0, 0.55], [0.18, 1], [0.36, 0.5], [0.55, 0.85], [0.74, 0.45], [0.9, 0.95], [1, 0.55]] as const) cg.addColorStop(k, rgba(mix(col, hi, v), Math.min(0.9, al * 1.4 * v)));
      g.strokeStyle = cg; } else g.strokeStyle = rgba(col, Math.min(0.85, al * 1.2));
    g.lineWidth = Math.max(0.8, lw * 0.55); g.beginPath(); g.arc(mx, cy, R, 0, 6.283); g.stroke();
    if (strong && u < 0.6) { const k = Math.sin(Math.PI * clamp(u / 0.6)) * wgt * (0.6 + 0.4 * I), Rb = M * 0.46, gr = g.createRadialGradient(mx, cy, 0, mx, cy, Rb);
      gr.addColorStop(0, rgba(mix(hot, [255, 255, 255], 0.3), 0.26 * k)); gr.addColorStop(0.18, rgba(hot, 0.14 * k)); gr.addColorStop(0.5, rgba(A, 0.05 * k)); gr.addColorStop(1, rgba(A, 0));
      g.fillStyle = gr; g.fillRect(mx - Rb, cy - Rb, Rb * 2, Rb * 2); } }
  g.restore();
}
/** The woofer of light: a soft halo, the cone's surround as a ring of light, the cone shading in to a dust cap. It is
 *  still between rings and pushes out exactly with each one it sends (the same events, the same weight: a quick push
 *  and a soft return), so its motion and the waves are one thing. Faint, its edges soft. Returns its rim. */
function drawWoofer(g: Ctx, f: RenderFrame, mx: number, cy: number) {
  const map = f.plan.map, t = f.t, M = Math.max(f.W, f.H), A = f.pal.accent, hot = mix(A, f.pal.flash, 0.5), dark = f.pal.dark;
  let push = 0; for (const e of map.eventsIn(t - 0.6, t, 1)) { const dt = t - e.t; if (dt < 0) continue;
    const down = !e.off && Math.round(e.pos) % map.meter === 0, wgt = clamp((down ? 0.75 : 0.4) * (0.6 + 0.25 * clamp(e.s, 0, 2.4)) + (e.tier === 2 ? 0.35 : 0), 0.25, 1.4);
    push = Math.max(push, wgt * Math.min(1, dt / 0.03) * Math.exp(-dt / 0.16)); }
  const R = M * 0.07 * (1 + 0.12 * push), I = (0.45 + 0.35 * f.I) * 0.62, lit = clamp(0.35 + 0.65 * push);
  g.save(); g.globalCompositeOperation = dark ? 'screen' : 'source-over';
  { const H = R * 4.4, gr = g.createRadialGradient(mx, cy, R * 0.4, mx, cy, H); gr.addColorStop(0, rgba(A, 0.16 * I * (0.6 + 0.6 * lit))); gr.addColorStop(0.3, rgba(A, 0.06 * I)); gr.addColorStop(1, rgba(A, 0));
    g.fillStyle = gr; g.fillRect(mx - H, cy - H, H * 2, H * 2); }                                       // the halo
  { const Ro = R * 1.25, gr = g.createRadialGradient(mx, cy - R * 0.1, R * 0.04, mx, cy, Ro); gr.addColorStop(0, rgba(mix(hot, [255, 255, 255], 0.5), 0.6 * I)); gr.addColorStop(0.24, rgba(hot, 0.34 * I));
    gr.addColorStop(0.52, rgba(mix(A, f.pal.bg, 0.35), 0.2 * I)); gr.addColorStop(0.72, rgba(A, 0.3 * I * (0.5 + 0.7 * lit))); gr.addColorStop(0.86, rgba(A, 0.1 * I)); gr.addColorStop(1, rgba(A, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(mx, cy, Ro, 0, 6.283); g.fill(); }                           // cone and surround, fading out (no hard edge)
  g.restore(); return R * 0.9;
}
export const ringsOrigin = (f: RenderFrame): 'self' | 'cover' | [number, number] | null =>
  f.style.bgStyle === 'cover' ? 'cover' : f.style.bgStyle === 'vinyl' ? [f.W / 2, f.H / 2] : f.style.fx.doors ? [f.W / 2, f.H * 0.62] : f.style.fx.grid ? [f.W / 2, f.H * 0.66] : 'self';
register({ id: 'rings', label: 'fx.rings', layer: 'backdrop', kind: 'effect', z: 1, draw(g, f) {
  const o = ringsOrigin(f); if (o === 'cover' || !o) return;                       // (the cover theme draws them under its sleeve)
  if (o === 'self') { const mx = f.W / 2, cy = f.H * 0.45; drawRings(g, f, mx, cy, M0(f)); drawWoofer(g, f, mx, cy); return; }
  drawRings(g, f, o[0], o[1]);
} });
const M0 = (f: RenderFrame) => Math.max(f.W, f.H) * 0.063;

/* ---------- shattered glass: cracks on the backdrop, shards carrying the finished frame ---------- */
type Glass = RenderFrame['plan']['cues']['glass'][number];
const GEO = new Map<number, any>();
function glassGeom(ev: Glass) {
  let geo = GEO.get(ev.seed); if (geo) return geo;
  let sd = ev.seed; const R = () => rnd(sd += 1.37);
  const n = 5 + Math.floor(R() * 3), angs: number[] = []; let a = R() * 6.283;
  for (let i = 0; i < n; i++) { angs.push(a); a += 6.283 / n * (0.45 + R() * 1.1); }
  const sc = 6.283 / (a - angs[0]); for (let i = 0; i < n; i++) angs[i] = angs[0] + (angs[i] - angs[0]) * sc;
  const rays = angs.map(a0 => { const len = 0.75 + R() * 0.45, pts: number[][] = []; let aa = a0; for (let r = 0; r <= len + 1e-6; r += 0.045 + R() * 0.05) { aa += (R() - 0.5) * 0.16 * (0.4 + r); pts.push([Math.cos(aa) * r, Math.sin(aa) * r, r]); } return { len, pts }; });
  const at = (ray: any, r: number) => { const p = ray.pts; if (r >= p[p.length - 1][2]) return p[p.length - 1]; for (let k = 1; k < p.length; k++) if (p[k][2] >= r) { const fr = (r - p[k - 1][2]) / ((p[k][2] - p[k - 1][2]) || 1); return [p[k - 1][0] + (p[k][0] - p[k - 1][0]) * fr, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * fr, r]; } return p[p.length - 1]; };
  const segs: any[] = [], shards: any[] = [], branches: any[] = [];
  for (let i = 0; i < n; i++) { const A = rays[i], B = rays[(i + 1) % n], top = Math.min(A.len, B.len) * 0.97, rings: number[][] = [];
    // (rings across each segment: most segments break into pieces that fly; the outermost ring keeps them inside the cracks)
    for (const b of [0.14, 0.3, 0.6]) { if (b > top - 0.05) break; if (b > 0.2 && R() < 0.25) continue; rings.push([b * (0.8 + R() * 0.4), b * (0.8 + R() * 0.4)]); }
    if (!rings.length && top > 0.25) rings.push([top * (0.7 + R() * 0.15), top * (0.7 + R() * 0.15)]);
    const bow: number[][] = []; for (const rr of rings) { const pA = at(A, rr[0]), pB = at(B, rr[1]), m = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2], rad = Math.hypot(m[0], m[1]) || 1, k = (R() - 0.35) * 0.12 * rad;
      const mid = [m[0] + m[0] / rad * k + (R() - 0.5) * 0.02, m[1] + m[1] / rad * k + (R() - 0.5) * 0.02]; bow.push(mid); segs.push([pA, mid, pB]); }
    // (from the very point of impact: the centre is glass too, its pieces the first to fly)
    const rs = [[0, 0], ...rings], mids = [null, ...bow];
    for (let q = 0; q < rs.length; q++) { const r0 = rs[q], r1 = q + 1 < rs.length ? rs[q + 1] : null; if (!r1) break; if (R() < 0.05) continue;
      const poly: number[][] = []; for (const p of A.pts) if (p[2] >= r0[0] && p[2] <= r1[0]) poly.push(p); poly.unshift(at(A, r0[0])); poly.push(at(A, r1[0])); if (mids[q + 1]) poly.push(mids[q + 1]!);
      const sideB: number[][] = []; for (const p of B.pts) if (p[2] >= r0[1] && p[2] <= r1[1]) sideB.push(p); sideB.unshift(at(B, r0[1])); sideB.push(at(B, r1[1])); for (let k = sideB.length - 1; k >= 0; k--) poly.push(sideB[k]); if (mids[q]) poly.push(mids[q]!);
      const cx = poly.reduce((u, p) => u + p[0], 0) / poly.length, cy = poly.reduce((u, p) => u + p[1], 0) / poly.length; const rr0 = Math.min(r0[0], r0[1]);
      // (only part of the pane breaks out: most pieces at the point of impact, fewer further out; the rest stay, cracked)
      shards.push({ poly, c: [cx, cy], r0: rr0, vr: (R() - 0.5) * 3, delay: R() * 0.3, fly: rr0 < 0.25 && R() < (rr0 < 0.05 ? 0.8 : 0.45) }); }
    if (R() >= 0.6) { const r = 0.15 + R() * (A.len - 0.2), p = at(A, r), dir = Math.atan2(p[1], p[0]) + (R() < 0.5 ? 1 : -1) * (0.4 + R() * 0.6), L = 0.05 + R() * 0.12; const pts = [[p[0], p[1]]]; let d = dir, x = p[0], y = p[1]; for (let k = 0; k < 3; k++) { d += (R() - 0.5) * 0.5; x += Math.cos(d) * L / 3; y += Math.sin(d) * L / 3; pts.push([x, y]); } branches.push({ r, pts }); } }
  const crush: number[][][] = []; for (let k = 0; k < 8; k++) { const a0 = R() * 6.283, r0 = R() * 0.05, L = 0.02 + R() * 0.05; crush.push([[Math.cos(a0) * r0, Math.sin(a0) * r0], [Math.cos(a0 + (R() - 0.5)) * (r0 + L), Math.sin(a0 + (R() - 0.5)) * (r0 + L)]]); }
  geo = { rays, segs, shards, branches, crush }; GEO.set(ev.seed, geo); if (GEO.size > 64) GEO.delete(GEO.keys().next().value!); return geo;
}
function crackPaths(g: Ctx, G: any, Rr: number, reach: number, fade: number, pass: number) {
  const LW = pass === 2 ? [5, 4, 3] : pass ? [0.8, 0.7, 0.5] : [1.6, 1.3, 1];
  for (const ray of G.rays) { g.globalAlpha = (pass ? 0.42 : 0.5) * fade; g.lineWidth = LW[0]; g.beginPath(); let st = false; for (const p of ray.pts) { if (p[2] > reach) break; st ? g.lineTo(p[0] * Rr, p[1] * Rr) : g.moveTo(p[0] * Rr, p[1] * Rr); st = true; } g.stroke(); }
  for (const sg of G.segs) { const r = Math.hypot(sg[0][0], sg[0][1]); if (r > reach * 0.95) continue; g.globalAlpha = (pass ? 0.35 : 0.42) * fade * clamp((reach * 0.95 - r) / 0.15); g.lineWidth = LW[1]; g.beginPath(); g.moveTo(sg[0][0] * Rr, sg[0][1] * Rr); g.quadraticCurveTo(sg[1][0] * Rr, sg[1][1] * Rr, sg[2][0] * Rr, sg[2][1] * Rr); g.stroke(); }
  g.globalAlpha = (pass ? 0.25 : 0.32) * fade; g.lineWidth = LW[2];
  for (const br of G.branches) { if (br.r > reach) continue; g.beginPath(); br.pts.forEach((p: number[], k: number) => (k ? g.lineTo(p[0] * Rr, p[1] * Rr) : g.moveTo(p[0] * Rr, p[1] * Rr))); g.stroke(); }
  g.beginPath(); for (const [p, q] of G.crush) { g.moveTo(p[0] * Rr, p[1] * Rr); g.lineTo(q[0] * Rr, q[1] * Rr); } g.stroke();
}
/** when a piece leaves: a few hundredths of a second after the blow, the ones nearest it first */
const burstAt = (sh: { r0: number; delay: number }) => 0.03 + sh.r0 * 0.07 + sh.delay * 0.12;
/** How far a piece that breaks out has gone (0 still there .. 1 gone), as the shards' own pass times it. Once gone it
 *  stays gone: the opening fades with the rest of the pane, it never closes up again (glass does not heal). */
const goneK = (sh: { r0: number; delay: number; fly: boolean }, dt: number, reach: number, fade: number) => { if (!sh.fly || sh.r0 > reach) return 0; const st = Math.max(0, dt - burstAt(sh)); return sstep(clamp(st / 0.25)) * fade; };
register({ id: 'glass', label: 'fx.glass', layer: 'backdrop', kind: 'effect', z: 40, draw(g, f) {
  const w = f.W, h = f.H, t = f.t, dark = f.pal.dark;
  for (const ev of f.plan.cues.glass) { const dt = t - ev.t; if (dt < 0 || dt > 2.2) continue;
    const G = glassGeom(ev), Rr = Math.hypot(w, h) * 0.5 * ev.size, cx = ev.x * w, cy = ev.y * h, grow = sstep(clamp(dt / 0.07)), fade = 1 - clamp((dt - 0.9) / 1.2), reach = grow * 1.2, hot = mix(mix(f.pal.text, f.pal.accent, 0.3), [255, 255, 255], 0.55), glow = mix(f.pal.accent, [255, 255, 255], 0.35);
    g.save(); g.translate(cx, cy); g.lineJoin = 'round'; g.lineCap = 'round';
    // the openings (pieces that have broken out): their cracks went with them — the cracks are drawn round them only,
    // so between two neighbours that both fell out no line is left, and at the edge of a piece that stays half the
    // crack remains on its side (its broken edge)
    const holes = new Path2D(); let nh = 0;
    for (const sh of G.shards) if (goneK(sh, dt, reach, 1) > 0.3) { nh++; sh.poly.forEach((p: number[], i: number) => (i ? holes.lineTo(p[0] * Rr, p[1] * Rr) : holes.moveTo(p[0] * Rr, p[1] * Rr))); holes.closePath(); }
    // (the clip only round the cracks, not four frames' worth)
    g.save(); if (nh) { const out = new Path2D(), E = Rr * 1.3; out.rect(-E, -E, E * 2, E * 2); out.addPath(holes); g.clip(out, 'evenodd'); }
    // (plain and additive blends only — no multiply or soft-light: on the GPU those read the picture back for every
    // stroke, which is what made the shatter drop frames)
    // the cracks as light, not as etched dark lines: a faint shade under each, a hairline of the theme's light on it and
    // a wide soft glow along it — fine, a little luminous, never heavy
    g.globalCompositeOperation = 'source-over'; g.strokeStyle = rgba(mix(f.pal.bg, K3, 0.75), 1); crackPaths(g, G, Rr, reach, fade * 0.3 * (ev.k ?? 1), 0);
    g.globalCompositeOperation = dark ? 'screen' : 'source-over'; g.strokeStyle = rgba(glow, 1); g.save(); g.lineWidth = 1; crackPaths(g, G, Rr, reach, Math.min(1, fade * (dark ? 0.35 : 0.18)), 2); g.restore();
    g.strokeStyle = rgba(hot, 1); g.save(); g.translate(-0.6, -0.6); crackPaths(g, G, Rr, reach, Math.min(1, fade * 1.1), 1); g.restore();
    g.restore();
    // the openings themselves, a shade darker (what was behind the glass)
    g.globalCompositeOperation = 'source-over'; g.fillStyle = g.strokeStyle = rgba(mix(f.pal.bg, K3, dark ? 0.35 : 0.22), 1); g.lineWidth = 1.6; g.lineJoin = 'round';
    // (one shape for all the openings, filled once: two neighbours' shared edge is never painted twice)
    { let kk = 0, n = 0; g.beginPath(); for (const sh of G.shards) { const k = goneK(sh, dt, reach, 1); if (k < 0.01) continue; kk += k; n++;
        sh.poly.forEach((p: number[], i: number) => (i ? g.lineTo(p[0] * Rr, p[1] * Rr) : g.moveTo(p[0] * Rr, p[1] * Rr))); g.closePath(); }
      if (n) { g.globalAlpha = kk / n * 0.5 * fade; g.fill('nonzero'); } }
    g.globalAlpha = 1;
    if (dt < 0.5) { const k = 1 - sstep(dt / 0.5), rr = Rr * 0.22, gr = g.createRadialGradient(0, 0, 0, 0, 0, rr); gr.addColorStop(0, rgba(hot, 0.55 * k)); gr.addColorStop(1, rgba(hot, 0));
      g.globalCompositeOperation = dark ? 'lighter' : 'source-over'; g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rr, 0, 6.283); g.fill();
      g.strokeStyle = rgba(hot, 0.85 * k); g.lineWidth = 1.4; g.beginPath(); const L = Rr * 0.3 * (0.6 + 0.4 * k); for (const a of [0.35, 0.35 + Math.PI / 2, 0.35 + Math.PI, 0.35 + Math.PI * 1.5]) { g.moveTo(0, 0); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); } g.stroke(); }
    if (dt < 0.7) { g.globalCompositeOperation = dark ? 'lighter' : 'source-over'; g.lineWidth = 2.2; const run = clamp(dt / 0.55) * 1.25, k = 1 - clamp((dt - 0.4) / 0.3);
      for (const ray of G.rays) { g.beginPath(); let st = false; for (const p of ray.pts) { if (p[2] < run - 0.14 || p[2] > run) continue; st ? g.lineTo(p[0] * Rr, p[1] * Rr) : g.moveTo(p[0] * Rr, p[1] * Rr); st = true; } g.strokeStyle = rgba(hot, 0.8 * k); g.stroke(); } }
    g.restore(); } } });
const GSNAP = makeCanvas(16, 16) as HTMLCanvasElement;

register({ id: 'glass-shards', label: 'fx.glass', layer: 'foreground', kind: 'effect', z: 0, draw(g, f) {
  if (!f.style.fx.glass) return; const t = f.t, act = f.plan.cues.glass.filter(ev => t >= ev.t && t - ev.t <= 2.2); if (!act.length) return;
  const w = f.W, h = f.H, cv = g.canvas as HTMLCanvasElement;
  const roll = f.cam.fx.r - f.cam.cont.r, zoom = f.cam.fx.z, Mbg = new DOMMatrix().translate(w / 2, h / 2).rotate(roll).scale(zoom).translate(-w / 2, -h / 2), inv = Mbg.inverse(), dark = f.pal.dark;
  // what each flying piece carries is only the picture where it was: the frame is copied for those places alone, and
  // each piece draws only its own part of it (a piece no longer reads the whole frame — the cost of the shatter)
  // (a large frame is copied at a little under its full size: the pieces are in flight, a hair of softness is not seen)
  const sk = Math.min(cv.width > 1600 ? 1600 / cv.width : 1, gfx() === 'optimized' ? 0.5 : 1), SW = Math.round(cv.width * sk), SH = Math.round(cv.height * sk); if (GSNAP.width !== SW || GSNAP.height !== SH) { GSNAP.width = SW; GSNAP.height = SH; }
  const kx = SW / w, ky = SH / h, BOX = new Map<any, number[]>(); let U = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ev of act) { const dt = t - ev.t, G = glassGeom(ev), Rr = Math.hypot(w, h) * 0.5 * ev.size, cx = ev.x * w, cy = ev.y * h, reach = sstep(clamp(dt / 0.07)) * 1.2;
    for (const sh of G.shards) { if (sh.r0 > reach || !sh.fly) continue; const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of sh.poly) { const q = Mbg.transformPoint({ x: cx + p[0] * Rr, y: cy + p[1] * Rr }); b[0] = Math.min(b[0], q.x); b[1] = Math.min(b[1], q.y); b[2] = Math.max(b[2], q.x); b[3] = Math.max(b[3], q.y); }
      b[0] = Math.max(0, Math.floor(b[0] - 2)); b[1] = Math.max(0, Math.floor(b[1] - 2)); b[2] = Math.min(w, Math.ceil(b[2] + 2)); b[3] = Math.min(h, Math.ceil(b[3] + 2));
      if (b[2] - b[0] < 1 || b[3] - b[1] < 1) continue; BOX.set(sh, b); U = [Math.min(U[0], b[0]), Math.min(U[1], b[1]), Math.max(U[2], b[2]), Math.max(U[3], b[3])]; } }
  if (U[2] > U[0]) { const sg = C2(GSNAP), x0 = Math.floor(U[0] * kx), y0 = Math.floor(U[1] * ky), x1 = Math.min(SW, Math.ceil(U[2] * kx)), y1 = Math.min(SH, Math.ceil(U[3] * ky));
    sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(x0, y0, x1 - x0, y1 - y0); sg.drawImage(cv, x0 / sk, y0 / sk, (x1 - x0) / sk, (y1 - y0) / sk, x0, y0, x1 - x0, y1 - y0); }
  // (the copy as a pattern laid where the picture was: a piece filled with it carries its part of the frame wherever it flies)
  const pat = U[2] > U[0] ? g.createPattern(GSNAP, 'no-repeat') : null; pat?.setTransform(inv.multiply(new DOMMatrix().scale(1 / kx, 1 / ky)));
  const light = dark ? mix(f.pal.text, [255, 255, 255], 0.2) : mix(f.pal.text, f.pal.bg, 0.35);
  for (const ev of act) { const dt = t - ev.t, G = glassGeom(ev), Rr = Math.hypot(w, h) * 0.5 * ev.size, cx = ev.x * w, cy = ev.y * h, reach = sstep(clamp(dt / 0.07)) * 1.2, fade = 1 - clamp((dt - 0.9) / 1.2), split = sstep(clamp(dt / 0.08)) * 0.035;
    g.save(); g.transform(Mbg.a, Mbg.b, Mbg.c, Mbg.d, Mbg.e, Mbg.f); g.globalCompositeOperation = 'source-over';
    { let kk = 0, n = 0; g.beginPath(); for (const sh of G.shards) { const gone = goneK(sh, dt, reach, fade); if (gone < 0.01) continue; kk += gone; n++;
        sh.poly.forEach((p: number[], k: number) => { const x = cx + p[0] * Rr, y = cy + p[1] * Rr; k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); }
      if (n) { g.globalAlpha = (dark ? 0.16 : 0.08) * kk / n; g.fillStyle = rgba(mix(f.pal.bg, K3, dark ? 0.5 : 0.35), 1); g.fill('nonzero'); } }
    g.restore();
    // a blow, not a peel: every piece is struck out from the point of impact at once (the inner ones a hair first), flies
    // outward fast and slows (air), drops a little, tumbles, and the pieces near the blow come toward the camera
    for (const sh of G.shards) { if (sh.r0 > reach || !sh.fly) continue; const st = Math.max(0, dt - burstAt(sh)), op = fade * (1 - clamp(st / 1.1)) * clamp((reach - sh.r0) / 0.2); if (op <= 0.01) continue;
      const cl = Math.hypot(sh.c[0], sh.c[1]) || 1, ux = sh.c[0] / cl, uy = sh.c[1] / cl, v0 = (1.1 + 1.4 * (1 - clamp(sh.r0 / 0.8))) * Rr, run = v0 * (1 - Math.exp(-st * 5)) / 5;
      const ox = cx + sh.c[0] * Rr, oy = cy + sh.c[1] * Rr, dx = sh.c[0] * Rr * split + ux * run, dy = sh.c[1] * Rr * split + uy * run + st * st * h * 0.5, near = 1 + st * 1.3 * (1 - clamp(sh.r0 / 0.6));
      const M = Mbg.multiply(new DOMMatrix().translate(ox + dx, oy + dy).rotate(sh.vr * st * 57.3 * 2.4).scale(near).translate(-ox, -oy));
      g.save(); g.transform(M.a, M.b, M.c, M.d, M.e, M.f); g.beginPath(); sh.poly.forEach((p: number[], k: number) => { const x = cx + p[0] * Rr, y = cy + p[1] * Rr; k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
      // (the piece filled with the picture it carries, and its glint filled into the same shape: no clip per piece)
      if (pat && BOX.has(sh)) { g.globalAlpha = 0.8 * op; g.fillStyle = pat; g.fill(); }
      const ex = sh.poly.reduce((m: number, p: number[]) => Math.max(m, Math.hypot(p[0] - sh.c[0], p[1] - sh.c[1])), 0) * Rr, band = -0.6 + ((st * 0.9 + rnd(sh.c[0] * 31 + sh.c[1] * 17) * 0.6) % 1.6);
      const sgd = g.createLinearGradient(ox - ex, oy - ex, ox + ex, oy + ex), b0 = clamp(band + 0.5);
      sgd.addColorStop(0, 'rgba(255,255,255,0)'); sgd.addColorStop(clamp(b0 - 0.08), 'rgba(255,255,255,0)'); sgd.addColorStop(b0, `rgba(255,255,255,${(dark ? 0.32 : 0.45) * op})`); sgd.addColorStop(clamp(b0 + 0.08), 'rgba(255,255,255,0)'); sgd.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalCompositeOperation = dark ? 'screen' : 'source-over'; g.globalAlpha = 1; g.fillStyle = sgd; g.fill();
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.1 * op; g.strokeStyle = rgba(mix(f.pal.bg, K3, 0.8), 1); g.lineWidth = 1.4; g.stroke();
      g.globalCompositeOperation = dark ? 'screen' : 'source-over'; g.globalAlpha = (dark ? 0.5 : 0.28) * op; g.strokeStyle = rgba(mix(mix(light, f.pal.accent, 0.25), [255, 255, 255], 0.45), 1); g.lineWidth = 0.8; g.stroke(); g.restore(); } } } });

/* ---------- glyph contours: one character of the current line, traced as vector outline rings, huge behind it ---------- */
const KEYCH = new WeakMap<PLine, string | null>();
/** Make ahead the panes a song's glyph slots will show (each is costly the first time: its mask, small mask and rim), one
 *  per call; returns whether there is more to do. */
export function glyphPaneWarm(f: Pick<RenderFrame, 'plan' | 'style'>) {
  const fc = fontStack(f.style.font), todo = f.style.fx.glyph ? [...new Set(f.plan.cues.glyphSlots.map(sl => keyChar(sl.line)).filter(Boolean) as string[])] : [];
  let i = 0; return () => { while (i < todo.length) { const ch = todo[i]; if (!glyphPane(ch, fc.w, fc.stack)) return true; i++; return i < todo.length; } return false; };
}
function keyChar(P: PLine) {
  if (KEYCH.has(P)) return KEYCH.get(P)!; let best: any = null; for (const S of P.words) if (!best || S.lw * S.lh > best.lw * best.lh) best = S;
  const cands = best ? graphemes(best.w.text).filter((ch: string) => !/[\p{P}\p{S}\s]/u.test(ch)) : [];
  const c = cands.length ? (isLatin(cands[0]) ? cands[0].toUpperCase() : cands[Math.floor(rnd(P.i * 3.3) * Math.min(cands.length, 3))]) : null; KEYCH.set(P, c); return c;
}
/* The glyph as frosted glass: a pane in the character's shape a good way behind the words (so it slides against both
   the words and the backdrop as the camera moves). Inside it, what is behind is seen blurred and a little lifted, as
   through ground glass; its edge catches the light in a fine rim. The pane is made where it stands each frame (the
   picture under it, a quarter of the size, blurred) — small work, however large the glyph. */
const GLY = new Map<string, { mask: HTMLCanvasElement | OffscreenCanvas; small: HTMLCanvasElement | OffscreenCanvas; rim: HTMLCanvasElement | OffscreenCanvas; S: number }>();
function glyphPane(ch: string, w: number, stack: string) {
  const key = ch + '|' + w + stack; let e = GLY.get(key); if (e) return e;
  const R = 720, font = `${w} ${R}px ${stack}`;
  // (drawn only once the face is really there: a fallback face must not be kept, nor redrawn every frame meanwhile)
  if (typeof document !== 'undefined' && document.fonts && !document.fonts.check(font, ch)) { document.fonts.load(font, ch).catch(() => {}); return null; }
  const S = Math.round(R * 1.6), mk = (draw: (g: CanvasRenderingContext2D) => void) => { const c = makeCanvas(S, S); const g = C2(c) as CanvasRenderingContext2D; g.translate(S / 2, S / 2);
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; draw(g); return c; };
  const mask = mk(g => { g.fillStyle = '#fff'; g.fillText(ch, 0, 0); });
  // its edge traced round the character's silhouette (the filled shape grown by a few pixels, the shape itself taken
  // out): one clean outline of the whole character, never the overlapping contours of its strokes; and a soft glow of
  // the same, wider
  // (made cheaply, once, ahead of time — see glyphPaneWarm: eight offsets for the fine line, and the soft glow as the
  // shape blurred once with the shape taken out, all on one canvas)
  const rim = makeCanvas(S, S); { const g = C2(rim) as CanvasRenderingContext2D, wd = R * 0.005;
    g.globalAlpha = 0.45; g.filter = `blur(${(R * 0.01).toFixed(1)}px)`; g.drawImage(mask as CanvasImageSource, 0, 0); g.filter = 'none'; g.globalAlpha = 1;
    for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; g.drawImage(mask as CanvasImageSource, Math.cos(a) * wd, Math.sin(a) * wd); }
    g.globalCompositeOperation = 'destination-out'; g.drawImage(mask as CanvasImageSource, 0, 0); g.globalCompositeOperation = 'source-over'; }
  // (the mask also small: the pane is worked at a couple of hundred pixels, and cutting it with the full mask read a
  // million pixels a frame)
  const small = makeCanvas(256, 256); { const sg = C2(small); sg.imageSmoothingQuality = 'high'; sg.drawImage(mask as CanvasImageSource, 0, 0, 256, 256); }
  e = { mask, small, rim, S: S / R }; GLY.set(key, e); if (GLY.size > 24) GLY.delete(GLY.keys().next().value!); return e;
}
const PANE = [makeCanvas(8, 8) as HTMLCanvasElement, makeCanvas(8, 8) as HTMLCanvasElement];
/** Where a glyph pane stands on screen: the place among a few (either side, the four corners' insides) that the words
 *  of its passage cross least while it shows — the planned camera sampled over its time, every line seen meanwhile —
 *  so it fills the empty part of the picture, held there. */
const SPOT = new WeakMap<object, { x: number; y: number; r: number }>();
const SPOTS = [[-0.3, 0], [0.3, 0], [-0.26, -0.2], [0.26, -0.2], [-0.26, 0.2], [0.26, 0.2]];
function glyphSpot(sl: RenderFrame['plan']['cues']['glyphSlots'][number], f: RenderFrame) {
  let o = SPOT.get(sl); if (o) return o;
  const W = f.W, H = f.H, plan = f.plan, t1 = Math.min(sl.end, sl.t + 8), score = SPOTS.map(() => 0), rad = H * 0.42;
  let r0 = 0;
  for (let ts = sl.t; ts <= t1; ts += 0.5) { const b = basePose(plan.camera, ts), cam = { x: b.x, y: b.y, z: b.z, r: b.r, d: b.d, yaw: 0, pitch: 0 }; if (ts === sl.t) r0 = b.r;
    for (const P of plan.lines) { if (P.sec !== sl.line.sec || P.L.t > ts + 0.5 || P.L.end < ts) continue;
      for (const S of P.words) { const p = project(S.x, S.y, S.d, cam, NO_FX, W, H), wr = Math.hypot(S.lw, S.lh) * 0.5 * p.k;
        SPOTS.forEach(([sx, sy], i) => { const d = Math.hypot(p.sx - sx * W, p.sy - sy * H); score[i] += Math.max(0, rad + wr - d); }); } } }
  let bi = sl.side ? 1 : 0; score.forEach((v, i) => { if (v < score[bi] - 1e-6) bi = i; });
  o = { x: SPOTS[bi][0] * W, y: SPOTS[bi][1] * H, r: r0 }; SPOT.set(sl, o); return o;
}
// (deep in the backdrop: behind its roses, its cover, its record — over a song's video when one is up)
register({ id: 'glyph', label: 'fx.glyph', layer: 'backdrop', kind: 'effect', z: 0, deep: true, params: [{ key: 'contrast', label: 'p.contrast', kind: 'range', min: 0.05, max: 1, step: 0.05, def: 0.2 }],
  draw(g, f, a) {
    const t = f.t, ov = f.cam.ov, k0 = +a.params.contrast, fc = fontStack(f.style.font), TR_IN = 0.4, tr = (g as CanvasRenderingContext2D).getTransform(), px = tr.a, cv = g.canvas as HTMLCanvasElement;
    const veil = f.pal.dark ? mix([255, 255, 255], f.pal.accent, 0.25) : mix(f.pal.bg, [255, 255, 255], 0.6);
    for (const sl of f.plan.cues.glyphSlots) {
      if (t < sl.t - 0.2 || t > sl.end + 1.8) continue; const P = sl.line, ch = keyChar(P); if (!ch) continue;
      const fin = eSine(clamp((t - sl.t + 0.2) / 1.8)), fout = sl.cut ? 1 - sstep(clamp((t - (sl.end - TR_IN)) / TR_IN)) : 1 - eSine(clamp((t - sl.end + 0.2) / 1.8));
      const al = Math.min(1, fin * fout * (1 - ov) * f.view.effect * k0); if (al < 0.01) continue;
      // where the words are not (a large shape filling the empty part of the picture, most of a frame high), floating
      // there on its own, as a pane of glass adrift in water would: it travels slowly across its place over its whole
      // time (each its own way), bobs and sways on a few slow waves that never line up, breathes, and turns a little in
      // depth (narrowing as it turns); it lies a good way behind the words, so the camera's moves slide it a little
      // against them (part of the backdrop's own parallax) — never pinned to the frame
      const tt = accentClock(f);   // (its drift, sway and breath hang on a heavy beat like the other floating things)
      const at = glyphSpot(sl, f), ph = P.i * 1.37, life = Math.max(2, sl.end + 1.8 - (sl.t - 0.2)), u = clamp((t - sl.t + 0.2) / life) - 0.5, da = rnd(P.i * 5.3) * 6.283;
      const br = 1 + 0.03 * Math.sin(tt * 0.47 + ph) + 0.015 * Math.sin(tt * 0.83 + ph * 1.9), size = f.H * 0.95 * (0.96 + 0.04 * fin) * br;
      const ly = glyphPane(ch, fc.w, fc.stack); if (!ly) continue;
      const rot = ((rnd(P.i * 2.3) - 0.5) * 12 + u * 7 * (rnd(P.i * 1.1) < 0.5 ? -1 : 1) + Math.sin(tt * 0.37 + ph) * 3.5 + Math.sin(tt * 0.71 + ph * 2.1) * 1.3) * D2R;
      const yaw = 1 - 0.07 * (0.5 + 0.5 * Math.sin(tt * 0.29 + ph * 1.3)), pitch = 1 - 0.035 * (0.5 + 0.5 * Math.sin(tt * 0.41 + ph * 0.7));
      const cx = f.W / 2 + at.x + Math.cos(da) * u * 0.09 * f.W + (Math.sin(tt * 0.43 + ph) * 0.02 + Math.sin(tt * 0.79 + ph * 1.7) * 0.008) * f.W + a.bd.ox * 0.5,
        cy = f.H / 2 + at.y + Math.sin(da) * u * 0.07 * f.H + (Math.sin(tt * 0.53 + ph * 0.8) * 0.026 + Math.sin(tt * 0.97 + ph * 2.3) * 0.01) * f.H + a.bd.oy * 0.5, w = size * ly.S, half = w * 0.72;
      // the picture under the pane, small, blurred, lifted, cut to the glyph
      // (worked small: a quarter of its size on screen, never over 160 px — it is blurred, so nothing is lost, and a large
      // pane up close no longer costs a large blur)
      const q = 0.25, sw = Math.max(8, Math.min(160, Math.ceil(half * 2 * px * q))), [A, B] = PANE; for (const c of PANE) if (c.width !== sw || c.height !== sw) { c.width = sw; c.height = sw; }
      const ax = C2(A), bx = C2(B), dx = (cx - half) * px + tr.e, dy = (cy - half) * px + tr.f, ds = half * 2 * px;
      ax.setTransform(1, 0, 0, 1, 0, 0); ax.globalCompositeOperation = 'copy'; ax.filter = 'none';
      // (only the part of the picture that is really there: a pane reaching past the frame reads no more than the frame)
      { const x0 = Math.max(0, dx), y0 = Math.max(0, dy), x1 = Math.min(cv.width, dx + ds), y1 = Math.min(cv.height, dy + ds), k = sw / ds;
        if (x1 - x0 < 1 || y1 - y0 < 1) continue; ax.clearRect(0, 0, sw, sw); ax.globalCompositeOperation = 'source-over'; ax.drawImage(cv, x0, y0, x1 - x0, y1 - y0, (x0 - dx) * k, (y0 - dy) * k, (x1 - x0) * k, (y1 - y0) * k); }
      bx.setTransform(1, 0, 0, 1, 0, 0); bx.globalCompositeOperation = 'copy';
      if (gfx() === 'optimized') { bx.clearRect(0, 0, sw, sw); bx.globalCompositeOperation = 'source-over'; cheapBlurDraw(bx, A, sw, sw, Math.max(2, sw * 0.022), 0, 0, sw, sw); bx.globalAlpha = 1; }
      else { bx.filter = `blur(${Math.max(2, sw * 0.022).toFixed(1)}px)`; bx.drawImage(A, 0, 0); bx.filter = 'none'; }
      bx.globalCompositeOperation = 'source-over'; bx.fillStyle = rgba(veil, f.pal.dark ? 0.1 : 0.22); bx.fillRect(0, 0, sw, sw);
      bx.globalCompositeOperation = 'destination-in'; bx.translate(sw / 2, sw / 2); bx.rotate(rot); const mw = w / (half * 2) * sw; bx.drawImage((mw <= 400 ? ly.small : ly.mask) as CanvasImageSource, -mw / 2, -mw / 2, mw, mw);
      g.save(); g.translate(cx, cy); g.scale(yaw, pitch); g.globalAlpha = al * 0.92; g.drawImage(B, -half, -half, half * 2, half * 2);
      // its edge: a fine rim of light (with its own soft glow: the glass has thickness)
      g.rotate(rot); g.globalCompositeOperation = f.pal.dark ? 'screen' : 'source-over';
      g.globalAlpha = al * (f.pal.dark ? 0.3 : 0.22); g.drawImage(ly.rim as CanvasImageSource, -w / 2, -w / 2, w, w);
      g.restore();
    } } });

/* ---------- lyric frames: an outline traced round part of a line, with corner ticks, following the words' depth ---------- */
register({ id: 'frame', label: 'fx.frame', layer: 'world-back', kind: 'effect', z: 2, draw(g, f) {
  // a frame encloses all its words, on screen or not (its shape must not depend on what the culling keeps)
  const vis = f.vis || [], byS = new Map(vis.map(v => [v.S, v])), t = f.t, ink = f.ink;
  const seen = new Set<any>();
  for (const v0 of vis) { const F = v0.S.frame; if (!F || seen.has(F) || t < F.ts) continue; seen.add(F);
    const o = Math.max(...F.words.map(S => byS.get(S)?.o ?? 0)) * f.view.effect; if (o < 0.02) continue;
    // each word as it is drawn now (its float, its own turn, its size: lyrics.ts), not at its rest pose — a tilted or
    // floating word stays inside; the words' leaning in depth is not followed exactly, a margin holds it
    const boxes = F.words.map(S => { const v = byS.get(S), p = v ? v.p : project(S.x, S.y, S.d, f.cam.cam, f.cam.fx, f.W, f.H), ws = v?.ws;
      const a = (S.tilt + p.rot + (ws?.frot ?? 0)) * D2R, k = S.s * (ws?.sc ?? 1) * p.k, ox = (ws?.ox ?? 0) * k, oy = (ws?.oy ?? 0) * k;
      return { x: p.sx + Math.cos(a) * ox - Math.sin(a) * oy, y: p.sy + Math.sin(a) * ox + Math.cos(a) * oy, lw: S.lw * (ws?.sc ?? 1) * p.k, lh: S.lh * (ws?.sc ?? 1) * p.k, tilt: a / D2R }; });
    const vv = [{ S: F.words[0], p: byS.get(F.words[0])?.p ?? project(F.words[0].x, F.words[0].y, F.words[0].d, f.cam.cam, f.cam.fx, f.W, f.H) }], L = vv[0].S.line;
    // its angle: mostly the words' own, leaning a little back to the line's — close to them, never glued to them
    const wa = Math.atan2(boxes.reduce((s, b) => s + Math.sin(b.tilt * D2R), 0), boxes.reduce((s, b) => s + Math.cos(b.tilt * D2R), 0)) / D2R, la = L.prot + vv[0].p.rot;
    const fa = la + angDiff(wa, la) * 0.8, B = boxIn(boxes, fa), cs = Math.min(...boxes.map(b => Math.min(b.lw, b.lh)));
    const padd = cs * 0.15 + Math.max(B.w, B.h) * 0.03, w = B.w + padd * 2, h = B.h + padd * 2, per = 2 * (w + h);
    const dt = t - F.ts, p = eOut(clamp(dt / 0.85)), tEnd = Math.min(L.L.end - 0.8, F.until ?? Infinity), q = 1 - eIO(clamp((t - tEnd) / 0.8)), vis1 = p * q; if (vis1 <= 0.002) continue;
    const fl = Math.sin(t * 0.9 + L.i) * 0.5, s1 = 1 + 0.012 * Math.sin(t * 1.3 + L.i * 2);
    g.save(); g.translate(f.W / 2 + B.x + Math.sin(t * 0.7 + L.i) * padd * 0.08, f.H / 2 + B.y + Math.cos(t * 0.6 + L.i) * padd * 0.08); g.rotate((fa + fl) * D2R); g.scale(s1, s1);
    g.strokeStyle = rgba(ink, 1); g.fillStyle = rgba(ink, 1); g.globalAlpha = o * 0.7; g.lineWidth = 1.6; g.lineJoin = 'miter'; g.lineCap = 'butt';
    const sx = F.corner ? 1 : -1, x0 = -w / 2 * sx, y0 = -h / 2, len = per / 2 * vis1;
    g.setLineDash([len, per]); g.beginPath(); g.moveTo(x0, y0); g.lineTo(-x0, y0); g.lineTo(-x0, -y0); g.lineTo(x0, -y0); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, -y0); g.lineTo(-x0, -y0); g.lineTo(-x0, y0); g.closePath(); g.stroke(); g.setLineDash([]);
    const e = padd * 1.2 * eOut(clamp((dt - 0.6) / 0.5)) * q;
    if (e > 0.5) { g.beginPath(); g.moveTo(x0 - e * sx, y0); g.lineTo(x0, y0); g.lineTo(x0, y0 - e); g.moveTo(-x0 + e * sx, -y0); g.lineTo(-x0, -y0); g.lineTo(-x0, -y0 + e); g.stroke(); }
    const rt = (dt - 0.85) / 1.3;
    if (rt > 0 && rt < 1 && q > 0.99) { const d = eIO(rt) * per, sq = Math.max(3, padd * 0.12), pts = [[x0, y0], [-x0, y0], [-x0, -y0], [x0, -y0], [x0, y0]], segL = [w, h, w, h]; let rem = d, k = 0; while (k < 3 && rem > segL[k]) { rem -= segL[k]; k++; }
      const fr = Math.min(1, rem / segL[k]), x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * fr, y = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * fr; g.globalAlpha = o * 0.9 * Math.sin(Math.PI * rt); g.fillRect(x - sq / 2, y - sq / 2, sq, sq); }
    g.restore(); } } });

/* ---------- stars: from far out of frame, curving in to land beside a word just as it appears ---------- */
/* a star: a soft halo, a four-pointed body with curved sides, two thin flares longer than it, a bright core — drawn
   once per colour into a sprite and placed (a star costs one image, however finely it is made) */
let STAR: { key: string; c: HTMLCanvasElement } | null = null;
function starSprite(col: RGB) {
  const key = col.join(); if (STAR && STAR.key === key) return STAR.c;
  const S = 192, c = makeCanvas(S, S) as HTMLCanvasElement, g = C2(c), m = S / 2, r = S * 0.2; g.translate(m, m);
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, m); halo.addColorStop(0, rgba(col, 0.42)); halo.addColorStop(0.18, rgba(col, 0.16)); halo.addColorStop(0.5, rgba(col, 0.04)); halo.addColorStop(1, rgba(col, 0));
  g.fillStyle = halo; g.fillRect(-m, -m, S, S);
  for (const [len, wd, al] of [[m * 0.98, 1.2, 0.35], [m * 0.62, 2.2, 0.55]] as const) for (const a of [0, Math.PI / 2]) {     // the flares: long and thin, fading out
    const gr = g.createLinearGradient(-len, 0, len, 0); gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(0.5, rgba(mix(col, [255, 255, 255], 0.5), al)); gr.addColorStop(1, rgba(col, 0));
    g.save(); g.rotate(a); g.fillStyle = gr; g.fillRect(-len, -wd / 2, len * 2, wd); g.restore(); }
  const body = g.createRadialGradient(0, 0, 0, 0, 0, r); body.addColorStop(0, '#ffffff'); body.addColorStop(0.35, rgba(mix(col, [255, 255, 255], 0.55), 1)); body.addColorStop(1, rgba(col, 0.9));
  g.fillStyle = body; g.beginPath(); g.moveTo(0, -r); g.quadraticCurveTo(r * 0.12, -r * 0.12, r * 0.72, 0); g.quadraticCurveTo(r * 0.12, r * 0.12, 0, r); g.quadraticCurveTo(-r * 0.12, r * 0.12, -r * 0.72, 0); g.quadraticCurveTo(-r * 0.12, -r * 0.12, 0, -r); g.fill();
  const core = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.32); core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = core; g.beginPath(); g.arc(0, 0, r * 0.32, 0, 6.283); g.fill();
  STAR = { key, c }; return c;
}
const STAR_K = 1.6;   // how much larger than the old plain star (the motion is the same)
function sparkle(g: Ctx, x: number, y: number, r: number, rot: number, spr: HTMLCanvasElement) { const s = r * STAR_K / 0.2; g.save(); g.translate(x, y); g.rotate(rot); g.drawImage(spr, -s / 2, -s / 2, s, s); g.restore(); }
register({ id: 'stars', label: 'fx.stars', layer: 'world-front', kind: 'effect', draw(g, f) {
  const t = f.t, tempo = Math.sqrt(clamp(f.plan.map.beatLen(t) / 0.5, 0.5, 2)), FLY = 0.75 * tempo, POP = 0.22 * tempo, far = Math.max(f.W, f.H) * 0.85, col = f.pal.dark ? mix(f.pal.flash, [255, 255, 255], 0.35) : f.pal.accent;
  const spr = starSprite(col);
  g.save(); g.globalCompositeOperation = f.pal.dark ? 'lighter' : 'source-over'; g.fillStyle = rgba(col, 1);
  for (const P of f.plan.lines) { if (P.L.t > t + FLY + 0.05) break; if (isFinite(P.secEnd) && t > P.secEnd - 0.4) continue;
    for (const S of P.words) { const dt = t - S.show; if (dt < -FLY || dt > POP) continue; if (rnd(P.i * 3.7 + S.k * 1.9) > 0.6) continue;
      const p = project(S.x, S.y, S.d, f.cam.cam, f.cam.fx, f.W, f.H), a0 = rnd(P.i * 9.1 + S.k * 4.3) * 6.283, bend = (rnd(P.i * 2.2 + S.k) < 0.5 ? 1 : -1) * (0.25 + rnd(P.i + S.k * 5.5) * 0.35);
      const side = rnd(P.i * 6.1 + S.k * 2.7) * 6.283, Rw = Math.hypot(S.lw, S.lh) * 0.5 * p.k * (1.05 + 0.4 * rnd(P.i * 1.3 + S.k * 8.9));
      const tx = f.W / 2 + p.sx + Math.cos(side) * Rw, ty = f.H / 2 + p.sy + Math.sin(side) * Rw * 0.7, sx = tx + Math.cos(a0) * far, sy = ty + Math.sin(a0) * far, mx = (sx + tx) / 2 - Math.sin(a0) * far * bend, my = (sy + ty) / 2 + Math.cos(a0) * far * bend;
      const r = Math.max(13, S.lh * p.k * 0.12), at = (u: number) => { const e = u * u * (3 - 2 * u) * 0.4 + u * u * 0.6, k = 1 - e; return [k * k * sx + 2 * k * e * mx + e * e * tx, k * k * sy + 2 * k * e * my + e * e * ty]; };
      if (dt < 0) { const u = clamp((dt + FLY) / FLY), env = sstep(clamp(u / 0.25)) * f.view.effect;
        for (let k = 10; k >= 1; k--) { const [x, y] = at(Math.max(0, u - k * 0.018)); g.globalAlpha = env * 0.4 * (1 - k / 11); g.beginPath(); g.arc(x, y, Math.max(0.5, r * 0.25 * (1 - k / 12)), 0, 6.283); g.fill(); }
        const [x, y] = at(u); g.globalAlpha = env; sparkle(g, x, y, r * (0.8 + 0.2 * u), t * 6, spr); }
      else { const u = dt / POP; g.globalAlpha = (1 - u) ** 2 * 0.9 * f.view.effect; sparkle(g, tx, ty, r * (1 + 0.35 * Math.sin(u * Math.PI)), t * 6, spr); } } }
  g.restore(); } });

/* ---------- over the screen: paper grain, vignette, scan lines (they fade with the effect view, never pop in) ---------- */
const GRAIN = (() => { const c = makeCanvas(160, 160) as HTMLCanvasElement, g = C2(c), d = g.createImageData(160, 160); for (let i = 0; i < d.data.length; i += 4) { const v = Math.floor(rnd(i * 0.37 + 1) * 255); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); return c; })();
const PATS = new WeakMap<object, Map<object, CanvasPattern>>();
const patternOf = (g: Ctx, src: CanvasImageSource) => { let m = PATS.get(g); if (!m) { m = new Map(); PATS.set(g, m); } let p = m.get(src as object); if (!p) { p = g.createPattern(src, 'repeat')!; m.set(src as object, p); } return p; };
register({ id: 'grain', label: 'fx.grain', layer: 'screen', kind: 'effect', z: 0, draw(g, f) { g.save(); g.globalAlpha = (f.pal.dark ? 0.18 : 0.24) * f.view.effect; g.globalCompositeOperation = 'soft-light'; g.fillStyle = patternOf(g, GRAIN); g.fillRect(0, 0, f.W, f.H); g.restore(); } });
let VIG: { key: string; g: CanvasGradient } | null = null;
register({ id: 'vignette', label: 'fx.vignette', layer: 'screen', kind: 'effect', z: 1, draw(g, f) {
  const key = `${f.W}|${f.H}|${f.pal.dark}`; if (!VIG || VIG.key !== key) { const v = g.createRadialGradient(f.W / 2, f.H * 0.45, Math.min(f.W, f.H) * 0.35, f.W / 2, f.H * 0.45, Math.max(f.W, f.H) * 0.75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, f.pal.dark ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.14)'); VIG = { key, g: v as CanvasGradient }; }
  g.save(); g.globalAlpha = f.view.effect; g.fillStyle = VIG.g; g.fillRect(0, 0, f.W, f.H); g.restore(); } });
let SCAN: { dark: boolean; c: HTMLCanvasElement } | null = null;
register({ id: 'scan', label: 'fx.scan', layer: 'screen', kind: 'effect', z: 2, draw(g, f) {
  if (!SCAN || SCAN.dark !== f.pal.dark) { const c = makeCanvas(4, 3) as HTMLCanvasElement, s = C2(c); s.fillStyle = f.pal.dark ? 'rgba(0,0,0,.28)' : 'rgba(0,0,0,.035)'; s.fillRect(0, 0, 4, 1); SCAN = { dark: f.pal.dark, c }; }
  g.save(); g.globalAlpha = f.view.effect; g.fillStyle = patternOf(g, SCAN.c); g.fillRect(0, 0, f.W, f.H); g.restore(); } });
export const _unused = { lerp, TIN_SPEC };
