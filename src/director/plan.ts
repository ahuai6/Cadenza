// Planning a song: layout → camera (which may add transitions) → passages per line → cues → titles. Once, ahead.
import type { LyricDoc } from '../lyrics/model';
import type { RhythmMap } from '../rhythm/map';
import type { Style } from '../theme/style';
import type { Measurer } from '../text/metrics';
import type { ScenePlan } from './types';
import { REF_H } from './types';
import { layout, assignSections } from './layout';
import { planCamera } from './camera';
import { planCues } from './cues';
import { planTitles, type SongInfo } from './titles';
import { planEntries } from './entry';

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
  assignSections(lay.lines, passages);
  // a line fades out before its passage's transition; a word is over by then too
  for (const P of lay.lines) if (isFinite(P.secEnd)) { P.L = { ...P.L, end: Math.min(P.L.end, P.secEnd - 0.4) }; }
  const cues = planCues(map, style, lay.lines, inp.musicEnd, camera.idle, inp.doc.marks || []);
  const drawOrder = [...lay.words].sort((a, b) => a.order - b.order);
  const out: ScenePlan = { doc, map, style, W, H, dur: inp.musicEnd + inp.endLen, endLen: inp.endLen, musicEnd: inp.musicEnd,
    lines: lay.lines, words: lay.words, drawOrder, passages, camera, cues, titles, dmin: lay.dmin, hasSubs: doc.lines.some(L => L.subs.length > 0) };
  planEntries(out);
  return out;
}
