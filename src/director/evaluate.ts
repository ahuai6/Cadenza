/* The camera and the frame's motion at a moment: the planned path plus the dynamic layer.
   - the cone: the rhythm SDK's subwoofer spring (strong low-end accents push the frame in, it returns with one small
     rebound) drives a zoom pump and a slight roll, instead of a jolt;
   - impacts: the strongest accents (the impact cue) kick the same kind of spring harder, with a colour split;
   - handheld float: a slow, never-repeating drift of position, roll and a slight tilt;
   - idle: in a long instrumental the frame drifts, eases back and turns slowly;
   - builds lean in toward the drop, and everything holds still in the half beat before it;
   - after a cut the new passage opens a touch wide and eases in.
   All of it is a function of t: preview, export and look-ahead see the same frame. */
import { clamp, sstep, lerp, D2R } from '../core/math';
import { eIO } from '../core/ease';
import { impulse } from '../core/spring';
import type { Signals, RhythmSample } from '../rhythm/signals';
import type { ScenePlan, PWord } from './types';
import { basePose } from './camera';
import type { Cam, Fx } from './project';
import { transK } from './passages';

export interface CamFrame { /** a long pause's rest (see restK) */ rest: number; cam: Cam; fx: Fx; /** the backdrop's camera: the same, but without the cuts */ cont: Cam; split: number; idle: number; trans: number; ov: number; calm: number; rs: RhythmSample;
  /** the handheld float, as a screen offset (px): the backdrop moves against it a little (parallax) */ hand: [number, number] }

export function idleK(plan: ScenePlan, t: number) {
  for (const I of plan.camera.idle) if (t > I.a && t < I.b) return Math.min(sstep((t - I.a) / 1.6), sstep((I.b - t) / 0.7));
  return 0;
}
/** How far a long pause has let the picture rest (0..1): it eases in slowly over the idle stretch (as slowly as the camera
 *  moves: the speed setting), and goes back at once under the blur of the passage that ends it — or, without one,
 *  just before the next words. A video backdrop rests upright, centred and unshaded. */
export function restK(plan: ScenePlan, t: number): number {
  const sp = Math.max(0.3, plan.style.m.speed), ramp = clamp(3.2 / sp, 1.5, 6);
  for (const I of plan.camera.idle) {
    const p = plan.passages.find(q => q.t > I.a && q.t < I.b + 1.2), end = p ? p.t : I.b;
    if (t <= I.a || t >= end) continue;
    const inn = 1 - (1 - clamp((t - I.a) / ramp)) ** 2, back = p ? 1 - sstep(clamp((t - (p.t - p.inn)) / p.inn)) : sstep(clamp((I.b - t) / 0.7));
    return Math.min(inn * inn * (3 - 2 * inn), back);
  }
  return 0;
}
export function cameraAt(plan: ScenePlan, sig: Signals, t: number, motion = 1): CamFrame {
  const c = plan.camera, b = basePose(c, t), M = plan.style.m, W = plan.W;
  // while a transition's blur is up the frame holds still — all of its own motion, the beat's and the heavy beats'
  // alike: a shake under the blur reads as a twitch, not a beat. Held from early in the blur's rise to late in its fall
  // (the blur's own curve is gentle at its ends; the hold is not)
  const trans = transK(plan.passages, t), hold = 1 - sstep(clamp(trans / 0.35));
  const centre = c.style === 'center', ik = centre ? 0 : idleK(plan, t), rs = sig.sample(t, idleK(plan, t)), calm = 1 - clamp((t - plan.musicEnd) / 0.3), still = 1 - rs.still;
  const cam: Cam = { x: b.x, y: b.y, z: b.z, r: b.r, d: b.d, yaw: 0, pitch: 0 };
  // handheld float
  const A = c.dyn.float * motion * (0.25 + 0.75 * hold), hx = (Math.sin(t * 0.31) + 0.6 * Math.sin(t * 0.53 + 1.3)) * A * 16, hy = (Math.cos(t * 0.27) + 0.6 * Math.sin(t * 0.47 + 2.1)) * A * 12;
  // screen-space offsets (px) of the float and the idle drift: applied to the camera and the backdrop's camera alike, each
  // at its own closeness, so the backdrop's never jumps where the camera cuts
  let ox = hx, oy = hy, oz = 1;
  cam.r += Math.sin(t * 0.19 + 0.7) * 0.9 * A;
  cam.yaw = Math.sin(t * 0.21 + 0.4) * 2.2 * A; cam.pitch = Math.cos(t * 0.17 + 1.1) * 2.6 * A;
  cam.yaw = clamp(cam.yaw, -4, 4); cam.pitch = clamp(cam.pitch, -4, 4);
  // idle drift
  if (ik > 0.001) { const k = ik * motion;
    ox += (Math.sin(t * 0.21 + 0.3) + 0.5 * Math.sin(t * 0.47 + 1.7)) * W * 0.09 * k; oy += (Math.cos(t * 0.17 + 1.1) + 0.5 * Math.sin(t * 0.39 + 0.4)) * W * 0.06 * k;
    oz = Math.exp((-0.1 + 0.05 * Math.sin(t * 0.29)) * k); cam.r += Math.sin(t * 0.13 + 0.9) * 3.2 * k; }
  cam.x += ox / b.z; cam.y += oy / b.z; cam.z *= oz;
  // opening push-in, and after a cut the new passage eases in from a touch wide
  if (t < 1.2) cam.z *= Math.exp(-0.35 * (1 - eIO(clamp(t / 1.2))));
  let easeIn = 1; for (const k of c.cuts) { const dt = t - k.t; if (dt >= 0 && dt < 1.1) easeIn *= Math.exp(-0.22 * (1 - eIO(dt / 1.1))); }
  cam.z *= easeIn;
  // the frame's own motion: cone spring, impacts, beat sway, build lean-in (all held under a transition's blur, above)
  const fx: Fx = { x: 0, y: 0, r: 0, z: 1 }, mo = motion * calm * still * hold;
  const gv = M.groove ?? 1;                                     // the beat-and-melody motion (its own knob)
  fx.z *= 1 + c.dyn.cone * rs.cone * mo * gv;
  fx.r += c.dyn.coneRoll * rs.coneRoll * mo * gv;
  // the beat sway: a slow roll on the half bar and the lyric plane rocking in depth (a slight shear) over the bar
  const sw = clamp(0.35 + 0.65 * rs.level) * mo * (c.dyn.sway ?? 0), tempo = Math.sqrt(clamp(plan.map.beatLen(t) / 0.5, 0.5, 2));
  fx.r += Math.sin(rs.bt * Math.PI / 2) * 1.4 * sw;
  fx.sk = [Math.tan(Math.cos(rs.bt * Math.PI / 4) * 3 * sw * D2R) * 0.15, Math.tan(Math.sin(rs.bt * Math.PI / 4) * 5 * sw * D2R) * 0.3];
  const lobe = (u: number, tau: number) => (u <= 0 ? 0 : (u / tau) * Math.exp(1 - u / tau));    // one swing out and back to rest, no crossing
  // waltz: elegant disorder — every accented arrival pushes the frame once in roll, distance and position, over a
  // never-repeating sway; the path stays smooth while the frame breathes and staggers
  if (c.kicks && mo > 0) {
    let kr = 0, kz = 0, kx = 0, ky = 0;
    for (const q of c.kicks) { const dt = t - q.t; if (dt < 0) break; if (dt > 2.2) continue;
      const u = dt / tempo, on = 1 - Math.exp(-u * 22), k1 = lobe(u, 0.16), k2 = on * Math.exp(-u * 4.5);
      kr += q.sg * q.a * 7 * k1; kz += q.a * 0.045 * k2; kx += q.px * q.a * W * 0.012 * k1; ky += q.py * q.a * W * 0.012 * k1; }
    const s2 = (c.dyn.sway ?? 0) * mo, sh = M.shake;
    fx.r += (kr * sh + (Math.sin(t * 0.73 + 1.1) + 0.6 * Math.sin(t * 1.37 + 2.3) + 0.35 * Math.sin(t * 2.83 + 0.4)) * 0.8 * s2) * mo;
    fx.x += (kx * sh + (Math.sin(t * 0.61) + 0.5 * Math.sin(t * 1.7 + 1)) * W * 0.003 * s2) * mo;
    fx.y += (ky * sh + (Math.cos(t * 0.53 + 0.7) + 0.5 * Math.sin(t * 1.9 + 2)) * W * 0.003 * s2) * mo;
    fx.z *= 1 + kz * M.punch * mo;
  }
  // punch: an arrival nudges the frame once in one direction and lets it settle back — firm, never rattling
  if (c.arrivals && mo > 0) for (const q of c.arrivals) { const dt = t - q.t; if (dt < 0) break; if (dt > 0.6) continue;
    const lb = lobe(dt, 0.05) * q.k, amp = (6 + 16 * rs.level) * lb * M.shake * (W / 1280);
    fx.x += Math.cos(q.ang) * amp * mo; fx.y += Math.sin(q.ang) * amp * mo; fx.r += q.sg * lb * 1.6 * M.shake * mo; }
  fx.z *= 1 + 0.05 * rs.build * motion * calm * hold;
  let split = 0;
  const IK = (M.impk ?? 0.8) * mo;
  if (IK > 0.001) for (const e of plan.cues.impacts) {
    const dt = t - e.t; if (dt < 0) break; if (dt > 0.9) continue;
    const k = IK * (0.5 + 0.6 * e.k), v = impulse(dt, 2 * Math.PI * 3.2, 0.5);
    fx.z *= 1 + k * 0.06 * v; fx.x += Math.cos(e.ang) * k * W * 0.008 * v; fx.y += Math.sin(e.ang) * k * W * 0.008 * v; fx.r += e.sg * k * 0.9 * v;
    split = Math.max(split, k * Math.max(0, v));
  }
  // the centred stage never turns or rocks: only its distance and position breathe
  if (centre) { cam.r = 0; cam.yaw = cam.pitch = 0; fx.r = 0; fx.sk = undefined; }
  // the backdrop's camera skips the cuts (they are hidden by the blur; the backdrop must not turn or jump with them)
  const cont = { ...cam, x: b.x, y: b.y, z: b.z }; for (const k of c.cuts) if (t >= k.t) { cont.x -= k.dx; cont.y -= k.dy; cont.r -= k.dr; cont.z /= Math.exp(k.dz); }
  cont.x += ox / cont.z; cont.y += oy / cont.z; cont.z *= oz;
  return { rest: restK(plan, t), cam, fx, cont, split, idle: ik, trans, ov: clamp((t - plan.musicEnd) / 0.7), calm, rs, hand: [hx, hy] };
}
export const lerpCam = (a: Cam, b: Cam, k: number): Cam => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), k)), r: lerp(a.r, b.r, k), d: lerp(a.d, b.d, k), yaw: lerp(a.yaw, b.yaw, k), pitch: lerp(a.pitch, b.pitch, k) });

/** The camera a carried word is seen through at t (the roller: a word that appears before its roll is over rides with the
 *  camera): the camera at t moved by what the planned path still has to do before t1, so the word holds where the camera
 *  will show it when the roll lands, while the world turns behind it; it is the camera itself again at t1. */
export function carryCam(plan: ScenePlan, S: PWord, t: number, cam: Cam): Cam {
  const C = S.carry; if (!C || t < C.t0 || t >= C.t1) return cam;
  const a = basePose(plan.camera, t), b = basePose(plan.camera, C.t1);
  return { ...cam, x: cam.x + b.x - a.x, y: cam.y + b.y - a.y, z: cam.z * b.z / a.z, r: cam.r + b.r - a.r, d: cam.d + b.d - a.d };
}
