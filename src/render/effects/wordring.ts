// Word rings (字環): now and then a word comes in over a ring under it, on the word's own plane, each its own size.
// Two looks: a ripple (rings spreading out and fading, trembling as they go — their edge shivers in a few waves, the
// beat's pulse shaking it a little more) or a halo (a clean, regular ring of light with turning arcs and ticks). Under
// the words (world-back), at the word's depth.
import { clamp } from '../../core/math';
import { eOut } from '../../core/ease';
import { rnd } from '../../core/rng';
import { rgba } from '../../core/color';
import { register, type Ctx } from './registry';
import type { RenderFrame } from '../frame';
import { wordPlacement } from '../../director/words';

const LIFE = 1.9; // seconds a ripple lasts
const SEG = 72; // points round a ring
register({
  id: 'wordring',
  label: 'fx.wordring',
  layer: 'world-back',
  kind: 'effect',
  z: 1,
  params: [
    { key: 'amount', label: 'p.amount', kind: 'range', min: 0.1, max: 1, step: 0.05, def: 0.3 },
    {
      key: 'look',
      label: 'p.look',
      kind: 'select',
      options: [
        ['ripple', 'p.look.ripple'],
        ['halo', 'p.look.halo'],
      ],
      def: 'ripple',
    },
  ],
  draw(g, f, a) {
    const t = f.t,
      amt = clamp(+a.params.amount, 0, 1),
      pulse = f.rs.pulse,
      ink = f.ink,
      halo = a.params.look === 'halo';
    for (const v of f.vis || []) {
      const S = v.S,
        t0 = S.w.t,
        dt = t - t0;
      if (dt < 0 || dt > LIFE) continue;
      // (which words: a fixed draw per word — the same in the preview and the export)
      if (rnd(S.seed * 1.7 + 0.3) >= amt) continue;
      const o = v.o * f.view.effect;
      if (o < 0.02) continue;
      const w = wordPlacement(S, v.p, v.ws),
        size = Math.max(S.lw, S.lh) * w.k;
      const big = 0.9 + 2.4 * rnd(S.seed * 3.1 + 7) ** 1.5,
        ph = rnd(S.seed * 9.7) * 6.283,
        waves = 3 + Math.floor(rnd(S.seed * 5.3) * 4);
      g.save();
      g.translate(f.W / 2 + w.x, f.H / 2 + w.y);
      // (the halo is sized by the characters, not the word: one character's height, CH)
      if (halo) {
        drawHalo(g, f, S.lh * w.k, rnd(S.seed * 3.1 + 7), dt, o, pulse, S.seed);
        g.restore();
        continue;
      }
      g.strokeStyle = rgba(ink, 1);
      g.lineJoin = 'round';
      // two or three rings, one after another, each spreading out and fading; the edge trembles, less as it widens
      const n = 2 + (rnd(S.seed * 2.3) < 0.5 ? 1 : 0);
      for (let r = 0; r < n; r++) {
        const u = (dt - r * 0.16) / (LIFE - r * 0.16);
        if (u <= 0 || u >= 1) continue;
        const R = size * (0.35 + big * eOut(u)),
          fade = (1 - u) ** 1.6 * Math.min(1, u * 8);
        const shake = size * (0.035 + 0.05 * pulse) * (1 - u) ** 0.8,
          sp = 9 + r * 3;
        g.globalAlpha = o * fade * (0.5 - r * 0.12);
        g.lineWidth = Math.max(1, size * 0.028 * (1 - u * 0.6));
        g.beginPath();
        for (let i = 0; i <= SEG; i++) {
          const th = (i / SEG) * 6.283;
          const rr =
            R +
            shake *
              (Math.sin(th * waves + ph + t * sp) * 0.7 + Math.sin(th * (waves * 2 + 1) - t * sp * 1.4 + ph * 2) * 0.3);
          const x = Math.cos(th) * rr,
            y = Math.sin(th) * rr * 0.92;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.closePath();
        g.stroke();
      }
      g.restore();
    }
  },
});

/* The halo look: the same moment drawn as a clean, regular light ring — a bright ring that opens fast and holds, its
   glow under it, an outer ring of three arcs turning one way and a ring of fine ticks turning the other, all breathing
   a little on the beat; perfectly round (no trembling), lit (added light on a dark picture), in the theme's accent.
   Its size, across the outer arcs, is HALO_MIN to HALO_MAX times a character's height (`ch`), each word's its own in
   that range (`k`, 0..1); it opens from the smallest. */
export const HALO_MIN = 1.3,
  HALO_MAX = 2.5;
/** The outer arcs' radius to the core ring's (the halo's outer edge, which its size is measured across). */
const ARCS = 1.3;
/** The core ring's radius: the outer edge (the arcs) HALO_MIN..HALO_MAX characters across at its full size (k: which
 *  in that range), opening from the smallest; the beat's breath (pulse 0..1) kept inside the largest. */
export function haloRadius(ch: number, k: number, open: number, pulse: number) {
  const rMin = (ch * HALO_MIN) / (2 * ARCS),
    rMax = (ch * HALO_MAX) / (2 * ARCS * 1.04);
  return (rMin + (rMax - rMin) * clamp(k) * clamp(open)) * (1 + 0.04 * clamp(pulse));
}
export const HALO_ARCS = ARCS;
function drawHalo(g: Ctx, f: RenderFrame, ch: number, k: number, dt: number, o: number, pulse: number, seed: number) {
  const u = dt / LIFE,
    open = eOut(clamp(u * 2.4)),
    fade = Math.min(1, u * 10) * (1 - u) ** 1.3,
    A = o * fade;
  if (A < 0.01) return;
  const size = ch,
    R = haloRadius(ch, k, open, pulse),
    col = f.pal.accent,
    lit = f.pal.dark,
    sq = 0.92,
    dir = rnd(seed * 4.1) < 0.5 ? -1 : 1;
  const ring = (r: number, a0 = 0, a1 = Math.PI * 2) => {
    g.beginPath();
    g.ellipse(0, 0, r, r * sq, 0, a0, a1);
    g.stroke();
  };
  g.globalCompositeOperation = lit ? 'lighter' : 'source-over';
  g.lineCap = 'round';
  g.strokeStyle = rgba(col, 1);
  // the core ring and its glow (two strokes, wide and faint under thin and bright: a glow without a blur)
  g.globalAlpha = A * 0.16;
  g.lineWidth = size * 0.1;
  ring(R);
  g.globalAlpha = A * 0.32;
  g.lineWidth = size * 0.045;
  ring(R);
  g.strokeStyle = rgba([255, 255, 255], 1);
  g.globalAlpha = A * (lit ? 0.85 : 0.6);
  g.lineWidth = Math.max(1, size * 0.016);
  ring(R);
  // the outer arcs, turning
  g.strokeStyle = rgba(col, 1);
  g.globalAlpha = A * 0.7;
  g.lineWidth = Math.max(1, size * 0.012);
  const R2 = R * ARCS,
    rot = dir * (dt * 1.1 + seed);
  for (let k = 0; k < 3; k++) {
    const a0 = rot + (k * Math.PI * 2) / 3;
    ring(R2, a0, a0 + 1.25);
  }
  // the ticks, turning the other way
  g.globalAlpha = A * 0.55;
  g.lineWidth = Math.max(1, size * 0.008);
  g.beginPath();
  const n = 36,
    r0 = R * 1.1,
    r1 = R * 1.17,
    rt = -dir * dt * 0.5;
  for (let k = 0; k < n; k++) {
    const th = rt + (k / n) * Math.PI * 2,
      e = k % 3 ? 1 : 1.6,
      c = Math.cos(th),
      sn = Math.sin(th);
    g.moveTo(c * r0, sn * r0 * sq);
    g.lineTo(c * (r0 + (r1 - r0) * e), sn * (r0 + (r1 - r0) * e) * sq);
  }
  g.stroke();
  g.globalCompositeOperation = 'source-over';
}
