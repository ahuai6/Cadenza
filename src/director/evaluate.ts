/* The camera and the frame's motion at a moment: the planned path plus the dynamic layer.
   - the cone: the rhythm SDK's subwoofer spring (strong low-end accents push the frame in, it returns with one small
     rebound) drives a zoom pump and a slight roll, instead of a jolt;
   - impacts: the strongest accents (the impact cue) kick the same kind of spring harder, with a colour split;
   - handheld float: a slow, never-repeating drift of position, roll and a slight tilt;
   - idle: in a long instrumental the frame drifts, eases back and turns slowly;
   - builds lean in toward the drop, and everything holds still in the half beat before it;
   - after a cut the new passage opens a touch wide and eases in.
   All of it is a function of t: preview, export and look-ahead see the same frame. */
import { clamp, sstep, lerp } from '../core/math';
import { eIO } from '../core/ease';
import { impulse } from '../core/spring';
import type { Signals, RhythmSample } from '../rhythm/signals';
import type { ScenePlan } from './types';
import { basePose } from './camera';
import type { Cam, Fx } from './project';
import { transK } from './passages';

export interface CamFrame { cam: Cam; fx: Fx; /** the backdrop's camera: the same, but without the cuts */ cont: Cam; split: number; idle: number; trans: number; ov: number; calm: number; rs: RhythmSample }

export function idleK(plan: ScenePlan, t: number) {
  for (const I of plan.camera.idle) if (t > I.a && t < I.b) return Math.min(sstep((t - I.a) / 1.6), sstep((I.b - t) / 0.7));
  return 0;
}
export function cameraAt(plan: ScenePlan, sig: Signals, t: number, motion = 1): CamFrame {
  const c = plan.camera, b = basePose(c, t), M = plan.style.m, W = plan.W;
  const ik = idleK(plan, t), rs = sig.sample(t, ik), calm = 1 - clamp((t - plan.musicEnd) / 0.3), still = 1 - rs.still;
  const cam: Cam = { x: b.x, y: b.y, z: b.z, r: b.r, d: b.d, yaw: 0, pitch: 0 };
  // handheld float
  const A = c.dyn.float * motion;
  cam.x += (Math.sin(t * 0.31) + 0.6 * Math.sin(t * 0.53 + 1.3)) * A * 16 / b.z;
  cam.y += (Math.cos(t * 0.27) + 0.6 * Math.sin(t * 0.47 + 2.1)) * A * 12 / b.z;
  cam.r += Math.sin(t * 0.19 + 0.7) * 0.9 * A;
  cam.yaw = Math.sin(t * 0.21 + 0.4) * 2.2 * A; cam.pitch = Math.cos(t * 0.17 + 1.1) * 2.6 * A;
  cam.yaw = clamp(cam.yaw, -4, 4); cam.pitch = clamp(cam.pitch, -4, 4);
  // idle drift
  if (ik > 0.001) { const span = W / b.z, k = ik * motion;
    cam.x += (Math.sin(t * 0.21 + 0.3) + 0.5 * Math.sin(t * 0.47 + 1.7)) * span * 0.09 * k; cam.y += (Math.cos(t * 0.17 + 1.1) + 0.5 * Math.sin(t * 0.39 + 0.4)) * span * 0.06 * k;
    cam.z *= Math.exp((-0.1 + 0.05 * Math.sin(t * 0.29)) * k); cam.r += Math.sin(t * 0.13 + 0.9) * 3.2 * k; }
  // opening push-in, and after a cut the new passage eases in from a touch wide
  if (t < 1.2) cam.z *= Math.exp(-0.35 * (1 - eIO(clamp(t / 1.2))));
  for (const k of c.cuts) { const dt = t - k.t; if (dt >= 0 && dt < 1.1) cam.z *= Math.exp(-0.22 * (1 - eIO(dt / 1.1))); }
  // the frame's own motion: cone spring, impacts, beat sway, build lean-in
  const fx: Fx = { x: 0, y: 0, r: 0, z: 1 }, mo = motion * calm * still;
  fx.z *= 1 + c.dyn.cone * rs.cone * mo;
  fx.r += c.dyn.coneRoll * rs.coneRoll * mo;
  const sw = clamp(0.35 + 0.65 * rs.level) * mo * (c.dyn.sway ?? 0);
  fx.r += Math.sin(rs.bt * Math.PI / 2) * 0.9 * sw;
  fx.z *= 1 + 0.05 * rs.build * motion * calm;
  let split = 0;
  const IK = (M.impk ?? 0.8) * mo;
  if (IK > 0.001) for (const e of plan.cues.impacts) {
    const dt = t - e.t; if (dt < 0) break; if (dt > 0.9) continue;
    const k = IK * (0.5 + 0.6 * e.k), v = impulse(dt, 2 * Math.PI * 3.2, 0.5);
    fx.z *= 1 + k * 0.06 * v; fx.x += Math.cos(e.ang) * k * W * 0.008 * v; fx.y += Math.sin(e.ang) * k * W * 0.008 * v; fx.r += e.sg * k * 0.9 * v;
    split = Math.max(split, k * Math.max(0, v));
  }
  // the backdrop's camera skips the cuts (they are hidden by the blur; the backdrop must not turn or jump with them)
  const cont = { ...cam }; for (const k of c.cuts) if (t >= k.t) { cont.x -= k.dx; cont.y -= k.dy; cont.r -= k.dr; cont.z /= Math.exp(k.dz); }
  return { cam, fx, cont, split, idle: ik, trans: transK(plan.passages, t), ov: clamp((t - plan.musicEnd) / 0.7), calm, rs };
}
export const lerpCam = (a: Cam, b: Cam, k: number): Cam => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), k)), r: lerp(a.r, b.r, k), d: lerp(a.d, b.d, k), yaw: lerp(a.yaw, b.yaw, k), pitch: lerp(a.pitch, b.pitch, k) });
