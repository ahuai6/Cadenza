// A rig is whatever holds the view: where the eye is and where it looks, one frame at a time. The scene draws from the
// pose of the rig in use and knows nothing of how it got there — walking freely (walk.ts) or a set of chosen shots
// (shots.ts). A new way of seeing the space is a new rig, not a new branch in the scene.
import type * as THREE from 'three';

export interface Pose {
  pos: THREE.Vector3;
  /** radians, 0 looks down -z, positive turns left */ yaw: number;
  /** radians, positive looks up */ pitch: number;
}
export interface Rig {
  readonly pose: Pose;
  /** One frame on. `now`: ms; `dt`: seconds. */
  step(now: number, dt: number): void;
  /** The hand moved the view, in pixels. */
  look(dx: number, dy: number): void;
}

export const wrapTo = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d;
};
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** in and out, slow at both ends */
export const inOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
