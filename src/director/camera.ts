/* The camera, planned ahead for the whole song.
   Stops: each group of words the camera frames together (a fast run, neighbours that fit one frame, a lyric frame with
   its words), with a framing that leaves room ahead in the singing direction instead of locking the words dead centre.
   While it holds, the camera keeps drifting slowly that way (bounded so the words stay well inside the frame).
   Moves: the camera goes from stop to stop by *adding* eased displacements, p(t) = p0 + Σ Δᵢ·Eᵢ(t). Moves may overlap;
   then they blend into one continuous motion (no stop-and-go, no hesitation, never backwards along a move).
   Every constraint is solved here, while planning, not patched afterwards:
   - the words being sung stay inside the safe area: a move sets off later, or its framing widens to hold both;
   - a move longer than the camera can reasonably make (MAX_PAN frames, or faster than MAX_SPEED) becomes a quick blur
     transition instead of a long pull;
   - a lyric frame is part of the framing from the moment it is traced;
   - at the ending the camera stays with the last words (no pull-back).
   Styles: punch (a firm, short move landing exactly on each word), glide (continuous, unhurried, arriving a moment
   early), waltz (glide's path with livelier moves; its springy kicks come from the rhythm's cone signal at render). */
import { clamp, dirv, angDiff, lerp, mcubic } from '../core/math';
import { rnd } from '../core/rng';
import { eGlide, eWaltz, ePunch, eSettle, minJerk, type Ease } from '../core/ease';
import type { RhythmMap } from '../rhythm/map';
import type { Style } from '../theme/style';
import type { PWord, PLine, Passage, Stop, Move, CameraPlan, Pose } from './types';
import { boxIn, corners, wordZoom, tsz } from './layout';
import { timePassage, roomForQuick } from './passages';

export const EASES: Record<string, Ease> = { glide: eGlide, waltz: eWaltz, punch: ePunch, settle: eSettle, zoom: minJerk, cut: u => (u >= 1 ? 1 : u > 0 ? 1 : 0) };
const MAX_PAN = 1.1;           // frames: a move that must travel further than about a screen becomes a transition
const MAX_SPEED = 3.4;         // frames per second
const SAFE_X = 0.43, SAFE_Y = 0.40;   // half-extent of the safe area, share of the frame

export interface CameraInput { lines: PLine[]; words: PWord[]; passages: Passage[]; map: RhythmMap; style: Style; W: number; H: number; musicEnd: number; dur: number; introHold: number }

export function planCamera(inp: CameraInput): { camera: CameraPlan; extraPassages: Passage[] } {
  const { lines, map, style: st, W, H } = inp, M = st.m, T = tsz(st), cut = st.cut, sp = Math.max(0.3, M.speed);
  const smooth = cut !== 'punch', waltz = cut === 'waltz', TK = M.tilt;
  const passByLine = new Map(inp.passages.map(p => [p.line, p]));
  const med = new Map(lines.map(P => { const hs = P.words.filter(S => !S.vert).map(S => S.lh).sort((a, b) => a - b); return [P, hs.length ? hs[hs.length >> 1] : (P.words[0]?.lh ?? 150)]; }));
  const zOf = (S: PWord) => wordZoom(S, med.get(S.line)!, W, H, T);

  /* ---- stops ---- */
  const stops: Stop[] = [];
  for (const P of lines) {
    const ws = P.words; let k = 0;
    while (k < ws.length) {
      const S0 = ws[k], grp = [S0]; let j = k + 1;
      const z1 = zOf(S0) * 0.97;
      while (j < ws.length && (stops.length || P.i > 0 || grp.length > 1 || ws[j].w.group === S0.w.group)) {
        const Q = ws[j], last = grp[grp.length - 1];
        const fused = Q.w.group === last.w.group;                                   // one gesture: always together
        const quick = Q.w.t - last.end < 0.2 || Q.w.t - last.w.t < 0.45;
        if (!fused) {
          if (grp.length >= 3 || !quick || Math.abs(angDiff(Q.tilt, S0.tilt)) > 8) break;
          const B = boxIn([...grp, Q], S0.tilt); if (Math.min(W * 0.82 / B.w, H * 0.52 / B.h) < z1 * 0.6) break;
        }
        grp.push(Q); j++;
      }
      // a lyric frame traced on these words is part of what is framed
      const F = grp.find(S => S.frame && S.frame.words[S.frame.words.length - 1] === S)?.frame;
      const boxWords = F ? [...new Set([...grp, ...F.words])] : grp;
      const B = boxIn(boxWords, S0.tilt, F ? F.pad : 0);
      // (a lyric frame is small — a word or two — so it never pulls the camera closer than the words' own framing)
      let z = Math.min(Math.min(W * 0.8 / B.w, H * 0.5 / B.h) * T, W * (grp.length > 1 ? 0.7 : 0.78) / B.w, H * 0.6 / B.h, z1);
      if (F) z = Math.min(z, W * 0.8 / B.w, H * 0.58 / B.h);
      const last = grp[grp.length - 1], rd = P.rtl ? -1 : 1, dv = dirv(S0.ang);
      stops.push({ x: B.x, y: B.y, z, r: S0.tilt + (rnd(P.i * 41 + k * 6.1) - 0.5) * 12 * TK, d: grp.reduce((a, S) => a + S.d, 0) / grp.length,
        t: S0.w.t, arrive: 0, leave: 0, sungEnd: last.end, box: { x: B.x, y: B.y, w: B.w, h: B.h, tilt: S0.tilt }, dir: [dv[0] * rd, dv[1] * rd], drift: 0,
        cut: !!passByLine.get(P.i) && k === 0, over: false, rest: last.w.rest, words: grp });
      k = j;
    }
  }
  if (!stops.length) return { camera: emptyPlan(st), extraPassages: [] };
  // one closeness per line: no stop tighter than the line's typical framing, and at most 1.6× change between neighbours
  for (const P of lines) {
    const zs = stops.filter(s => s.words[0].line === P && !s.words.some(w => w.frame)).map(s => s.z).sort((a, b) => a - b); if (!zs.length) continue;
    const zm = zs[zs.length >> 1]; for (const s of stops) if (s.words[0].line === P) s.z = Math.min(s.z, zm * (s.words.some(w => w.frame) ? 1 : 1));
  }
  // neighbours: at most 1.6× change in closeness within a line, 2.2× across lines (more only across a cut)
  for (let i = 1; i < stops.length; i++) { const a = stops[i - 1], b = stops[i], k = a.words[0].line === b.words[0].line ? 1.6 : 2.2; if (!b.cut) b.z = clamp(b.z, a.z / k, a.z * k); }
  // a stop that is soon followed by a wider one already holds wider: no push-in only to pull out again
  for (let i = stops.length - 2; i >= 0; i--) { const a = stops[i], b = stops[i + 1]; if (!b.cut && b.t - a.t < 1.2 && b.z < a.z) a.z = Math.max(b.z, a.z * 0.85); }

  /* ---- composition: room ahead in the singing direction, and a slow drift that way while holding ---- */
  const leadK = cut === 'punch' ? 0.07 : 0.1, driftRate = cut === 'punch' ? 0.025 : 0.045;   // frame widths, per stop / per second
  /** Frames `bx` (a box in the stop's direction) at zoom ≤ s.z with room ahead: sets the stop's position, zoom and drift. */
  const compose = (s: Stop, bx: { x: number; y: number; w: number; h: number }) => {
    if (s.words.some(w => w.frame && w.frame.words[w.frame.words.length - 1] === w)) { s.x = bx.x; s.y = bx.y; s.drift = 0; return; }   // a lyric frame is framed whole, still
    // room to lead and drift: pull back a little (at most 15 %) when the words fill the safe area
    const want = 2.2 * leadK * W, zRoom = (W * SAFE_X - want) / Math.max(1, bx.w / 2);
    if (W * SAFE_X / s.z - bx.w / 2 < want / s.z && zRoom >= s.z * 0.85) s.z = Math.min(s.z, zRoom);
    const room = Math.max(0, W * SAFE_X / s.z - bx.w / 2), lead = Math.min(room * 0.5, leadK * W / s.z);
    s.x = bx.x + s.dir[0] * lead; s.y = bx.y + s.dir[1] * lead;
    s.drift = Math.max(0, Math.min(room - lead, driftRate * W / s.z * 2.5));
  };
  for (const s of stops) compose(s, s.box);

  /* ---- timing ---- */
  const lead = clamp(M.lead ?? 0.15, 0, 1.2), moves: Move[] = [], drifts: [number, number, number, number][] = [];
  const restSlow = (rest: number) => clamp((rest - 1) / 2);
  const intensity = (t: number) => clamp(0.35 + 0.65 * map.level(t));
  const start: Pose = { x: stops[0].x, y: stops[0].y, z: stops[0].z * (smooth ? 0.6 : 0.35), r: stops[0].r, d: stops[0].d };
  // the opening: from a wide view onto the first words (after the intro title, if one holds the camera wide)
  const d0 = (smooth ? 1.2 : 0.7) / sp, a0 = smooth ? stops[0].t - lead : stops[0].t;
  const s0 = Math.max(0, Math.min(Math.max(inp.introHold, a0 - d0), a0 - 0.3));
  stops[0].arrive = Math.max(a0, s0 + 0.3);
  const extraPass: Passage[] = [];
  const firstMove: Move = { s: s0, a: stops[0].arrive, dx: 0, dy: 0, dz: Math.log(stops[0].z / start.z), dr: 0, dd: 0, ease: smooth ? 'glide' : 'settle', bow: [0, 0] };
  moves.push(firstMove);
  for (let i = 1; i < stops.length; i++) {
    const A = stops[i - 1], B = stops[i], P = passByLine.get(B.words[0].line.i), isCut = B.cut && !!P;
    // where A's drift has taken the camera when it sets off
    const slow = restSlow(B.rest), bl = map.beatLen(B.t);
    let arrive: number, dur: number;
    if (isCut) { arrive = P!.t; dur = 0; }
    else if (smooth) {
      arrive = Math.max(A.arrive + 0.1, B.t - lead);
      if (slow > 0) arrive = Math.max(arrive, Math.min(B.t + 0.85 * slow / sp, B.sungEnd + 0.4 * B.rest));
      const gapT = arrive - A.arrive;
      dur = Math.min((waltz ? clamp(gapT * 0.45, 0.5 / sp, 1.3 / sp) : clamp(gapT * 0.62, 0.75 / sp, 1.9 / sp)) * (1 + 0.6 * slow), gapT * 0.9);
    } else {
      const lineStart = B.words[0].k === 0;
      dur = lineStart ? clamp(lerp(0.6, 0.3, intensity(B.t)) * Math.sqrt(bl / 0.5) / sp, 0.2, 0.5) : clamp(0.5 * bl, 0.18, 0.32) / sp;
      dur *= 1 + 0.8 * slow;
      arrive = B.t + (slow > 0 ? 0.25 * slow : 0);
      dur = Math.min(dur, Math.max(0.1, (B.t - A.t) * 0.85));
    }
    let s = arrive - dur;
    if (!isCut) {
      // stay until A's words are (nearly) sung, then go decisively
      s = Math.max(s, Math.min(A.sungEnd - 0.12, B.t - 0.25 / sp), A.arrive + 0.05);
      // a move always takes its time: a tight gap lands a moment late rather than snapping across
      // (in a quick succession of words the moves are as quick as the words: never longer than the time between them)
      const minDur = Math.min((smooth ? 0.45 : 0.4) / sp, Math.max(0.12, 0.85 * (B.t - A.t)));
      arrive = Math.max(arrive, Math.min(s + minDur, smooth ? Math.max(B.t + 0.12, s + Math.min(0.3, minDur)) : B.t + 0.12));
      // the words still being sung while the camera moves must stay in the safe area: B's framing holds them too
      // when that is a reasonable framing; otherwise the camera sets off only once they are sung
      if (A.sungEnd > s + 0.02) {
        const still = A.words.filter(S => S.end > s + 0.02);
        if (still.length && !fits([...still, ...B.words], B, W, H)) {
          const both = fitPose([...still, ...B.words], B.box.tilt, B.r, W, H, T), ub = boxIn([...still, ...B.words], B.box.tilt);
          if (both.z > B.z * (smooth ? 0.5 : 0.6) && fits([...still, ...B.words], { ...B, x: both.x, y: both.y, z: Math.min(B.z, both.z) }, W, H)) { B.z = Math.min(B.z, both.z); compose(B, ub);
            if (!fits([...still, ...B.words], B, W, H)) { B.x = both.x; B.y = both.y; B.drift = 0; } }
          else if (smooth) { s = Math.max(s, A.sungEnd - 0.12); arrive = Math.max(arrive, Math.min(s + Math.max(0.45 / sp, dur * 0.8), Math.max(B.t + 0.2, s + Math.min(0.3, Math.max(0.12, 0.85 * (B.t - A.t)))))); }
          // the hard cut lands on the word: the last moment of the word before (its sustain) may leave the frame first
        }
      }
      // A's hold drift: from its arrival until this move begins
      { const h0 = A.arrive, h1 = Math.max(h0, s);
        if (A.drift > 0 && h1 - h0 > 0.2 && !A.over) { const dd = Math.min(A.drift, A.drift * (h1 - h0) / 2.5); drifts.push([h0, h1, A.dir[0] * dd, A.dir[1] * dd]); A.x += A.dir[0] * dd; A.y += A.dir[1] * dd; } }
      // too far or too fast for one move: a quick transition instead (when the pause allows one)
      const zm = Math.abs(B.z - A.z) > 1e-6 ? (B.z - A.z) / Math.log(B.z / A.z) : A.z, D = Math.hypot(B.x - A.x, B.y - A.y) * zm / W, gapT = B.words[0].show - A.sungEnd;   // apparent travel: the log-mean closeness
      // (only for a move far beyond what a camera can make, and only when the pause leaves room: a long move is better
      //  than a needless clear, and no clear may hide words still being sung)
      if ((D > MAX_PAN || D / Math.max(0.05, arrive - s) > MAX_SPEED) && roomForQuick(A.sungEnd, B.words[0].show) && B.words[0].k === 0) {
        const tm = timePassage(A.sungEnd, B.words[0].show, map, true);
        const pg: Passage = { ...tm, line: B.words[0].line.i, quick: true, reason: 'distance' }; extraPass.push(pg); passByLine.set(pg.line, pg);
        B.cut = true; arrive = pg.t; s = arrive;
      }
    }
    B.arrive = arrive;
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
    let bow: [number, number] = [0, 0];
    if (smooth && !B.cut && L > 1) { const C = stops[i + 1], nx = -dy / L, ny = dx / L; let side = rnd(i * 3.7 + 1) < 0.5 ? -1 : 1, turn = 0;
      if (C && !C.cut) { const cx = C.x - B.x, cy = C.y - B.y, lc = Math.hypot(cx, cy); if (lc > 1) { const cr = (dx * cy - dy * cx) / (L * lc), dt = (dx * cx + dy * cy) / (L * lc); turn = clamp((1 - dt) / 1.5); if (Math.abs(cr) > 0.05) side = cr > 0 ? -1 : 1; } }
      const a = L * (0.0125 + 0.03 * turn); bow = [nx * a * side, ny * a * side]; }
    moves.push({ s, a: B.cut ? s : arrive, dx, dy, dz: Math.log(B.z / A.z), dr: angDiff(B.r, A.r), dd: B.d - A.d, ease: B.cut ? 'cut' : smooth ? (waltz ? 'waltz' : 'glide') : (slow > 0 ? 'glide' : 'punch'), bow });
  }
  // the last stop drifts until the ending
  const lastS = stops[stops.length - 1];

  /* ---- the ending: no pull-back — the camera stays with the last words and keeps drifting gently until the end ---- */
  { const go = Math.max(inp.musicEnd, lastS.sungEnd, lastS.arrive + 0.2) + 3;
    if (lastS.drift > 0 && go - lastS.arrive > 0.2) { const dd = Math.min(lastS.drift, lastS.drift * (go - lastS.arrive) / 2.5); drifts.push([lastS.arrive, go, lastS.dir[0] * dd, lastS.dir[1] * dd]); lastS.x += lastS.dir[0] * dd; lastS.y += lastS.dir[1] * dd; } }

  /* ---- cuts: the jump the base path makes at each transition (the backdrop does not follow these) ---- */
  const plan: CameraPlan = { style: cut, start, stops, moves, drifts, cuts: [], idle: idleWindows(lines, inp.musicEnd),
    dyn: { cone: (cut === 'punch' ? 0.03 : waltz ? 0.026 : 0.016) * clamp(M.punch + 0.4, 0.2, 2), coneRoll: (cut === 'punch' ? 0.5 : waltz ? 1.1 : 0.35) * TK * clamp(M.shake + 0.3, 0, 2),
      float: (0.45 + (M.float ?? 0)), sway: M.sway } };
  for (const m of moves) if (m.ease === 'cut') plan.cuts.push({ t: m.s, dx: m.dx, dy: m.dy, dz: m.dz, dr: m.dr });
  // the frame's answer to arrivals: a spring kick for the waltz, a firm nudge for punch, sized by how hard the music hits
  const sounding = (t: number) => map.sounding(t);
  if (waltz) plan.kicks = stops.filter(s => !s.over && s.t > 0.3 && (s.words[0].k === 0 || map.accentAt(s.t) >= 1.3)).map(s => ({ t: map.snap(s.t, 0.09),
    a: clamp(map.accentAt(s.t) - 0.45, 0.15, 1.05) * (0.6 + 0.6 * intensity(s.t)) * sounding(s.t), sg: rnd(s.t * 13.7) < 0.5 ? -1 : 1, px: Math.cos(rnd(s.t * 7.3) * 6.283), py: Math.sin(rnd(s.t * 7.3) * 6.283) }));
  if (!smooth) plan.arrivals = stops.filter(s => !s.over && !s.cut && s.t > 0.3).map(s => ({ t: s.arrive, ang: rnd(s.t * 7.13) * 6.283, sg: rnd(s.t * 3.3) < 0.5 ? -1 : 1, k: (0.5 + 0.7 * intensity(s.t)) * (s.words[0].k === 0 ? 1 : 0.6) }));
  plan.path = smoothPath(plan, inp.dur, cut, sp, stops.find(s => s.over) ? moves[moves.length - 1].s : Infinity);
  // each cut's jump as the smoothed path really makes it (the backdrop's camera takes exactly this out, so it never jumps)
  { const Pp = plan.path; for (const k of plan.cuts) { const f = Math.min(Pp.n - 1, Math.max(1, Math.ceil(k.t * Pp.rate - 1e-9)));
    k.dx = Pp.x[f] - Pp.x[f - 1]; k.dy = Pp.y[f] - Pp.y[f - 1]; k.dz = Pp.lz[f] - Pp.lz[f - 1]; k.dr = Pp.r[f] - Pp.r[f - 1]; } }
  return { camera: plan, extraPassages: extraPass };
}

/** A framing that holds these words in the safe area, centred on them (the zoom at most what one word would get). */
function fitPose(ws: PWord[], tilt: number, r: number, W: number, H: number, T: number) {
  const B = boxIn(ws, tilt), z = Math.min(W * 2 * SAFE_X * 0.96 / B.w, H * 2 * SAFE_Y * 0.96 / B.h, W * 0.8 / B.w * T);
  return { x: B.x, y: B.y, z };
}
/** Does a stop's framing hold these words inside the safe area? */
function fits(ws: PWord[], s: Stop, W: number, H: number): boolean {
  const cr = Math.cos(-s.r * Math.PI / 180), sr = Math.sin(-s.r * Math.PI / 180), ax = W * SAFE_X, ay = H * SAFE_Y;
  for (const S of ws) for (const p of corners(S)) { const dx = p[0] - s.x, dy = p[1] - s.y, qx = (dx * cr - dy * sr) * s.z, qy = (dx * sr + dy * cr) * s.z; if (Math.abs(qx) > ax || Math.abs(qy) > ay) return false; }
  return true;
}

/** Long intros, instrumentals and outros: after five seconds of waiting the camera goes idle until just before the next words. */
function idleWindows(lines: PLine[], musicEnd: number) {
  const out: { a: number; b: number }[] = [], WAIT = 5;
  const add = (g0: number, g1: number, isOut: boolean) => { if (g1 - g0 >= WAIT + 1.4) out.push({ a: g0 + WAIT, b: g1 - (isOut ? 0.2 : 0.6) }); };
  const endOf = (P: PLine) => Math.min(P.L.sung, P.L.end, P.secEnd);
  if (lines.length) { add(0, lines[0].L.t, false); for (let i = 1; i < lines.length; i++) add(endOf(lines[i - 1]), lines[i].L.t, false); add(endOf(lines[lines.length - 1]), musicEnd, true); }
  return out;
}
function emptyPlan(st: Style): CameraPlan {
  const p: Pose = { x: 0, y: 0, z: 1, r: 0, d: 0 };
  return { style: st.cut, start: p, stops: [], moves: [], drifts: [], cuts: [], idle: [], dyn: { cone: 0, coneRoll: 0, float: 0, sway: 0 } };
}

/** The path the camera really follows: the planned moves sampled, then given inertia — a light gaussian rounds off every
 *  start and landing, distance changes are smoothed longer and softer than the pan, and a zoom envelope looks a little
 *  ahead and holds the widest framing coming up, so the camera eases out once instead of pushing in and pulling out
 *  within a couple of seconds. Nothing is smoothed or looked ahead across a cut, nor into the ending's pull-back. */
const RATE = 60;
function smoothPath(c: CameraPlan, dur: number, style: string, sp: number, overStart: number): NonNullable<CameraPlan['path']> {
  const n = Math.ceil((dur + 1) * RATE) + 1, waltz = style === 'waltz', punch = style === 'punch';
  const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n), R = new Float32Array(n), Dd = new Float32Array(n), seg = new Int32Array(n);
  const cuts = c.cuts.map(k => k.t).sort((a, b) => a - b);
  // (a sample on a cut belongs to the new passage, as its segment says: it is read just after the cut)
  for (let f = 0, ci = 0; f < n; f++) { const t = f / RATE; while (ci < cuts.length && t >= cuts[ci]) ci++; seg[f] = ci;
    const b = rawPose(c, t + 1e-6); X[f] = b.x; Y[f] = b.y; Z[f] = Math.log(b.z); R[f] = b.r; Dd[f] = b.d; }
  const lo = new Int32Array(n), hi = new Int32Array(n);
  for (let f = 0; f < n; f++) lo[f] = f > 0 && seg[f - 1] === seg[f] ? lo[f - 1] : f;
  for (let f = n - 1; f >= 0; f--) hi[f] = f < n - 1 && seg[f + 1] === seg[f] ? hi[f + 1] : f;
  const overF = Math.min(n, Math.floor(overStart * RATE));
  // zoom envelope (the widest framing a moment ahead, never more than 1.25x wider than now)
  if (!punch) { const ahead = Math.round(Math.min(1.4, (waltz ? 0.6 : 0.9) / sp) * RATE), back = Math.round(0.35 * RATE), Zr = Z.slice(), maxWide = Math.log(1.25);
    for (let f = 0; f < overF; f++) { let m = Zr[f]; const a = Math.max(lo[f], f - back), b = Math.min(overF - 1, hi[f], f + ahead); for (let j = a; j <= b; j++) if (Zr[j] < m) m = Zr[j]; Z[f] = Math.max(m, Zr[f] - maxWide); } }
  const gauss = (a: Float32Array, sig: number) => { const rad = Math.max(1, Math.round(sig * RATE * 3)), ker: number[] = []; let ks = 0;
    for (let k = -rad; k <= rad; k++) { const v = Math.exp(-0.5 * (k / (sig * RATE)) ** 2); ker.push(v); ks += v; }
    const o = new Float32Array(n); for (let f = 0; f < n; f++) { let v = 0; for (let k = -rad; k <= rad; k++) { const g = f + k; v += a[g < lo[f] ? lo[f] : g > hi[f] ? hi[f] : g] * ker[k + rad]; } o[f] = v / ks; } return o; };
  const ps = punch ? 0.035 : waltz ? 0.08 : 0.12, zsig = (punch ? 0.12 : waltz ? 0.3 : 0.45) / sp;
  return { rate: RATE, n, seg, cutT: cuts, x: gauss(X, ps), y: gauss(Y, ps), lz: gauss(Z, zsig), r: gauss(R, ps), d: gauss(Dd, ps) };
}
/** The planned camera at t (on its smoothed path when there is one). Pure. */
export function basePose(c: CameraPlan, t: number): Pose & { tx: number; ty: number } {
  const P = c.path; if (!P) return rawPose(c, t);
  // read along a curve through the samples that never overshoots them, and never across a cut
  const u = clamp(t * P.rate, 0, P.n - 1), f = Math.floor(u), k = u - f, n1 = P.n - 1, sg = P.seg;
  let f0 = Math.max(0, f - 1), f2 = Math.min(n1, f + 1), f3 = Math.min(n1, f + 2);
  // between the last sample before a cut and the first after it: the cut happens exactly at its own time, not on a sample
  if (sg[f2] !== sg[f] && t >= (P.cutT[sg[f]] ?? Infinity)) return { x: P.x[f2], y: P.y[f2], z: Math.exp(P.lz[f2]), r: P.r[f2], d: P.d[f2], tx: 0, ty: 0 };
  if (sg[f0] !== sg[f]) f0 = f; if (sg[f2] !== sg[f]) f2 = f; if (sg[f3] !== sg[f2]) f3 = f2;
  const L = (a: Float32Array) => mcubic(a[f0], a[f], a[f2], a[f3], k);
  return { x: L(P.x), y: L(P.y), z: Math.exp(L(P.lz)), r: L(P.r), d: L(P.d), tx: 0, ty: 0 };
}
/** The planned camera at t, before smoothing: start + every move and drift so far, each through its own ease. */
export function rawPose(c: CameraPlan, t: number): Pose & { tx: number; ty: number } {
  let x = c.start.x, y = c.start.y, lz = Math.log(c.start.z), r = c.start.r, d = c.start.d;
  for (const m of c.moves) {
    if (t <= m.s) continue;
    const span = m.a - m.s, u = span <= 0 ? 1 : clamp((t - m.s) / span), e = EASES[m.ease](u);
    x += m.dx * e; y += m.dy * e; r += m.dr * e; d += m.dd * e;
    // zoom eases over a slightly longer window, so changes in distance stay softer than the pan
    const zs = m.s - span * 0.15, za = m.a + span * 0.25, uz = span <= 0 ? 1 : clamp((t - zs) / (za - zs)); lz += m.dz * minJerk(uz);
    if (u > 0 && u < 1) { const q = 4 * e * (1 - e); x += m.bow[0] * q; y += m.bow[1] * q; }
  }
  for (const [a, b, dx, dy] of c.drifts) { if (t <= a) continue; const e = minJerk(clamp((t - a) / Math.max(1e-3, b - a))); x += dx * e; y += dy * e; }
  return { x, y, z: Math.exp(lz), r, d, tx: 0, ty: 0 };
}
