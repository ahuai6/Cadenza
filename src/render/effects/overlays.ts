// Effects switched on per theme: drawn in the backdrop's space (motes, feathers, floor grid, spectrum, beat rings, glass
// cracks), in the lyric world (glyph contours, lyric frames, stars), in front (shards, feathers) or over the screen
// (grain, vignette, scan lines).
import { clamp, sstep, D2R, lerp } from '../../core/math';
import { eOut, eIO, eSine } from '../../core/ease';
import { rnd } from '../../core/rng';
import { mix, rgba, K3, W3, type RGB } from '../../core/color';
import { register, type Ctx } from './registry';
import type { RenderFrame } from '../frame';
import { makeCanvas } from '../palette';
import { project } from '../../director/project';
import { boxIn } from '../../director/layout';
import { fontStack } from '../../text/fonts';
import { graphemes, isLatin } from '../../lyrics/script';
import { TIN_SPEC } from '../../director/words';
import type { PLine } from '../../director/types';

const C2 = (c: HTMLCanvasElement | OffscreenCanvas) => (c as HTMLCanvasElement).getContext('2d')!;
let DOT: { key: string; c: HTMLCanvasElement } | null = null;
const dot = (col: RGB) => { const key = col.join(); if (DOT && DOT.key === key) return DOT.c; const c = makeCanvas(64, 64) as HTMLCanvasElement, g = C2(c), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, rgba(col, 1)); r.addColorStop(0.3, rgba(col, 0.55)); r.addColorStop(1, rgba(col, 0)); g.fillStyle = r; g.fillRect(0, 0, 64, 64); DOT = { key, c }; return c; };

/* ---------- motes: specks of light drifting up ---------- */
const MOTES = Array.from({ length: 170 }, (_, i) => ({ x: rnd(i * 3.1), y: rnd(i * 5.7), z: 0.2 + rnd(i * 9.3) * 0.8, s: 0.5 + rnd(i * 2.3), f: 0.5 + rnd(i * 4.4) * 2, p: rnd(i * 6.6) * 6.28, big: i < 26 }));
register({ id: 'motes', label: 'fx.motes', layer: 'backdrop', kind: 'effect', z: 10, params: [{ key: 'amount', label: 'p.amount', kind: 'range', min: 0, max: 2, step: 0.05, def: 1 }],
  draw(g, f, a) { const E = a.bd.E, w = f.W, h = f.H, m = Math.min(w, h), t = f.t, P = f.P, D = dot(f.pal.accent), amt = +a.params.amount, brk = Math.max(0, t - (f.plan.musicEnd - 3.5)), n = Math.round(MOTES.length * clamp(amt / 2 * 2, 0, 1));
    for (let i = 0; i < n; i++) { const d = MOTES[i];
      const X = d.x * (w + 2 * E) - E + a.bd.ox * d.z * 2 + Math.sin(t * 0.3 + d.p) * 20 * d.z, Y = ((((d.y - t * 0.006 * d.s * (1 + brk * 0.15)) % 1) + 1) % 1) * (h + 2 * E) - E + a.bd.oy * d.z * 2, tw = 0.55 + 0.45 * Math.sin(t * d.f + d.p);
      if (d.big) { const r = (10 + 30 * d.z) * (m / 720); g.globalAlpha = ((0.04 + 0.07 * d.z) * tw + P * 0.04) * Math.min(1, amt); g.drawImage(D, X - r, Y - r, r * 2, r * 2); }
      else { const r = (1.2 + 3.2 * d.z) * (m / 720); g.globalAlpha = Math.min(1, (0.2 + 0.5 * d.z) * tw + P * 0.3 * d.z) * Math.min(1, amt); g.drawImage(D, X - r * 2, Y - r * 2, r * 4, r * 4); } }
    g.globalAlpha = 1; } });

/* ---------- feathers ---------- */
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
/* The feathers' own clock: it runs with the music but slows on each strong accent — braking within a tenth of a second to
   a fifth of their speed, holding a moment, then easing back over a little over a second — so they hang in the air on
   the hit and drift on. One table per plan (30 samples a second), the clock read from it. */
const FCLK = new WeakMap<object, Float32Array>(), FR = 30;
function featherClock(f: RenderFrame): number {
  const plan = f.plan; let tb = FCLK.get(plan);
  if (!tb) { const n = Math.ceil((plan.dur + 2) * FR) + 1, sp = new Float32Array(n).fill(1);
    for (const e of plan.map.events) { if (e.tier < 2 || e.s < 1.1 || e.off) continue; const k = clamp((e.s - 1.1) / 0.8 + 0.6, 0.6, 1);
      for (let i = Math.max(0, Math.floor(e.t * FR)); i < n; i++) { const u = i / FR - e.t; if (u > 1.6) break;
        const dip = u < 0.1 ? eOut(u / 0.1) : u < 0.3 ? 1 : 1 - eIO((u - 0.3) / 1.3), v = 1 - 0.8 * k * dip; if (v < sp[i]) sp[i] = v; } }
    tb = new Float32Array(n); for (let i = 1; i < n; i++) tb[i] = tb[i - 1] + (sp[i - 1] + sp[i]) / 2 / FR; FCLK.set(plan, tb); }
  const x = clamp(f.t * FR, 0, tb.length - 1), i = Math.floor(x), j = Math.min(tb.length - 1, i + 1);
  return f.t < 0 ? f.t : tb[i] + (tb[j] - tb[i]) * (x - i) + Math.max(0, f.t - (tb.length - 1) / FR);
}
const BGF = Array.from({ length: 12 }, (_, i) => ({ x: rnd(i * 4.1 + 1), p: rnd(i * 6.3 + 2), z: 0.25 + rnd(i * 2.9) * 0.75, s: 0.018 + rnd(i * 8.8) * 0.03, f: 0.4 + rnd(i * 1.7) * 0.7, ph: rnd(i * 7.7) * 6.28, r0: (rnd(i * 5.5) - 0.5) * 2.4, k: i % 4 }));
const FGF = Array.from({ length: 3 }, (_, i) => ({ x: 0.15 + i * 0.35 + rnd(i * 3.7) * 0.1, p: rnd(i * 9.1 + 4), s: 0.03 + rnd(i * 2.2) * 0.02, f: 0.3 + rnd(i * 5.1) * 0.4, ph: rnd(i * 1.9) * 6.28, r0: (rnd(i * 8.3) - 0.5) * 2, k: i % 2 }));
register({ id: 'feathers', label: 'fx.feathers', layer: 'backdrop', kind: 'effect', z: 30, draw(g, f, a) {
  const F = feathers(f), w = f.W, h = f.H, m = Math.min(w, h), t = featherClock(f);
  for (const q of BGF) { const y = ((q.p + t * q.s) % 1.4 - 0.2) * h + a.bd.oy * q.z, x = (q.x + Math.sin(t * q.f + q.ph) * 0.05) * w + a.bd.ox * q.z * 1.5, rot = q.r0 + Math.sin(t * q.f * 1.3 + q.ph) * 0.55, fl = Math.cos(t * q.f * 0.8 + q.ph);
    drawFeather(g, F.sharp[q.k], x, y, (0.14 + 0.22 * q.z) * m * 1.3, rot, Math.sign(fl || 1) * Math.max(0.2, Math.abs(fl)), (0.15 + 0.4 * q.z) * (0.85 + 0.3 * f.P)); } } });
register({ id: 'feathers-fg', label: 'fx.feathers', layer: 'foreground', kind: 'effect', z: 1, draw(g, f) {
  if (!f.style.fx.feathers) return; const F = feathers(f), w = f.W, h = f.H, m = Math.min(w, h), t = featherClock(f), fx = f.cam.fx;
  for (const q of FGF) { const y = ((q.p + t * q.s) % 1.6 - 0.3) * h + fx.y * 3, x = (q.x + Math.sin(t * q.f + q.ph) * 0.08) * w + fx.x * 3, rot = q.r0 + Math.sin(t * q.f * 1.2 + q.ph) * 0.6, fl = Math.cos(t * q.f * 0.7 + q.ph);
    drawFeather(g, F.soft[q.k], x, y, m * 0.95, rot, Math.sign(fl || 1) * Math.max(0.25, Math.abs(fl)), (0.16 + 0.08 * f.P) * f.view.effect); } } });

/* ---------- floor grid and spectrum ---------- */
register({ id: 'grid', label: 'fx.grid', layer: 'backdrop', kind: 'effect', z: 20, draw(g, f, a) {
  const E = a.bd.E, w = f.W, h = f.H, hy = h * 0.66, mx = w / 2, A = f.pal.accent, I = f.I, P = f.P, t = f.t, brk = Math.max(0, t - (f.plan.musicEnd - 3.5));
  g.save(); g.beginPath(); g.rect(-E, hy, w + 2 * E, h - hy + E); g.clip(); const off = brk <= 0 ? eOut(f.rs.phase) : (t * 0.7) % 1, NL = 16;
  for (let j = 0; j < NL; j++) { const z = (j + off) / NL, y = hy + (h + E * 0.5 - hy) * z ** 2.3; g.strokeStyle = rgba(A, z * (0.14 + 0.24 * I) * (0.7 + 0.6 * P)); g.lineWidth = 0.6 + z * 1.6;
    g.setLineDash(brk ? [w * 0.03 * (1 + z * 3), brk * w * 0.012 * (0.3 + z)] : []); g.beginPath(); g.moveTo(-E, y); g.lineTo(w + E, y); g.stroke(); }
  g.setLineDash([]); g.lineWidth = 1; g.strokeStyle = rgba(A, (0.06 + 0.1 * I) * (1 - clamp(brk / 6) * 0.7));
  g.beginPath(); for (let k = -40; k <= 40; k++) { g.moveTo(mx + k * w * 0.012, hy); g.lineTo(mx + k * w * 0.165, h + E * 0.5); } g.stroke(); g.restore();
  g.fillStyle = rgba(A, 0.3 + 0.45 * I * (0.6 + 0.4 * P)); g.fillRect(-E, hy - 1, w + 2 * E, 2); } });
register({ id: 'eq', label: 'fx.eq', layer: 'backdrop', kind: 'effect', z: 15, draw(g, f, a) {
  const E = a.bd.E, w = f.W, h = f.H, hy = h * 0.66, bw = w / 48, i0 = -Math.ceil(E / bw), i1 = 48 + Math.ceil(E / bw), A = f.pal.accent, I = f.I, P = f.P, t = f.t;
  for (let i = i0; i < i1; i++) { const fq = Math.min(1, Math.abs(i - 23.5) / 24), v = (0.25 + 0.75 * I) * (P * (1 - fq) * 0.9 + 0.35 * Math.abs(Math.sin(t * 2.7 + i * 0.9)) * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.37 + t * 0.8)))), bh = v * h * 0.13;
    g.fillStyle = rgba(A, 0.1 + 0.3 * P * (1 - fq * 0.5)); g.fillRect(i * bw + 1, hy - bh, bw - 2, bh); g.fillStyle = rgba(A, 0.035); g.fillRect(i * bw + 1, hy, bw - 2, bh * 0.6); } } });

/* ---------- beat rings: one per rhythmic event, launched on it, bigger on strong accents and downbeats ----------
   Heavy: each ring is a firm core over a wide soft halo; a strong accent also blooms a glow at the centre and its ring
   carries a brighter, wider halo. All plain strokes and gradients (no filters), so it stays cheap. From the frame's
   centre on the centred stage (the record's middle), a little above it elsewhere. */
register({ id: 'rings', label: 'fx.rings', layer: 'backdrop', kind: 'effect', z: 5, draw(g, f) {
  const map = f.plan.map, L = 1.6 * map.beatLen(f.t), M = Math.max(f.W, f.H), mx = f.W / 2, cy = f.style.cut === 'center' ? f.H / 2 : f.H * 0.45, A = f.pal.accent, hot = mix(A, f.pal.flash, 0.5), I = f.I, t = f.t;
  for (const e of map.eventsIn(t - L, t, 1)) { const u = (t - e.t) / L; if (u < 0 || u >= 1) continue;
    const down = !e.off && Math.round(e.pos) % map.meter === 0, strong = e.tier === 2 && e.s >= 1.15, wgt = clamp((down ? 0.75 : 0.4) * (0.6 + 0.25 * clamp(e.s, 0, 2.4)) + (e.tier === 2 ? 0.35 : 0), 0.25, 1.4);
    const r = 1 - (1 - u) ** 2.5, al = (1 - u) ** 1.2 * Math.min(1, u * 20) * wgt * 0.5 * (0.6 + 0.4 * I), R = (0.05 + 0.7 * r) * M * 0.75 * (0.8 + 0.2 * wgt), lw = (3 + 5 * wgt) * (1 - 0.4 * u) * (M / 1280);
    g.beginPath(); g.arc(mx, cy, R, 0, Math.PI * 2);
    g.lineWidth = lw * (strong ? 7 : 4.5); g.strokeStyle = rgba(strong ? hot : A, Math.min(0.3, al * (strong ? 0.75 : 0.45))); g.stroke();
    if (strong) { g.lineWidth = lw * 2.6; g.strokeStyle = rgba(hot, Math.min(0.5, al * 1)); g.stroke(); }
    g.lineWidth = lw; g.strokeStyle = rgba(strong ? mix(A, W3, 0.25) : A, Math.min(0.85, al * 1.8)); g.stroke();
    // the accent's bloom: a glow at the centre that swells and fades within the beat
    if (strong && u < 0.6) { const k = Math.sin(Math.PI * clamp(u / 0.6)) * wgt * (0.6 + 0.4 * I), gr = g.createRadialGradient(mx, cy, 0, mx, cy, M * 0.42);
      gr.addColorStop(0, rgba(hot, 0.34 * k)); gr.addColorStop(0.4, rgba(A, 0.12 * k)); gr.addColorStop(1, rgba(A, 0)); g.fillStyle = gr; g.fillRect(mx - M * 0.42, cy - M * 0.42, M * 0.84, M * 0.84); } } } });

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
    for (const b of [0.55]) { if (b > top - 0.05) break; if (R() < 0.7) continue; rings.push([b * (0.75 + R() * 0.5), b * (0.75 + R() * 0.5)]); }
    const bow: number[][] = []; for (const rr of rings) { const pA = at(A, rr[0]), pB = at(B, rr[1]), m = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2], rad = Math.hypot(m[0], m[1]) || 1, k = (R() - 0.35) * 0.12 * rad;
      const mid = [m[0] + m[0] / rad * k + (R() - 0.5) * 0.02, m[1] + m[1] / rad * k + (R() - 0.5) * 0.02]; bow.push(mid); segs.push([pA, mid, pB]); }
    const rs = [[0.02, 0.02], ...rings], mids = [null, ...bow];
    for (let q = 0; q < rs.length; q++) { const r0 = rs[q], r1 = q + 1 < rs.length ? rs[q + 1] : null; if (!r1) break; if (R() < 0.12) continue;
      const poly: number[][] = []; for (const p of A.pts) if (p[2] >= r0[0] && p[2] <= r1[0]) poly.push(p); poly.unshift(at(A, r0[0])); poly.push(at(A, r1[0])); if (mids[q + 1]) poly.push(mids[q + 1]!);
      const sideB: number[][] = []; for (const p of B.pts) if (p[2] >= r0[1] && p[2] <= r1[1]) sideB.push(p); sideB.unshift(at(B, r0[1])); sideB.push(at(B, r1[1])); for (let k = sideB.length - 1; k >= 0; k--) poly.push(sideB[k]); if (mids[q]) poly.push(mids[q]!);
      const cx = poly.reduce((u, p) => u + p[0], 0) / poly.length, cy = poly.reduce((u, p) => u + p[1], 0) / poly.length; shards.push({ poly, c: [cx, cy], r0: Math.min(r0[0], r0[1]), vr: (R() - 0.5) * 3, delay: R() * 0.3 }); }
    if (R() >= 0.6) { const r = 0.15 + R() * (A.len - 0.2), p = at(A, r), dir = Math.atan2(p[1], p[0]) + (R() < 0.5 ? 1 : -1) * (0.4 + R() * 0.6), L = 0.05 + R() * 0.12; const pts = [[p[0], p[1]]]; let d = dir, x = p[0], y = p[1]; for (let k = 0; k < 3; k++) { d += (R() - 0.5) * 0.5; x += Math.cos(d) * L / 3; y += Math.sin(d) * L / 3; pts.push([x, y]); } branches.push({ r, pts }); } }
  const crush: number[][][] = []; for (let k = 0; k < 8; k++) { const a0 = R() * 6.283, r0 = R() * 0.05, L = 0.02 + R() * 0.05; crush.push([[Math.cos(a0) * r0, Math.sin(a0) * r0], [Math.cos(a0 + (R() - 0.5)) * (r0 + L), Math.sin(a0 + (R() - 0.5)) * (r0 + L)]]); }
  geo = { rays, segs, shards, branches, crush }; GEO.set(ev.seed, geo); if (GEO.size > 64) GEO.delete(GEO.keys().next().value!); return geo;
}
function crackPaths(g: Ctx, G: any, Rr: number, reach: number, fade: number, pass: number) {
  for (const ray of G.rays) { g.globalAlpha = (pass ? 0.42 : 0.5) * fade; g.lineWidth = pass ? 0.9 : 2.2; g.beginPath(); let st = false; for (const p of ray.pts) { if (p[2] > reach) break; st ? g.lineTo(p[0] * Rr, p[1] * Rr) : g.moveTo(p[0] * Rr, p[1] * Rr); st = true; } g.stroke(); }
  for (const sg of G.segs) { const r = Math.hypot(sg[0][0], sg[0][1]); if (r > reach * 0.95) continue; g.globalAlpha = (pass ? 0.35 : 0.42) * fade * clamp((reach * 0.95 - r) / 0.15); g.lineWidth = pass ? 0.8 : 1.8; g.beginPath(); g.moveTo(sg[0][0] * Rr, sg[0][1] * Rr); g.quadraticCurveTo(sg[1][0] * Rr, sg[1][1] * Rr, sg[2][0] * Rr, sg[2][1] * Rr); g.stroke(); }
  g.globalAlpha = (pass ? 0.25 : 0.32) * fade; g.lineWidth = pass ? 0.6 : 1.3;
  for (const br of G.branches) { if (br.r > reach) continue; g.beginPath(); br.pts.forEach((p: number[], k: number) => (k ? g.lineTo(p[0] * Rr, p[1] * Rr) : g.moveTo(p[0] * Rr, p[1] * Rr))); g.stroke(); }
  g.beginPath(); for (const [p, q] of G.crush) { g.moveTo(p[0] * Rr, p[1] * Rr); g.lineTo(q[0] * Rr, q[1] * Rr); } g.stroke();
}
register({ id: 'glass', label: 'fx.glass', layer: 'backdrop', kind: 'effect', z: 40, draw(g, f) {
  const w = f.W, h = f.H, t = f.t, dark = f.pal.dark;
  for (const ev of f.plan.cues.glass) { const dt = t - ev.t; if (dt < 0 || dt > 2.2) continue;
    const G = glassGeom(ev), Rr = Math.hypot(w, h) * 0.5 * ev.size, cx = ev.x * w, cy = ev.y * h, grow = sstep(clamp(dt / 0.07)), fade = 1 - clamp((dt - 0.9) / 1.2), reach = grow * 1.2, hot = mix(f.pal.text, [255, 255, 255], 0.6);
    g.save(); g.translate(cx, cy); g.lineJoin = 'round'; g.lineCap = 'round';
    g.globalCompositeOperation = 'multiply'; g.strokeStyle = rgba(mix(f.pal.bg, K3, 0.6), 1); crackPaths(g, G, Rr, reach, fade * 1.5 * (ev.k ?? 1), 0);
    g.globalCompositeOperation = dark ? 'screen' : 'soft-light'; g.strokeStyle = rgba(hot, 1); g.save(); g.translate(-0.8, -0.8); crackPaths(g, G, Rr, reach, Math.min(1, fade * 1.6), 1); g.restore();
    if (dt < 0.5) { const k = 1 - sstep(dt / 0.5), rr = Rr * 0.22, gr = g.createRadialGradient(0, 0, 0, 0, 0, rr); gr.addColorStop(0, rgba(hot, 0.55 * k)); gr.addColorStop(1, rgba(hot, 0));
      g.globalCompositeOperation = dark ? 'lighter' : 'source-over'; g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rr, 0, 6.283); g.fill();
      g.strokeStyle = rgba(hot, 0.85 * k); g.lineWidth = 1.4; g.beginPath(); const L = Rr * 0.3 * (0.6 + 0.4 * k); for (const a of [0.35, 0.35 + Math.PI / 2, 0.35 + Math.PI, 0.35 + Math.PI * 1.5]) { g.moveTo(0, 0); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); } g.stroke(); }
    if (dt < 0.7) { g.globalCompositeOperation = dark ? 'lighter' : 'source-over'; g.lineWidth = 2.2; const run = clamp(dt / 0.55) * 1.25, k = 1 - clamp((dt - 0.4) / 0.3);
      for (const ray of G.rays) { g.beginPath(); let st = false; for (const p of ray.pts) { if (p[2] < run - 0.14 || p[2] > run) continue; st ? g.lineTo(p[0] * Rr, p[1] * Rr) : g.moveTo(p[0] * Rr, p[1] * Rr); st = true; } g.strokeStyle = rgba(hot, 0.8 * k); g.stroke(); } }
    g.restore(); } } });
const GSNAP = makeCanvas(16, 16) as HTMLCanvasElement;
/** when a piece leaves: a few hundredths of a second after the blow, the ones nearest it first */
const burstAt = (sh: { r0: number; delay: number }) => 0.03 + sh.r0 * 0.07 + sh.delay * 0.12;
register({ id: 'glass-shards', label: 'fx.glass', layer: 'foreground', kind: 'effect', z: 0, draw(g, f) {
  if (!f.style.fx.glass) return; const t = f.t, act = f.plan.cues.glass.filter(ev => t >= ev.t && t - ev.t <= 2.2); if (!act.length) return;
  const w = f.W, h = f.H, cv = g.canvas as HTMLCanvasElement; if (GSNAP.width !== cv.width || GSNAP.height !== cv.height) { GSNAP.width = cv.width; GSNAP.height = cv.height; }
  const sg = C2(GSNAP); sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, cv.width, cv.height); sg.drawImage(cv, 0, 0);
  const roll = f.cam.fx.r - f.cam.cont.r, zoom = f.cam.fx.z, Mbg = new DOMMatrix().translate(w / 2, h / 2).rotate(roll).scale(zoom).translate(-w / 2, -h / 2), inv = Mbg.inverse(), dark = f.pal.dark;
  const light = dark ? mix(f.pal.text, [255, 255, 255], 0.2) : mix(f.pal.text, f.pal.bg, 0.35);
  for (const ev of act) { const dt = t - ev.t, G = glassGeom(ev), Rr = Math.hypot(w, h) * 0.5 * ev.size, cx = ev.x * w, cy = ev.y * h, reach = sstep(clamp(dt / 0.07)) * 1.2, fade = 1 - clamp((dt - 0.9) / 1.2), split = sstep(clamp(dt / 0.08)) * 0.035;
    g.save(); g.transform(Mbg.a, Mbg.b, Mbg.c, Mbg.d, Mbg.e, Mbg.f); g.globalCompositeOperation = 'multiply';
    for (const sh of G.shards) { if (sh.r0 > reach) continue; const st = Math.max(0, dt - burstAt(sh)), gone = sstep(clamp(st / 0.25)) * fade * (1 - clamp((st - 0.9) / 0.8)); if (gone < 0.01) continue;
      g.globalAlpha = (dark ? 0.3 : 0.14) * gone; g.fillStyle = rgba(mix(f.pal.bg, K3, dark ? 0.5 : 0.35), 1); g.beginPath(); sh.poly.forEach((p: number[], k: number) => { const x = cx + p[0] * Rr, y = cy + p[1] * Rr; k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill(); }
    g.restore();
    // a blow, not a peel: every piece is struck out from the point of impact at once (the inner ones a hair first), flies
    // outward fast and slows (air), drops a little, tumbles, and the pieces near the blow come toward the camera
    for (const sh of G.shards) { if (sh.r0 > reach) continue; const st = Math.max(0, dt - burstAt(sh)), op = fade * (1 - clamp(st / 1.1)) * clamp((reach - sh.r0) / 0.2); if (op <= 0.01) continue;
      const cl = Math.hypot(sh.c[0], sh.c[1]) || 1, ux = sh.c[0] / cl, uy = sh.c[1] / cl, v0 = (1.1 + 1.4 * (1 - clamp(sh.r0 / 0.8))) * Rr, run = v0 * (1 - Math.exp(-st * 5)) / 5;
      const ox = cx + sh.c[0] * Rr, oy = cy + sh.c[1] * Rr, dx = sh.c[0] * Rr * split + ux * run, dy = sh.c[1] * Rr * split + uy * run + st * st * h * 0.5, near = 1 + st * 1.3 * (1 - clamp(sh.r0 / 0.6));
      const M = Mbg.multiply(new DOMMatrix().translate(ox + dx, oy + dy).rotate(sh.vr * st * 57.3 * 2.4).scale(near).translate(-ox, -oy));
      g.save(); g.transform(M.a, M.b, M.c, M.d, M.e, M.f); g.beginPath(); sh.poly.forEach((p: number[], k: number) => { const x = cx + p[0] * Rr, y = cy + p[1] * Rr; k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
      g.save(); g.clip(); g.save(); g.transform(inv.a, inv.b, inv.c, inv.d, inv.e, inv.f); g.globalAlpha = 0.8 * op; g.drawImage(GSNAP, 0, 0, cv.width, cv.height, 0, 0, w, h); g.restore();
      const ex = sh.poly.reduce((m: number, p: number[]) => Math.max(m, Math.hypot(p[0] - sh.c[0], p[1] - sh.c[1])), 0) * Rr, band = -0.6 + ((st * 0.9 + rnd(sh.c[0] * 31 + sh.c[1] * 17) * 0.6) % 1.6);
      const sgd = g.createLinearGradient(ox - ex, oy - ex, ox + ex, oy + ex), b0 = clamp(band + 0.5);
      sgd.addColorStop(0, 'rgba(255,255,255,0)'); sgd.addColorStop(clamp(b0 - 0.08), 'rgba(255,255,255,0)'); sgd.addColorStop(b0, `rgba(255,255,255,${(dark ? 0.32 : 0.45) * op})`); sgd.addColorStop(clamp(b0 + 0.08), 'rgba(255,255,255,0)'); sgd.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalCompositeOperation = dark ? 'screen' : 'source-over'; g.globalAlpha = 1; g.fillStyle = sgd; g.fillRect(ox - ex, oy - ex, ex * 2, ex * 2); g.restore();
      g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.45 * op; g.strokeStyle = rgba(mix(f.pal.bg, K3, 0.55), 1); g.lineWidth = 1.8; g.stroke();
      g.globalCompositeOperation = dark ? 'screen' : 'soft-light'; g.globalAlpha = 0.6 * op; g.strokeStyle = rgba(mix(light, [255, 255, 255], 0.4), 1); g.lineWidth = 1; g.stroke(); g.restore(); } } } });

/* ---------- glyph contours: one character of the current line, traced as vector outline rings, huge behind it ---------- */
const KEYCH = new WeakMap<PLine, string | null>();
function keyChar(P: PLine) {
  if (KEYCH.has(P)) return KEYCH.get(P)!; let best: any = null; for (const S of P.words) if (!best || S.lw * S.lh > best.lw * best.lh) best = S;
  const cands = best ? graphemes(best.w.text).filter((ch: string) => !/[\p{P}\p{S}\s]/u.test(ch)) : [];
  const c = cands.length ? (isLatin(cands[0]) ? cands[0].toUpperCase() : cands[Math.floor(rnd(P.i * 3.3) * Math.min(cands.length, 3))]) : null; KEYCH.set(P, c); return c;
}
/* The glyph as a mid-ground drawing, not as type: three loose layers kept as bitmaps (a broken, gestural contour in a
   brush's rhythm of long and short strokes; a finer echo a little larger and turned; a faint wash of its shape), in a
   muted mix of the theme's light and its ground — never the lyrics' ink, never as bright. It lives in the lyric world a
   good way behind the words (so it slides against both the words and the backdrop as the camera moves) and its layers
   drift and breathe apart a little, so it reads as depth rather than as a stamp. */
const GLY = new Map<string, { L: (HTMLCanvasElement | OffscreenCanvas)[]; S: number }>();
function glyphLayers(ch: string, w: number, stack: string, col: string) {
  const key = ch + '|' + w + stack + '|' + col; let e = GLY.get(key); if (e) return e;
  const R = 720, font = `${w} ${R}px ${stack}`;
  // (drawn only once the face is really there: a fallback face must not be kept, nor redrawn every frame meanwhile)
  if (typeof document !== 'undefined' && document.fonts && !document.fonts.check(font, ch)) { document.fonts.load(font, ch).catch(() => {}); return null; }
  const S = Math.round(R * 1.6), L: (HTMLCanvasElement | OffscreenCanvas)[] = [];
  const mk = (draw: (g: CanvasRenderingContext2D) => void) => { const c = makeCanvas(S, S); const g = C2(c) as CanvasRenderingContext2D; g.translate(S / 2, S / 2);
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = col; g.fillStyle = col; draw(g); L.push(c); };
  // the gesture: long strokes broken by short ones and gaps, slightly soft
  mk(g => { g.filter = 'blur(1.4px)'; g.lineWidth = R * 0.0065; g.setLineDash([R * 0.21, R * 0.05, R * 0.035, R * 0.11, R * 0.12, R * 0.07]); g.strokeText(ch, 0, 0);
    g.globalAlpha = 0.5; g.lineWidth = R * 0.0028; g.setLineDash([R * 0.06, R * 0.16]); g.lineDashOffset = R * 0.09; g.rotate(-0.012); g.strokeText(ch, R * 0.006, -R * 0.004); });
  // the echo: finer, a little larger, sparser
  mk(g => { g.filter = 'blur(0.8px)'; g.scale(1.07, 1.07); g.rotate(0.03); g.lineWidth = R * 0.0026; g.setLineDash([R * 0.04, R * 0.1, R * 0.015, R * 0.06]); g.strokeText(ch, 0, 0); });
  // the wash: the shape as mist
  mk(g => { g.filter = `blur(${Math.round(R * 0.035)}px)`; g.fillText(ch, 0, 0); });
  e = { L, S: S / R }; GLY.set(key, e); if (GLY.size > 24) GLY.delete(GLY.keys().next().value!); return e;
}
register({ id: 'glyph', label: 'fx.glyph', layer: 'world-back', kind: 'effect', z: 0, params: [{ key: 'contrast', label: 'p.contrast', kind: 'range', min: 0.3, max: 2, step: 0.05, def: 1 }],
  draw(g, f, a) {
    const t = f.t, ov = f.cam.ov, base = (f.pal.dark ? 0.16 : 0.12) * +a.params.contrast, fc = fontStack(f.style.font), col = rgba(mix(mix(f.pal.accent, f.pal.text, 0.25), f.pal.bg, 0.3), 1), TR_IN = 0.4;
    for (const sl of f.plan.cues.glyphSlots) {
      if (t < sl.t - 0.2 || t > sl.end + 1.8) continue; const P = sl.line, ch = keyChar(P); if (!ch) continue;
      const fin = eSine(clamp((t - sl.t + 0.2) / 1.8)), fout = sl.cut ? 1 - sstep(clamp((t - (sl.end - TR_IN)) / TR_IN)) : 1 - eSine(clamp((t - sl.end + 0.2) / 1.8));
      const al = base * fin * fout * (1 - ov) * f.view.effect; if (al < 0.004) continue;
      const side = sl.side ? 1 : -1, d = [Math.cos(P.prot * D2R), Math.sin(P.prot * D2R)], X = P.ax + d[0] * side * P.bw * 0.2, Y = P.ay + d[1] * side * P.bw * 0.2;
      const p = project(X, Y, P.d + 700, f.cam.cam, f.cam.fx, f.W, f.H), size = Math.max(P.bh * 3.4, 1300) * p.k * 0.7 * (0.96 + 0.04 * fin);
      const ly = glyphLayers(ch, fc.w, fc.stack, col); if (!ly) continue; const rot0 = (P.prot + p.rot + (rnd(P.i * 2.3) - 0.5) * 10) * D2R;
      const cx = f.W / 2 + p.sx + Math.sin(t * 0.37 + P.i) * 60 * p.k, cy = f.H / 2 + p.sy + Math.cos(t * 0.31 + P.i * 1.7) * 45 * p.k;
      // each layer: its own slow drift, turn and breath (the wash furthest back moves least)
      const lay = [{ a: 1, dx: 0, dy: 0, r: Math.sin(t * 0.23 + P.i) * 0.035, s: 1 },
        { a: 0.8 * (0.75 + 0.25 * Math.sin(t * 0.6 + P.i)), dx: Math.sin(t * 0.29 + 1 + P.i) * 0.018, dy: Math.cos(t * 0.21 + P.i) * 0.014, r: Math.sin(t * 0.17 + 2 + P.i) * 0.05, s: 1 + 0.015 * Math.sin(t * 0.4 + P.i) },
        { a: 0.55, dx: -Math.sin(t * 0.19 + P.i) * 0.01, dy: 0, r: 0, s: 0.98 }];
      for (let i = 2; i >= 0; i--) { const q = lay[i], c = ly.L[i], w = size * ly.S * q.s;
        g.save(); g.translate(cx + q.dx * size, cy + q.dy * size); g.rotate(rot0 + q.r); g.globalAlpha = al * q.a; g.drawImage(c as CanvasImageSource, -w / 2, -w / 2, w, w); g.restore(); }
    } } });

/* ---------- lyric frames: an outline traced round part of a line, with corner ticks, following the words' depth ---------- */
register({ id: 'frame', label: 'fx.frame', layer: 'world-back', kind: 'effect', z: 2, draw(g, f) {
  // a frame encloses all its words, on screen or not (its shape must not depend on what the culling keeps)
  const vis = f.vis || [], byS = new Map(vis.map(v => [v.S, v])), t = f.t, ink = f.ink;
  const seen = new Set<any>();
  for (const v0 of vis) { const F = v0.S.frame; if (!F || seen.has(F) || t < F.ts) continue; seen.add(F);
    const o = Math.max(...F.words.map(S => byS.get(S)?.o ?? 0)) * f.view.effect; if (o < 0.02) continue;
    const pj = F.words.map(S => ({ S, p: project(S.x, S.y, S.d, f.cam.cam, f.cam.fx, f.W, f.H) }));
    const boxes = pj.map(({ S, p }) => ({ x: p.sx, y: p.sy, lw: S.lw * p.k, lh: S.lh * p.k, tilt: S.tilt + p.rot }));
    const vv = [{ S: F.words[0], p: pj[0].p }];
    const L = vv[0].S.line, B = boxIn(boxes, L.prot + vv[0].p.rot), padd = Math.min(...boxes.map(b => b.lh)) * 0.3, w = B.w + padd * 2, h = B.h + padd * 2, per = 2 * (w + h);
    const dt = t - F.ts, p = eOut(clamp(dt / 0.85)), tEnd = L.L.end - 0.8, q = 1 - eIO(clamp((t - tEnd) / 0.8)), vis1 = p * q; if (vis1 <= 0.002) continue;
    const fl = Math.sin(t * 0.9 + L.i) * 0.5, s1 = 1 + 0.012 * Math.sin(t * 1.3 + L.i * 2);
    g.save(); g.translate(f.W / 2 + B.x + Math.sin(t * 0.7 + L.i) * padd * 0.08, f.H / 2 + B.y + Math.cos(t * 0.6 + L.i) * padd * 0.08); g.rotate((L.prot + vv[0].p.rot + fl) * D2R); g.scale(s1, s1);
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
function sparkle(g: Ctx, x: number, y: number, r: number, rot: number) { g.save(); g.translate(x, y); g.rotate(rot); g.beginPath(); g.moveTo(0, -r); g.quadraticCurveTo(0, 0, r * 0.72, 0); g.quadraticCurveTo(0, 0, 0, r); g.quadraticCurveTo(0, 0, -r * 0.72, 0); g.quadraticCurveTo(0, 0, 0, -r); g.fill(); g.restore(); }
register({ id: 'stars', label: 'fx.stars', layer: 'world-front', kind: 'effect', draw(g, f) {
  const t = f.t, tempo = Math.sqrt(clamp(f.plan.map.beatLen(t) / 0.5, 0.5, 2)), FLY = 0.75 * tempo, POP = 0.22 * tempo, far = Math.max(f.W, f.H) * 0.85, col = f.pal.dark ? mix(f.pal.flash, [255, 255, 255], 0.35) : f.pal.accent;
  g.save(); g.globalCompositeOperation = f.pal.dark ? 'lighter' : 'source-over'; g.fillStyle = rgba(col, 1);
  for (const P of f.plan.lines) { if (P.L.t > t + FLY + 0.05) break; if (isFinite(P.secEnd) && t > P.secEnd - 0.4) continue;
    for (const S of P.words) { const dt = t - S.show; if (dt < -FLY || dt > POP) continue; if (rnd(P.i * 3.7 + S.k * 1.9) > 0.6) continue;
      const p = project(S.x, S.y, S.d, f.cam.cam, f.cam.fx, f.W, f.H), a0 = rnd(P.i * 9.1 + S.k * 4.3) * 6.283, bend = (rnd(P.i * 2.2 + S.k) < 0.5 ? 1 : -1) * (0.25 + rnd(P.i + S.k * 5.5) * 0.35);
      const side = rnd(P.i * 6.1 + S.k * 2.7) * 6.283, Rw = Math.hypot(S.lw, S.lh) * 0.5 * p.k * (1.05 + 0.4 * rnd(P.i * 1.3 + S.k * 8.9));
      const tx = f.W / 2 + p.sx + Math.cos(side) * Rw, ty = f.H / 2 + p.sy + Math.sin(side) * Rw * 0.7, sx = tx + Math.cos(a0) * far, sy = ty + Math.sin(a0) * far, mx = (sx + tx) / 2 - Math.sin(a0) * far * bend, my = (sy + ty) / 2 + Math.cos(a0) * far * bend;
      const r = Math.max(13, S.lh * p.k * 0.12), at = (u: number) => { const e = u * u * (3 - 2 * u) * 0.4 + u * u * 0.6, k = 1 - e; return [k * k * sx + 2 * k * e * mx + e * e * tx, k * k * sy + 2 * k * e * my + e * e * ty]; };
      if (dt < 0) { const u = clamp((dt + FLY) / FLY), env = sstep(clamp(u / 0.25)) * f.view.effect;
        for (let k = 10; k >= 1; k--) { const [x, y] = at(Math.max(0, u - k * 0.018)); g.globalAlpha = env * 0.4 * (1 - k / 11); g.beginPath(); g.arc(x, y, Math.max(0.5, r * 0.25 * (1 - k / 12)), 0, 6.283); g.fill(); }
        const [x, y] = at(u); g.globalAlpha = env; sparkle(g, x, y, r * (0.8 + 0.2 * u), t * 6); }
      else { const u = dt / POP; g.globalAlpha = (1 - u) ** 2 * 0.9 * f.view.effect; sparkle(g, tx, ty, r * (1 + 0.35 * Math.sin(u * Math.PI)), t * 6); } } }
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
