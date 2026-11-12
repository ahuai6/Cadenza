// Chosen shots: the view rests on one framing of the space, breathing a little, and moves to the next when asked (or
// after a while, if given a time to hold). Nobody walks; the hand only leans the view a little, and it comes back.
import { inOut, wrapTo, type Pose, type Rig } from './rig';

export interface ShotOptions {
  shots: Pose[];
  /** seconds on a shot before the next, on its own (0: only when asked) */
  hold?: number;
  /** seconds from one shot to the next */
  move?: number;
  reduced(): boolean;
}

/** how far the hand may lean the view (radians), and how fast it comes back (a second's remainder) */
const LEAN = 0.12,
  RETURN = 0.15;

export class ShotRig implements Rig {
  readonly pose: Pose;
  /** the shot the view is on, or going to */
  at = 0;
  private from: Pose;
  private t0 = -1e9;
  private since = 0;
  private lean = { x: 0, y: 0 };

  constructor(private o: ShotOptions) {
    const s = o.shots[0];
    this.pose = { pos: s.pos.clone(), yaw: s.yaw, pitch: s.pitch };
    this.from = { pos: s.pos.clone(), yaw: s.yaw, pitch: s.pitch };
  }

  /** Go to a shot (reduced motion: at once). */
  go(i: number, now = performance.now()) {
    const n = this.o.shots.length;
    this.from = { pos: this.pose.pos.clone(), yaw: this.pose.yaw - this.lean.x, pitch: this.pose.pitch - this.lean.y };
    this.at = ((i % n) + n) % n;
    this.t0 = this.o.reduced() ? -1e9 : now;
    this.since = 0;
  }

  look(dx: number, dy: number) {
    this.lean.x = Math.max(-LEAN, Math.min(LEAN, this.lean.x - dx * 0.0006));
    this.lean.y = Math.max(-LEAN, Math.min(LEAN, this.lean.y - dy * 0.0006));
  }

  step(now: number, dt: number) {
    const to = this.o.shots[this.at],
      k = inOut(Math.max(0, Math.min(1, (now - this.t0) / ((this.o.move ?? 2.4) * 1000)))),
      breath = this.o.reduced() ? 0 : Math.sin(now / 2300) * 0.006;
    this.pose.pos.lerpVectors(this.from.pos, to.pos, k);
    this.lean.x *= Math.pow(RETURN, dt);
    this.lean.y *= Math.pow(RETURN, dt);
    this.pose.yaw = this.from.yaw + (wrapTo(this.from.yaw, to.yaw) - this.from.yaw) * k + this.lean.x + breath;
    this.pose.pitch = this.from.pitch + (to.pitch - this.from.pitch) * k + this.lean.y;
    this.since += dt;
    if (this.o.hold && this.since > this.o.hold) this.go(this.at + 1, now);
  }
}
