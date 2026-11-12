// Walking freely: the visitor moves with the keys and looks with the hand; asked to go somewhere, the rig takes them
// there (a flight — straight when the place is in the same room, through the doorways when it is not); seated, they
// stay until they walk off. It knows nothing of the building: the scene says where one may stand and which way leads
// from room to room.
import * as THREE from 'three';
import { inOut, smooth, wrapTo, type Pose, type Rig } from './rig';

export interface WalkOptions {
  start: Pose;
  /** eye height standing, metres */
  eye: number;
  /** May one be at this point, and how high may one float there? (null: a wall, or outside) */
  region(p: THREE.Vector3): { top: number } | null;
  /** The points to pass on the way to a place (none: straight there). */
  route(to: THREE.Vector3): THREE.Vector3[];
  /** walking speed and look sensitivity, 1 = as designed */
  speed(): number;
  sensitivity(): number;
  /** The visitor began to walk (what was open where they stood closes). */
  onWalk?(): void;
}
/** What the keys ask for this frame: each -1, 0 or 1. */
export interface Move {
  forward: number;
  right: number;
  up: number;
}
interface Flight {
  t0: number;
  dur: number;
  y0: number;
  p0: number;
  yaw: number;
  pitch: number;
  /** under way at once, settling at the end (sitting down) */ out: boolean;
  curve?: THREE.CatmullRomCurve3;
  from?: THREE.Vector3;
  to?: THREE.Vector3;
}

/** metres a second squared at speed 1, and what is left of the velocity after a second of coasting */
const ACCEL = 26,
  COAST = 0.02;
/** a flight ends when the hand has moved this many pixels: a deliberate look, not a hand resting on the mouse */
const DELIBERATE = 40;
/** how fast the view turns to a point it was asked to follow (a critically damped spring's frequency) */
const TURN = 2.6;

export class WalkRig implements Rig {
  readonly pose: Pose & { vel: THREE.Vector3 };
  /** sitting: stays put until the visitor walks off or stands */
  seated = false;
  private flight: Flight | null = null;
  private rising = false;
  private drift = 0;
  private turnTo: number | null = null;
  private turnV = 0;
  private move: Move = { forward: 0, right: 0, up: 0 };
  private readonly fwd = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly acc = new THREE.Vector3();
  private readonly tng = new THREE.Vector3();
  private readonly next = new THREE.Vector3();

  constructor(private o: WalkOptions) {
    this.pose = { pos: o.start.pos.clone(), yaw: o.start.yaw, pitch: o.start.pitch, vel: new THREE.Vector3() };
  }

  /** being taken somewhere */
  get flying() {
    return !!this.flight;
  }

  /** What the keys ask for, until told otherwise. */
  steer(m: Move) {
    this.move = m;
  }

  /** There, now (no flight). */
  put(pos: THREE.Vector3, yaw: number, pitch: number) {
    this.flight = null;
    this.pose.pos.copy(pos);
    this.pose.yaw = yaw;
    this.pose.pitch = pitch;
    this.pose.vel.set(0, 0, 0);
  }

  /** Take the visitor there. `dur`: seconds (else by the distance). */
  fly(pos: THREE.Vector3, yaw: number, pitch: number, dur?: number, out = false) {
    const me = this.pose,
      ways = this.o.route(pos);
    this.drift = 0;
    const t0 = performance.now(),
      base = { t0, y0: me.yaw, p0: me.pitch, pitch, out };
    if (!ways.length) {
      const d = me.pos.distanceTo(pos);
      this.flight = {
        ...base,
        dur: (dur ?? Math.min(2.4, 0.8 + d * 0.06)) * 1000,
        from: me.pos.clone(),
        to: pos.clone(),
        yaw: wrapTo(me.yaw, yaw),
      };
      return;
    }
    // a walk through the doorways, not through the walls
    const pts = [me.pos.clone(), ...ways, pos.clone()].filter((p, i, a) => i === 0 || p.distanceTo(a[i - 1]) > 0.4),
      curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    this.flight = { ...base, curve, dur: Math.max(1.6, Math.min(6.5, curve.getLength() / 10)) * 1000, yaw, out: false };
  }

  /** Sit down there, facing `yaw`. */
  sit(seat: THREE.Vector3, yaw: number) {
    this.fly(seat, yaw, -0.04, Math.min(1.1, 0.4 + this.pose.pos.distanceTo(seat) * 0.05), true);
    this.seated = true;
  }

  /** Stand up (back to eye height, wherever one floats or sits). */
  stand() {
    this.rising = true;
    this.seated = false;
    this.flight = null;
  }

  /** Stop being taken anywhere. */
  halt() {
    this.flight = null;
  }

  /** Turn the view to face `yaw`: from rest, easing in — it never starts with a jerk. The hand takes over at once. */
  follow(yaw: number) {
    this.turnTo = yaw;
  }

  /** A push along the view (the wheel): metres a second. */
  push(v: number) {
    const me = this.pose;
    me.vel.addScaledVector(this.fwd.set(-Math.sin(me.yaw), 0, -Math.cos(me.yaw)), v);
  }

  look(dx: number, dy: number) {
    const me = this.pose,
      moved = Math.abs(dx) + Math.abs(dy);
    if (this.flight) {
      this.drift += moved;
      if (this.drift < DELIBERATE) return;
      this.flight = null;
    }
    if (moved > 2) {
      this.turnTo = null;
      this.turnV = 0;
    }
    const k = this.o.sensitivity();
    me.yaw -= dx * 0.0024 * k;
    me.pitch = Math.max(-1.25, Math.min(1.25, me.pitch - dy * 0.0022 * k));
  }

  step(now: number, dt: number) {
    const me = this.pose,
      f = this.flight;
    if (f) {
      const u = Math.max(0, Math.min(1, (now - f.t0) / f.dur)),
        k = f.out ? 1 - Math.pow(1 - u, 3) : inOut(u);
      if (f.curve) {
        // (the view follows the path, leaving its first direction and arriving at its last by degrees)
        f.curve.getPointAt(k, me.pos);
        f.curve.getTangentAt(Math.min(1, k + 0.03), this.tng);
        const along = wrapTo(f.y0, Math.atan2(-this.tng.x, -this.tng.z)),
          endw = smooth(0.72, 1, k),
          startw = smooth(0, 0.14, k);
        const y = f.y0 + (along - f.y0) * startw;
        me.yaw = y + (wrapTo(y, f.yaw) - y) * endw;
        me.pitch = f.p0 * (1 - startw) + f.pitch * endw;
      } else {
        me.pos.lerpVectors(f.from!, f.to!, k);
        me.yaw = f.y0 + (f.yaw - f.y0) * k;
        me.pitch = f.p0 + (f.pitch - f.p0) * k;
      }
      me.vel.set(0, 0, 0);
      if (u >= 1) this.flight = null;
    } else this.walk(dt);
    if (this.turnTo != null) {
      const err = wrapTo(me.yaw, this.turnTo) - me.yaw;
      this.turnV += (TURN * TURN * err - 2 * TURN * this.turnV) * dt;
      me.yaw += this.turnV * dt;
      if (Math.abs(err) < 0.003 && Math.abs(this.turnV) < 0.01) {
        this.turnTo = null;
        this.turnV = 0;
      }
    }
  }

  private walk(dt: number) {
    const me = this.pose,
      m = this.move,
      eye = this.o.eye;
    this.fwd.set(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
    this.side.set(-this.fwd.z, 0, this.fwd.x);
    this.acc.set(0, 0, 0).addScaledVector(this.fwd, m.forward).addScaledVector(this.side, m.right);
    this.acc.y = m.up;
    if (this.acc.lengthSq()) {
      const level = this.acc.x || this.acc.z;
      this.acc.normalize().multiplyScalar(ACCEL * this.o.speed());
      this.o.onWalk?.();
      if (this.seated && level) {
        this.seated = false;
        this.rising = true;
      }
    }
    if (m.up) this.rising = false;
    if (this.rising) {
      me.pos.y += (eye - me.pos.y) * Math.min(1, dt * 5);
      me.pitch *= Math.pow(0.2, dt);
      if (Math.abs(me.pos.y - eye) < 0.005) {
        me.pos.y = eye;
        this.rising = false;
      }
    }
    me.vel.addScaledVector(this.acc, dt);
    me.vel.multiplyScalar(Math.pow(COAST, dt));
    // (one axis at a time: along a wall one slides, never sticks)
    for (const axis of ['x', 'z', 'y'] as const) {
      this.next.copy(me.pos);
      this.next[axis] += me.vel[axis] * dt;
      const reg = this.o.region(this.next);
      if (reg && this.next.y >= eye * 0.55 && this.next.y <= reg.top) me.pos.copy(this.next);
      else me.vel[axis] *= 0.2;
    }
  }
}
