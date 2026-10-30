// Springs, solved exactly. A spring's response to an impulse is a closed-form function of time, so anything driven by
// springs can be evaluated at any moment (export, look-ahead, tests) and gives the same picture as live playback.

/** Displacement at time dt after a unit-velocity impulse, for a damped oscillator with natural frequency `omega`
 *  (rad/s) and damping ratio `zeta`. The peak is normalised to 1, so `amp` reads as the largest displacement. */
export function impulse(dt: number, omega: number, zeta: number): number {
  if (dt <= 0) return 0;
  return impulseRaw(dt, omega, zeta) / impulsePeak(omega, zeta);
}
function impulseRaw(t: number, w: number, z: number): number {
  if (z < 1) { const wd = w * Math.sqrt(1 - z * z); return Math.exp(-z * w * t) * Math.sin(wd * t) / wd; }
  if (z === 1) return t * Math.exp(-w * t);
  const s = Math.sqrt(z * z - 1), r1 = -w * (z - s), r2 = -w * (z + s);
  return (Math.exp(r1 * t) - Math.exp(r2 * t)) / (r1 - r2);
}
const PEAKS = new Map<string, number>();
function impulsePeak(w: number, z: number): number {
  const key = w.toFixed(4) + ':' + z.toFixed(4); let p = PEAKS.get(key);
  if (p == null) {
    let tp: number;
    if (z < 1) { const wd = w * Math.sqrt(1 - z * z); tp = Math.atan2(wd, z * w) / wd; }
    else if (z === 1) tp = 1 / w;
    else { const s = Math.sqrt(z * z - 1), r1 = -w * (z - s), r2 = -w * (z + s); tp = Math.log(r2 / r1) / (r1 - r2); }
    p = impulseRaw(tp, w, z) || 1; PEAKS.set(key, p);
    if (PEAKS.size > 256) PEAKS.delete(PEAKS.keys().next().value!);
  }
  return p;
}


