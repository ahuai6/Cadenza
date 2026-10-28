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
/** Time of the first peak of the impulse response. */
export function impulsePeakTime(omega: number, zeta: number): number {
  if (zeta < 1) { const wd = omega * Math.sqrt(1 - zeta * zeta); return Math.atan2(wd, zeta * omega) / wd; }
  return 1 / omega;
}

/** Step response (0 → 1) of the same oscillator: how a spring-driven value settles onto a new target. */
export function stepResponse(dt: number, omega: number, zeta: number): number {
  if (dt <= 0) return 0;
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega * dt) * (Math.cos(wd * dt) + (zeta * omega / wd) * Math.sin(wd * dt));
  }
  return 1 - Math.exp(-omega * dt) * (1 + omega * dt);
}

/** A live spring for interface motion (one value, any target, interruptible: it always continues from where it is). */
export class Spring {
  x: number; v = 0; target: number;
  constructor(x = 0, public stiffness = 170, public damping = 26, public mass = 1) { this.x = x; this.target = x; }
  set(target: number) { this.target = target; }
  jump(x: number) { this.x = this.target = x; this.v = 0; }
  /** Advances by dt seconds (sub-stepped for stability). Returns true while still moving. */
  step(dt: number): boolean {
    const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (-this.stiffness * (this.x - this.target) - this.damping * this.v) / this.mass;
      this.v += a * h; this.x += this.v * h;
    }
    const moving = Math.abs(this.x - this.target) > 1e-4 || Math.abs(this.v) > 1e-3;
    if (!moving) { this.x = this.target; this.v = 0; }
    return moving;
  }
}
