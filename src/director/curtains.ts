// The timing of the curtains the lyrics ask for ('@N'): when each comes down and how it opens. Part of the plan, so the
// clearing of the scene (plan.ts) and the drawing (render/curtain.ts) agree on the moment.
import { clamp } from '../core/math';

export interface CurtainTiming {
  /** how long before its stamp it comes down — time made for a slower opening that still ends where it did */ lead: number;
  /** seconds closed before it starts to open, and how long the opening takes */ hold: number; open: number;
  /** the opening's progress (0 closed .. 1 open) at u (0..1 of the opening's time) */ ease(u: number): number;
}
/** A cubic that sets off exactly as the slow-fast-slow cubic of before (e = 4τ³ over 1.25 s, so the same start), turns
 *  at 0.3 of the way, then slows down on a cubic over the rest — much longer near the end, as the opening reaches out
 *  past the frame — its speed continuous where the two meet. */
function startEnd(T0: number, turn: number) {
  const a = 4 / T0 ** 3, t1 = Math.cbrt(turn / a), v = 3 * a * t1 * t1, D = (1 - turn) * 3 / v, len = t1 + D;
  return { len, ease: (u: number) => { const tau = clamp(u) * len; return tau <= t1 ? a * tau ** 3 : turn + (1 - turn) * (1 - (1 - (tau - t1) / D) ** 3); } };
}
const STAR = startEnd(1.25, 0.3);
export const CURTAIN_TIMES: Record<number, CurtainTiming> = {
  // (opens over about 1.76 s: half a second longer than before, all of it at the end; it comes down that much earlier)
  1: { lead: STAR.len - 1.25, hold: 0.15, open: STAR.len, ease: STAR.ease },
};
/** When curtain `kind` asked for at `t` comes down (null: no such curtain). */
export const curtainDown = (kind: number, t: number) => { const c = CURTAIN_TIMES[kind]; return c ? Math.max(0, t - c.lead) : null; };
