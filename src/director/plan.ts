// Planning a song: layout → camera (which may add transitions) → passages per line → cues → titles. Once, ahead.
import type { LyricDoc } from '../lyrics/model';
import type { RhythmMap } from '../rhythm/map';
import type { Style } from '../theme/style';
import type { Measurer } from '../text/metrics';
import type { ScenePlan } from './types';
import { REF_H } from './types';
import { layout, assignSections, dropShortFrames, PAGE_LINES } from './layout';
import { planCamera } from './camera';
import { planCues } from './cues';
import { planTitles, type SongInfo } from './titles';
import { planEntries } from './entry';
import { rnd } from '../core/rng';
import { basePose, cutJumps } from './camera';
import { fitFrames } from './fit';
import { project, NO_FX } from './project';
import type { PLine, CameraPlan } from './types';

/** The frame shapes a picture can have (the scene is planned for the shape: it changes size, it is never cropped). */
export const ASPECTS: Record<string, number> = { '16:9': 16 / 9, '16:10': 16 / 10, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
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
  // every lyric frame wholly in the picture while it is up, the word being sung with it (fit.ts) — before the clears,
  // which judge what the camera sees on the path as it finally is
  fitFrames(camera, lay.words, W, H); cutJumps(camera);
  applySweeps(lay.lines, lay.sweeps, camera, W, H);
  const cues = planCues(map, style, lay.lines, inp.musicEnd, camera.idle, inp.doc.marks || []);
  const drawOrder = [...lay.words].sort((a, b) => a.order - b.order);
  const out: ScenePlan = { doc, map, style, W, H, dur: inp.musicEnd + inp.endLen, endLen: inp.endLen, musicEnd: inp.musicEnd,
    lines: lay.lines, words: lay.words, drawOrder, passages, camera, cues, titles, dmin: lay.dmin, hasSubs: doc.lines.some(L => L.subs.length > 0) };
  planEntries(out);
  pickEmphasis(lay.lines);
  return out;
}
/** Clears without a blur: at a sweep, every earlier line of the page the camera does not see is taken away there and
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
  // the page's cap, whatever the camera does: as a line starts, at most PAGE_LINES lines of its page are up (it among
  // them); the oldest beyond that go — at once where the camera does not see them, else fading out over half a second
  for (let i = 0; i < lines.length; i++) {
    const B = lines[i]; if (!B.words.length) continue; const t = B.words[0].show;
    const up = lines.slice(0, i).filter(P => P.sec === B.sec && P.words.length && P.secEnd - P.secIn > t + 1e-3);
    let extra = up.length + 1 - PAGE_LINES;
    for (const P of up) { if (extra <= 0) break;
      if (Math.min(P.L.sung, P.L.end) > t - 0.05) continue;                    // (still being sung: it stays)
      const fade = seen(P, t) ? 0.5 : 0.01;
      // (it starts to go now; one already ending sooner keeps its end, fading from now to it)
      P.secEnd = Math.min(P.secEnd, t + fade); P.secIn = Math.max(0.01, P.secEnd - t); P.L = { ...P.L, end: Math.min(P.L.end, P.secEnd) }; extra--; }
  }
}
/** A lit word now and then: one line in every three or four, one of its words — a word as the segmenter (or the
 *  listener) broke the line (lyrics/spacing.ts), so it is always a whole word, never a few characters cut out of one —
 *  picked by chance among its content words (two characters or more where there are any, never punctuation alone), and
 *  never a line's only word (the emphasis is a word in a line, not the line). Seeded by the song, so a preview, a replay
 *  and an export pick the same. */
function pickEmphasis(lines: ScenePlan['lines']) {
  let next = 1 + Math.floor(rnd(lines.length * 1.7) * 3);
  lines.forEach((P, i) => {
    if (i < next) return;
    const content = P.words.filter(S => /[\p{L}\p{N}]/u.test(S.w.text));
    if (content.length < 2) { next = i + 1; return; }
    const long = content.filter(S => S.w.latin || S.units.length >= 2), pool = long.length ? long : content;
    const S = pool[Math.floor(rnd(i * 5.17 + 0.3) * pool.length)]; S.emph = [0, S.units.length];
    next = i + 3 + (rnd(i * 2.9 + 1) < 0.5 ? 1 : 0);
  });
}
