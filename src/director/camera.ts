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
   - inside a stop the camera follows the singing character by character, left to right (along a column, down it): a
     long word is never shrunk to fit, the camera frames a stretch of it and travels along it as it is sung.
   Styles: punch (quick steps from character to character, a firm short move to each word, turns cut hard), waltz (a
   steady follow at a moderate pace; moves take a bend like a car a corner — wide on the way in, leaning into it, the
   turn on a curve; springy kicks on accented arrivals), glide (never stops: it slides on toward the next character,
   starting only as early as keeps it out of the empty space of a long pause; turns land long and soft), close (glide,
   but close on each character, so the travel along the words is plain to see; more of the way is crossed by quick
   blur transitions). */
import { clamp, dirv, angDiff, lerp, mcubic, D2R } from '../core/math';
import { rnd } from '../core/rng';
import { rollDur } from './scenes';
import { eGlide, eWaltz, ePunch, eSettle, eSpring, minJerk, type Ease } from '../core/ease';
import type { RhythmMap } from '../rhythm/map';
import type { Style } from '../theme/style';
import type { PWord, PLine, Passage, Stop, Move, CameraPlan, Pose, UBox } from './types';
import { boxIn, corners, wordZoom, tsz, centerZoom } from './layout';
import { timePassage, roomForQuick } from './passages';

export const EASES: Record<string, Ease> = { lin: u => u, cruise: u => 0.5 * u + 0.5 * (1 - (1 - u) ** 2), reach: u => 1 - (1 - u) ** 2.4,   // (a long way: most of it at once, landing on the move)
     // (off at pace, still moving as it lands: it never comes to a stop)
   swing: eSpring(1.05, 0.16), roll: eSpring(1.2, 0.12), glide: eGlide, waltz: eWaltz, punch: ePunch, settle: eSettle, zoom: minJerk, cut: u => (u >= 1 ? 1 : u > 0 ? 1 : 0) };
const MAX_PAN = 1.1;           // frames: a move that must travel further than about a screen becomes a transition
const MAX_PAN_CLOSE = 0.55;    // (close up, half a screen: more of the way is crossed by blur transitions)
const MAX_SPEED = 3.4;         // frames per second
const SAFE_X = 0.43, SAFE_Y = 0.40;   // half-extent of the safe area, share of the frame

export interface CameraInput { lines: PLine[]; words: PWord[]; passages: Passage[]; map: RhythmMap; style: Style; W: number; H: number; musicEnd: number; dur: number; introHold: number }

export function planCamera(inp: CameraInput): { camera: CameraPlan; extraPassages: Passage[] } {
  if (inp.style.cut === 'center') return { camera: planCenter(inp), extraPassages: [] };
  const { lines, map, style: st, W, H } = inp, M = st.m, T = tsz(st), cut = st.cut, sp = Math.max(0.3, M.speed);
  // (hover: the camera of before the follow — it rests over the middle of the words — on the waltz's curves)
  const smooth = cut !== 'punch', hover = cut === 'hover', waltz = cut === 'waltz' || hover, close = cut === 'close', TK = M.tilt;
  const passByLine = new Map(inp.passages.map(p => [p.line, p]));
  // (a line set in columns: its characters' size is the columns' width, not their length — so a column is framed a few
  // characters at a time and travelled down as it is sung, as a long row is travelled along)
  const med = new Map(lines.map(P => { const hs = P.words.filter(S => !S.vert).map(S => S.lh).sort((a, b) => a - b), vs = P.words.map(S => S.lw).sort((a, b) => a - b);
    return [P, hs.length ? hs[hs.length >> 1] : vs.length ? vs[vs.length >> 1] : 150]; }));
  const zOf = (S: PWord) => wordZoom(S, med.get(S.line)!, W, H, T);

  /* ---- stops ---- */
  const stops: Stop[] = [];
  for (const P of lines) {
    const ws = P.words; let k = 0;
    while (k < ws.length) {
      const S0 = ws[k], grp = [S0]; let j = k + 1;
      const z1 = zOf(S0) * 0.97;
      // a line laid heading back (leftward): hovered over, as the hover style does — the camera over the middle of each
      // group of its words, drifting a little on — never following along its characters, which would run it right
      // against the way the lines go, nor holding the whole line still (columns are travelled down as ever)
      const west = !!P.west && !hover && !P.scene && !ws.some(S => S.vert || S.roll || S.frame);
      while (j < ws.length && (stops.length || P.i > 0 || grp.length > 1 || ws[j].w.group === S0.w.group)) {
        const Q = ws[j], last = grp[grp.length - 1];
        const fused = Q.w.group === last.w.group;                                   // one gesture: always together
        const quick = Q.w.t - last.end < 0.2 || Q.w.t - last.w.t < 0.45;
        if (!fused) {
          // (a column is a stop of its own: the camera goes down it, then on to the next, as from row to row)
          if (grp.length >= (close || S0.vert ? 1 : 3) || !quick || Math.abs(angDiff(Q.tilt, S0.tilt)) > 8) break;
          const B = boxIn([...grp, Q], S0.tilt); if (Math.min(W * 0.82 / B.w, H * 0.52 / B.h) < z1 * 0.6) break;
        }
        grp.push(Q); j++;
      }
      // a lyric frame traced on these words is part of what is framed
      const F = grp.find(S => S.frame && S.frame.words[S.frame.words.length - 1] === S)?.frame;
      const boxWords = F ? [...new Set([...grp, ...F.words])] : grp;
      const B = boxIn(boxWords, S0.tilt, F ? F.pad : 0);
      // (a lyric frame is small — a word or two — so it never pulls the camera closer than the words' own framing)
      // (the words' height sets the closeness; a group wider than the frame is not shrunk to fit: the camera follows the
      // singing along it, so it stays as close as one word would be framed)
      let z = hover || west ? Math.min(Math.min(W * 0.8 / B.w, H * 0.5 / B.h) * T, W * (grp.length > 1 ? 0.7 : 0.78) / B.w, H * 0.6 / B.h, z1) : Math.min(H * 0.5 / B.h * T, H * 0.6 / B.h, z1);
      // (a column: its characters' size sets the closeness, as a row's height does — about three of them down the frame,
      // the rest travelled as they are sung — never the whole column shrunk to fit the frame's height)
      if (!hover && grp.every(S => S.vert)) { const cw = Math.max(1, ...grp.map(S => S.lw)); z = Math.min(H * 0.55 / cw * T, H * 0.63 / cw, H * 0.77 / clamp(B.h, cw * 2, cw * 3.2), W * 0.8 / B.w); }
      // (a framed word is shown whole, the camera pulling back for it — a column framed less far: it is long, not wide)
      if (F) z = Math.min(z, W * 0.8 / B.w, H * (grp.every(S => S.vert) ? 0.76 : 0.58) / B.h);
      // close up: a character about two fifths of the frame high (the one being sung always wholly in view)
      if (close && !F && !west) { const us = grp.flatMap(S => S.units), uh = us.map(u => u.h).sort((a, b) => a - b)[us.length >> 1] || B.h, uw = Math.max(...us.map(u => u.w), 1), uhm = Math.max(...us.map(u => u.h), 1);
        z = Math.min(H * 0.4 / uh * T, W * 0.5 / uw, H * 0.62 / uhm); }
      const last = grp[grp.length - 1], rd = P.rtl ? -1 : 1, dv = dirv(S0.ang);
      stops.push({ x: B.x, y: B.y, z, r: S0.tilt + (rnd(P.i * 41 + k * 6.1) - 0.5) * 6 * TK, d: grp.reduce((a, S) => a + S.d, 0) / grp.length,
        t: S0.w.t, arrive: 0, leave: 0, sungEnd: last.end, box: { x: B.x, y: B.y, w: B.w, h: B.h, tilt: S0.tilt }, dir: [dv[0] * rd, dv[1] * rd], drift: 0,
        cut: !!passByLine.get(P.i) && k === 0, over: false, rest: last.w.rest, words: grp, roll: S0.roll || 0, ...(west ? { hov: true } : {}) });
      k = j;
    }
  }
  if (!stops.length) return { camera: emptyPlan(st), extraPassages: [] };
  // one closeness per line: no stop tighter than the line's typical framing, and at most 1.6× change between neighbours
  for (const P of lines) {
    const zs = stops.filter(s => s.words[0].line === P && !s.words.some(w => w.frame)).map(s => s.z).sort((a, b) => a - b); if (!zs.length) continue;
    const zm = zs[zs.length >> 1]; for (const s of stops) if (s.words[0].line === P) s.z = Math.min(s.z, zm * (close ? 1.25 : 1));
  }
  // neighbours: at most 1.6× change in closeness within a line, 2.2× across lines (more only across a cut)
  for (let i = 1; i < stops.length; i++) { const a = stops[i - 1], b = stops[i], k = a.words[0].line === b.words[0].line ? 1.6 : 2.2; if (!b.cut) b.z = b.hov ? Math.min(b.z, a.z * k) : clamp(b.z, a.z / k, a.z * k); }   // (a line hovered over is never pushed in past fitting)
  // a stop that is soon followed by a wider one already holds wider: no push-in only to pull out again
  if (!close) for (let i = stops.length - 2; i >= 0; i--) { const a = stops[i], b = stops[i + 1]; if (!b.cut && b.t - a.t < 1.2 && b.z < a.z) a.z = Math.max(b.z, a.z * 0.85); }

  /* ---- composition: the follow along the characters, room ahead in the singing direction, a slow drift on ----
     The camera's centre for each character c_j (along the follow axis, from the box's centre) sits a little ahead of
     it, so the frame leads the voice; while the words all fit it stays where they all show (a smaller travel inside
     them), and a longer stretch is travelled from one end to the other, the character being sung always in view. Never
     backwards along it. Each step is timed by the style (punch: a quick step on the character; waltz: a steady one
     around it; glide and close: on the way the whole time from the character before, setting off no earlier than
     LEAD before the next one, and only creeping through a long pause). */
  const LEADK = { punch: 0.08, waltz: 0.09, glide: 0.1, close: 0.07 }[cut as 'punch'] ?? 0.08;
  const driftRate = cut === 'punch' ? 0.03 : 0.05, LEADT = (close ? 0.8 : 1) / sp;
  const track = (s: Stop) => {
    // hovering: the words framed whole, the camera over their middle with a little room ahead, drifting slowly that way
    // (a line heading back leans and drifts the way the lines go — leftward on the screen — not the way its characters read)
    if (hover || s.hov) { const dv: [number, number] = s.hov ? [-1, 0] : s.dir; s.follow = []; s.fax = dv; s.head = s.words.map(ubox); s.ubox = unitBoxes(s.words);
      if (s.words.some(w => w.frame && w.frame.words[w.frame.words.length - 1] === w)) { s.x = s.box.x; s.y = s.box.y; s.drift = 0; return; }
      const room = Math.max(0, W * SAFE_X / s.z - s.box.w / 2), ld = Math.min(room * 0.5, 0.1 * W / s.z);
      s.x = s.box.x + dv[0] * ld; s.y = s.box.y + dv[1] * ld; s.drift = Math.max(0, Math.min(room - ld, 0.045 * W / s.z * 2.5)); return; }
    s.follow = []; s.fax = s.dir; s.head = s.words.map(ubox); s.ubox = unitBoxes(s.words);
    if (s.words.some(w => w.frame && w.frame.words[w.frame.words.length - 1] === w)) { s.x = s.box.x; s.y = s.box.y; s.drift = 0; return; }   // a lyric frame is framed whole, still
    const U = s.ubox; if (!U.length) { s.x = s.box.x; s.y = s.box.y; s.drift = 0; return; }
    // along the reading direction; down a column for vertical words
    const across = s.words.every(w => w.vert), ax: [number, number] = across ? dirv(s.box.tilt + 90) : s.dir; s.fax = ax;
    const V = (across ? H * SAFE_Y : W * SAFE_X) / s.z * 0.94;
    const pos = U.map(u => (u.x - s.box.x) * ax[0] + (u.y - s.box.y) * ax[1]), half = U.map(u => (across ? u.lh : u.lw) / 2);
    const leadW = LEADK * (across ? H * 1.2 : W) / s.z;
    // the centre a little behind the character being sung: the character sits just right of the middle, what was
    // sung trailing to its left — the camera follows the voice, never runs ahead of it — and always in view
    const c: number[] = [];
    pos.forEach((p, j) => { let v = p - leadW;
      v = clamp(v, p + half[j] - V, p - half[j] + V);
      c.push(j ? Math.max(v, c[j - 1]) : v); });
    s.x = s.box.x + ax[0] * c[0]; s.y = s.box.y + ax[1] * c[0];
    s.head = U.filter((u, j) => Math.abs(pos[j] - c[0]) + half[j] <= V);
    for (let j = 1; j < U.length; j++) { const dc = c[j] - c[j - 1]; if (dc < 0.5) continue;
      const t0 = U[j - 1].t, t1 = U[j].t, gap = Math.max(0.02, t1 - t0), dx = ax[0] * dc, dy = ax[1] * dc;
      // punch: the glide's follow, quicker and crisper (a short drive onto each character); waltz: a steady step around it
      if (cut === 'punch') s.follow.push([t1 - Math.min(0.06, gap * 0.35), t1 + clamp(0.7 * gap, 0.1, 0.2 / sp), dx, dy, 'punch']);
      else if (cut === 'waltz') s.follow.push([t1 - Math.min(0.22, gap * 0.45), t1 + clamp(0.6 * gap, 0.12, 0.35 / sp), dx, dy, 'zoom']);
      else if (gap <= LEADT + 0.05) s.follow.push([j === 1 ? t0 - 0.35 : t0, t1 + 0.08, dx, dy, 'lin']);   // (the first a moment before: no pause on it)
      else { s.follow.push([t0, t1 - LEADT, dx * 0.12, dy * 0.12, 'lin']); s.follow.push([t1 - LEADT, t1 + 0.08, dx * 0.88, dy * 0.88, 'lin']); }   // creep through the pause, then on
    }
    // on after the last character, as far as keeps it in view (and all of it, when it all fits)
    const j = U.length - 1, cl = c[j], room = pos[j] - half[j] + V * 0.9 - cl;
    s.drift = Math.max(0, Math.min(room, driftRate * W / s.z * 2.5));
  };
  for (const s of stops) track(s);

  /** Starts a stop's framing from (x, y) instead: its follow then makes up the difference on the way to where it ends
   *  (none, if it ends behind there). */
  const retarget = (B: Stop, x: number, y: number) => { const ax = B.fax || B.dir, F = B.follow || [];
    const tot = F.reduce((a, f) => a + f[2] * ax[0] + f[3] * ax[1], 0), off = (x - B.x) * ax[0] + (y - B.y) * ax[1], k = tot > 1e-6 ? Math.max(0, (tot - off) / tot) : 0;
    B.follow = F.map(f => [f[0], f[1], f[2] * k, f[3] * k, f[4]]); if (!k) B.drift = 0; B.x = x; B.y = y; };
  /** Lays a stop's follow into the drifts (each step finished by `by`, when the camera leaves) and moves the stop to
   *  where it ends; returns when the last step lands. */
  const follow = (A: Stop, by: number) => { let end = A.arrive;
    for (const [a0, b0, dx, dy, e] of A.follow || []) { if (Math.hypot(dx, dy) < 1e-3) continue;
      // (from the arrival on: a follow never runs into the move bringing the camera here)
      // (a character sung before the camera landed is caught up right after it lands, never during the move in)
      const a = Math.max(A.arrive, Math.min(a0, by - 0.04, b0 - 0.04)), b = Math.max(a + 0.04, Math.min(b0 <= A.arrive ? a + 0.12 : b0, by));
      drifts.push([a, b, dx, dy, e]); A.x += dx; A.y += dy; end = Math.max(end, b); }
    A.follow = []; return end; };

  // glide and close never stop: their moves keep the pace they arrive with (a steady run, rounded by the smoothing)
  const glideE = cut === 'glide' || close ? 'cruise' : 'glide';
  const lastSung = (A: Stop) => { const U = A.ubox || []; return U.length ? U[U.length - 1].t : A.t; };
  /* ---- timing ---- */
  // (each lyric frame and the stop that frames it)
  const frameStop = new Map<NonNullable<PWord['frame']>, number>(); stops.forEach((s, k) => s.words.forEach(w => { if (w.frame && w.frame.words[w.frame.words.length - 1] === w) frameStop.set(w.frame, k); }));
  const lead = clamp(M.lead ?? 0.15, 0, 1.2), moves: Move[] = [], drifts: CameraPlan['drifts'] = [];
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
    if (isCut) { arrive = P!.t; dur = 0; follow(A, arrive); }
    else if (smooth) {
      arrive = Math.max(A.arrive + 0.1, B.t - lead);
      // (slower into the last words before a rest — but landing while they are sung, never after: the slowness is in the
      // move, not in arriving late)
      if (slow > 0) arrive = Math.max(arrive, Math.min(B.t + 0.85 * slow / sp, B.sungEnd + 0.4 * B.rest, B.t + 0.35));
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
      // close up, the last character is sung before the camera leaves it (just as the next word is about to be)
      if (close) s = Math.max(s, Math.min(lastSung(A) + 0.04, B.t - 0.12));
      // (and when the next words are back to the left — a new line — the held last character is seen out first: going
      // back, it would leave the frame at once)
      if (close) { const ax = A.fax || A.dir; if ((B.x - A.x) * ax[0] + (B.y - A.y) * ax[1] < 0) s = Math.max(s, Math.min(A.sungEnd - 0.2, B.t - 0.06)); }
      // a lyric frame is held whole for its time on screen before the camera goes on
      { const Fa = A.words.find(w => w.frame)?.frame; if (Fa) s = Math.max(s, Math.min(Fa.ts + 1.25, B.t - 0.05)); }
      // a move always takes its time: a tight gap lands a moment late rather than snapping across
      // (in a quick succession of words the moves are as quick as the words: never longer than the time between them)
      const minDur = Math.min((smooth ? 0.45 : 0.4) / sp, Math.max(0.12, 0.85 * (B.t - A.t)));
      arrive = Math.max(arrive, Math.min(s + minDur, smooth ? Math.max(B.t + 0.12, s + Math.min(0.3, minDur)) : B.t + 0.12));
      // the words still being sung while the camera moves must stay in the safe area: B's framing holds them too
      // when that is a reasonable framing; otherwise the camera sets off only once they are sung
      if (A.sungEnd > s + 0.02) {
        const still = A.ubox!.filter(u => u.end > s + 0.02), head = B.head!;
        if (still.length && !close && !fits([...still, ...head], B, W, H)) {
          const both = fitPose([...still, ...head], B.box.tilt, B.r, W, H, T);
          // (a column is not widened to hold the end of the one before — the travel down it would flatten: it waits instead)
          const col = B.words.every(w => w.vert);
          if (both.z > B.z * (col ? 0.85 : smooth ? 0.5 : 0.6) && fits([...still, ...head], { ...B, x: both.x, y: both.y, z: Math.min(B.z, both.z) }, W, H)) { B.z = Math.min(B.z, both.z); track(B);
            if (!fits([...still, ...B.head!], B, W, H)) retarget(B, both.x, both.y); }
          else if (smooth) { s = Math.max(s, A.sungEnd - 0.12); arrive = Math.max(arrive, Math.min(s + Math.max(0.45 / sp, dur * 0.8), Math.max(B.t + 0.2, s + Math.min(0.3, Math.max(0.12, 0.85 * (B.t - A.t)))))); }
          // the hard cut lands on the word: the last moment of the word before (its sustain) may leave the frame first
        }
      }
      // a lyric frame still drawn when the camera comes here (the words after it are sung while it shows): this framing
      // holds it too — the camera pulls back and moves over it and the words, holding still — or, were that too far,
      // the frame fades as the camera leaves it, never left cut off at the edge
      for (const [F, fi] of frameStop) { if (fi >= i) continue; const fEnd = Math.min(F.until ?? Infinity, F.words[0].line.L.end - 0.8) + 0.8; if (arrive >= fEnd || F.ts > arrive + 2) continue;
        const fb = F.words.map(S => ({ x: S.x, y: S.y, lw: S.lw + F.pad * 2, lh: S.lh + F.pad * 2, tilt: S.tilt })), all = [...fb, ...(B.ubox || [])];
        if (fits(all, B, W, H)) continue;
        const both = fitPose(all, B.box.tilt, B.r, W, H, T);
        if (both.z >= B.z * 0.3 && fits(all, { ...B, x: both.x, y: both.y, z: Math.min(B.z, both.z) }, W, H)) { B.z = Math.min(B.z, both.z); B.x = both.x; B.y = both.y; B.follow = []; B.drift = 0; B.head = B.ubox || []; }
        else F.until = Math.min(F.until ?? Infinity, s); }
      // A's follow along its characters (finished by the time the camera leaves), then its hold drift until it does
      const fEnd = follow(A, s);
      // (the drift on begins once the last character is sung, never while the words are still waiting to be sung)
      { const h0 = Math.max(A.arrive, fEnd, lastSung(A)), h1 = Math.max(h0, s), ax = A.fax || A.dir;
        if (A.drift > 0 && h1 - h0 > 0.2 && !A.over) { const dd = Math.min(A.drift, A.drift * (h1 - h0) / 2.5); drifts.push([h0, h1, ax[0] * dd, ax[1] * dd, smooth ? 'lin' : undefined]); A.x += ax[0] * dd; A.y += ax[1] * dd; } }
      // too far or too fast for one move: a quick transition instead (when the pause allows one)
      const zm = Math.abs(B.z - A.z) > 1e-6 ? (B.z - A.z) / Math.log(B.z / A.z) : A.z, D = Math.hypot(B.x - A.x, B.y - A.y) * zm / W;   // apparent travel: the log-mean closeness
      // (only for a move far beyond what a camera can make, and only when the pause leaves room: a long move is better
      //  than a needless clear, and no clear may hide words still being sung)
      if ((D > (close ? MAX_PAN_CLOSE : MAX_PAN) || D / Math.max(0.05, arrive - s) > MAX_SPEED) && roomForQuick(A.sungEnd, B.words[0].show) && B.words[0].k === 0) {
        const tm = timePassage(A.sungEnd, B.words[0].show, map, true);
        const pg: Passage = { ...tm, line: B.words[0].line.i, quick: true, reason: 'distance' }; extraPass.push(pg); passByLine.set(pg.line, pg);
        B.cut = true; arrive = pg.t; s = arrive;
      }
    }
    // the roller: half a turn takes its time (the pace knob). It sets off once the words before are sung (earlier only if
    // that lets it land before the new word appears). A word that appears before the roll is over is simply there, at its
    // own place on the drum — still upside down to the camera — and the roll turns the camera round to it
    const roll = B.roll && !B.cut ? B.roll : 0;
    if (roll) { const D = rollDur(M.speed); s = Math.max(A.arrive + 0.05, Math.min(s, Math.max(B.words[0].show - D, A.sungEnd - 0.12))); arrive = s + D; }
    B.arrive = arrive;
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
    let bow: [number, number] = [0, 0], bend = 0;
    if (smooth && !B.cut && L > 1) { const C = stops[i + 1], nx = -dy / L, ny = dx / L; let side = rnd(i * 3.7 + 1) < 0.5 ? -1 : 1, turn = 0;
      if (C && !C.cut) { const cx = C.x - B.x, cy = C.y - B.y, lc = Math.hypot(cx, cy); if (lc > 1) { const cr = (dx * cy - dy * cx) / (L * lc), dt = (dx * cx + dy * cy) / (L * lc); turn = clamp((1 - dt) / 1.5); if (Math.abs(cr) > 0.05) side = cr > 0 ? -1 : 1; } }
      // (waltz: every move a curve — out wide on the way in, the more the sharper the corner ahead)
      const a = L * (waltz ? 0.07 + 0.1 * turn : 0.0125 + 0.03 * turn); bow = [nx * a * side, ny * a * side]; bend = side * (waltz ? 0.35 + 0.65 * turn : turn); }
    if (roll) {
      // the way it was asked to turn (half a turn has two ways round), sprung by the force knob, swinging further and
      // breathing out more with the turns knob
      const dr = angDiff(B.r - roll * 180, A.r) + roll * 180;
      moves.push({ s, a: arrive, dx, dy, dz: Math.log(B.z / A.z), dr, dd: B.d - A.d, ease: 'roll', bow: [0, 0],
        spring: [clamp(0.75 + M.punch * 0.9, 0.6, 2.4), clamp(0.05 + 0.09 * TK, 0.02, 0.32)], zb: clamp(0.1 * TK, 0, 0.3) });
      continue;
    }
    const mv: Move = { s, a: B.cut ? s : arrive, dx, dy, dz: Math.log(B.z / A.z), dr: angDiff(B.r, A.r), dd: B.d - A.d, ease: B.cut ? 'cut' : smooth ? (waltz ? 'waltz' : glideE === 'cruise' && (close || L * Math.sqrt(A.z * B.z) / W > 0.5) ? 'reach' : glideE) : (slow > 0 ? 'glide' : 'punch'), bow };
    // the turn: punch turns with its move (only quicker); waltz takes it on a curve — a little behind the pan, swinging
    // just past and back like a car through a bend, leaning into it, the corner taken wide first; glide and close land
    // it long and soft
    if (!B.cut && smooth) { if (waltz) { mv.rot = [0.1, 1.45, 'swing']; mv.bank = -bend * (3 + 4 * Math.abs(bend)) * TK; mv.apex = true; } else mv.rot = [0, 1.6, 'zoom']; }
    moves.push(mv);
  }
  // the last stop drifts until the ending
  const lastS = stops[stops.length - 1];

  /* ---- the ending: no pull-back — the camera stays with the last words and keeps drifting gently until the end ---- */
  { const go = Math.max(inp.musicEnd, lastS.sungEnd, lastS.arrive + 0.2) + 3, h0 = Math.max(lastS.arrive, follow(lastS, Infinity), lastSung(lastS)), ax = lastS.fax || lastS.dir;
    if (lastS.drift > 0 && go - h0 > 0.2) { const dd = Math.min(lastS.drift, lastS.drift * (go - h0) / 2.5); drifts.push([h0, go, ax[0] * dd, ax[1] * dd]); lastS.x += ax[0] * dd; lastS.y += ax[1] * dd; } }

  /* ---- cuts: the jump the base path makes at each transition (the backdrop does not follow these) ---- */
  const plan: CameraPlan = { style: cut, start, stops, moves, drifts, cuts: [], idle: idleWindows(lines, inp.musicEnd),
    dyn: { cone: (cut === 'punch' ? 0.03 : waltz ? 0.026 : 0.016) * clamp(M.punch + 0.4, 0.2, 2), coneRoll: (cut === 'punch' ? 0.5 : waltz ? 1.1 : 0.35) * TK * clamp(M.shake + 0.3, 0, 2),
      float: (0.45 + (M.float ?? 0)), sway: M.sway } };
  for (const m of moves) if (m.ease === 'cut') plan.cuts.push({ t: m.s, dx: m.dx, dy: m.dy, dz: m.dz, dr: m.dr });
  // the frame's answer to arrivals: a spring kick for the waltz, a firm nudge for punch, sized by how hard the music hits
  const sounding = (t: number) => map.sounding(t);
  if (cut === 'waltz') plan.kicks = stops.filter(s => !s.over && s.t > 0.3 && (s.words[0].k === 0 || map.accentAt(s.t) >= 1.3)).map(s => ({ t: map.snap(s.t, 0.09),
    a: clamp(map.accentAt(s.t) - 0.45, 0.15, 1.05) * (0.6 + 0.6 * intensity(s.t)) * sounding(s.t), sg: rnd(s.t * 13.7) < 0.5 ? -1 : 1, px: Math.cos(rnd(s.t * 7.3) * 6.283), py: Math.sin(rnd(s.t * 7.3) * 6.283) }));
  if (!smooth) plan.arrivals = stops.filter(s => !s.over && !s.cut && s.t > 0.3).map(s => ({ t: s.arrive, ang: rnd(s.t * 7.13) * 6.283, sg: rnd(s.t * 3.3) < 0.5 ? -1 : 1, k: (0.5 + 0.7 * intensity(s.t)) * (s.words[0].k === 0 ? 1 : 0.6) }));
  plan.path = smoothPath(plan, inp.dur, cut, sp, stops.find(s => s.over) ? moves[moves.length - 1].s : Infinity);
  // each cut's jump as the smoothed path really makes it (the backdrop's camera takes exactly this out, so it never jumps)
  cutJumps(plan);
  return { camera: plan, extraPassages: extraPass };
}

/** The centred stage: the camera stays on the middle and never turns. While a line is sung it leans a little towards it
 *  (a tenth of the way, a touch closer: a small focus, at the pace knob's speed); in a pause of a couple of seconds, and
 *  at the end, it comes back to the middle. The beat and the accents still breathe in the frame (evaluate.ts), never in
 *  its angle. */
function planCenter(inp: CameraInput): CameraPlan {
  const { lines, style: st, H } = inp, M = st.m, sp = Math.max(0.3, M.speed), z0 = centerZoom(inp.words, H, tsz(st));
  const mid = (t: number): Stop => ({ x: 0, y: 0, z: z0, r: 0, d: 0, t, arrive: t, leave: t, sungEnd: t, box: { x: 0, y: 0, w: 0, h: 0, tilt: 0 }, dir: [1, 0], drift: 0, cut: false, over: false, rest: 0, words: [] });
  const stops: Stop[] = [];
  lines.forEach((P, i) => { if (!P.words.length) return;
    const B = boxIn(P.words, 0), t0 = P.words[0].show, end = Math.min(P.L.sung, P.L.end), next = lines[i + 1]?.words[0]?.show ?? Infinity;
    stops.push({ ...mid(t0), x: B.x * 0.1, y: B.y * 0.1, z: z0 * 1.05, sungEnd: end, box: { x: B.x, y: B.y, w: B.w, h: B.h, tilt: 0 }, words: P.words });
    if (next - end > 2.5) stops.push(mid(end + 0.6)); });
  const start: Pose = { x: 0, y: 0, z: z0 * 0.94, r: 0, d: 0 }, moves: Move[] = [];
  let prev: Pose = start, at = 0;
  for (const s of stops) { const dur = clamp(0.9 / sp, 0.5, 1.8), a = Math.max(s.t, at + 0.05), s0 = Math.max(at, a - dur);
    moves.push({ s: s0, a, dx: s.x - prev.x, dy: s.y - prev.y, dz: Math.log(s.z / prev.z), dr: 0, dd: 0, ease: 'glide', bow: [0, 0] }); s.arrive = a; prev = s; at = a; }
  const plan: CameraPlan = { style: 'center', start, stops, moves, drifts: [], cuts: [], idle: idleWindows(lines, inp.musicEnd), dyn: { cone: 0.012 * clamp(M.punch + 0.4, 0.2, 2), coneRoll: 0, float: 0, sway: 0 } };
  plan.path = smoothPath(plan, inp.dur, 'glide', sp, Infinity);
  return plan;
}
/** A word as one box; and each of its characters as a box, with when it is sung and until when (the next one). */
const ubox = (S: PWord): UBox => ({ x: S.x, y: S.y, lw: S.lw, lh: S.lh, tilt: S.tilt });
function unitBoxes(ws: PWord[]): (UBox & { t: number; end: number })[] {
  const out: (UBox & { t: number; end: number })[] = [];
  for (const S of ws) { const c = Math.cos(S.tilt * D2R), sn = Math.sin(S.tilt * D2R), n = S.units.length, span = Math.max(0.05, S.end - S.w.t);
    S.units.forEach((u, i) => out.push({ x: S.x + c * u.ox - sn * u.oy, y: S.y + sn * u.ox + c * u.oy, lw: u.w, lh: u.h, tilt: S.tilt, t: u.t ?? S.w.t + span * 0.85 * i / Math.max(1, n), end: S.end })); }
  for (let i = 0; i + 1 < out.length; i++) out[i].end = Math.min(out[i].end, Math.max(out[i].t + 0.05, out[i + 1].t));
  return out;
}
/** A framing that holds these words in the safe area, centred on them (the zoom at most what one word would get). */
function fitPose(ws: UBox[], tilt: number, r: number, W: number, H: number, T: number) {
  const B = boxIn(ws, tilt), z = Math.min(W * 2 * SAFE_X * 0.96 / B.w, H * 2 * SAFE_Y * 0.96 / B.h, W * 0.8 / B.w * T);
  return { x: B.x, y: B.y, z };
}
/** Does a stop's framing hold these words inside the safe area? */
function fits(ws: UBox[], s: Stop, W: number, H: number): boolean {
  const cr = Math.cos(-s.r * Math.PI / 180), sr = Math.sin(-s.r * Math.PI / 180), ax = W * SAFE_X, ay = H * SAFE_Y;
  for (const S of ws) for (const p of corners(S)) { const dx = p[0] - s.x, dy = p[1] - s.y, qx = (dx * cr - dy * sr) * s.z, qy = (dx * sr + dy * cr) * s.z; if (Math.abs(qx) > ax || Math.abs(qy) > ay) return false; }
  return true;
}

/** Long intros, instrumentals and outros: after five seconds of waiting the camera goes idle until just before the next
 *  words; after the last words it stays idle through the ending (the ending card comes over it, the camera never comes
 *  back first). Lines with nothing to sing in them ("♪～", "……", "(間奏)") are no words to wait for. */
function idleWindows(lines: PLine[], musicEnd: number) {
  const out: { a: number; b: number; g: number }[] = [], WAIT = 5, sung = lines.filter(P => P.words.length && !onlyMarks(P.L.text));
  const add = (g0: number, g1: number, isOut: boolean) => { if (g1 - g0 >= WAIT + 1.4) out.push({ a: g0 + WAIT, b: isOut ? Infinity : g1 - 0.6, g: g0 }); };
  const endOf = (P: PLine) => Math.min(P.L.sung, P.L.end, P.secEnd);
  if (sung.length) { add(0, sung[0].L.t, false); for (let i = 1; i < sung.length; i++) add(endOf(sung[i - 1]), sung[i].L.t, false); add(endOf(sung[sung.length - 1]), musicEnd, true); }
  return out;
}
const INSTR = /^[\s(（［\[【〔]*(?:間奏|间奏|前奏|尾奏|interlude|instrumental|intro|outro|music)[\s)）］\]】〕]*$/iu;
/** A line with nothing to sing: no letter or digit in it at all, or only an instrumental marker. */
export const onlyMarks = (s: string) => !/[\p{L}\p{N}]/u.test(s) || INSTR.test(s.trim());
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
  // (the segment is decided at the very moment the sample is read, so a cut a hair after a sample's time never splits them)
  for (let f = 0, ci = 0; f < n; f++) { const t = f / RATE + 1e-6; while (ci < cuts.length && t >= cuts[ci]) ci++; seg[f] = ci;
    const b = rawPose(c, t); X[f] = b.x; Y[f] = b.y; Z[f] = Math.log(b.z); R[f] = b.r; Dd[f] = b.d; }
  const lo = new Int32Array(n), hi = new Int32Array(n);
  for (let f = 0; f < n; f++) lo[f] = f > 0 && seg[f - 1] === seg[f] ? lo[f - 1] : f;
  for (let f = n - 1; f >= 0; f--) hi[f] = f < n - 1 && seg[f + 1] === seg[f] ? hi[f + 1] : f;
  const overF = Math.min(n, Math.floor(overStart * RATE));
  // zoom envelope (the widest framing a moment ahead, never more than 1.25x wider than now)
  if (!punch && style !== 'close') { const ahead = Math.round(Math.min(1.4, (waltz ? 0.6 : 0.9) / sp) * RATE), back = Math.round(0.35 * RATE), Zr = Z.slice(), maxWide = Math.log(1.25);
    for (let f = 0; f < overF; f++) { let m = Zr[f]; const a = Math.max(lo[f], f - back), b = Math.min(overF - 1, hi[f], f + ahead); for (let j = a; j <= b; j++) if (Zr[j] < m) m = Zr[j]; Z[f] = Math.max(m, Zr[f] - maxWide); } }
  const gauss = (a: Float32Array, sig: number) => { const rad = Math.max(1, Math.round(sig * RATE * 3)), ker: number[] = []; let ks = 0;
    for (let k = -rad; k <= rad; k++) { const v = Math.exp(-0.5 * (k / (sig * RATE)) ** 2); ker.push(v); ks += v; }
    const o = new Float32Array(n); for (let f = 0; f < n; f++) { let v = 0; for (let k = -rad; k <= rad; k++) { const g = f + k; v += a[g < lo[f] ? lo[f] : g > hi[f] ? hi[f] : g] * ker[k + rad]; } o[f] = v / ks; } return o; };
  const ps = punch ? 0.05 : waltz ? 0.1 : style === 'close' ? 0.16 : 0.2, rsig = punch ? 0.05 : waltz ? 0.1 : 0.16, zsig = (punch ? 0.15 : waltz ? 0.3 : 0.45) / sp;
  return { rate: RATE, n, seg, cutT: cuts, x: gauss(X, ps), y: gauss(Y, ps), lz: gauss(Z, zsig), r: gauss(R, rsig), d: gauss(Dd, ps) };
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
    const span = m.a - m.s, u = span <= 0 ? 1 : clamp((t - m.s) / span), e = m.spring ? eSpring(m.spring[0], m.spring[1])(u) : EASES[m.ease](u);
    x += m.dx * e; y += m.dy * e; d += m.dd * e;
    if (m.rot && span > 0) { const [r0, r1, re] = m.rot, ur = clamp((t - m.s - r0 * span) / (span * (1 + r1 - r0))); r += m.dr * (ur > 0 ? EASES[re](ur) : 0); } else r += m.dr * e;
    if (m.bank && u > 0 && u < 1) r += m.bank * Math.sin(Math.PI * u) ** 2;
    // zoom eases over a slightly longer window, so changes in distance stay softer than the pan
    const zs = m.s - span * 0.15, za = m.a + span * 0.25, uz = span <= 0 ? 1 : clamp((t - zs) / (za - zs)); lz += m.dz * minJerk(uz);
    if (u > 0 && u < 1) { const q = m.apex ? 6.75 * e * (1 - e) ** 2 : 4 * e * (1 - e); x += m.bow[0] * q; y += m.bow[1] * q; }
    if (m.zb && u > 0 && u < 1) lz -= m.zb * Math.sin(Math.PI * u) ** 2;   // a roll breathes out a little at its middle
  }
  for (const [a, b, dx, dy, en] of c.drifts) { if (t <= a) continue; const e = (en ? EASES[en] : minJerk)(clamp((t - a) / Math.max(1e-3, b - a))); x += dx * e; y += dy * e; }
  return { x, y, z: Math.exp(lz), r, d, tx: 0, ty: 0 };
}
/** Each cut's jump as the smoothed path really makes it (the backdrop's camera takes exactly this out, so it never
 *  jumps); read again whenever the path is changed after planning (fit.ts). */
export function cutJumps(plan: CameraPlan) {
  const Pp = plan.path; if (!Pp) return;
  for (const k of plan.cuts) { const f = Math.min(Pp.n - 1, Math.max(1, Math.ceil(k.t * Pp.rate - 1e-9)));
    k.dx = Pp.x[f] - Pp.x[f - 1]; k.dy = Pp.y[f] - Pp.y[f - 1]; k.dz = Pp.lz[f] - Pp.lz[f - 1]; k.dr = Pp.r[f] - Pp.r[f - 1]; }
}
