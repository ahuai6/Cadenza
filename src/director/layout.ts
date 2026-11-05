/* Layout: where every word sits in the world. Words of a line follow a path in reading order; the path turns now and
   then (more often on accents and in busy passages), lines continue onward, step below, or fold back so the camera
   snakes instead of running away; a new passage starts clear of everything before it. Neighbouring words stay close
   enough that the camera never sweeps further than its own frame; when a line cannot be placed within reach, a quick
   transition opens a new passage instead of a long move.
   Lyric frames are decided *before* placement and the frame's padding is part of the framed words' footprint, so the
   layout makes room for it and the camera frames it without later corrections. */
import { clamp, dirv, D2R, angDiff } from '../core/math';
import { rnd } from '../core/rng';
import type { LyricDoc } from '../lyrics/model';
import type { RhythmMap } from '../rhythm/map';
import type { Style } from '../theme/style';
import { EM, type Measurer } from '../text/metrics';
import { graphemes, RE_COMPLEX } from '../text/script';
import type { PWord, PLine, Passage, FrameRef } from './types';
import { gapPassages, timePassage, roomForQuick } from './passages';
import { scenesOf, fastLine } from './scenes';
import { lyricType } from './lyrictypes';

export const TIN_MIX = ['blur', 'drift', 'rise', 'track'];
export const FRAME_NEED = 1.3;
export interface LayoutInput { doc: LyricDoc; map: RhythmMap; style: Style; measure: Measurer; W: number; H: number; musicEnd: number;
  /** transitions decided after a first layout (the camera's, for a move too long): taken as passages from the start, so the lines turn their way there too */ more?: Passage[] }
/** The most lines a page keeps up at once (the one being sung among them). */
/** At most this many lines up at once (the one sung and the two before it): an older one fades out as a new one comes
 *  in (plan.ts) — so a new line keeps clear only of those (and the space of the ones gone is free again). */
export const PAGE_LINES = 3;
/** What the page's clearing counts: a line's words as the segmenter (and the singing) cut them, and its line break —
 *  so a page of short lines holds more of them than a page of long ones. */
export const pageUnits = (P: { words: unknown[] }) => P.words.length + 1;
/** As many as about three lines of three words: the most a page holds up at once (plan.ts). */
export const PAGE_UNITS = 12;
/** As many as about five such lines: from here a crowding page takes a quick clear. */
export const CROWD_UNITS = 20;
export interface LayoutResult { lines: PLine[]; words: PWord[]; passages: Passage[]; dmin: number; /** clears without a blur (plan.ts applySweeps) */ sweeps: { t: number; line: number }[];
  /** lines that leave at a set time of their own, fading over `inn` (the centred stage's groups of three) */ leaves?: { line: number; t: number; inn: number }[] }

export const tsz = (st: Style) => clamp(st.m.tsize ?? 1, 0.5, 2.5);
/** How close the camera frames one word: about 68 % of the width or 46 % of the height, against the line's typical
 *  word height so small words are not blown up; never more than the frame can hold. */
export function wordZoom(S: { lw: number; lh: number }, medLh: number, W: number, H: number, T: number) {
  // a long word is not shrunk to fit: the camera frames a stretch of it (five or so characters, four down a column)
  // and travels along it as it is sung (camera.ts)
  const lw = Math.min(S.lw, Math.max(S.lh, medLh * 0.85) * 5.5), lh = Math.min(S.lh, Math.max(S.lw, medLh * 0.85) * 4);
  const z = Math.min(W * 0.68 / lw, H * 0.46 / Math.max(lh, medLh * 0.85));
  return Math.min(z * T, W * 0.8 / lw, H * 0.58 / lh);
}
export function corners(S: { x: number; y: number; lw: number; lh: number; tilt: number }, pad = 0): [number, number][] {
  const d = dirv(S.tilt), n = dirv(S.tilt + 90), hw = S.lw / 2 + pad, hh = S.lh / 2 + pad;
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([a, b]) => [S.x + d[0] * hw * a + n[0] * hh * b, S.y + d[1] * hw * a + n[1] * hh * b]);
}
/** A word's harmony as drawn (render/lyrics.ts drawHarmony: at 0.52 of the word, its lower right), as a box of its own. */
export const HARM_K = 0.52;
export function harmBox(S: { x: number; y: number; tilt: number; s?: number; w0?: number; h0?: number; harm?: { w0: number; h0: number } | null }) {
  const H = S.harm; if (!H || S.s == null || S.w0 == null || S.h0 == null) return null;
  const hw = H.w0 * HARM_K, hh = H.h0 * HARM_K, ox = (S.w0 / 2 * 0.55 + hw / 2) * S.s, oy = (S.h0 / 2 + hh * 0.3) * S.s, d = dirv(S.tilt), n = dirv(S.tilt + 90);
  return { x: S.x + d[0] * ox + n[0] * oy, y: S.y + d[1] * ox + n[1] * oy, lw: hw * S.s, lh: hh * S.s, tilt: S.tilt };
}
/** The box round some words, as the camera frames them — their harmonies with them (a harmony is sung too). */
export function boxIn(segs: { x: number; y: number; lw: number; lh: number; tilt: number }[], fa: number, pad = 0) {
  const u = dirv(fa), v = dirv(fa + 90); let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  const all = segs.flatMap(S => { const h = harmBox(S as Parameters<typeof harmBox>[0]); return h ? [S, h] : [S]; });
  for (const S of all) for (const p of corners(S, pad)) { const a = p[0] * u[0] + p[1] * u[1], b = p[0] * v[0] + p[1] * v[1]; u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, b); v1 = Math.max(v1, b); }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2; return { x: u[0] * cu + v[0] * cv, y: u[1] * cu + v[1] * cv, w: u1 - u0, h: v1 - v0 };
}
/** How long before its moment a word shows (s): with the entrance's length, as much as before the entrances were made
 *  shorter (the default ones ×0.7), so the words are as early as ever. */
const ANTIC = (st: Style) => clamp((st.m.enter ?? 0.21) / 0.7 * 0.3, 0.05, 0.14);

/** The units a word is laid out by: its own, or (the spread exit opens out the space between letters) letter by letter,
 *  each with its syllable's moment. */
export function layoutUnits(Wd: LyricDoc['lines'][number]['words'][number], st: Style) {
  return st.tout === 'spread' ? Wd.units.flatMap(u => (RE_COMPLEX.test(u.c) ? [u] : graphemes(u.c).map(c => ({ c, t: u.t })))) : Wd.units;
}
export function layout(inp: LayoutInput): LayoutResult {
  const { doc, map, style: st, measure, W, H } = inp, M = st.m, T = tsz(st);
  const BASE = EM, gap = BASE * 0.14 * T, TURN = clamp(M.turn ?? 0.4, 0, 1), TA = M.tang ?? 90, TK = M.tilt, DEP = M.depth ?? 1;
  const waltz = st.cut === 'waltz' || st.cut === 'hover', smooth = st.cut !== 'punch', LT = lyricType(st.ltype), LD = LT.depth ?? 1, ORBIT = !!LT.orbit;

  /* ---- words, measured ---- */
  const lines: PLine[] = [], words: PWord[] = [], vruns = st.cut === 'center' || ORBIT ? new Set<number>() : vertRuns(doc.lines);   // (round a centre: no columns — they would run off out of the circle)
  for (const L of doc.lines) {
    const P: PLine = { L, i: L.i, words: [], sec: 0, secEnd: Infinity, secIn: 0.4, ax: 0, ay: 0, bw: 0, bh: 0, prot: 0, d: 0, back: false, rtl: L.rtl, vert: vruns.has(L.i) };
    let prev: { group: number; s0: number; tin: string; show: number } | null = null;
    for (const Wd of L.words) {
      const k = Wd.k, n = Wd.units.length;
      const vert = !!P.vert;
      // (the spread exit opens out the space between letters, so a unit of several — a sung syllable — is taken letter
      // by letter, each with its syllable's moment)
      const us = layoutUnits(Wd, st);
      const mb = measure.word(us.map(u => u.c), { vertical: vert, rtl: L.rtl });
      let s0 = Wd.latin ? 1.1 : !LT.sizes ? 1 : n === 1 ? 0.5 : [1, 0.62, 1.32][Math.floor(rnd(L.i * 13 + k * 5.1) * 3)];
      if (k === 0 && !Wd.latin) s0 = Math.max(s0, 1);
      // words sung as one quick run (one gesture) share one size and one entrance, so they read as one beat, not a stutter
      const fused: boolean = !!prev && prev.group === Wd.group; if (fused) s0 = prev!.s0;
      const tinV = st.tin || 'mix', tin: string = fused ? prev!.tin : tinV === 'mix' ? TIN_MIX[Math.floor(rnd(L.i * 13.7 + k * 7.1 + 2) * TIN_MIX.length)] : tinV, s = (Wd.lift ? Math.max(s0, ...P.words.map(Q => Q.s / T)) * Wd.lift.scale : s0) * T;   // (a word set apart by a rule — lyrics/rules.ts: bigger than the line's words before it)
      // (a type that brings the line in whole: every word with the first)
      // (a line timed only as a whole is shown as a whole: its words come in with its first — only the camera still
      // goes along it at the words' estimated moments)
      const show: number = (LT.together || !Wd.timed) && P.words.length ? P.words[0].show : fused ? prev!.show : Wd.t - ANTIC(st);
      prev = { group: Wd.group, s0, tin, show };
      const pw: PWord = { w: Wd, line: P, k, x: 0, y: 0, tilt: 0, d: 0, s, lw: mb.w0 * s, lh: mb.h0 * s, w0: mb.w0, h0: mb.h0, vert,
        units: us.map((u, ui) => ({ c: u.c, t: u.t, ox: mb.units[ui].cx * s, oy: mb.units[ui].cy * s, w: mb.units[ui].w * s, h: mb.units[ui].h * s, rot: mb.units[ui].rot })),
        ang: 0, frame: null, order: 0, show, end: Wd.end, tin, seed: L.i * 101 + k * 7 + 1,
        harm: Wd.harm ? (hm => ({ text: Wd.harm!.text, t: Wd.harm!.t, w0: hm.w0, h0: hm.h0 }))(measure.word(Wd.harm.units.map(u => u.c), { vertical: false, rtl: L.rtl })) : null };
      P.words.push(pw); words.push(pw);
    }
    lines.push(P);
  }
  const medLh = (P: PLine) => { const hs = P.words.filter(S => !S.vert).map(S => S.lh).sort((a, b) => a - b); return hs.length ? hs[hs.length >> 1] : P.words[0]?.lh ?? BASE; };
  const med = new Map(lines.map(P => [P, medLh(P)]));
  // how close each camera style holds a word: what the layout's limits (how far apart words may sit, in frames) are measured in
  const close = st.cut === 'close';
  const zOf = (S: PWord) => close ? closeZoom(S, H, W, T) : wordZoom(S, med.get(S.line)!, W, H, T);

  /* ---- passages at pauses ---- */
  const passages = gapPassages(lines.map(P => ({ t: P.words[0]?.show ?? P.L.t, sungEnd: Math.min(P.L.sung, P.L.end) })), map, inp.musicEnd, (st.trans || 'auto') !== 'off', st.bgStyle === 'video');
  for (const q of inp.more || []) if (!passages.some(x => x.line === q.line)) passages.push({ ...q });
  passages.sort((a, b) => a.t - b.t);
  /* ---- lyric frames, before placement ----
     About one line in five asks for one on a chosen word (never two framed lines close together): a small target (one
     word, a few characters). When that word does
     not leave the frame enough time on screen (its line ends, or a passage clears the picture), the frame moves on to the
     next word that does, into the following lines if need be: frames stay frequent and are never cut short. */
  const nextPass = new Map(passages.map(q => [q.line, q]));
  const chars = (S: PWord) => { const s = S.w.text.trim(); return /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(s) ? [...s].length : Math.ceil([...s].length / 3); };
  const small = (S: PWord) => chars(S) <= 4;
  const lineEnd = (P: PLine) => { const q = nextPass.get(P.i + 1); return q ? Math.min(P.L.end, q.t - q.inn) : P.L.end; };
  // the frames the lyrics ask for ('$1' before a word): always, round that word — whether or not frames are on, close up too
  const asked = new Set<number>();
  for (const P of lines) for (const S of P.words) if (S.w.box && !S.frame) {
    const F: FrameRef = { words: [S], ts: S.w.t, corner: rnd(P.i * 5.1 + S.k) < 0.5, pad: Math.min(S.lw, S.lh) * 0.15 * 2.3 }; S.frame = F; asked.add(P.i); }
  // (close up there are none of the chosen ones: a frame would have the camera pull back from the characters to show it whole)
  if (st.fx.frame && st.cut !== 'close') { let want = false, lastF = -9;
    for (const P of lines) {
      const n = P.words.length; let k0 = 0;
      // (a line with a frame of its own asked for: the chosen ones keep away from it, as from each other)
      if (asked.has(P.i)) { lastF = P.i; want = false; continue; }
      if (!want && P.i > 0 && P.i - lastF >= 3 && rnd(P.i * 7.7 + 3.3) < 0.22) { want = true; k0 = n === 1 ? 0 : Math.min(n - 1, Math.floor(rnd(P.i * 2.9) * Math.min(n, 3))); }
      if (!want) continue;
      // a small target: one word (a short one by preference), or a very short word with the one before it — a few
      // characters at most, never a stretch of a line, so the outline sits snugly and the camera holds it at its usual closeness
      const ok = (k: number) => lineEnd(P) - 0.8 - P.words[k].w.t >= FRAME_NEED;
      let pick = -1; for (let k = k0; k < n; k++) if (ok(k) && small(P.words[k])) { pick = k; break; }
      if (pick < 0) for (let k = k0; k < n; k++) if (ok(k)) { pick = k; break; }
      if (pick >= 0) { const S = P.words[pick], prev = P.words[pick - 1];
        const fw = prev && chars(S) <= 2 && chars(prev) + chars(S) <= 4 && Math.abs(prev.tilt - S.tilt) < 1 ? [prev, S] : [S], pad = Math.min(...fw.map(x => Math.min(x.lw, x.lh))) * 0.15 * 2.3;   // (the characters' size: a column's length is not its margin)
        const F: FrameRef = { words: fw, ts: S.w.t, corner: rnd(P.i * 5.1) < 0.5, pad }; for (const x of fw) x.frame = F; want = false; lastF = P.i; }
    } }
  const padOf = (S: PWord) => (S.frame ? S.frame.pad * 0.6 : 0);

  const starts = lines.flatMap(P => P.words.map(S => S.w.t)).sort((a, b) => a - b);
  const dens = (t: number) => { let c = 0; for (const x of starts) { if (x > t + 1.6) break; if (x >= t - 1.6) c++; } return c; };
  let mxd = 1; for (const x of starts) mxd = Math.max(mxd, dens(x));

  /* ---- the centred stage: the camera holds the middle; each line is set there, alternately above and below it ---- */
  if (st.cut === 'center') return centerLayout(lines, words, W, H, gap, T, map, (st.trans || 'auto') !== 'off');

  /* ---- placement ---- */
  const { scenes, rolls } = scenesOf(lines, map, M.speed), drum = new Map<number, [number, number]>();
  const placed: PWord[] = [], pad0 = gap * 0.4;
  const proj = (pts: [number, number][], ax: [number, number]) => { let a = 1e9, b = -1e9; for (const q of pts) { const v = q[0] * ax[0] + q[1] * ax[1]; if (v < a) a = v; if (v > b) b = v; } return [a, b]; };
  const clash = (A: PWord, B: PWord) => {
    const pa = padOf(A), pb = padOf(B);
    if (Math.hypot(A.x - B.x, A.y - B.y) > (Math.hypot(A.lw + 2 * pa, A.lh + 2 * pa) + Math.hypot(B.lw + 2 * pb, B.lh + 2 * pb)) / 2 + pad0) return false;
    const a = corners(A, pa), b = corners(B, pb);
    for (const P of [a, b]) for (let e = 0; e < 2; e++) { const ex = P[e + 1][0] - P[e][0], ey = P[e + 1][1] - P[e][1], l = Math.hypot(ex, ey) || 1, nx = -ey / l, ny = ex / l;
      const [a0, a1] = proj(a, [nx, ny]), [b0, b1] = proj(b, [nx, ny]); if (Math.min(a1, b1) - Math.max(a0, b0) <= -pad0) return false; }
    return true;
  };
  // (what a line must keep clear of is only what is still up beside it — the lines of the same passage still on the
  // page, its own words, a frame — or the page would fill up with lines long gone)
  const secOf = new Map<PLine, number>();
  const near = (S: PWord, Q: PWord) => Q.line === S.line || (secOf.get(Q.line) === secOf.get(S.line) && Q.line.i > S.line.i - PAGE_LINES);
  const hits = (S: PWord) => placed.some(Q => Q.frame && Q.frame === S.frame ? false : near(S, Q) && clash(S, Q));
  // (a word goes on up as often as down: below / above, a step down / a step up — the small rise beside them is a lift
  // within the row, not a way to go)
  const FLOW: [string, number][] = waltz ? [['right', .34], ['below', .13], ['above', .13], ['stair', .13], ['climb', .13], ['rise', .14]] : smooth ? [['right', .36], ['below', .15], ['above', .15], ['stair', .14], ['climb', .14], ['rise', .06]] : [['right', .38], ['below', .14], ['above', .14], ['stair', .11], ['climb', .11], ['rise', .12]];
  const placeNext = (S: PWord, Q: PWord, w: number, h: number, d: [number, number], n: [number, number], i: number, k: number): [number, number] | null => {
    let r = rnd(i * 61.7 + k * 4.3 + 3), mode = 'right'; for (const [m, wt] of FLOW) { if (r < wt) { mode = m; break; } r -= wt; }
    const down = Q.lh / 2 + gap * 1.3 + h / 2;
    if (mode === 'below') { const al = rnd(i * 5.1 + k * 7.7), ax = al < 0.34 ? (w - Q.lw) / 2 : al < 0.67 ? 0 : (Q.lw - w) / 2; return [Q.x + n[0] * down + d[0] * ax, Q.y + n[1] * down + d[1] * ax]; }
    if (mode === 'above') { const al = rnd(i * 5.1 + k * 7.7), ax = al < 0.34 ? (w - Q.lw) / 2 : al < 0.67 ? 0 : (Q.lw - w) / 2; return [Q.x - n[0] * down + d[0] * ax, Q.y - n[1] * down + d[1] * ax]; }
    if (mode === 'stair') { const ax = Q.lw * 0.3 + w * 0.3; return [Q.x + n[0] * down * 0.92 + d[0] * ax, Q.y + n[1] * down * 0.92 + d[1] * ax]; }
    if (mode === 'climb') { const ax = Q.lw * 0.3 + w * 0.3; return [Q.x - n[0] * down * 0.92 + d[0] * ax, Q.y - n[1] * down * 0.92 + d[1] * ax]; }
    if (mode === 'rise') { const ax = Q.lw / 2 + (S.w.latin && Q.w.latin ? Math.max(gap, h * 0.32) : gap) + w / 2, up = (Q.lh + h) * 0.32; return [Q.x + d[0] * ax - n[0] * up, Q.y + d[1] * ax - n[1] * up]; }
    return null;
  };
  // the empty space between two neighbours, in frames at the wider framing of the two
  const WANDER = 1.8, ORBIT_REACH = 1.0, ORBIT_RANGE = 1.0, ORBIT_TRIES = 10, SPAN = ({ punch: 0.6, waltz: 0.55, glide: 0.55, close: 0.4, hover: 0.5 } as Record<string, number>)[st.cut] ?? 0.55, BACK_REACH = 0.7, FOLD = 0.9;
  // where a new line goes, by style: below the line before, above it, or on to the right (the rest); close up it mostly
  // runs on (a short way, seen travelling), hovering it spreads round the middle
  // (as often above as below)
  const [PB0, PA0] = ({ punch: [0.3, 0.3], waltz: [0.3, 0.3], glide: [0.28, 0.28], close: [0.18, 0.18], hover: [0.33, 0.33] } as Record<string, number[]>)[st.cut] ?? [0.3, 0.3];
  // (the lyric type can ask for more lines above and below and fewer onward — the odds kept short of always)
  const SK = Math.min(LT.stack ?? 1, 0.85 / (PB0 + PA0)), P_BELOW = PB0 * SK, P_ABOVE = PA0 * SK;
  const blankOf = (A: PWord, B: PWord) => { const z = Math.min(zOf(A), zOf(B)), d = dirv(A.tilt), n = dirv(A.tilt + 90), dx = B.x - A.x, dy = B.y - A.y;
    const ext = (Q: PWord, ax: number) => Math.abs(Q.lw / 2 * Math.cos((Q.tilt - A.tilt) * D2R + (ax ? Math.PI / 2 : 0))) + Math.abs(Q.lh / 2 * Math.sin((Q.tilt - A.tilt) * D2R + (ax ? Math.PI / 2 : 0)));
    return Math.max((Math.abs(dx * d[0] + dy * d[1]) - ext(A, 0) - ext(B, 0)) / (W / z), (Math.abs(dx * n[0] + dy * n[1]) - ext(A, 1) - ext(B, 1)) / (H / z)); };
  const inView = (A: PWord, B: PWord) => { const z = zOf(A), d = dirv(A.tilt), n = dirv(A.tilt + 90), hw = W / (2 * z) * 0.94, hh = H / (2 * z) * 0.94;
    return corners(B, padOf(B)).every(p => { const dx = p[0] - A.x, dy = p[1] - A.y; return Math.abs(dx * d[0] + dy * d[1]) <= hw && Math.abs(dx * n[0] + dy * n[1]) <= hh; }); };
  const alongMotion = (A: PWord, B: PWord) => { const Pv = placed.length > 1 && placed[placed.length - 1] === A ? placed[placed.length - 2] : null;
    const vx = Pv ? A.x - Pv.x : Math.cos(A.ang * D2R), vy = Pv ? A.y - Pv.y : Math.sin(A.ang * D2R), vl = Math.hypot(vx, vy) || 1, dx = B.x - A.x, dy = B.y - A.y, dl = Math.hypot(dx, dy) || 1;
    return (vx * dx + vy * dy) / (vl * dl) > Math.cos(60 * D2R); };

  // a line that starts back to the left goes above or below the line before, its last character over (under) that
  // line's second-to-last: how far back from the end P of the line before it starts, along d
  const alignBack = (Lp: PLine, prevLine: PLine, Pe: [number, number], d: [number, number]) => {
    const us: [number, number][] = []; for (const Q of prevLine.words) { const c = Math.cos(Q.tilt * D2R), sn = Math.sin(Q.tilt * D2R); for (const u of Q.units) us.push([Q.x + c * u.ox - sn * u.oy, Q.y + sn * u.ox + c * u.oy]); }
    const X = us[Math.max(0, us.length - 2)] || Pe, along = (X[0] - Pe[0]) * d[0] + (X[1] - Pe[1]) * d[1];
    const lw = Lp.words[Lp.words.length - 1], lu = lw?.units[lw.units.length - 1], Lw = Lp.words.reduce((a, Q) => a + Q.lw, 0) + gap * (Lp.words.length - 1) * (Lp.words.some(Q => Q.w.latin) ? 2.2 : 1);
    return Math.max(0, Lw - (lu ? lu.w / 2 : 0) - along); };
  const penult = (prevLine: PLine, Pe: [number, number]): [number, number] => { const us: [number, number][] = [];
    for (const Q of prevLine.words) { const c = Math.cos(Q.tilt * D2R), sn = Math.sin(Q.tilt * D2R); for (const u of Q.units) us.push([Q.x + c * u.ox - sn * u.oy, Q.y + sn * u.ox + c * u.oy]); }
    return us[Math.max(0, us.length - 2)] || Pe; };
  type St = { P: [number, number]; th: number; lineStart: [number, number]; prevH: number; lastTurn: number; prevLine: PLine | null; prevSeg: PWord | null; secFirst: boolean; flow: number; flowFrom: number | null; backN: number; colN: number; n?: number };
  let S0: St = { P: [0, 0], th: 0, lineStart: [0, 0], prevH: BASE, lastTurn: -9, prevLine: null, prevSeg: null, secFirst: false, flow: 1, flowFrom: null, backN: 0, colN: 0 };
  const save = (): St => ({ ...S0, P: [...S0.P] as [number, number], lineStart: [...S0.lineStart] as [number, number], n: placed.length });
  const restore = (v: St) => { placed.length = v.n!; S0 = { ...v, P: [...v.P] as [number, number], lineStart: [...v.lineStart] as [number, number] }; };
  let secN = 0;
  /** the 圓心 type: the centre of the passage's circle (its first line), which the lines go round and never far from */
  let orbO: [number, number] | null = null, orbZ = 0;   // (and the circle's size: about a frame at its first line's closeness)
  /** where the passage began (its first line's middle): the lines never wander far from it one way (WANDER lines'
   *  times its first line's width or a frame, whichever is more) — past half that they go on above and below instead, and a passage that
   *  would run on further is closed by a transition (a dash excepted) */
  let secO: [number, number] | null = null, secR = 0, roam = false, clashed = false;   // (clashed: the last placement left words on top of others)   // (roam: no time for a transition — the line may go further)
  const newPassage = () => { secN++;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const Q of placed) for (const p of corners(Q)) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    // (every transition turns the way the lines go — rightward, then leftward, … — and every second one whether the new
    // passage opens above or below what came before: over four passages the lyrics come from every side, in turn)
    const up = ((secN + 1) >> 1) % 2 === 1, sx = x0 - BASE * (1 + rnd(secN * 3.1) * 3);
    S0.P = [sx, up ? y0 - BASE * (3 + rnd(secN * 2.2) * 1.5) : y1 + BASE * (2 + rnd(secN * 2.2) * 1.5)]; S0.lineStart = [...S0.P] as [number, number];
    // (round a centre: a new passage opens on the same centre — the passage before is gone under the transition)
    if (ORBIT) { S0.P = [-BASE * 3 * T, 0]; S0.lineStart = [...S0.P] as [number, number]; }
    S0.th = ORBIT ? 0 : [0, -10, 8, -16, 14][Math.floor(rnd(secN * 5.7) * 5)] * TK * 0.6; S0.prevLine = null; S0.prevSeg = null; S0.lastTurn = -9; S0.secFirst = true; S0.flow = secN % 2 ? -1 : 1; S0.flowFrom = null; S0.backN = 0; };

  /** (the 圓心 type: which try at a line's angle round the line before this placement is, or null for the ordinary ones) */
  let orbitTry: number | null = null;
  const placeLine = (Lp: PLine, i: number, mode: string | null): boolean => {
    let { P, th, lineStart, prevH, lastTurn, prevLine, prevSeg, secFirst, flow, flowFrom, backN, colN } = S0, bad = false;
    Lp.back = false; Lp.west = false; clashed = false; secOf.set(Lp, secN); const westStart = flow < 0 && secFirst, opens = secFirst || i === 0; let align: { X: [number, number]; d: [number, number] } | null = null;
    Lp.words.forEach((S, k) => {
      const w = S.lw, h = S.lh, first = (i === 0 && k === 0) || (secFirst && k === 0);
      const tilt0 = rnd(i * 5 + k * 9.1) < 0.3 ? (rnd(i * 3 + k) - 0.5) * 12 : 0;
      let turn = 0; const rd = Lp.rtl ? -1 : 1; S.roll = 0;
      // (heading back, a line starts by folding back, never by turning: the turn would take the place of the fold)
      // (once the passage has gone a way from where it began, it goes on above and below instead: no more folding back)
      const far = !!secO && !!prevLine && !ORBIT && Math.abs(prevLine.ax - secO[0]) > WANDER * 0.5 * secR;
      const folds = !ORBIT && k === 0 && flow < 0 && !!prevLine && !mode && !Lp.vert && !prevLine.vert && !far;
      // round a centre (the 圓心 type): the line goes round the line before, at an angle of its own — upright, or now and
      // then turned so its characters' tops face away from that centre (never towards it, never upside down)
      let orb: [number, number] | null = null, orbR = 0, orbOut = false;
      if (k === 0 && orbitTry != null && prevLine && !first && !Lp.vert && !prevLine.vert && !Lp.rtl) {
        // the angle round the line before: always toward the side of the circle's centre the lines are not on — right
        // when they sit left of it, left when right, turn and turn about while near it — so from the first line on they
        // go left as often as right (and up as often as down once they stray), never off one way for a while and then back
        const O = orbO ?? [prevLine.ax, prevLine.ay], Rc = ORBIT_RANGE * W / (orbZ || zOf(S)), off = [prevLine.ax - O[0], prevLine.ay - O[1]], q = orbitTry;
        let a = rnd(i * 23.1 + 4) * 360 + q * 137.5;
        if (q < ORBIT_TRIES) {
          const sx = off[0] > Rc * 0.1 ? -1 : off[0] < -Rc * 0.1 ? 1 : i % 2 ? 1 : -1;
          if (Math.sign(Math.cos(a * D2R)) !== sx) a = 180 - a;
          if (Math.abs(off[1]) > Rc * 0.3 && Math.sign(Math.sin(a * D2R)) === Math.sign(off[1])) a = -a;
        }
        const radial = ((a + 90 + 540) % 360) - 180;
        const turnIt = q < ORBIT_TRIES && rnd(i * 5.9 + orbitTry * 1.7) < 0.35 && Math.abs(radial) <= 100;   // (never turned when set round the circle's centre instead: its tops would face away from the wrong centre)
        th = turnIt ? radial : [0, -6, 5, -3][Math.floor(rnd(i * 2.7) * 4)] * TK * 0.6;
        const Lw = Lp.words.reduce((t, Q) => t + Q.lw, 0) + gap * (Lp.words.length - 1) * 1.6, hh = Math.max(...Lp.words.map(Q => Q.lh));
        const ext = (bw: number, bh: number, ang: number) => Math.abs(bw / 2 * Math.cos((a - ang) * D2R)) + Math.abs(bh / 2 * Math.sin((a - ang) * D2R));
        const R = ext(prevLine.bw, prevLine.bh, prevLine.prot) + ext(Lw, hh, th) + gap * 3, u = dirv(a), d1 = dirv(th);
        // (the later tries, when none round the line before fits: round the circle's centre itself, further out each time)
        const byO = q >= ORBIT_TRIES, rO = Rc * (0.3 + 0.1 * (q - ORBIT_TRIES));
        const N: [number, number] = byO ? [O[0] + u[0] * rO, O[1] + u[1] * rO] : [prevLine.ax + u[0] * R, prevLine.ay + u[1] * R];
        lineStart = [N[0] - d1[0] * Lw / 2, N[1] - d1[1] * Lw / 2]; orb = lineStart; orbR = byO ? 0 : R; if (turnIt) lastTurn = S.w.t;
        // (never outside the circle)
        orbOut = !byO && Math.hypot(N[0] - O[0], N[1] - O[1]) > Rc;
      }
      // (a line of this type not placed round the one before — no angle fitted — stands upright: it is never left turned
      // by the line before's angle, which would face its tops anywhere)
      else if (ORBIT && k === 0 && !first && !Lp.vert) th = 0;
      if (!first && !folds && !(far && k === 0) && !ORBIT && !Lp.rtl && mode !== 'dash' && TURN > 0 && TA > 0 && S.s > 0.55 && !S.vert && S.w.t - lastTurn >= map.beatLen(S.w.t)) {
        const acc = clamp(0.5 + map.accentAt(S.w.t) * 0.5, 0.5, 1.5);
        const p = TURN * (k === 0 ? 0.9 : 0.45) * acc * (0.6 + 0.8 * dens(S.w.t) / mxd) * (S.w.latin ? 0.7 : 1);
        if (rnd(i * 53 + k * 7.7 + 11) < p) {
          const pref = th > 1 ? -1 : th < -1 ? 1 : (rnd(i * 3 + k * 5) < 0.5 ? -1 : 1), sg = rnd(i * 17 + k * 3.1) < 0.75 ? pref : -pref;
          turn = sg * Math.max(5, Math.round(TA * (0.75 + 0.5 * rnd(i * 9 + k * 2.3)) / 5) * 5);
        }
      }
      let c: [number, number];
      // the roller: the word goes on the drum's next row — turned half round, beside the row before (its start under that
      // row's end), every row of a run on the same side, so the rows stack outwards like the faces of a drum
      const roll = !first && mode !== 'dash' && !S.vert ? rolls.get(S) : undefined;
      if (roll) {
        const nr = placed.filter(Q => Q.roll && rolls.get(Q)?.run === roll.run).length, sg = nr % 2 ? 1 : -1;   // left first, then right, … (counting the rows on the page)
        const d1 = dirv(th), th2 = th + sg * 180, d2 = dirv(th2);
        let m = nr ? drum.get(roll.run) : undefined; if (!m) { const n1 = dirv(th + 90); m = [-n1[0], -n1[1]]; drum.set(roll.run, m); }
        const off = prevH / 2 + gap * 2.2 + h / 2;
        c = [P[0] + m[0] * off - d1[0] * w / 2, P[1] + m[1] * off - d1[1] * w / 2]; P = [c[0] + d2[0] * w / 2, c[1] + d2[1] * w / 2];
        th = th2; if (k === 0) lineStart = [c[0] - d2[0] * w / 2, c[1] - d2[1] * w / 2]; lastTurn = S.w.t; S.roll = sg; S.rollD = roll.dur;
      } else if (turn) {
        const th2 = th + turn, d1 = dirv(th), d2 = dirv(th2);
        const P2: [number, number] = [P[0] + d1[0] * (h / 2 + gap) - d2[0] * prevH / 2, P[1] + d1[1] * (h / 2 + gap) - d2[1] * prevH / 2];
        th = th2; c = [P2[0] + d2[0] * w / 2, P2[1] + d2[1] * w / 2]; P = [c[0] + d2[0] * w / 2, c[1] + d2[1] * w / 2];
        if (k === 0) lineStart = P2; lastTurn = S.w.t;
      } else {
        // (once the passage has gone a way from where it began, the next line goes above or below the one before)
        const d0 = dirv(th), d: [number, number] = [d0[0] * rd, d0[1] * rd], nrm = dirv(th + 90), r0 = rnd(i * 71.3 + 5);
        // (far: always above or below — on the side away from the line before that one, which is still up, so the three
        // stack up and down round each other instead of on top of one another)
        const pp = far && prevLine ? lines.slice(0, i).reverse().find(Q => Q !== prevLine && Q.words.length && secOf.get(Q) === secN) : undefined;
        const lr = !far ? r0 : pp && Math.abs(pp.ay - prevLine!.ay) > 1 ? (pp.ay > prevLine!.ay ? P_BELOW + P_ABOVE * 0.5 : P_BELOW * 0.5) : r0 * (P_BELOW + P_ABOVE);
        // (a row after a column carries on from the pen — beside the column, level with its top — never under the
        // column's foot nor folded back to where it began: both are a long way off, a column being tall)
        let backMax = -Infinity, run = 0;
        if (folds && !first && !Lp.rtl && prevSeg) {
          const zz = Math.min(zOf(prevSeg), zOf(S)); run = (P[0] - lineStart[0]) * d[0] + (P[1] - lineStart[1]) * d[1];
          backMax = FOLD * 0.9 * W / zz - (run - prevSeg.lw - w); }
        // (a passage going onward to the right: a line set above or below the one before starts back under it no further
        // than keeps its middle right of that one's — a step down or up, never a step back against the way the lines go)
        // (and a passage gone far from where it began: right above or below the line before, a little back towards
        // where the passage began — the lines then stack up and down instead of running on)
        const onward = (back: number) => { if ((flow < 0 && !far) || !prevLine || k !== 0) return back; const runL = (P[0] - lineStart[0]) * d[0] + (P[1] - lineStart[1]) * d[1];
          const Lw = Lp.words.reduce((a, Q) => a + Q.lw, 0) + gap * (Lp.words.length - 1) * 1.6, mid = (runL + Lw) / 2;
          // (its middle a little from the line before's middle towards where the passage began: measured from the pen)
          if (far) { const toO = (secO![0] - prevLine.ax) * d[0] + (secO![1] - prevLine.ay) * d[1], pm = (P[0] - prevLine.ax) * d[0] + (P[1] - prevLine.ay) * d[1];
            return pm + Lw / 2 - Math.sign(toO) * Lw * 0.3; }
          return Math.min(back, Math.max(0, mid)); };   // (at most: right above or below it, middle over middle)
        let cc: [number, number] | null = null;
        if (orb) { cc = [orb[0] + d[0] * w / 2, orb[1] + d[1] * w / 2]; P = [cc[0] + d[0] * w / 2, cc[1] + d[1] * w / 2]; }
        // (the camera hovers over a line heading back: how far back it may start is set by the line, not by a follow's reach)
        else if (backMax > -Infinity) {
          // heading back: the new line starts a row above or below and well behind where the line before began, so the
          // lines go leftward one after another (hovered over by the camera, never followed along: camera.ts)
          const Lw = Lp.words.reduce((a, Q) => a + Q.lw, 0) + gap * (Lp.words.length - 1) * 1.6, back = Lw * (0.85 + 0.35 * rnd(i * 2.9)) + gap * 3;   // (from the line before's start: its middle well left of that, a plain step leftward)
          const a0 = -back - gap * 2, a1 = -back + Lw + gap * 2, side = [0, 0];
          for (const Q of [...placed, ...prevLine!.words]) { const cs = corners(Q, padOf(Q)); let u0 = 1e9, u1 = -1e9;
            for (const p of cs) { const u = (p[0] - lineStart[0]) * d[0] + (p[1] - lineStart[1]) * d[1]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
            if (u1 < a0 || u0 > a1) continue;
            for (const p of cs) { const v = (p[0] - lineStart[0]) * nrm[0] + (p[1] - lineStart[1]) * nrm[1]; side[0] = Math.max(side[0], -v); side[1] = Math.max(side[1], v); } }
          const upw = Math.abs(side[0] - side[1]) < gap ? rnd(i * 4.1 + 2) < 0.5 : side[0] < side[1], ext = upw ? side[0] : side[1];
          const off = (ext + gap * 2.2 + h / 2) * (upw ? -1 : 1), s0: [number, number] = [lineStart[0] + nrm[0] * off - d[0] * back, lineStart[1] + nrm[1] * off - d[1] * back];
          cc = [s0[0] + d[0] * w / 2, s0[1] + d[1] * w / 2]; P = [cc[0] + d[0] * w / 2, cc[1] + d[1] * w / 2]; lineStart = s0; Lp.back = true;
        } else if (k === 0 && !first && prevLine && (mode === 'above' || (!mode && lr >= P_BELOW && lr < P_BELOW + P_ABOVE)) && !Lp.vert && !prevLine.vert) {
          // above the line before, ending over its second-to-last character: the singing carries on from where it was
          // instead of jumping back to where the line before began (below has its own branch, as likely as this one)
          // (measured from where it is set — the pen, gone back along the line — as below is: measured from where the line
          // before began, a line that had stepped down as it went was set on top of its own end, and rejected)
          const back = onward(alignBack(Lp, prevLine, P, d)); if (back === alignBack(Lp, prevLine, P, d)) align = { X: penult(prevLine, P), d };
          const ref: [number, number] = [P[0] - d[0] * back, P[1] - d[1] * back];
          let ext = 0; for (const Q of prevLine.words) for (const p of corners(Q, padOf(Q))) ext = Math.max(ext, -((p[0] - ref[0]) * nrm[0] + (p[1] - ref[1]) * nrm[1]));
          const off = -(ext + gap * 2.5 + h / 2), s0: [number, number] = [ref[0] + nrm[0] * off, ref[1] + nrm[1] * off];
          cc = [s0[0] + d[0] * w / 2, s0[1] + d[1] * w / 2]; P = [cc[0] + d[0] * w / 2, cc[1] + d[1] * w / 2]; lineStart = s0;
        } else if (k === 0 && !first && prevLine && (mode === 'below' || (!mode && lr < P_BELOW)) && !prevLine.vert) {
          const bk = onward(alignBack(Lp, prevLine, P, d)); if (bk === alignBack(Lp, prevLine, P, d)) align = { X: penult(prevLine, P), d }; const ref: [number, number] = [P[0] - d[0] * bk, P[1] - d[1] * bk];
          let below = 0; for (const Q of prevLine.words) for (const p of corners(Q, padOf(Q))) below = Math.max(below, (p[0] - ref[0]) * nrm[0] + (p[1] - ref[1]) * nrm[1]);
          const s0: [number, number] = [ref[0] + nrm[0] * (below + gap * 2.5 + h / 2), ref[1] + nrm[1] * (below + gap * 2.5 + h / 2)];
          cc = [s0[0] + d[0] * w / 2, s0[1] + d[1] * w / 2]; P = [cc[0] + d[0] * w / 2, cc[1] + d[1] * w / 2]; lineStart = s0;
        } else if (k === 0 && !first && prevLine && prevLine.vert && Lp.vert && mode !== 'dash') {
          // a line of columns after a line of columns: beside it — to its right or to its left, its top character level
          // with the line before's fourth — or below it, where the camera's own bounds keep it in reach (a retry asks
          // for 'right' or 'below' outright)
          const at = (p: [number, number]) => [p[0] * d[0] + p[1] * d[1], p[0] * nrm[0] + p[1] * nrm[1]];
          let a0 = 1e9, a1 = -1e9, b1 = -1e9; for (const Q of prevLine.words) for (const p of corners(Q)) { const [x, y] = at(p); a0 = Math.min(a0, x); a1 = Math.max(a1, x); b1 = Math.max(b1, y); }
          const us: { x: number; y: number; h: number }[] = []; for (const Q of prevLine.words) { const c = Math.cos(Q.tilt * D2R), sn = Math.sin(Q.tilt * D2R); for (const u of Q.units) us.push({ x: Q.x + c * u.ox - sn * u.oy, y: Q.y + sn * u.ox + c * u.oy, h: u.h }); }
          const u4 = us[Math.min(3, us.length - 1)], top4 = at([u4.x, u4.y])[1] - u4.h / 2;
          const Wb = Lp.words.reduce((t, Q) => t + Q.lw, 0) + gap * (Lp.words.length - 1), r0 = rnd(i * 13.7 + 2);
          // (a passage gone far from where it began: the next column beside it on the side back towards there, or below)
          const back0 = far && secO ? ((secO[0] - prevLine.ax) * d[0] + (secO[1] - prevLine.ay) * d[1] < 0 ? 1 : 0) : -1;
          const side = mode === 'right' ? 0 : mode === 'below' ? 2 : back0 >= 0 ? (r0 < 0.6 ? back0 : 2) : r0 < 0.4 ? 0 : r0 < 0.7 ? 1 : 2;
          const x0 = side === 0 ? a1 + gap * 2.2 : side === 1 ? a0 - gap * 2.2 - Wb : a0, top = side === 2 ? b1 + gap * 2.5 : top4;
          const toW = (x: number, y: number): [number, number] => [d[0] * x + nrm[0] * y, d[1] * x + nrm[1] * y];
          cc = toW(x0 + w / 2, top + h / 2);
          // (the pen after it, on the line the line's other columns hang from: their tops level with this one's)
          P = toW(x0 + w, top + prevH / 2); lineStart = toW(x0, top + prevH / 2); colN = 0;
        } else if (k > 0 && !S.vert && prevSeg && !prevSeg.vert && mode !== 'right' && mode !== 'dash' && (cc = placeNext(S, prevSeg, w, h, d, nrm, i, k))) {
          P = [cc[0] + d[0] * w / 2, cc[1] + d[1] * w / 2];
        } else {
          const g2 = first ? 0 : k === 0 ? gap * (mode === 'dash' ? 2 : 3 + 5 * rnd(i * 6.1 + 2) ** 2) : S.w.latin && prevSeg && prevSeg.w.latin ? Math.max(gap, h * 0.32) : gap, jit = first ? 0 : (rnd(i + k * 2.2) - 0.5) * h * 0.2;
          // a dash rises and dips with the beat as it runs on (a wave across the bar), instead of a random jitter
          const wave = mode === 'dash' ? Math.sin((S.w.t / map.beatLen(S.w.t)) * Math.PI / 2 + i * 0.7) * h * 0.42 : jit;
          // a column hangs from the row's top; the columns of a run step down a little one after another, like a poem set
          // by hand (a cascade, not a ruler), and their words follow each other closely down the page
          if (S.vert && k === 0) colN = prevSeg && prevSeg.vert ? colN + 1 : 0;
          const col = S.vert ? colN : 0;
          const off = S.vert ? (h - prevH) / 2 + (col ? (0.18 + 0.32 * rnd(i * 4.7 + 1)) * prevH * (col % 3 === 2 ? -0.6 : 1) : 0) : wave;
          cc = [P[0] + d[0] * (g2 + w / 2) + nrm[0] * off, P[1] + d[1] * (g2 + w / 2) + nrm[1] * off];
          P = [P[0] + d[0] * (g2 + w), P[1] + d[1] * (g2 + w)];
          if (k === 0) lineStart = [cc[0] - d[0] * w / 2, cc[1] - d[1] * w / 2];
        }
        c = cc!;
      }
      if (secFirst && k === 0) secFirst = false;
      S.x = c[0]; S.y = c[1]; S.ang = th; S.tilt = th + (S.roll ? 0 : tilt0 * TK * 0.35);
      // (round a centre a clash is never nudged away — that would carry the line off its place round the line before, and
      // its turn with it: another angle is tried instead)
      if (ORBIT && orbitTry != null && hits(S)) bad = true;
      else if (hits(S)) { const d = dirv(th), n = dirv(th + 90), ox = S.x, oy = S.y; let done = false;
        // (a passage gone far from where it began is nudged up, down, or back towards it — never further on)
        const sd = far && secO ? Math.sign((secO[0] - ox) * d[0] + (secO[1] - oy) * d[1]) || -1 : 1;
        // (up or down: away from the line before, on the side it is already on — never always down)
        const vs = prevLine && prevLine !== Lp ? Math.sign((ox - prevLine.ax) * n[0] + (oy - prevLine.ay) * n[1]) || (rnd(i * 2.1 + k) < 0.5 ? -1 : 1) : (rnd(i * 2.1 + k) < 0.5 ? -1 : 1);
        const tries = (s2: number) => far ? [[n[0] * h * 0.45 * s2, n[1] * h * 0.45 * s2], [-n[0] * h * 0.45 * s2, -n[1] * h * 0.45 * s2], [sd * d[0] * w * 0.3 * s2, sd * d[1] * w * 0.3 * s2]]
          : [[d[0] * w * 0.3 * s2, d[1] * w * 0.3 * s2], [vs * n[0] * h * 0.45 * s2, vs * n[1] * h * 0.45 * s2], [(d[0] + vs * n[0]) * w * 0.22 * s2, (d[1] + vs * n[1]) * w * 0.22 * s2]];
        for (let s2 = 1; s2 <= 12 && !done; s2++) for (const [ux, uy] of tries(s2)) {
          S.x = ox + ux; S.y = oy + uy; if (!hits(S)) { P = [P[0] + ux, P[1] + uy]; done = true; break; } }
        if (!done) { S.x = ox; S.y = oy; bad = true; clashed = true; } }
      if (prevSeg && !first) {
        // (a line heading back is hovered over: the camera goes from over the line before to over this one's first words
        // — never from the last character sung to its first, so no follow's reach applies; a move too long is crossed by
        // a transition, as any is)
        // (round a centre: the camera goes from the line before — the centre — out to this one's middle, so that distance
        // is what must be within reach, about a frame — measured to its middle, not its first word, or only the lines
        // to the right of the centre would ever fit)
        if (k === 0) { if (orb) { if (orbR * zOf(S) / W > ORBIT_REACH || orbOut) bad = true; }
          // (stacked above or below in a passage gone far: in reach of any word of the line before, the camera going
          // from over that line to over this one — not from its last word)
          else if (far && prevLine) { if (!prevLine.words.some(Q => inView(Q, S) || blankOf(Q, S) <= SPAN)) bad = true; }
          else if (!Lp.back && !inView(prevSeg, S) && blankOf(prevSeg, S) > (alongMotion(prevSeg, S) ? SPAN : SPAN * BACK_REACH)) bad = true; }
        else if (blankOf(prevSeg, S) > SPAN) bad = true;
      }
      placed.push(S); prevSeg = S;
      // (a type set deeper: its lines further apart in depth, its words within a line a little more — √ of it — so a line
      // still reads as one)
      // (a type set deep — round a centre — has each line come in a step nearer than the one before, so the lines sung
      // fall back into the depth as the camera goes on, smaller; set at random depths, a line before could be far nearer
      // than the one sung, and loomed up to twice its size past the frame's edges)
      if (k === 0) Lp.d = first ? 0 : LD > 1 && prevLine ? prevLine.d - DEP * Math.sqrt(LD) * (60 + 70 * rnd(i * 7.9 + 2)) : DEP * LD * ((rnd(i * 7.9 + 2) - 0.5) * 600);
      S.d = first ? 0 : Lp.d + DEP * Math.min(Math.sqrt(LD), 1.15) * ((rnd(i * 13 + k * 3.3) - 0.5) * 260 + (k % 2 ? 80 : -60));
      // (set apart by a rule: nearer than every word of its line before it — and so drawn over them)
      if (S.w.lift) S.d = Math.min(S.d, ...Lp.words.slice(0, k).map(Q => Q.d)) - S.w.lift.near;
      if (!S.vert) prevH = h;
    });
    // a line that went back to the left: moved along so that its last character stands exactly over (under) the line
    // before's second-to-last, as placed (its words may have stepped off a straight row) — unless that would collide
    const al = align as { X: [number, number]; d: [number, number] } | null;   // (set inside the loop above)
    if (al && Lp.words.length) { const L = Lp.words[Lp.words.length - 1], lu = L.units[L.units.length - 1], c = Math.cos(L.tilt * D2R), sn = Math.sin(L.tilt * D2R);
      const ux = L.x + c * lu.ox - sn * lu.oy, uy = L.y + sn * lu.ox + c * lu.oy, sh = (al.X[0] - ux) * al.d[0] + (al.X[1] - uy) * al.d[1], dx = al.d[0] * sh, dy = al.d[1] * sh;
      const mine = new Set(Lp.words), clashes = () => Lp.words.some(S => placed.some(Q => !mine.has(Q) && !(Q.frame && Q.frame === S.frame) && clash(S, Q)));
      for (const S of Lp.words) { S.x += dx; S.y += dy; }
      if (clashes()) for (const S of Lp.words) { S.x -= dx; S.y -= dy; } else { P = [P[0] + dx, P[1] + dy]; lineStart = [lineStart[0] + dx, lineStart[1] + dy]; } }
    const fa = Lp.words[0]?.ang ?? th, B = boxIn(Lp.words, fa);
    Lp.ax = B.x; Lp.ay = B.y; Lp.bw = B.w; Lp.bh = B.h; Lp.prot = fa;
    { const d0 = dirv(fa), pos = B.x * d0[0] + B.y * d0[1];
      // hovered over (camera.ts): a line laid heading back, the first of a passage that heads back, and any line that
      // stands clearly left of the one before — the camera then goes leftward from line to line, never right along a
      // line and back
      // (leftward on the screen, whichever way the path has turned)
      if (ORBIT && opens) { orbO = [B.x, B.y]; orbZ = zOf(Lp.words[0]); }
      if (opens) { secO = [B.x, B.y]; secR = Math.max(B.w, W / zOf(Lp.words[0])); }
      // (never too far one way from where the passage began: a line that would be is placed otherwise, or after a
      // transition — the camera never sets off on a long run one way, a dash excepted)
      else if (secO && !ORBIT && mode !== 'dash' && !roam && Math.abs(B.x - secO[0]) > WANDER * Math.max(secR, B.w * 0.5)) bad = true;
      Lp.west = !Lp.rtl && (Lp.back || westStart || (!!prevLine && B.x - prevLine.ax < -Math.max(BASE * T, B.w * 0.2)));
      // (the way the lines go is the passage's own, all through it: it turns at a transition, never between two lines)
      if (flowFrom == null) flowFrom = pos; }
    Lp.d = Lp.words.reduce((a, S) => a + S.d, 0) / Math.max(1, Lp.words.length);
    prevLine = Lp;
    S0 = { P, th, lineStart, prevH, lastTurn, prevLine, prevSeg, secFirst, flow, flowFrom, backN, colN };
    return !bad;
  };
  // (close up, a page holds fewer lines: more of the song is crossed by quick blur transitions)
  const startsAt = new Set(passages.map(p => p.line)), canClear = (st.trans || 'auto') !== 'off', CROWD = CROWD_UNITS, sweeps: { t: number; line: number }[] = []; let onPage = 0;
  lines.forEach((Lp, i) => {
    if (!Lp.words.length) return;
    // a crowding page: from a couple of lines before CROWD, a line with room for a quick clear clears the picture; from
    // CROWD on, even a short breath is taken, so a song sung without pauses still clears — and where there is no time
    // even for that, the lines out of sight are taken away unseen. (Whatever these choose, plan.ts holds the page to
    // PAGE_LINES lines up at once.)
    if (i > 0 && !startsAt.has(i) && canClear && onPage >= CROWD - 8) { const A = lines[i - 1], endA = Math.min(A.L.sung, A.L.end);
      const nx = Lp.words[0].show;
      // (a crowded page takes even a short breath: the line before sung out, then a quick blur in and out)
      if (nx - endA >= (onPage >= CROWD ? 0.45 : 0.55)) { passages.push({ ...timePassage(endA, nx, map, true), line: i, quick: true, reason: 'crowd' }); startsAt.add(i); }
      // no time for the line before to be sung out and the blur to pass: no blur — the lines the camera no longer sees
      // are taken away instead, unseen (plan.ts applySweeps), and the singing goes on on the same page
      else if (onPage >= CROWD) { sweeps.push({ t: nx - 0.05, line: i }); onPage = 0; }
      // (a clear just made: a pause's own one a line or two later would only blur the page again at once)
      if (startsAt.has(i)) for (let j = i + 1; j <= i + 2; j++) { const q = passages.findIndex(x => x.line === j && x.reason === 'gap'); if (q >= 0) { passages.splice(q, 1); startsAt.delete(j); } } }
    if (i > 0 && startsAt.has(i)) { newPassage(); onPage = 0; }
    onPage += pageUnits(Lp);
    const before = save();
    // a scene's own arrangement first (a dash runs on to the right); the ordinary tries after it
    Lp.scene = scenes[i];
    if (scenes[i] === 'dash' && i > 0 && !startsAt.has(i)) { if (placeLine(Lp, i, 'dash')) return; restore(before); Lp.scene = null; }
    // (round the line before: a few angles, the first that fits — else the ordinary placements)
    if (ORBIT && i > 0 && !startsAt.has(i)) {
      for (let q = 0; q < ORBIT_TRIES + 6; q++) { orbitTry = q; const ok = placeLine(Lp, i, null); orbitTry = null; if (ok) return; restore(before); }
      // (none fits at all — the circle is full: a blur transition and a new circle, where there is a moment for one;
      // where there is none, close round the centre all the same — never sent off onward to the right)
      const A = lines[i - 1], endA = Math.min(A.L.sung, A.L.end);
      if (canClear && roomForQuick(endA, Lp.words[0].show)) { restore(before);
        passages.push({ ...timePassage(endA, Lp.words[0].show, map, true), line: i, quick: true, reason: 'layout' }); startsAt.add(i);
        newPassage(); onPage = pageUnits(Lp); placeLine(Lp, i, null); return; }
      orbitTry = ORBIT_TRIES; placeLine(Lp, i, null); orbitTry = null; return; }
    if (placeLine(Lp, i, null) || i === 0 || startsAt.has(i)) return;
    // (then below or above the line before — either first, as it falls — then, in a passage going rightward, on to the right)
    const vfirst = rnd(i * 3.7 + 1.3) < 0.5 ? 'below' : 'above';
    restore(before); if (placeLine(Lp, i, vfirst)) return;
    restore(before); if (placeLine(Lp, i, vfirst === 'below' ? 'above' : 'below')) return;
    if (S0.flow > 0) { restore(before); if (placeLine(Lp, i, 'right')) return; }
    const A = lines[i - 1], endA = Math.min(A.L.sung, A.L.end);
    // no room for a clear (or none allowed): keep going on the page — below or above the line before if it fits there,
    // which stays nearest — and where it fits nowhere, a quick blur all the same if there is any moment at all for one (a
    // blur is better than lines on top of each other), else wherever it goes, the camera making the longer move
    if (!canClear || !roomForQuick(endA, Lp.words[0].show)) { roam = true; restore(before); let ok = placeLine(Lp, i, vfirst);
      if (!ok) { restore(before); ok = placeLine(Lp, i, vfirst === 'below' ? 'above' : 'below'); }
      if (!ok) { restore(before); ok = placeLine(Lp, i, null); }
      roam = false; if (ok || !clashed || !canClear || Lp.words[0].show - endA < 0.2) return; }
    restore(before);
    const tm = timePassage(endA, Lp.words[0].show, map, true);
    passages.push({ ...tm, line: i, quick: true, reason: 'layout' }); startsAt.add(i);
    newPassage(); onPage = pageUnits(Lp); placeLine(Lp, i, null);
  });
  passages.sort((a, b) => a.t - b.t);
  assignSections(lines, passages);
  dropShortFrames(lines);
  // draw order, fixed: deeper first, then in singing order (never re-sorted by the view)
  const order = [...words].sort((a, b) => b.d - a.d || a.w.id - b.w.id); order.forEach((S, i) => { S.order = i; });
  const dmin = words.reduce((m, S) => Math.min(m, S.d), 0);
  return { lines, words, passages, dmin, sweeps };
}

/** Which lines are set vertically: whole lines, in runs of two to four (a few lines down the page, then rows again),
 *  never a lone column among rows nor columns and rows mixed within a line. A line can stand as a column when it is all
 *  CJK, two to ten characters long (in at most five words) and not a quick run; runs start now and then, rows between. */
export function vertRuns(ls: LyricDoc['lines']): Set<number> {
  // (a line is mostly one word now — words break only at spaces — so it is the line's length that counts: two to ten
  // characters down a column, in at most five words)
  const ok = (L: LyricDoc['lines'][number]) => { if (!L || !L.words.length || L.words.length > 5 || fastLine(L) || !L.words.every(w => w.cjk && !w.latin)) return false;
    const n = L.words.reduce((a, w) => a + w.units.length, 0); return n >= 2 && n <= 10; };
  // (the count of lines since the last run goes on over the whole song — a transition or a new page does not restart
  // it — and the chance of a run grows with it: a quarter at six lines on, certain by about fourteen, so every song
  // with lines that can stand as columns gets them)
  const out = new Set<number>(); let last = -9;
  for (let i = 1; i < ls.length; i++) {
    const since = i - last, chance = clamp(0.26 + (since - 6) * 0.1, 0, 1);
    if (since < 6 || !ok(ls[i]) || !ok(ls[i + 1]) || rnd(ls[i].i * 37 + 5.3) >= chance) continue;
    const want = 2 + Math.floor(rnd(ls[i].i * 11.3 + 2) * 3); let j = i; while (j < ls.length && j - i < want && ok(ls[j])) j++;
    if (j - i < 2) continue;
    for (let k = i; k < j; k++) out.add(k);
    last = j - 1; i = j - 1;
  }
  return out;
}

/** How close the close-up holds a word: a character about two fifths of the frame high (as camera.ts frames it). */
export function closeZoom(S: { units: { w: number; h: number }[]; lh: number }, H: number, W: number, T: number) {
  const hs = S.units.map(u => u.h).sort((a, b) => a - b), uh = hs[hs.length >> 1] || S.lh, uw = Math.max(1, ...S.units.map(u => u.w));
  return Math.min(H * 0.4 / uh * T, W * 0.5 / uw, H * 0.62 / Math.max(1, ...S.units.map(u => u.h)));
}
/** How close the camera holds the centred stage: the lyric type a steady size on screen (its typical word about 12 %
 *  of the frame's height), whatever the song. */
export function centerZoom(words: PWord[], H: number, T: number) {
  const hs = words.filter(S => !S.vert).map(S => S.lh / S.s).sort((a, b) => a - b), h0 = hs.length ? hs[hs.length >> 1] : EM;
  return clamp(H * 0.12 / (h0 * T), 0.15, 2);
}
/** The centred stage (camera style 'center'): every line is set level, wrapped into rows that fit the frame, as many
 *  lines at a time as fit in three rows, in a set order — the middle, above it, below it — then a transition, the
 *  group leaving in it, and the next begins; no depth and no turns. */
function centerLayout(lines: PLine[], words: PWord[], W: number, H: number, gap: number, T: number, map: RhythmMap, trans: boolean): LayoutResult {
  const z = centerZoom(words, H, T), maxW = W * 0.8 / z, rg = gap * 2.2, sp = (S: PWord) => (S.w.latin ? Math.max(gap, S.lh * 0.32) : gap);
  // each line wrapped into rows that fit the frame
  const blocks = lines.map(P => { const rows: PWord[][] = [[]]; let rw = 0;
    for (const S of P.words) { const g = rows[rows.length - 1].length ? sp(S) : 0;
      if (rows[rows.length - 1].length && rw + g + S.lw > maxW) { rows.push([]); rw = 0; } rw += (rows[rows.length - 1].length ? g : 0) + S.lw; rows[rows.length - 1].push(S); }
    const rh = rows.map(r => r.length ? Math.max(...r.map(S => S.lh)) : 0), bh = rh.reduce((a, h) => a + h, 0) + rg * (rows.length - 1);
    return { rows, rh, bh }; });
  // as many lines at a time as take three rows at most (three short lines; a wrapped one and a short one; a line of
  // three rows alone — longer still, alone too), in a set order: the first in the middle, the next above it, the third
  // below it; then the group goes together as the next begins (its first in the middle again)
  const sung = lines.filter(P => P.words.length), groupOf = new Map<PLine, number>(), slotOf = new Map<PLine, number>(), firsts = new Set<number>();
  { let g = -1, rowsIn = 3, slot = 0;
    for (const P of sung) { const n = blocks[P.i].rows.length;
      if (rowsIn + n > 3 || slot >= 3) { g++; rowsIn = 0; slot = 0; firsts.add(P.i); }
      groupOf.set(P, g); slotOf.set(P, slot++); rowsIn += n; } }
  const mid = new Map<number, number>(); for (const P of sung) if (slotOf.get(P) === 0) mid.set(groupOf.get(P)!, blocks[P.i].bh);
  lines.forEach((P, i) => { if (!P.words.length) return;
    const { rows, rh, bh } = blocks[i], slot = slotOf.get(P)!, m = mid.get(groupOf.get(P)!) ?? bh, away = m / 2 + bh / 2 + rg * 1.6;
    const cy = slot === 0 ? 0 : slot === 1 ? -away : away; let y = cy - bh / 2;
    rows.forEach((r, ri) => { const ws = r.reduce((a, S, k) => a + S.lw + (k ? sp(S) : 0), 0); let x = -ws / 2;
      for (const [k, S] of r.entries()) { if (k) x += sp(S); S.x = x + S.lw / 2; S.y = y + rh[ri] / 2; S.tilt = 0; S.ang = 0; S.d = 0; S.roll = 0; x += S.lw; }
      y += rh[ri] + rg; });
    const B = boxIn(P.words, 0); P.ax = B.x; P.ay = B.y; P.bw = B.w; P.bh = B.h; P.prot = 0; P.d = 0;
  });
  // after each group, a transition (the group goes in it, the next comes in after it) — a quick one where the next
  // line follows close on; with transitions off, the group only fades out together just before the next comes in
  const passages: Passage[] = [], leaves: { line: number; t: number; inn: number }[] = [];
  sung.forEach((B, k) => { if (k === 0 || !firsts.has(B.i)) return; const A = sung[k - 1], end = Math.min(A.L.sung, A.L.end), t = B.words[0].show;
    if (trans) passages.push({ ...timePassage(end, t, map, t - end < 1.2), line: B.i, quick: t - end < 1.2, reason: 'layout' });
    else for (const P of sung.filter(Q => groupOf.get(Q) === groupOf.get(A))) leaves.push({ line: P.i, t, inn: 0.35 }); });
  assignSections(lines, passages);
  const order = [...words].sort((a, b) => a.w.id - b.w.id); order.forEach((S, i) => { S.order = i; });
  return { lines, words, passages, dmin: 0, sweeps: [], leaves };
}

/** A quick clear decided while placing (or by the camera) may still shorten a framed line: such a frame is not drawn
 *  rather than cut short. */
export function dropShortFrames(lines: PLine[]) {
  for (const P of lines) if (isFinite(P.secEnd)) for (const S of P.words) { const F = S.frame;
    if (F && Math.min(P.L.end, P.secEnd - Math.max(0.4, P.secIn)) - 0.8 - F.ts < FRAME_NEED) for (const x of F.words) x.frame = null; }
}
/** Which passage each line belongs to, and when it ends; a line's end is trimmed to before its passage's transition. */
export function assignSections(lines: PLine[], passages: Passage[]) {
  const sorted = [...passages].sort((a, b) => a.t - b.t);
  for (const P of lines) {
    let k = 0; while (k < sorted.length && sorted[k].line <= P.i) k++;
    P.sec = k; P.secEnd = k < sorted.length ? sorted[k].t : Infinity; P.secIn = k < sorted.length ? sorted[k].inn : 0.4;
  }
}
export { angDiff };
