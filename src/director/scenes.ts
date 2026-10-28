/* Scenes: arrangements chosen by what the lyrics are doing, ahead of placement. Each scene says when it applies (from the
   lines and the music); the layout then places those lines its way, and the camera follows what was placed. New scenes
   are one entry here plus their placement in the layout, nothing else.
   - dash: a fast, dense run of words (a rapid verse, a patter) runs straight on to the right, rising and dipping with the
     beat, so the camera keeps travelling one way like a sprint instead of folding back and turning. */
import type { RhythmMap } from '../rhythm/map';
import type { PLine } from './types';
import type { Line } from '../lyrics/model';

export type SceneId = 'dash';
export interface SceneRule { id: SceneId; /** does line i call for this scene (it may look at its neighbours) */ applies(lines: PLine[], i: number, map: RhythmMap): boolean }

/** Words (or, for scripts without spaces, sung units) per second over the time the line is sung. */
export function paceOf(L: Line): number {
  const dur = Math.max(0.4, Math.min(L.sung, L.end) - L.t), latin = L.words.every(W => W.latin);
  return (latin ? L.words.length : L.words.reduce((a, W) => a + W.units.length, 0) * 0.55) / dur;
}
export const pace = (P: PLine) => paceOf(P.L);
/** A line sung too fast to stand any of its words on end (a dash keeps every word running on). */
export const fastLine = (L: Line) => paceOf(L) >= 3.4;
const units = (P: PLine) => P.words.reduce((a, S) => a + S.units.length, 0);
const dense = (P: PLine | undefined) => !!P && (P.words.length >= 3 || units(P) >= 6) && pace(P) >= 3.4;
const DASH: SceneRule = { id: 'dash', applies: (lines, i) => dense(lines[i]) && (dense(lines[i - 1]) || dense(lines[i + 1]) || units(lines[i]) >= 12) };

export const SCENES: SceneRule[] = [DASH];
/** The scene of each line (null: the ordinary arrangement). */
export function scenesOf(lines: PLine[], map: RhythmMap): (SceneId | null)[] {
  return lines.map((_, i) => SCENES.find(r => r.applies(lines, i, map))?.id ?? null);
}
