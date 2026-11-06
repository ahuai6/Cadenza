/* Entering inside the frame. A word appears a moment before it is sung, wherever the layout put it; if at that moment
   part of it lies outside the frame on a side the camera is not already heading for, it would show cut off. Such a word
   appears nudged just inside the frame and glides to its own place as the camera's move brings that place into view —
   the camera is never held back for it. Off the edge the camera is heading for is fine: it is in view a moment later. */
import { D2R, clamp } from '../core/math';
import { Signals } from '../rhythm/signals';
import { cameraAt } from './evaluate';
import { project, type Cam, type Fx } from './project';
import { corners } from './layout';
import { wordState, type WordCtx } from './words';
import type { ScenePlan, PWord } from './types';

/** the picture's real camera and frame motion at t (what is drawn), not only the planned path */
type View = { cam: Cam; fx: Fx };
const viewAt = (plan: ScenePlan, sig: Signals, t: number): View => { const c = cameraAt(plan, sig, t, 1); return { cam: c.cam, fx: c.fx }; };
/** the word's box as drawn at t: with its entrance offset (a drift brings it in from well aside) and scale */
function bounds(S: PWord, v: View, W: number, H: number, ox = 0, oy = 0, sc = 1) {
  const c = Math.cos(S.tilt * D2R), s = Math.sin(S.tilt * D2R), shift = { ...S, x: S.x + (ox * c - oy * s) * S.s, y: S.y + (ox * s + oy * c) * S.s, lw: S.lw * sc, lh: S.lh * sc };
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [x, y] of corners(shift)) { const p = project(x, y, S.d, v.cam, v.fx, W, H); x0 = Math.min(x0, p.sx); x1 = Math.max(x1, p.sx); y0 = Math.min(y0, p.sy); y1 = Math.max(y1, p.sy); }
  return { x0, x1, y0, y1 };
}
export function planEntries(plan: ScenePlan) {
  const { W, H } = plan, lx = W / 2 * 0.97, ly = H / 2 * 0.95, sig = new Signals(plan.map), M = plan.style.m;
  const ctx = (t: number): WordCtx => ({ enter: Math.max(0.05, M.enter), tempo: Math.sqrt(clamp(plan.map.beatLen(t) / 0.5, 0.5, 2)), float: M.float ?? 0, future: plan.style.future, smooth: plan.style.cut !== 'punch', punch: M.punch, motion: 1, drift: plan.style.tout === 'drift', spread: plan.style.tout === 'spread', held: plan.style.cut === 'center' });
  for (const S of plan.words) {
    S.entry = null;
    // (a line timed only as a whole comes in whole, each word at its own place: the camera holds the line — no word is
    // nudged in and left to glide back while the rest stand still; only its first, which leads it in as ever)
    if (!S.line.L.kar && S.k > 0) continue;
    const t0 = S.show + 0.03, v0 = viewAt(plan, sig, t0);
    // the worst moment of the entrance (it may sweep in from aside): its first frame and two more as it settles
    let sx = 0, sy = 0, big = false;
    const v1 = viewAt(plan, sig, t0 + 0.25), p0 = project(S.x, S.y, S.d, v0.cam, v0.fx, W, H), p1 = project(S.x, S.y, S.d, v1.cam, v1.fx, W, H), vx = p1.sx - p0.sx, vy = p1.sy - p0.sy, inn = 0.015 * W;
    for (const dt of [0, 0.12, 0.24]) {
      const t = t0 + dt, v = dt ? viewAt(plan, sig, t) : v0, ws = wordState(S, t, 0, false, ctx(t)), b = bounds(S, v, W, H, ws?.ox ?? 0, ws?.oy ?? 0, ws?.sc ?? 1);
      if (b.x1 - b.x0 > 2 * lx || b.y1 - b.y0 > 2 * ly) { big = true; break; }       // bigger than the frame: nothing to do
      if (b.x1 > lx && !(vx < -inn)) sx = Math.min(sx, lx - b.x1); else if (b.x0 < -lx && !(vx > inn)) sx = Math.max(sx, -lx - b.x0);
      if (b.y1 > ly && !(vy < -inn)) sy = Math.min(sy, ly - b.y1); else if (b.y0 < -ly && !(vy > inn)) sy = Math.max(sy, -ly - b.y0);
    }
    if (big || (Math.abs(sx) < 1 && Math.abs(sy) < 1)) continue;
    // when its own place is in view (or close enough that the glide ends with the camera's arrival) — looked for over
    // the word's whole time up; if the camera never brings its place in, the word keeps its nudge (it never glides back
    // out over the edge it was brought in from)
    let t1 = Infinity; const until = Math.min(S.line.secEnd, S.line.L.end + 1);
    for (let t = t0 + 0.3; t < until; t += 1 / 20) { const q = bounds(S, viewAt(plan, sig, t), W, H); if ((sx === 0 || (q.x1 <= lx + 2 && q.x0 >= -lx - 2)) && (sy === 0 || (q.y1 <= ly + 2 && q.y0 >= -ly - 2))) { t1 = t; break; } }
    // the screen shift as a world offset at that moment (undo the camera's zoom, depth scale and roll)
    const k = p0.k || 1, r = (v0.cam.r - v0.fx.r) * D2R, c = Math.cos(r), s = Math.sin(r);
    S.entry = { dx: (sx * c - sy * s) / k, dy: (sx * s + sy * c) / k, t0, t1: Math.max(t0 + 0.3, t1) };   // (t1 Infinity: held)
  }
}
/** How much of a word's entry nudge still applies at t (1 as it appears, easing to 0 as its own place comes into view). */
export function entryK(S: PWord, t: number): number {
  const e = S.entry; if (!e || t >= e.t1) return 0; if (t <= e.t0) return 1;
  const u = clamp((t - e.t0) / (e.t1 - e.t0)); return 1 - u * u * (3 - 2 * u);
}
