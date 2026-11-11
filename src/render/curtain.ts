// Curtains: openings asked for in the lyrics ('@N'), for cutting a video — curtain N is over the whole picture at once
// a little before that moment (no fade in: the cut lands on it), holds a moment, then draws open on a cubic ease (its
// start as quick as ever, its end drawn out — director/curtains.ts).
// The curtain is the flash colour; what it opens onto is the background colour, the picture showing through once the
// opening fills the frame; the words on screen fade in while it opens. A new curtain is one more entry in CURTAINS.
import { clamp, sstep } from '../core/math';
import { rgba } from '../core/color';
import type { Ctx } from './effects/registry';
import type { RenderFrame } from './frame';
import { CURTAIN_TIMES, curtainDown } from '../director/curtains';

interface Curtain {
  /** the opening's shape at e (0 closed .. 1 open past the frame's corners), as a path on g (W×H picture) */
  shape(g: Ctx, W: number, H: number, e: number): void;
  /** how large the opening is at e (its own measure, for the shadow along its edge) */
  size(W: number, H: number, e: number): number;
}
/** The star's notch radius to its point radius: 0.5, a broad star whose notches between the points are obtuse (the
 *  reference's shape — a regular pentagram's 0.382 makes them sharp and the star thin). */
const INNER = 0.5;
/** A five-pointed star (point up) of point radius R round (cx, cy). */
function star(g: Ctx, cx: number, cy: number, R: number) {
  const r = R * INNER;
  g.moveTo(cx, cy - R);
  for (let i = 1; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5,
      q = i % 2 ? r : R;
    g.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q);
  }
  g.closePath();
}
export const CURTAINS: Record<number, Curtain> = {
  /** 1: a star opening from a small one a little above the middle until it covers the whole picture (its notches
   *  past the frame's corners); it grows by the same ratio each moment, on its timing's curve (director/curtains.ts) */
  1: {
    size(W, H, e) {
      const far = Math.hypot(W / 2, Math.max(H * 0.46, H * 0.54)),
        r0 = H * 0.035,
        r1 = (far / INNER) * 1.04;
      return r0 * (r1 / r0) ** e;
    },
    shape(g, W, H, e) {
      star(g, W / 2, H * 0.46, this.size(W, H, e));
    },
  },
};

/** The curtain at f.t, if one is up: which, and how far it has opened (e: 0 closed .. 1 open; u: the opening's own time). */
export function curtainAt(f: RenderFrame): { c: Curtain; e: number; u: number } | null {
  let best: { c: Curtain; e: number; u: number } | null = null;
  for (const q of f.plan.doc.curtains || []) {
    const c = CURTAINS[q.kind],
      T = CURTAIN_TIMES[q.kind];
    if (!c || !T) continue;
    const dt = f.t - curtainDown(q.kind, q.t)!;
    if (dt < 0 || dt >= T.hold + T.open) continue;
    const u = clamp((dt - T.hold) / T.open);
    best = { c, e: T.ease(u), u };
  }
  return best;
}
/** How much of the words shows under a curtain: none while it is closed, fading in as it opens. */
export const curtainWords = (cu: ReturnType<typeof curtainAt>) => (cu ? sstep(cu.u) : 1);
/** Under the words: the background colour over the picture inside the opening, the picture showing through at the end. */
export function drawCurtainGround(g: Ctx, f: RenderFrame, cu: NonNullable<ReturnType<typeof curtainAt>>) {
  const k = 1 - sstep(clamp((cu.e - 0.72) / 0.28));
  if (k < 0.003) return;
  g.save();
  g.fillStyle = rgba(f.pal.bg, k * f.view.effect);
  g.fillRect(0, 0, f.W, f.H);
  g.restore();
}
/** Over everything: the curtain, in the flash colour, with the opening cut out of it. */
export function drawCurtain(g: Ctx, f: RenderFrame, cu: NonNullable<ReturnType<typeof curtainAt>>) {
  if (cu.e >= 1) return;
  const curtain = () => {
    g.beginPath();
    g.rect(-f.W, -f.H, f.W * 3, f.H * 3);
    cu.c.shape(g, f.W, f.H, cu.e);
  };
  // inside the opening, a soft shadow along its edge (the curtain has a thickness, the picture lies a little behind
  // it): the curtain filled once more under a clip to the opening — only its shadow, falling inward, is left
  {
    const sz = cu.c.size(f.W, f.H, cu.e),
      b = clamp(sz * 0.07, 4, f.H * 0.06);
    g.save();
    g.beginPath();
    cu.c.shape(g, f.W, f.H, cu.e);
    g.clip();
    g.shadowColor = `rgba(0,0,0,${(0.62 * f.view.effect).toFixed(3)})`;
    g.shadowBlur = b * f.px;
    g.shadowOffsetX = 0;
    g.shadowOffsetY = b * 0.35 * f.px;
    g.fillStyle = '#000';
    curtain();
    g.fill('evenodd');
    // (and on a dark ground, where a shadow cannot show: a faint glow of the curtain's own colour just inside its edge)
    if (f.pal.dark) {
      g.shadowColor = rgba(f.pal.flash, 0.3 * f.view.effect);
      g.shadowBlur = b * 0.7 * f.px;
      g.shadowOffsetY = -b * 0.12 * f.px;
      curtain();
      g.fill('evenodd');
    }
    g.restore();
  }
  g.save();
  g.fillStyle = rgba(f.pal.flash, f.view.effect);
  curtain();
  g.fill('evenodd');
  g.restore();
}
