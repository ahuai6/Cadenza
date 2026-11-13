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
export const depthFeel = (kp: number) => clamp(kp ** DEPTH_FEEL, 0.35, 1.3); // (near, at most 1.3×: the framing keeps that much room for the shake)
export interface Cam {
  x: number;
  y: number;
  z: number;
  r: number;
  d: number;
  yaw: number;
  pitch: number;
  /** how the camera is moving now, per second: its pan (world units), its roll (degrees) and its push (log of the
   *  closeness). With these a word takes the camera's move a moment early or late by its depth (DEPTH_LAG): near things
   *  swing ahead, far things trail — things at their own distances, not one sheet turning as a whole. At rest they are
   *  nothing, so a framing held still is exactly the planned one. */
  vx?: number;
  vy?: number;
  vr?: number;
  vz?: number;
}
/** seconds a word's view of the camera's move is shifted, per unit its parallax scale is off 1 (near: earlier; far: later) */
const DEPTH_LAG = 0.42;
/** …and never more than this either way */
const DEPTH_LAG_MAX = 0.16;
/** the most a depth's own view of the move differs: of the frame's width, in degrees, in log size */
/** x, eased toward ±m and never past it */
const soft = (x: number, m: number) => (m > 0 ? m * Math.tanh(x / m) : 0);
const LAG_PAN = 0.018,
  LAG_ROLL = 2.5,
  LAG_ZOOM = 0.035;
/** the frame's own motion: offset, roll, scale, and a slight shear (b, c of a canvas transform) that rocks the lyric plane in depth */
export interface Fx {
  x: number;
  y: number;
  r: number;
  z: number;
  sk?: [number, number];
}
export const NO_FX: Fx = { x: 0, y: 0, r: 0, z: 1 };
export interface Projected {
  sx: number;
  sy: number;
  k: number;
  rot: number;
  kp: number;
}

export function project(X: number, Y: number, D: number, cam: Cam, fx: Fx, W: number, H: number): Projected {
  const rz = Math.max(D - cam.d, -FOCAL * 0.55),
    kp = FOCAL / (FOCAL + rz);
  // (the camera's move as this depth sees it: `ahead` seconds on for what is near, back for what is far)
  // (bounded on the screen, so a quick hard move never throws a word or a frame out of the framing it was planned in:
  // a few hundredths of the frame, a couple of degrees, a few per cent of the size)
  const ahead = clamp((kp - 1) * DEPTH_LAG, -DEPTH_LAG_MAX, DEPTH_LAG_MAX),
    pm = (LAG_PAN * W) / (kp * cam.z),
    // (each eased toward its limit, not cut off at it: a move near the limit does not flicker in and out of it)
    cx = cam.x + soft((cam.vx ?? 0) * ahead, pm),
    cy = cam.y + soft((cam.vy ?? 0) * ahead, pm),
    cz = cam.z * Math.exp(soft((cam.vz ?? 0) * ahead, LAG_ZOOM)),
    cr = cam.r + soft((cam.vr ?? 0) * ahead, LAG_ROLL);
  const wx = (X - cx) * kp * cz,
    wy = (Y - cy) * kp * cz;
  const c = Math.cos(-cr * D2R),
    s = Math.sin(-cr * D2R);
  let qx = wx * c - wy * s,
    qy = wx * s + wy * c;
  const nx = clamp(qx / (W / 2), -1.6, 1.6),
    ny = clamp(qy / (H / 2), -1.6, 1.6);
  const kt = 1 / (1 + 0.9 * (nx * Math.tan(cam.yaw * D2R) + ny * Math.tan(cam.pitch * D2R)));
  qx *= kt;
  qy *= kt;
  const g = depthFeel(kp),
    fr = fx.r * g,
    fz = 1 + (fx.z - 1) * Math.min(g, 1); // (the push: less far off, never more near — it grows from the middle, and the edges have no more room)
  const fc = Math.cos(fr * D2R),
    fs = Math.sin(fr * D2R),
    b = fx.sk ? fx.sk[0] * g : 0,
    c2 = fx.sk ? fx.sk[1] * g : 0;
  const rx = qx * fc - qy * fs,
    ry = qx * fs + qy * fc;
  return {
    sx: (rx + c2 * ry) * fz + fx.x * g,
    sy: (b * rx + ry) * fz + fx.y * g,
    k: kp * cz * kt * fz,
    rot: -cr + fr,
    kp,
  };
}
/** Is a box (centre, half-diagonal in screen px) at least partly inside the frame, with a margin? */
export const onScreen = (p: Projected, halfDiag: number, W: number, H: number, margin = 40) =>
  p.sx + halfDiag > -W / 2 - margin &&
  p.sx - halfDiag < W / 2 + margin &&
  p.sy + halfDiag > -H / 2 - margin &&
  p.sy - halfDiag < H / 2 + margin;
