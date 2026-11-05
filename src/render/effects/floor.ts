// The floor grid (the ground, under every other backdrop effect) and the spectrum.
import { clamp } from '../../core/math';
import { eOut } from '../../core/ease';
import { rgba } from '../../core/color';
import { register, atMid } from './registry';

/* ---------- floor grid (the ground, under every other backdrop effect) and spectrum ---------- */
register({ id: 'grid', label: 'fx.grid', layer: 'backdrop', kind: 'effect', z: 3, draw: atMid((g, f, a) => {
  const E = a.bd.E, w = f.W, h = f.H, hy = h * 0.66, mx = w / 2, A = f.pal.accent, I = f.I, P = f.P, t = f.t, brk = Math.max(0, t - (f.plan.musicEnd - 3.5));
  g.save(); g.beginPath(); g.rect(-E, hy, w + 2 * E, h - hy + E); g.clip(); const off = brk <= 0 ? eOut(f.rs.phase) : (t * 0.7) % 1, NL = 16;
  for (let j = 0; j < NL; j++) { const z = (j + off) / NL, y = hy + (h + E * 0.5 - hy) * z ** 2.3; g.strokeStyle = rgba(A, z * (0.14 + 0.24 * I) * (0.7 + 0.6 * P)); g.lineWidth = 0.6 + z * 1.6;
    g.setLineDash(brk ? [w * 0.03 * (1 + z * 3), brk * w * 0.012 * (0.3 + z)] : []); g.beginPath(); g.moveTo(-E, y); g.lineTo(w + E, y); g.stroke(); }
  g.setLineDash([]); g.lineWidth = 1; g.strokeStyle = rgba(A, (0.06 + 0.1 * I) * (1 - clamp(brk / 6) * 0.7));
  g.beginPath(); for (let k = -40; k <= 40; k++) { g.moveTo(mx + k * w * 0.012, hy); g.lineTo(mx + k * w * 0.165, h + E * 0.5); } g.stroke(); g.restore();
  g.fillStyle = rgba(A, 0.3 + 0.45 * I * (0.6 + 0.4 * P)); g.fillRect(-E, hy - 1, w + 2 * E, 2); }) });
/* the spectrum: the song's own (the analysis's coarse bands, low in the middle to high at the sides), so the bars move
   with what is really playing; a small, steady texture between neighbouring bars; the pulse only without analysis */
const SPEC: number[] = [];
register({ id: 'eq', label: 'fx.eq', layer: 'backdrop', kind: 'effect', z: 15, draw: atMid((g, f, a) => {
  const E = a.bd.E, w = f.W, h = f.H, hy = h * 0.66, bw = w / 48, i0 = -Math.ceil(E / bw), i1 = 48 + Math.ceil(E / bw), A = f.pal.accent, I = f.I, P = f.P, t = f.t;
  const sp = f.plan.map.spec(t, SPEC), nb = sp ? sp.length : 0;
  for (let i = i0; i < i1; i++) { const fq = Math.min(1, Math.abs(i - 23.5) / 24);
    let v: number;
    if (sp && nb) { const x = fq * (nb - 1), k = Math.floor(x), u = x - k, b = sp[k] * (1 - u) + sp[Math.min(nb - 1, k + 1)] * u, tex = 0.88 + 0.12 * Math.sin(i * 2.17 + Math.floor(t * 8) * 0.9);
      v = b * tex * (0.55 + 0.45 * I); }
    else v = (0.25 + 0.75 * I) * (P * (1 - fq) * 0.9 + 0.35 * Math.abs(Math.sin(t * 2.7 + i * 0.9)) * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.37 + t * 0.8))));
    const bh = v * h * 0.13;
    g.fillStyle = rgba(A, 0.1 + 0.3 * P * (1 - fq * 0.5)); g.fillRect(i * bw + 1, hy - bh, bw - 2, bh); g.fillStyle = rgba(A, 0.035); g.fillRect(i * bw + 1, hy, bw - 2, bh * 0.6); } }) });
