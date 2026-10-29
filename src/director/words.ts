/* How each word and each of its units looks at time t: one place, read by every drawing of it (the glyph, its halo,
   its shadow, the ghost of an unsung unit, the outline that marks a unit as it is sung). The old engine computed the
   position of these separately and they disagreed (the ghost floated, the outline did not), which showed as a twitch the
   moment a unit was sung. Here the *rest* pose of a unit (where it settles, including the slow float) is computed once
   and every layer is offset from it. */
import { clamp, lerp, sstep } from '../core/math';
import { eOut, eSine } from '../core/ease';
import { rnd } from '../core/rng';
import type { PWord, PLine } from './types';

/** Per entrance style: duration (× the theme's entrance time, never shorter than min) and blur (share of glyph height). */
export const TIN_SPEC: Record<string, { dur: number; min: number; blur: number }> = {
  blur: { dur: 1.8, min: 0.42, blur: 0.16 }, drift: { dur: 1.5, min: 0.36, blur: 0.08 }, rise: { dur: 1.4, min: 0.32, blur: 0.1 },
  track: { dur: 1.5, min: 0.34, blur: 0.08 }, pop: { dur: 1.0, min: 0.16, blur: 0.06 },
};
const DRIFT_DIRS = [[0, 1], [0, 1], [-1, 0], [0, -1], [1, 0], [-0.7, 0.7]];
export const SUNG = 0.42, PAST = 0.3, END_DIM = 0.3, END_DIM_CARD = 0.25;

export interface WordCtx { enter: number; tempo: number; float: number; future: 'dim' | 'hide'; smooth: boolean; punch: number; motion: number; drift: boolean; /** one line at a time (the centred stage): a line over leaves altogether */ solo?: boolean }
export interface WordState {
  o: number; pe: number; dimK: number; pastK: number; live: boolean; gk: number;
  sc: number; ox: number; oy: number; frot: number; tin: string; dur: number;
}
/** The word as a whole: opacity, entrance progress, entrance offset and scale, how far past it is. */
export function wordState(S: PWord, t: number, ov: number, card: boolean, c: WordCtx): WordState | null {
  const L = S.line, lineOn = t >= L.L.t - 0.01 || t >= S.show;
  const pastK = eSine(clamp((t - L.L.end) / (1.6 * c.tempo)));
  let o = 0, live = false, dimK = 0, pe = 1;
  const tin = S.tin, sp = TIN_SPEC[tin] || TIN_SPEC.blur, dur = Math.max(sp.min, c.enter * sp.dur * c.tempo);
  const nextT = S.k + 1 < L.words.length ? L.words[S.k + 1].show : Infinity;
  if (lineOn && t >= S.show) {
    const p = eSine(clamp((t - S.show) / Math.max(0.3, c.enter * 1.2 * c.tempo)));
    pe = eOut(clamp((t - S.show) / dur));
    dimK = eSine(clamp((t - nextT) / (1.2 * c.tempo)));
    live = dimK < 0.5 && pastK < 1;
    o = (tin === 'rise' || tin === 'track' ? 1 : p) * Math.min(lerp(1, SUNG, dimK), lerp(1, PAST, pastK));
  }
  if (c.solo) o *= 1 - pastK;
  const secK = isFinite(L.secEnd) ? 1 - sstep(clamp((t - (L.secEnd - L.secIn)) / L.secIn)) : 1;
  o = ov > 0 ? lerp(o * secK, t >= S.show ? Math.min(o, card ? END_DIM_CARD : END_DIM) : 0, ov) : o * secK;
  if (o <= 0.003) return null;
  const q = 1 - pe; let ox = 0, oy = 0, sc = 1;
  if (tin === 'blur') sc = 1 + 0.07 * q;
  else if (tin === 'drift') { const d = DRIFT_DIRS[Math.floor(rnd(L.i * 5.3 + S.k * 2.9) * DRIFT_DIRS.length)]; ox = d[0] * 130 * q; oy = d[1] * 110 * q; }
  else if (tin === 'pop') sc = 1 + q * (c.smooth ? 0.08 : 0.45 * Math.min(1.5, c.punch + 0.3)) * c.motion;
  if (c.drift) oy -= dimK * 16 + pastK * 26;
  const ph = rnd(L.i * 3.1 + S.k * 1.7) * 6.28;
  oy += Math.sin(t * 0.9 + ph) * c.float * 7;
  const frot = Math.sin(t * 0.6 + ph * 1.3) * c.float * 1.2;
  return { o, pe, dimK, pastK, live, gk: ov > 0 ? 0 : (1 - dimK) * (1 - pastK), sc, ox, oy, frot, tin, dur };
}

export interface UnitPose {
  /** rest position (word-local, unscaled units) including the slow float */ rx: number; ry: number;
  /** entrance offset from rest, scale, rotation (deg), alpha */ dx: number; dy: number; um: number; ur: number; ua: number;
  /** how far from settled 0..1 (drives blur) */ uq: number;
  /** not sung yet: drawn as a faint ghost at its rest position */ ghost: boolean;
  /** just being sung: a fading outline at its rest position */ outline: number;
}
/** One unit of a word. Ghost, outline and glyph share the same rest position. */
export function unitPose(S: PWord, ui: number, t: number, ws: WordState, ov: number, c: WordCtx, trail = false): UnitPose | null {
  const u = S.units[ui], n = S.units.length, L = S.line;
  const s = S.s;                                   // unit offsets are stored scaled; the word transform scales by s
  let rx = u.ox / s, ry = u.oy / s;
  if (c.float > 0) ry += Math.sin(t * 1.15 + ui * 0.7 + L.i) * c.float * 2.6;     // float: part of the rest pose
  let ua = 1, um = 1, dx = 0, dy = 0, ur = 0, uq = 1 - ws.pe, ghost = false, outline = 0;
  if ((S.w.timed || S.w.paced) && u.t != null && ov === 0) {   // (a paced word: its characters at their estimated moments)
    const lt = t - u.t;
    if (lt < 0) { if (c.future === 'hide' || trail) return null; ghost = true; uq = 0;
      // the ghost arrives with the word's entrance (as the word's own type would), then waits for its moment
      if (ov === 0) { const pu = eOut(clamp((t - S.show - ui * 0.055) / ws.dur)), qq = 1 - pu; ua = eSine(clamp((t - S.show - ui * 0.055) / Math.max(0.22, c.enter * 0.9 * c.tempo)));
        if (ws.tin === 'rise') { dy = 48 * qq; ur = (ui % 2 ? 6 : -6) * qq; }
        else if (ws.tin === 'pop') um = 1 + qq * (c.smooth ? 0.12 : 0.45) * c.motion;
        else if (ws.tin === 'track') dx = rx * 0.55 * qq;
        else if (ws.tin === 'blur') um = 1 + 0.12 * qq;
        else dy = 30 * qq; } }
    else {
      const pu = eOut(clamp(lt / ws.dur)), qq = 1 - pu; uq = qq;
      ua = eSine(clamp(lt / Math.max(0.22, c.enter * 0.9 * c.tempo)));
      if (ws.tin === 'pop') { um = 1 + qq * (c.smooth ? 0.12 : 0.6 * Math.min(1.5, c.punch + 0.3)) * c.motion; dy = -18 * qq; }
      else if (ws.tin === 'track') dx = (u.ox >= 0 ? 1 : -1) * 24 * qq;
      else if (ws.tin === 'blur') um = 1 + 0.12 * qq;
      else dy = 30 * qq;
      if (qq > 0.001 && c.future !== 'hide' && !trail) outline = 0.4 * qq;
    }
  } else if (ov === 0 && t >= S.show) {
    if (ws.tin === 'rise') { const pu = eOut(clamp((t - S.show - ui * 0.055) / ws.dur)), qq = 1 - pu; ua = pu; dy = 48 * qq; ur = (ui % 2 ? 6 : -6) * qq; uq = qq; }
    else if (ws.tin === 'track') { const pu = eOut(clamp((t - S.show - Math.abs(ui - (n - 1) / 2) * 0.03) / ws.dur)); ua = pu; dx = rx * 0.55 * (1 - pu); uq = 1 - pu; }
  }
  if (ov > 0) uq = 0;
  return { rx, ry, dx, dy, um, ur, ua, uq, ghost, outline };
}
export { type PLine };
