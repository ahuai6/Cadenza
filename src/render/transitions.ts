/* The transitions between passages: what the finished picture does while the camera moves somewhere new. The director
   decides when (its passages: a rise to the cut, the cut at the peak, a clearing after); a transition only decides how
   it looks, so a style picks any of them, and a new one is a registration here. Cadenza's own is the frosted blur
   (post.ts); the other three are Folia's Sonnet scene transitions (fast blur, monochrome tear, fade), drawn over the
   whole frame from the same easing and the same numbers. */
import { clamp } from '../core/math';
import { hexOf, mix } from '../core/color';
import { drawTransition } from './post';
import { gfx, cheapBlurDraw } from './gfx';
import { makeCanvas } from './palette';
import type { RenderFrame } from './frame';
import type { Ctx } from './effects/registry';
import type { Passage } from '../director/types';

/** Where a frame is in a transition: how far in (k, 0..1, the director's own curve), which side of the cut, and how far
 *  through that side (0..1, linear). */
export interface TransPhase {
  k: number;
  phase: 'exit' | 'enter';
  p: number;
  /** the passage's index (a seed for anything drawn per transition) */
  i: number;
}
export function transPhase(passages: Passage[], t: number): TransPhase | null {
  let best: TransPhase | null = null;
  passages.forEach((ps, i) => {
    const x = t - ps.t;
    if (x < -ps.inn || x > ps.out) return;
    const exit = x < 0,
      u = exit ? (x + ps.inn) / ps.inn : 1 - x / ps.out,
      k = u * u * (3 - 2 * u);
    if (!best || k > best.k) best = { k, phase: exit ? 'exit' : 'enter', p: exit ? u : x / ps.out, i };
  });
  return best;
}

export interface Transition {
  id: string;
  /** its name in the interface (a dictionary key) */
  label: string;
  /** draws over the finished frame; k already carries the view's own fade (k ≤ the phase's own k) */
  draw(g: Ctx, f: RenderFrame, k: number, ph: TransPhase): void;
}
const REG = new Map<string, Transition>();
export function registerTransition(t: Transition) {
  REG.set(t.id, t);
  return t;
}
/** The transition by id; an unknown one is the frosted blur. */
export const transition = (id: string | undefined) => REG.get(id || '') ?? REG.get('frost')!;
export const transitions = () => [...REG.values()];

/** The colour the picture clears into: the song's own background. */
const ground = (f: RenderFrame) => hexOf(mix(f.pal.bg, f.pal.bg2, 0.4));
function veil(g: Ctx, f: RenderFrame, a: number) {
  if (a <= 0.003) return;
  const cv = g.canvas as HTMLCanvasElement;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = clamp(a);
  g.fillStyle = ground(f);
  g.fillRect(0, 0, cv.width, cv.height);
  g.restore();
}
// Folia's sonnet easing (easeSonnetInOut) — the transitions take their amount from it, not from the director's curve
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** Folia's amount: rising to the cut, falling after it. */
const amountOf = (ph: TransPhase) => (ph.phase === 'exit' ? easeInOut(ph.p) : 1 - easeInOut(ph.p));

/** 柔焦: Cadenza's own — the whole picture softens out of focus and back (post.ts). */
registerTransition({ id: 'frost', label: 'trf.frost', draw: (g, f, k) => drawTransition(g, f, k) });

/** 模糊: Folia's fast blur — up to 14 px of blur, the picture fading into the background as it peaks. */
registerTransition({
  id: 'blur',
  label: 'trf.blur',
  draw(g, f, k, ph) {
    const a = amountOf(ph) * (k / Math.max(ph.k, 1e-3)),
      cv = g.canvas as HTMLCanvasElement,
      r = a * 14 * f.px;
    if (gfx() !== 'lite' && r > 0.5) {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      cheapBlurDraw(g, cv, cv.width, cv.height, r, 0, 0, cv.width, cv.height, 1);
      g.restore();
    }
    veil(g, f, ph.phase === 'exit' ? a : a * 0.82);
  },
});

/** 淡出: Folia's fade — no blur, the picture dims into the background and back. */
registerTransition({
  id: 'fade',
  label: 'trf.fade',
  draw(g, f, k, ph) {
    const a = amountOf(ph) * (k / Math.max(ph.k, 1e-3));
    veil(g, f, ph.phase === 'exit' ? a : a * 0.72);
  },
});

/* 撕裂: Folia's monochrome glitch — horizontal bands of the picture torn sideways and brightened, the tear stepping 14
   times through each side; the same hash, band counts and shifts as its shader (sonnetGlitchFilter), on the frame. */
const hash = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
let snap: HTMLCanvasElement | null = null;
function tear(g: Ctx, amount: number, seed: number) {
  const cv = g.canvas as HTMLCanvasElement,
    w = cv.width,
    h = cv.height;
  if (!snap || snap.width !== w || snap.height !== h) snap = makeCanvas(w, h) as HTMLCanvasElement;
  const sc = snap.getContext('2d')!;
  sc.globalCompositeOperation = 'copy';
  sc.drawImage(cv, 0, 0);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  // (a band's shift is the coarse band's and the fine one's together — the screen is cut where either changes)
  const cut = new Set<number>([0, h]);
  for (let i = 1; i < 14; i++) cut.add(Math.round((i / 14) * h));
  for (let i = 1; i < 58; i++) cut.add(Math.round((i / 58) * h));
  const ys = [...cut].sort((a, b) => a - b);
  for (let j = 0; j < ys.length - 1; j++) {
    const y0 = ys[j],
      y1 = ys[j + 1],
      ym = (y0 + y1) / 2 / h,
      cb = Math.floor(ym * 14),
      fb = Math.floor(ym * 58),
      cn = hash(cb, seed),
      fn = hash(fb + 41, seed * 1.37),
      cg = cn >= 0.58 ? 1 : 0,
      fg = fn >= 0.88 ? 1 : 0;
    if (!cg && !fg) continue;
    const shift =
        ((hash(cb + 17, seed) * 2 - 1) * cg * amount * 0.1 + (hash(fb + 73, seed) * 2 - 1) * fg * amount * 0.037) * w,
      lift = (cg * (cn - 0.58) + fg * 0.12) * amount * 0.42,
      bh = y1 - y0;
    // (the sample is clamped at the edges, as the shader's is: the edge column stretched into the gap)
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(snap, 0, y0, w, bh, shift, y0, w, bh);
    if (shift > 0) g.drawImage(snap, 0, y0, 1, bh, 0, y0, Math.ceil(shift), bh);
    else if (shift < 0) g.drawImage(snap, w - 1, y0, 1, bh, w + shift - 1, y0, Math.ceil(-shift) + 1, bh);
    if (lift > 0.002) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = Math.min(1, lift);
      g.drawImage(cv, 0, y0, w, bh, 0, y0, w, bh);
    }
  }
  g.restore();
}
registerTransition({
  id: 'glitch',
  label: 'trf.glitch',
  draw(g, f, k, ph) {
    const a = amountOf(ph) * (k / Math.max(ph.k, 1e-3)),
      step = Math.floor(clamp(ph.p) * 14),
      seed = Math.round(f.plan.dur * 1000) * 0.0001 + ph.i * 7.31 + step * 0.173;
    if (a > 0.004) tear(g, a, seed);
    // (it fades out only at the very end of its exit, as Folia's does, so the cut never shows)
    if (ph.phase === 'exit' && ph.p > 0.86) veil(g, f, ((ph.p - 0.86) / 0.14) * (k / Math.max(ph.k, 1e-3)));
  },
});
