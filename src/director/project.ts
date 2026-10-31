/* One projection for everything that lives in the lyric world (words, glyph contours, frames, stars, the cover).
   - depth parallax: a word at depth d is scaled by F/(F + d − cam.d) around the camera's centre;
   - the camera's roll and zoom;
   - a slight perspective tilt (yaw/pitch, a few degrees) computed in *normalised screen space*: its effect is bounded
     (about ±10 % at the frame's edge) and smooth everywhere, so a word near the edge is never flung off screen (the old
     tilt grew with the word's distance in the world and could scale edge words ×3);
   - the frame's own motion on top (shake, sway, punch), felt by depth: what is near the camera is shaken, swung and
     pushed more, what is far less (DEPTH_FEEL) — the lyrics are things at their own distances, not one flat layer.
   Screen coordinates are relative to the frame's centre, in reference pixels (720 tall). */
import { clamp, D2R } from '../core/math';

export const FOCAL = 1300;
/** How much the frame's motion is felt at a depth: its parallax scale to this power (near, more; far, less), bounded. */
const DEPTH_FEEL = 2;
export const depthFeel = (kp: number) => clamp(kp ** DEPTH_FEEL, 0.35, 1.3);   // (near, at most 1.3×: the framing keeps that much room for the shake)
export interface Cam { x: number; y: number; z: number; r: number; d: number; yaw: number; pitch: number }
/** the frame's own motion: offset, roll, scale, and a slight shear (b, c of a canvas transform) that rocks the lyric plane in depth */
export interface Fx { x: number; y: number; r: number; z: number; sk?: [number, number] }
export const NO_FX: Fx = { x: 0, y: 0, r: 0, z: 1 };
export interface Projected { sx: number; sy: number; k: number; rot: number; kp: number }

export function project(X: number, Y: number, D: number, cam: Cam, fx: Fx, W: number, H: number): Projected {
  const rz = Math.max(D - cam.d, -FOCAL * 0.55), kp = FOCAL / (FOCAL + rz);
  const wx = (X - cam.x) * kp * cam.z, wy = (Y - cam.y) * kp * cam.z;
  const c = Math.cos(-cam.r * D2R), s = Math.sin(-cam.r * D2R);
  let qx = wx * c - wy * s, qy = wx * s + wy * c;
  const nx = clamp(qx / (W / 2), -1.6, 1.6), ny = clamp(qy / (H / 2), -1.6, 1.6);
  const kt = 1 / (1 + 0.9 * (nx * Math.tan(cam.yaw * D2R) + ny * Math.tan(cam.pitch * D2R)));
  qx *= kt; qy *= kt;
  const g = depthFeel(kp), fr = fx.r * g, fz = 1 + (fx.z - 1) * Math.min(g, 1);   // (the push: less far off, never more near — it grows from the middle, and the edges have no more room)
  const fc = Math.cos(fr * D2R), fs = Math.sin(fr * D2R), b = fx.sk ? fx.sk[0] * g : 0, c2 = fx.sk ? fx.sk[1] * g : 0;
  const rx = qx * fc - qy * fs, ry = qx * fs + qy * fc;
  return { sx: (rx + c2 * ry) * fz + fx.x * g, sy: (b * rx + ry) * fz + fx.y * g, k: kp * cam.z * kt * fz, rot: -cam.r + fr, kp };
}
/** Is a box (centre, half-diagonal in screen px) at least partly inside the frame, with a margin? */
export const onScreen = (p: Projected, halfDiag: number, W: number, H: number, margin = 40) =>
  p.sx + halfDiag > -W / 2 - margin && p.sx - halfDiag < W / 2 + margin && p.sy + halfDiag > -H / 2 - margin && p.sy - halfDiag < H / 2 + margin;
