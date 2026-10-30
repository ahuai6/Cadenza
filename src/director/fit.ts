/* Framing: while a lyric frame is up, all of it — every word it encloses, with the frame's own margin — is in the
   picture, together with the word being sung. One rule for every case (camera style, aspect, rows or columns, a long
   line, the camera gone on to the next words), applied to the path the camera really follows: wherever the plan leaves
   part of a frame outside the safe area, the camera pans and, when it must, draws back just enough to hold it all.

   The correction is planned ahead like the rest: each sample's need is taken a little early and held a little after
   (a look-ahead window), then smoothed, so the camera eases into the wider or shifted framing before the frame needs it
   and out of it after — never a jerk to catch a frame's edge. Nothing is smoothed across a cut. A frame that would need
   the camera to draw back further than DRAW_BACK (its words far from the ones being sung) fades out instead, a moment
   before it would leave (whole as it goes). */
import { clamp, D2R } from '../core/math';
import { project, NO_FX } from './project';
import { corners } from './layout';
import type { CameraPlan, PWord } from './types';

/** The safe area, as half its width and height in parts of the frame (a little inside the edges). */
const SAFE_X = 0.46, SAFE_Y = 0.44;
/** The furthest the camera draws back to hold a frame (as a zoom factor). */
const DRAW_BACK = 0.62;
/** How long ahead a need is taken, and held after (s). */
const LEAD = 0.6, HOLD = 0.3, SMOOTH = 0.22;
/** A frame that cannot be held starts fading this long before it would leave the safe area (s). */
const DROP_EARLY = 0.5;

type Frame = NonNullable<PWord['frame']>;
/** When a frame is fully gone (it fades over 0.8 s from its end: render/effects/frames.ts). */
const frameGone = (F: Frame) => { const L = F.words[0].line; return Math.min(L.L.end - 0.8, F.until ?? Infinity, L.secEnd - L.secIn) + 0.8; };

export function fitFrames(c: CameraPlan, words: PWord[], W: number, H: number) {
  const P = c.path; if (!P) return;
  const frames = [...new Set(words.map(S => S.frame).filter((F): F is Frame => !!F))]; if (!frames.length) return;
  const sung = [...words].sort((a, b) => a.w.t - b.w.t), dropped = new Set<Frame>();
  // (a few passes, each measured on the path as the last one left it: the smoothing takes the edge off a short need,
  // the next pass makes up the rest)
  for (let pass = 0; pass < 5; pass++) if (!fitPass(P, frames, sung, dropped, W, H)) break;
}
function fitPass(P: NonNullable<CameraPlan['path']>, frames: Frame[], sung: PWord[], dropped: Set<Frame>, W: number, H: number): boolean {
  const n = P.n, rate = P.rate, SW = W * SAFE_X, SH = H * SAFE_Y;
  const dz = new Float32Array(n), dx = new Float32Array(n), dy = new Float32Array(n), on = new Uint8Array(n);
  const f0 = Math.max(0, Math.floor(Math.min(...frames.map(F => F.ts)) * rate)), f1 = Math.min(n - 1, Math.ceil(Math.max(...frames.map(frameGone)) * rate));
  let worst = 0;
  for (let f = f0; f <= f1; f++) {
    const t = f / rate, act = frames.filter(F => !dropped.has(F) && t >= F.ts && t < frameGone(F)); if (!act.length) continue;
    const cam = { x: P.x[f], y: P.y[f], z: Math.exp(P.lz[f]), r: P.r[f], d: P.d[f], yaw: 0, pitch: 0 };
    const S0 = sung.find(S => t >= S.w.t && t < S.end);
    const fit = (fs: Frame[]) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, ks = 0, nk = 0;
      const add = (S: PWord, pad: number) => { for (const [X, Y] of corners(S, pad)) { const q = project(X, Y, S.d, cam, NO_FX, W, H);
        x0 = Math.min(x0, q.sx); x1 = Math.max(x1, q.sx); y0 = Math.min(y0, q.sy); y1 = Math.max(y1, q.sy); ks += q.k; nk++; } };
      for (const F of fs) for (const S of F.words) add(S, F.pad);
      if (S0) add(S0, 0);
      const k = Math.min(1, (2 * SW) / Math.max(1, x1 - x0), (2 * SH) / Math.max(1, y1 - y0));
      // (after drawing back by k the box is k times smaller about the middle; then the least shift that brings it in)
      const sx = clamp(0, -SW - x0 * k, SW - x1 * k), sy = clamp(0, -SH - y0 * k, SH - y1 * k);
      return { k, sx, sy, kp: ks / Math.max(1, nk) };
    };
    let r = fit(act);
    // a frame too far from the singing to hold without drawing back a long way: it ends here instead (the oldest one)
    while (r.k < DRAW_BACK && act.length) {
      const far = act.reduce((a, F) => (a.ts < F.ts ? a : F)); dropped.add(far);
      // (one that cannot be held even as it comes in — its words wider than the picture at this size — is not drawn at all)
      if (t - far.ts < 0.9 + DROP_EARLY) for (const S of far.words) { if (S.frame === far) S.frame = null; }
      else far.until = Math.min(far.until ?? Infinity, t - DROP_EARLY);
      act.splice(act.indexOf(far), 1); r = act.length ? fit(act) : { k: 1, sx: 0, sy: 0, kp: 1 };
    }
    if (r.k >= 0.999 && Math.abs(r.sx) < 0.5 && Math.abs(r.sy) < 0.5) continue;
    worst = Math.max(worst, Math.abs(r.sx), Math.abs(r.sy), (1 - r.k) * W);
    // screen shift → camera shift: the screen is the world turned by -roll and scaled by k·z·kp
    const cr = Math.cos(cam.r * D2R), sr = Math.sin(cam.r * D2R), sc = Math.max(1e-3, r.kp * r.k);
    dz[f] = Math.log(r.k); dx[f] = -(r.sx * cr - r.sy * sr) / sc; dy[f] = -(r.sx * sr + r.sy * cr) / sc; on[f] = 1;
  }
  if (worst < 1) return false;
  // drawing back is taken early and held a little after (the widest need from HOLD before to LEAD after, in its
  // segment): the camera eases out before the frame needs the room. A shift is not taken early — the frame moves across
  // the picture, and a shift it will need later would push it off the other side now — only smoothed.
  const sg = P.seg, lead = Math.round(LEAD * rate), hold = Math.round(HOLD * rate);
  const ez = new Float32Array(n);
  for (let f = 0; f < n; f++) { let bz = 0; for (let j = Math.max(0, f - hold); j <= Math.min(n - 1, f + lead); j++) if (on[j] && sg[j] === sg[f] && dz[j] < bz) bz = dz[j]; ez[f] = bz; }
  // then smoothed (a gaussian, within each segment) and added to the path
  const rad = Math.round(SMOOTH * rate * 3), ker: number[] = [];
  for (let k = -rad; k <= rad; k++) ker.push(Math.exp(-0.5 * (k / (SMOOTH * rate)) ** 2));
  const smooth = (a: Float32Array, f: number) => { let v = 0, w = 0; for (let k = -rad; k <= rad; k++) { const g = f + k; if (g < 0 || g >= n || sg[g] !== sg[f]) continue; v += a[g] * ker[k + rad]; w += ker[k + rad]; } return w > 0 ? v / w : 0; };
  const sz = new Float32Array(n), sx2 = new Float32Array(n), sy2 = new Float32Array(n);
  for (let f = 0; f < n; f++) { sz[f] = smooth(ez, f); sx2[f] = smooth(dx, f); sy2[f] = smooth(dy, f); }
  for (let f = 0; f < n; f++) { P.lz[f] += sz[f]; P.x[f] += sx2[f]; P.y[f] += sy2[f]; }
  return true;
}
