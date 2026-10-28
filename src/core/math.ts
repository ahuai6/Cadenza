// Small numeric helpers shared by every module.

export const D2R = Math.PI / 180;
export const TAU = Math.PI * 2;

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const invLerp = (a: number, b: number, x: number) => (b === a ? 0 : (x - a) / (b - a));
export const remap = (x: number, a0: number, a1: number, b0: number, b1: number) => lerp(b0, b1, clamp(invLerp(a0, a1, x)));
/** Smootherstep on 0..1: eases in and out with zero first and second derivative at both ends. */
export const sstep = (x: number) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
export const smoothstep = (a: number, b: number, x: number) => sstep(invLerp(a, b, x));
/** Signed shortest difference between two angles in degrees, in (-180, 180]. */
export const angDiff = (a: number, b: number) => ((((a - b + 540) % 360) + 360) % 360) - 180;
export const dirv = (deg: number): [number, number] => [Math.cos(deg * D2R), Math.sin(deg * D2R)];
export const fract = (x: number) => x - Math.floor(x);
export const mod = (x: number, m: number) => ((x % m) + m) % m;

/** A smooth reading between samples p1 and p2 (k in 0..1) that never overshoots them (Fritsch–Carlson). */
export function mcubic(p0: number, p1: number, p2: number, p3: number, k: number) {
  const d0 = p1 - p0, d1 = p2 - p1, d2 = p3 - p2;
  let m1 = d0 * d1 <= 0 ? 0 : (d0 + d1) / 2, m2 = d1 * d2 <= 0 ? 0 : (d1 + d2) / 2;
  if (d1 === 0) { m1 = 0; m2 = 0; } else {
    const lim = 3 * Math.abs(d1);
    if (Math.abs(m1) > lim) m1 = Math.sign(m1) * lim;
    if (Math.abs(m2) > lim) m2 = Math.sign(m2) * lim;
  }
  const k2 = k * k, k3 = k2 * k;
  return (2 * k3 - 3 * k2 + 1) * p1 + (k3 - 2 * k2 + k) * m1 + (-2 * k3 + 3 * k2) * p2 + (k3 - k2) * m2;
}

/** Index of the last element of a sorted array that is <= x (−1 when none). */
export function bisect(arr: ArrayLike<number>, x: number): number {
  let lo = 0, hi = arr.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
/** Value at quantile q (0..1) of a list of numbers. */
export function quantile(arr: ArrayLike<number>, q: number): number {
  if (!arr.length) return 0;
  const a = Float64Array.from(arr as ArrayLike<number>).sort();
  const x = clamp(q) * (a.length - 1), i = Math.floor(x), f = x - i;
  return i + 1 < a.length ? a[i] * (1 - f) + a[i + 1] * f : a[i];
}
export const median = (arr: ArrayLike<number>) => quantile(arr, 0.5);
export function mean(arr: ArrayLike<number>, a = 0, b = arr.length) {
  a = Math.max(0, a); b = Math.min(arr.length, b); let s = 0;
  for (let i = a; i < b; i++) s += arr[i];
  return b > a ? s / (b - a) : 0;
}

/** Sample an evenly spaced series at time t (seconds) with linear interpolation. */
export function sampleSeries(arr: ArrayLike<number>, rate: number, t: number): number {
  if (!arr.length) return 0;
  const x = clamp(t * rate, 0, arr.length - 1), i = Math.floor(x), f = x - i;
  return i + 1 < arr.length ? arr[i] * (1 - f) + arr[i + 1] * f : arr[i];
}

export interface Rect { x: number; y: number; w: number; h: number }
export const rectUnion = (a: Rect, b: Rect): Rect => {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
