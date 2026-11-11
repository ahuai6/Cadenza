// Timing curves. Every move in Cadenza leaves and lands at rest and never passes its target unless a curve says so.
import { clamp } from './math';

export type Ease = (u: number) => number;

export const linear: Ease = (u) => clamp(u);
export const eOut: Ease = (u) => {
  u = clamp(u);
  return 1 - (1 - u) ** 3;
};
export const eSine: Ease = (u) => Math.sin((clamp(u) * Math.PI) / 2);
export const eIO: Ease = (u) => {
  u = clamp(u);
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
};

/** CSS-style cubic Bézier timing function. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx,
    cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const X = (s: number) => ((ax * s + bx) * s + cx) * s,
    Y = (s: number) => ((ay * s + by) * s + cy) * s,
    dX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let s = u;
    for (let i = 0; i < 8; i++) {
      const e = X(s) - u,
        d = dX(s);
      if (Math.abs(e) < 1e-7) return Y(s);
      if (Math.abs(d) < 1e-6) break;
      s -= e / d;
    }
    let lo = 0,
      hi = 1;
    s = u;
    for (let i = 0; i < 30; i++) {
      const e = X(s) - u;
      if (Math.abs(e) < 1e-7) break;
      if (e > 0) hi = s;
      else lo = s;
      s = (lo + hi) / 2;
    }
    return Y(s);
  };
}

/** A spring let go from rest: it swings past the target by `over` (0.02..0.35 of the move), comes back and settles by
 *  u = 1 exactly. `force` (0.5..2.5) is how hard it is driven: a stronger spring reaches its first swing sooner. The
 *  residual of the swing at u = 1 is taken out smoothly (minimum jerk), so the move still ends exactly on its target. */
export function eSpring(force: number, over: number): Ease {
  const os = clamp(over, 0.01, 0.4),
    L = Math.log(os),
    z = -L / Math.sqrt(Math.PI * Math.PI + L * L),
    up = clamp(0.5 / Math.max(0.4, force), 0.2, 0.62);
  const wd = Math.PI / up,
    w = wd / Math.sqrt(1 - z * z),
    k = z / Math.sqrt(1 - z * z);
  const x = (u: number) => 1 - Math.exp(-z * w * u) * (Math.cos(wd * u) + k * Math.sin(wd * u)),
    r1 = 1 - x(1);
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    return x(u) + r1 * minJerk(u);
  };
}

/** Minimum-jerk profile: the smoothest way from rest to rest (zero velocity and acceleration at both ends). */
export const minJerk: Ease = (u) => {
  u = clamp(u);
  return u * u * u * (10 - 15 * u + 6 * u * u);
};

// The camera's curves: they gather speed smoothly (no instant start), peak early and settle longer.
export const eGlide = cubicBezier(0.4, 0, 0.22, 1); // smooth scrolling: an unhurried push off, a long soft landing
export const eWaltz = cubicBezier(0.36, 0, 0.2, 1); // livelier off the mark, the same soft landing
export const ePunch = cubicBezier(0.55, 0, 0.3, 1); // a brief wind-up, a decisive drive, a firm but rounded stop
export const eSettle = cubicBezier(0.3, 0, 0.1, 1); // small moves: leave at once but smoothly
