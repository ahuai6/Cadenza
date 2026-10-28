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
import type { PWord, PLine, Passage, FrameRef } from './types';
import { gapPassages, timePassage, roomForQuick } from './passages';
import { unitsOf } from '../lyrics/script';

export const TIN_MIX = ['blur', 'drift', 'rise', 'track'];
export const FRAME_NEED = 1.3;
export interface LayoutInput { doc: LyricDoc; map: RhythmMap; style: Style; measure: Measurer; W: number; H: number; musicEnd: number }
export interface LayoutResult { lines: PLine[]; words: PWord[]; passages: Passage[]; dmin: number }

export const tsz = (st: Style) => clamp(st.m.tsize ?? 1, 0.5, 2.5);
/** How close the camera frames one word: about 68 % of the width or 46 % of the height, against the line's typical
 *  word height so small words are not blown up; never more than the frame can hold. */
export function wordZoom(S: { lw: number; lh: number }, medLh: number, W: number, H: number, T: number) {
  const z = Math.min(W * 0.68 / S.lw, H * 0.46 / Math.max(S.lh, medLh * 0.85));
  return Math.min(z * T, W * 0.8 / S.lw, H * 0.58 / S.lh);
}
export function corners(S: { x: number; y: number; lw: number; lh: number; tilt: number }, pad = 0): [number, number][] {
  const d = dirv(S.tilt), n = dirv(S.tilt + 90), hw = S.lw / 2 + pad, hh = S.lh / 2 + pad;
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([a, b]) => [S.x + d[0] * hw * a + n[0] * hh * b, S.y + d[1] * hw * a + n[1] * hh * b]);
}
export function boxIn(segs: { x: number; y: number; lw: number; lh: number; tilt: number }[], fa: number, pad = 0) {
  const u = dirv(fa), v = dirv(fa + 90); let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (const S of segs) for (const p of corners(S, pad)) { const a = p[0] * u[0] + p[1] * u[1], b = p[0] * v[0] + p[1] * v[1]; u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, b); v1 = Math.max(v1, b); }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2; return { x: u[0] * cu + v[0] * cv, y: u[1] * cu + v[1] * cv, w: u1 - u0, h: v1 - v0 };
}
const ANTIC = (st: Style) => clamp((st.m.enter ?? 0.3) * 0.3, 0.05, 0.14);

export function layout(inp: LayoutInput): LayoutResult {
  const { doc, map, style: st, measure, W, H } = inp, M = st.m, T = tsz(st);
  const BASE = EM, gap = BASE * 0.14 * T, TURN = clamp(M.turn ?? 0.4, 0, 1), TA = M.tang ?? 90, TK = M.tilt, DEP = M.depth ?? 1;
  const waltz = st.cut === 'waltz', smooth = st.cut !== 'punch';

  /* ---- words, measured ---- */
  const lines: PLine[] = [], words: PWord[] = [];
  for (const L of doc.lines) {
    const P: PLine = { L, i: L.i, words: [], sec: 0, secEnd: Infinity, secIn: 0.4, ax: 0, ay: 0, bw: 0, bh: 0, prot: 0, d: 0, back: false, rtl: L.rtl };
    let prev: { group: number; s0: number; tin: string; show: number } | null = null;
    for (const Wd of L.words) {
      const k = Wd.k, n = Wd.units.length;
      const vert = Wd.cjk && n >= 2 && n <= 5 && k > 0 && rnd(L.i * 37 + k * 11.3) < 0.34;
      const mb = measure.word(Wd.units.map(u => u.c), { vertical: vert, rtl: L.rtl });
      let s0 = Wd.latin ? 1.1 : n === 1 ? 0.5 : [1, 0.62, 1.32][Math.floor(rnd(L.i * 13 + k * 5.1) * 3)];
      if (k === 0 && !Wd.latin) s0 = Math.max(s0, 1);
      // words sung as one quick run (one gesture) share one size and one entrance, so they read as one beat, not a stutter
      const fused: boolean = !!prev && prev.group === Wd.group; if (fused) s0 = prev!.s0;
      const tinV = st.tin || 'mix', tin: string = fused ? prev!.tin : tinV === 'mix' ? TIN_MIX[Math.floor(rnd(L.i * 13.7 + k * 7.1 + 2) * TIN_MIX.length)] : tinV, s = s0 * T;
      const show: number = fused ? prev!.show : Wd.t - ANTIC(st);
      prev = { group: Wd.group, s0, tin, show };
      const pw: PWord = { w: Wd, line: P, k, x: 0, y: 0, tilt: 0, d: 0, s, lw: mb.w0 * s, lh: mb.h0 * s, w0: mb.w0, h0: mb.h0, vert,
        units: Wd.units.map((u, ui) => ({ c: u.c, t: u.t, ox: mb.units[ui].cx * s, oy: mb.units[ui].cy * s, w: mb.units[ui].w * s, h: mb.units[ui].h * s, rot: mb.units[ui].rot })),
        ang: 0, frame: null, order: 0, show, end: Wd.end, tin, seed: L.i * 101 + k * 7 + 1 };
      P.words.push(pw); words.push(pw);
    }
    lines.push(P);
  }
  const medLh = (P: PLine) => { const hs = P.words.filter(S => !S.vert).map(S => S.lh).sort((a, b) => a - b); return hs.length ? hs[hs.length >> 1] : P.words[0]?.lh ?? BASE; };
  const med = new Map(lines.map(P => [P, medLh(P)]));
  const zOf = (S: PWord) => wordZoom(S, med.get(S.line)!, W, H, T);

  /* ---- passages at pauses ---- */
  const passages = gapPassages(lines.map(P => ({ t: P.words[0]?.show ?? P.L.t, sungEnd: Math.min(P.L.sung, P.L.end) })), map, inp.musicEnd, (st.trans || 'auto') !== 'off');
  /* ---- lyric frames, before placement ----
     About half the lines ask for one on a chosen word. When that word does not leave the frame enough time on screen (its
     line ends, or a passage clears the picture), the frame moves on to the next word that does, into the following lines if
     need be: frames stay frequent and are never cut short. */
  const nextPass = new Map(passages.map(q => [q.line, q]));
  const lineEnd = (P: PLine) => { const q = nextPass.get(P.i + 1); return q ? Math.min(P.L.end, q.t - q.inn) : P.L.end; };
  if (st.fx.frame) { let want = false;
    for (const P of lines) {
      const n = P.words.length; let k0 = 0;
      if (!want && P.i > 0 && rnd(P.i * 7.7 + 3.3) < 0.5) { want = true; k0 = n === 1 ? 0 : Math.min(n - 1, Math.floor(rnd(P.i * 2.9) * Math.min(n, 3))); }
      if (!want) continue;
      for (let k = k0; k < n; k++) { const S = P.words[k]; if (lineEnd(P) - 0.8 - S.w.t >= FRAME_NEED) {
        const fw = P.words.slice(Math.max(0, k - 2), k + 1), pad = Math.min(...fw.map(x => x.lh)) * 0.3 * 2.3;
        const F: FrameRef = { words: fw, ts: S.w.t, corner: rnd(P.i * 5.1) < 0.5, pad }; for (const x of fw) x.frame = F; want = false; break; } }
    } }
  const padOf = (S: PWord) => (S.frame ? S.frame.pad * 0.6 : 0);

  const starts = lines.flatMap(P => P.words.map(S => S.w.t)).sort((a, b) => a - b);
  const dens = (t: number) => { let c = 0; for (const x of starts) { if (x > t + 1.6) break; if (x >= t - 1.6) c++; } return c; };
  let mxd = 1; for (const x of starts) mxd = Math.max(mxd, dens(x));

  /* ---- placement ---- */
  const FLIP = clamp(M.flip ?? 1, 0.2, 6) * BASE * 8 * T;
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
  const hits = (S: PWord) => placed.some(Q => Q.frame && Q.frame === S.frame ? false : clash(S, Q));
  const FLOW: [string, number][] = waltz ? [['right', .34], ['below', .26], ['stair', .26], ['rise', .14]] : smooth ? [['right', .38], ['below', .30], ['stair', .28], ['rise', .04]] : [['right', .40], ['below', .28], ['stair', .20], ['rise', .12]];
  const placeNext = (S: PWord, Q: PWord, w: number, h: number, d: [number, number], n: [number, number], i: number, k: number): [number, number] | null => {
    let r = rnd(i * 61.7 + k * 4.3 + 3), mode = 'right'; for (const [m, wt] of FLOW) { if (r < wt) { mode = m; break; } r -= wt; }
    const down = Q.lh / 2 + gap * 1.3 + h / 2;
    if (mode === 'below') { const al = rnd(i * 5.1 + k * 7.7), ax = al < 0.34 ? (w - Q.lw) / 2 : al < 0.67 ? 0 : (Q.lw - w) / 2; return [Q.x + n[0] * down + d[0] * ax, Q.y + n[1] * down + d[1] * ax]; }
    if (mode === 'stair') { const ax = Q.lw * 0.3 + w * 0.3; return [Q.x + n[0] * down * 0.92 + d[0] * ax, Q.y + n[1] * down * 0.92 + d[1] * ax]; }
    if (mode === 'rise') { const ax = Q.lw / 2 + (S.w.latin && Q.w.latin ? Math.max(gap, h * 0.32) : gap) + w / 2, up = (Q.lh + h) * 0.32; return [Q.x + d[0] * ax - n[0] * up, Q.y + d[1] * ax - n[1] * up]; }
    return null;
  };
  // the empty space between two neighbours, in frames at the wider framing of the two
  const SPAN = 0.55, BACK_REACH = 0.7, FOLD = 0.9;
  const blankOf = (A: PWord, B: PWord) => { const z = Math.min(zOf(A), zOf(B)), d = dirv(A.tilt), n = dirv(A.tilt + 90), dx = B.x - A.x, dy = B.y - A.y;
    const ext = (Q: PWord, ax: number) => Math.abs(Q.lw / 2 * Math.cos((Q.tilt - A.tilt) * D2R + (ax ? Math.PI / 2 : 0))) + Math.abs(Q.lh / 2 * Math.sin((Q.tilt - A.tilt) * D2R + (ax ? Math.PI / 2 : 0)));
    return Math.max((Math.abs(dx * d[0] + dy * d[1]) - ext(A, 0) - ext(B, 0)) / (W / z), (Math.abs(dx * n[0] + dy * n[1]) - ext(A, 1) - ext(B, 1)) / (H / z)); };
  const inView = (A: PWord, B: PWord) => { const z = zOf(A), d = dirv(A.tilt), n = dirv(A.tilt + 90), hw = W / (2 * z) * 0.94, hh = H / (2 * z) * 0.94;
    return corners(B, padOf(B)).every(p => { const dx = p[0] - A.x, dy = p[1] - A.y; return Math.abs(dx * d[0] + dy * d[1]) <= hw && Math.abs(dx * n[0] + dy * n[1]) <= hh; }); };
  const alongMotion = (A: PWord, B: PWord) => { const Pv = placed.length > 1 && placed[placed.length - 1] === A ? placed[placed.length - 2] : null;
    const vx = Pv ? A.x - Pv.x : Math.cos(A.ang * D2R), vy = Pv ? A.y - Pv.y : Math.sin(A.ang * D2R), vl = Math.hypot(vx, vy) || 1, dx = B.x - A.x, dy = B.y - A.y, dl = Math.hypot(dx, dy) || 1;
    return (vx * dx + vy * dy) / (vl * dl) > Math.cos(60 * D2R); };

  type St = { P: [number, number]; th: number; lineStart: [number, number]; prevH: number; lastTurn: number; prevLine: PLine | null; prevSeg: PWord | null; secFirst: boolean; flow: number; flowFrom: number | null; backN: number; n?: number };
  let S0: St = { P: [0, 0], th: 0, lineStart: [0, 0], prevH: BASE, lastTurn: -9, prevLine: null, prevSeg: null, secFirst: false, flow: 1, flowFrom: null, backN: 0 };
  const save = (): St => ({ ...S0, P: [...S0.P] as [number, number], lineStart: [...S0.lineStart] as [number, number], n: placed.length });
  const restore = (v: St) => { placed.length = v.n!; S0 = { ...v, P: [...v.P] as [number, number], lineStart: [...v.lineStart] as [number, number] }; };
  let secN = 0;
  const newPassage = () => { secN++;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const Q of placed) for (const p of corners(Q)) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const up = rnd(secN * 7.3 + 1) < 0.4, sx = x0 - BASE * (1 + rnd(secN * 3.1) * 3);
    S0.P = [sx, up ? y0 - BASE * (3 + rnd(secN * 2.2) * 1.5) : y1 + BASE * (2 + rnd(secN * 2.2) * 1.5)]; S0.lineStart = [...S0.P] as [number, number];
    S0.th = [0, -10, 8, -16, 14][Math.floor(rnd(secN * 5.7) * 5)] * TK * 0.6; S0.prevLine = null; S0.prevSeg = null; S0.lastTurn = -9; S0.secFirst = true; S0.flow = 1; S0.flowFrom = null; S0.backN = 0; };

  const placeLine = (Lp: PLine, i: number, mode: string | null): boolean => {
    let { P, th, lineStart, prevH, lastTurn, prevLine, prevSeg, secFirst, flow, flowFrom, backN } = S0, bad = false;
    Lp.back = false;
    Lp.words.forEach((S, k) => {
      const w = S.lw, h = S.lh, first = (i === 0 && k === 0) || (secFirst && k === 0);
      const tilt0 = rnd(i * 5 + k * 9.1) < 0.3 ? (rnd(i * 3 + k) - 0.5) * 12 : 0;
      let turn = 0; const rd = Lp.rtl ? -1 : 1;
      if (!first && !Lp.rtl && TURN > 0 && TA > 0 && S.s > 0.55 && !S.vert && S.w.t - lastTurn >= map.beatLen(S.w.t)) {
        const acc = clamp(0.5 + map.accentAt(S.w.t) * 0.5, 0.5, 1.5);
        const p = TURN * (k === 0 ? 0.9 : 0.45) * acc * (0.6 + 0.8 * dens(S.w.t) / mxd) * (S.w.latin ? 0.7 : 1);
        if (rnd(i * 53 + k * 7.7 + 11) < p) {
          const pref = th > 1 ? -1 : th < -1 ? 1 : (rnd(i * 3 + k * 5) < 0.5 ? -1 : 1), sg = rnd(i * 17 + k * 3.1) < 0.75 ? pref : -pref;
          turn = sg * Math.max(5, Math.round(TA * (0.75 + 0.5 * rnd(i * 9 + k * 2.3)) / 5) * 5);
        }
      }
      let c: [number, number];
      if (turn) {
        const th2 = th + turn, d1 = dirv(th), d2 = dirv(th2);
        const P2: [number, number] = [P[0] + d1[0] * (h / 2 + gap) - d2[0] * prevH / 2, P[1] + d1[1] * (h / 2 + gap) - d2[1] * prevH / 2];
        th = th2; c = [P2[0] + d2[0] * w / 2, P2[1] + d2[1] * w / 2]; P = [c[0] + d2[0] * w / 2, c[1] + d2[1] * w / 2];
        if (k === 0) lineStart = P2; lastTurn = S.w.t;
      } else {
        const d0 = dirv(th), d: [number, number] = [d0[0] * rd, d0[1] * rd], nrm = dirv(th + 90), lr = rnd(i * 71.3 + 5);
        let backMax = -Infinity, run = 0;
        if (k === 0 && !first && prevLine && flow < 0 && !Lp.rtl && !mode && prevSeg) {
          const zz = Math.min(zOf(prevSeg), zOf(S)); run = (P[0] - lineStart[0]) * d[0] + (P[1] - lineStart[1]) * d[1];
          backMax = FOLD * 0.9 * W / zz - (run - prevSeg.lw - w); }
        let cc: [number, number] | null = null;
        if (backMax > -0.5 * run) {
          const Lw = Lp.words.reduce((a, Q) => a + Q.lw, 0) + gap * (Lp.words.length - 1) * 1.6, back = Math.min(backMax, Lw * (0.55 + 0.35 * rnd(i * 2.9)) + gap * 3);
          const a0 = -back - gap * 2, a1 = -back + Lw + gap * 2, side = [0, 0];
          for (const Q of [...placed, ...prevLine!.words]) { const cs = corners(Q, padOf(Q)); let u0 = 1e9, u1 = -1e9;
            for (const p of cs) { const u = (p[0] - lineStart[0]) * d[0] + (p[1] - lineStart[1]) * d[1]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
            if (u1 < a0 || u0 > a1) continue;
            for (const p of cs) { const v = (p[0] - lineStart[0]) * nrm[0] + (p[1] - lineStart[1]) * nrm[1]; side[0] = Math.max(side[0], -v); side[1] = Math.max(side[1], v); } }
          const upw = Math.abs(side[0] - side[1]) < gap ? rnd(i * 4.1 + 2) < 0.5 : side[0] < side[1], ext = upw ? side[0] : side[1];
          const off = (ext + gap * 2.2 + h / 2) * (upw ? -1 : 1), s0: [number, number] = [lineStart[0] + nrm[0] * off - d[0] * back, lineStart[1] + nrm[1] * off - d[1] * back];
          cc = [s0[0] + d[0] * w / 2, s0[1] + d[1] * w / 2]; P = [cc[0] + d[0] * w / 2, cc[1] + d[1] * w / 2]; lineStart = s0; Lp.back = true;
        } else if (k === 0 && !first && prevLine && !mode && lr >= 0.34 && lr < 0.6) {
          const upw = lr < 0.47, back = (0.25 + rnd(i * 3.9) * 0.5) * Math.min(prevLine.bw || w, BASE * 6);
          let ext = 0; for (const Q of prevLine.words) for (const p of corners(Q, padOf(Q))) { const v = (p[0] - lineStart[0]) * nrm[0] + (p[1] - lineStart[1]) * nrm[1]; ext = Math.max(ext, upw ? -v : v); }
          const off = (ext + gap * 2.5 + h / 2) * (upw ? -1 : 1), s0: [number, number] = [lineStart[0] + nrm[0] * off - d[0] * back, lineStart[1] + nrm[1] * off - d[1] * back];
          cc = [s0[0] + d[0] * w / 2, s0[1] + d[1] * w / 2]; P = [cc[0] + d[0] * w / 2, cc[1] + d[1] * w / 2]; lineStart = s0;
        } else if (k === 0 && !first && prevLine && (mode === 'below' || (!mode && lr < 0.34))) {
          const ref: [number, number] = smooth ? [P[0] - d[0] * w * 0.25, P[1] - d[1] * w * 0.25] : lineStart;
          let below = 0; for (const Q of prevLine.words) for (const p of corners(Q, padOf(Q))) below = Math.max(below, (p[0] - ref[0]) * nrm[0] + (p[1] - ref[1]) * nrm[1]);
          const s0: [number, number] = [ref[0] + nrm[0] * (below + gap * 2.5 + h / 2), ref[1] + nrm[1] * (below + gap * 2.5 + h / 2)];
          cc = [s0[0] + d[0] * w / 2, s0[1] + d[1] * w / 2]; P = [cc[0] + d[0] * w / 2, cc[1] + d[1] * w / 2]; lineStart = s0;
        } else if (k > 0 && !S.vert && prevSeg && !prevSeg.vert && mode !== 'right' && (cc = placeNext(S, prevSeg, w, h, d, nrm, i, k))) {
          P = [cc[0] + d[0] * w / 2, cc[1] + d[1] * w / 2];
        } else {
          const g2 = first ? 0 : k === 0 ? gap * 3 : S.w.latin && prevSeg && prevSeg.w.latin ? Math.max(gap, h * 0.32) : gap, jit = first ? 0 : (rnd(i + k * 2.2) - 0.5) * h * 0.2;
          const off = S.vert ? (h - prevH) / 2 : jit;
          cc = [P[0] + d[0] * (g2 + w / 2) + nrm[0] * off, P[1] + d[1] * (g2 + w / 2) + nrm[1] * off];
          P = [P[0] + d[0] * (g2 + w), P[1] + d[1] * (g2 + w)];
          if (k === 0) lineStart = [cc[0] - d[0] * w / 2, cc[1] - d[1] * w / 2];
        }
        c = cc!;
      }
      if (secFirst && k === 0) secFirst = false;
      S.x = c[0]; S.y = c[1]; S.ang = th; S.tilt = th + tilt0 * TK * 0.35;
      if (hits(S)) { const d = dirv(th), n = dirv(th + 90), ox = S.x, oy = S.y; let done = false;
        for (let s2 = 1; s2 <= 12 && !done; s2++) for (const [ux, uy] of [[d[0] * w * 0.3 * s2, d[1] * w * 0.3 * s2], [n[0] * h * 0.45 * s2, n[1] * h * 0.45 * s2], [(d[0] + n[0]) * w * 0.22 * s2, (d[1] + n[1]) * w * 0.22 * s2]]) {
          S.x = ox + ux; S.y = oy + uy; if (!hits(S)) { P = [P[0] + ux, P[1] + uy]; done = true; break; } }
        if (!done) { S.x = ox; S.y = oy; bad = true; } }
      if (prevSeg && !first) {
        if (k === 0) { if (!inView(prevSeg, S) && blankOf(prevSeg, S) > (Lp.back ? FOLD : alongMotion(prevSeg, S) ? SPAN : SPAN * BACK_REACH)) bad = true; }
        else if (blankOf(prevSeg, S) > SPAN) bad = true;
      }
      placed.push(S); prevSeg = S;
      if (k === 0) Lp.d = first ? 0 : DEP * ((rnd(i * 7.9 + 2) - 0.5) * 600);
      S.d = first ? 0 : Lp.d + DEP * ((rnd(i * 13 + k * 3.3) - 0.5) * 260 + (k % 2 ? 80 : -60));
      if (!S.vert) prevH = h;
    });
    const fa = Lp.words[0]?.ang ?? th, B = boxIn(Lp.words, fa);
    Lp.ax = B.x; Lp.ay = B.y; Lp.bw = B.w; Lp.bh = B.h; Lp.prot = fa;
    { const d0 = dirv(fa), pos = B.x * d0[0] + B.y * d0[1];
      if (flowFrom == null) flowFrom = pos; else if ((pos - flowFrom) * flow >= FLIP || (flow < 0 && Lp.back && ++backN >= 3)) { flow = -flow; flowFrom = pos; backN = 0; } }
    Lp.d = Lp.words.reduce((a, S) => a + S.d, 0) / Math.max(1, Lp.words.length);
    prevLine = Lp;
    S0 = { P, th, lineStart, prevH, lastTurn, prevLine, prevSeg, secFirst, flow, flowFrom, backN };
    return !bad;
  };
  const startsAt = new Set(passages.map(p => p.line)), canClear = (st.trans || 'auto') !== 'off';
  lines.forEach((Lp, i) => {
    if (!Lp.words.length) return;
    if (i > 0 && startsAt.has(i)) newPassage();
    const before = save();
    if (placeLine(Lp, i, null) || i === 0 || startsAt.has(i)) return;
    restore(before); if (placeLine(Lp, i, 'right')) return;
    restore(before); if (placeLine(Lp, i, 'below')) return;
    const A = lines[i - 1], endA = Math.min(A.L.sung, A.L.end);
    // no room for a clear (or none allowed): keep going on the page — the camera makes the longer move instead
    if (!canClear || !roomForQuick(endA, Lp.words[0].show)) { restore(before); placeLine(Lp, i, null); return; }
    restore(before);
    const tm = timePassage(endA, Lp.words[0].show, map, true);
    passages.push({ ...tm, line: i, quick: true, reason: 'layout' }); startsAt.add(i);
    newPassage(); placeLine(Lp, i, null);
  });
  passages.sort((a, b) => a.t - b.t);
  assignSections(lines, passages);
  // a quick clear decided while placing may still shorten a framed line: such a frame is not drawn rather than cut short
  for (const P of lines) if (isFinite(P.secEnd)) for (const S of P.words) { const F = S.frame;
    if (F && Math.min(P.L.end, P.secEnd - Math.max(0.4, P.secIn)) - 0.8 - F.ts < FRAME_NEED) for (const x of F.words) x.frame = null; }
  // draw order, fixed: deeper first, then in singing order (never re-sorted by the view)
  const order = [...words].sort((a, b) => b.d - a.d || a.w.id - b.w.id); order.forEach((S, i) => { S.order = i; });
  const dmin = words.reduce((m, S) => Math.min(m, S.d), 0);
  return { lines, words, passages, dmin };
}

/** Which passage each line belongs to, and when it ends; a line's end is trimmed to before its passage's transition. */
export function assignSections(lines: PLine[], passages: Passage[]) {
  const sorted = [...passages].sort((a, b) => a.t - b.t);
  for (const P of lines) {
    let k = 0; while (k < sorted.length && sorted[k].line <= P.i) k++;
    P.sec = k; P.secEnd = k < sorted.length ? sorted[k].t : Infinity; P.secIn = k < sorted.length ? sorted[k].inn : 0.4;
  }
}
export const unitText = unitsOf;
export { angDiff };
