// Planning a song: layout → camera (which may add transitions) → passages per line → cues → titles. Once, ahead.
import type { LyricDoc } from '../lyrics/model';
import type { RhythmMap } from '../rhythm/map';
import type { Style } from '../theme/style';
import type { Measurer } from '../text/metrics';
import type { ScenePlan } from './types';
import { REF_H } from './types';
import { layout, assignSections, dropShortFrames } from './layout';
import { planCamera } from './camera';
import { planCues } from './cues';
import { planTitles, type SongInfo } from './titles';
import { planEntries } from './entry';
import { rnd } from '../core/rng';
import { basePose } from './camera';
import { project, NO_FX } from './project';
import type { PLine, CameraPlan } from './types';

export const ASPECTS: Record<string, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
export interface PlanInput {
  doc: LyricDoc; map: RhythmMap; style: Style; measure: Measurer;
  /** the frame's aspect ratio (width / height) */
  aspect: number;
  /** where the music ends (song time); the ending follows for endLen seconds */
  musicEnd: number; endLen: number;
  song: SongInfo; labels: { composer: string; lyricist: string; artist: string };
}

export function plan(inp: PlanInput): ScenePlan {
  const H = REF_H, W = Math.round(REF_H * inp.aspect), { doc, map, style } = inp;
  const lay = layout({ doc, map, style, measure: inp.measure, W, H, musicEnd: inp.musicEnd });
  const first = doc.lines.length ? doc.lines[0].t : null;
  const titles = planTitles(inp.song, first, map, inp.musicEnd, inp.labels);
  const introHold = titles.intro && titles.intro.kind === 'card' ? titles.intro.t1 : 0;
  const { camera, extraPassages } = planCamera({ lines: lay.lines, words: lay.words, passages: lay.passages, map, style, W, H, musicEnd: inp.musicEnd, dur: inp.musicEnd + inp.endLen, introHold });
  const passages = [...lay.passages, ...extraPassages].sort((a, b) => a.t - b.t);
  assignSections(lay.lines, passages); dropShortFrames(lay.lines);
  // a line fades out before its passage's transition; a word is over by then too
  for (const P of lay.lines) if (isFinite(P.secEnd)) { P.L = { ...P.L, end: Math.min(P.L.end, P.secEnd - 0.4) }; }
  applySweeps(lay.lines, lay.sweeps, camera, W, H);
  const cues = planCues(map, style, lay.lines, inp.musicEnd, camera.idle, inp.doc.marks || []);
  const drawOrder = [...lay.words].sort((a, b) => a.order - b.order);
  const out: ScenePlan = { doc, map, style, W, H, dur: inp.musicEnd + inp.endLen, endLen: inp.endLen, musicEnd: inp.musicEnd,
    lines: lay.lines, words: lay.words, drawOrder, passages, camera, cues, titles, dmin: lay.dmin, hasSubs: doc.lines.some(L => L.subs.length > 0) };
  planEntries(out);
  pickEmphasis(lay.lines);
  return out;
}
/** A clear without a blur: at a sweep, every earlier line of the page the camera does not see is taken away there and
 *  then (unseen, so nothing visibly vanishes); a line still in view stays until the camera has left it. */
function applySweeps(lines: PLine[], sweeps: { t: number; line: number }[], cam: CameraPlan, W: number, H: number) {
  const seen = (P: PLine, t: number) => { const b = basePose(cam, t), c = { x: b.x, y: b.y, z: b.z, r: b.r, d: b.d, yaw: 0, pitch: 0 };
    return P.words.some(S => { const p = project(S.x, S.y, S.d, c, NO_FX, W, H), half = Math.hypot(S.lw, S.lh) * 0.5 * p.k; return Math.abs(p.sx) - half < W * 0.56 && Math.abs(p.sy) - half < H * 0.56; }); };
  for (const sw of sweeps) {
    const B = lines[sw.line]; if (!B) continue;
    for (let j = 0; j < sw.line; j++) { const P = lines[j]; if (P.sec !== B.sec || !P.words.length || P.secEnd <= sw.t) continue;
      if (Math.min(P.L.sung, P.L.end) > sw.t - 0.05) continue;                 // (still being sung: it stays)
      let tv = sw.t; const until = Math.min(P.secEnd, sw.t + 30);
      while (tv < until && seen(P, tv)) tv += 0.1;
      if (tv >= until) continue;
      P.secEnd = tv; P.secIn = 0.01; P.L = { ...P.L, end: Math.min(P.L.end, tv) };
    }
  }
}
/** A word picked by chance (no rule: neither the longest nor the loudest), one line in every three or four — a lit
 *  word now and then, never a pattern. Seeded by the song, so a preview, a replay and an export pick the same. */
function pickEmphasis(lines: ScenePlan['lines']) {
  let next = 1 + Math.floor(rnd(lines.length * 1.7) * 3);
  lines.forEach((P, i) => {
    if (i < next) return;
    const ws = P.words.filter(S => /[\p{L}\p{N}]/u.test(S.w.text)); if (!ws.length) { next = i + 1; return; }
    ws[Math.floor(rnd(i * 5.17 + 0.3) * ws.length)].emph = true;
    next = i + 3 + (rnd(i * 2.9 + 1) < 0.5 ? 1 : 0);
  });
}
