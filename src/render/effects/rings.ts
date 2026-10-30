// Beat rings and the subwoofer orb: launched on the rhythm's events, from the words, the cover or the picture's centre.
import { clamp } from '../../core/math';
import { mix, rgba, type RGB } from '../../core/color';
import { register, type Ctx } from './registry';
import type { RenderFrame } from '../frame';

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
