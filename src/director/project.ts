/* One projection for everything that lives in the lyric world (words, glyph contours, frames, stars, the cover).
   - depth parallax: a word at depth d is scaled by F/(F + d − cam.d) around the camera's centre;
   - the camera's roll and zoom;
   - a slight perspective tilt (yaw/pitch, a few degrees) computed in *normalised screen space*: its effect is bounded
     (about ±10 % at the frame's edge) and smooth everywhere, so a word near the edge is never flung off screen (the old
     tilt grew with the word's distance in the world and could scale edge words ×3);
   - the frame's own motion on top (shake, sway, punch).
   Screen coordinates are relative to the frame's centre, in reference pixels (720 tall). */
import { clamp, D2R } from '../core/math';

export const FOCAL = 1300;
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
  const fc = Math.cos(fx.r * D2R), fs = Math.sin(fx.r * D2R), b = fx.sk ? fx.sk[0] : 0, c2 = fx.sk ? fx.sk[1] : 0;
  const rx = qx * fc - qy * fs, ry = qx * fs + qy * fc;
  return { sx: (rx + c2 * ry) * fx.z + fx.x, sy: (b * rx + ry) * fx.z + fx.y, k: kp * cam.z * kt * fx.z, rot: -cam.r + fx.r, kp };
}
/** Is a box (centre, half-diagonal in screen px) at least partly inside the frame, with a margin? */
export const onScreen = (p: Projected, halfDiag: number, W: number, H: number, margin = 40) =>
  p.sx + halfDiag > -W / 2 - margin && p.sx - halfDiag < W / 2 + margin && p.sy + halfDiag > -H / 2 - margin && p.sy - halfDiag < H / 2 + margin;
