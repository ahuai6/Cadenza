// Interface motion. Every multi-part move (the player card opening into the now-playing page, panels, the queue) is one
// progress value on a spring; each part reads its own curve off that value. Nothing is a separate timed animation, so
// a move can be reversed at any moment from wherever it is — with its velocity — and can never be left half-done.
import { clamp } from '../core/math';

export interface SpringOpts {
  stiffness?: number;
  damping?: number;
}
/** A progress value driven toward a target by a mass–spring (mass 1), stepped on animation frames. */
export class Drive {
  x: number;
  v = 0;
  target: number;
  k: number;
  c: number;
  private raf = 0;
  private last = 0;
  private waiters: ((done: boolean) => void)[] = [];
  constructor(
    x = 0,
    private onFrame: (x: number, d: Drive) => void = () => {},
    o: SpringOpts = {},
  ) {
    this.x = this.target = x;
    this.k = o.stiffness ?? 170;
    this.c = o.damping ?? 2 * 0.92 * Math.sqrt(this.k);
  }
  get moving() {
    return this.raf !== 0;
  }
  /** Head for `target`; resolves true on arrival, false when sent elsewhere first. */
  to(target: number, o: SpringOpts = {}): Promise<boolean> {
    if (o.stiffness) {
      this.k = o.stiffness;
      this.c = o.damping ?? 2 * 0.92 * Math.sqrt(this.k);
    }
    this.target = target;
    this.flush(false);
    if (reduced()) {
      this.jump(target);
      return Promise.resolve(true);
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.step(t));
    }
    return new Promise((res) => this.waiters.push(res));
  }
  jump(x: number) {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.x = this.target = x;
    this.v = 0;
    this.onFrame(x, this);
    this.flush(true);
  }
  private flush(done: boolean) {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f(done));
  }
  private step(now: number) {
    const dt = clamp((now - this.last) / 1000, 0, 1 / 30);
    this.last = now;
    for (let i = 0, n = 4; i < n; i++) {
      const h = dt / n;
      this.v += (-this.k * (this.x - this.target) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    const done = Math.abs(this.x - this.target) < 5e-4 && Math.abs(this.v) < 5e-3;
    if (done) {
      this.x = this.target;
      this.v = 0;
      this.raf = 0;
    }
    this.onFrame(this.x, this);
    if (done) this.flush(true);
    else this.raf = requestAnimationFrame((t) => this.step(t));
  }
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export const rectOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
/** Where an element sits without the transform it wears right now. */
export function restRect(el: HTMLElement): Box {
  const t = el.style.transform;
  el.style.transform = 'none';
  const r = rectOf(el);
  el.style.transform = t;
  return r;
}
/** A sub-range of a progress value, eased (smoothstep) — how each part of a move reads the one progress. */
export const part = (p: number, a: number, b: number) => {
  const u = clamp((p - a) / (b - a));
  return u * u * (3 - 2 * u);
};
export const reduced = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
