/* Scenes: arrangements chosen by what the lyrics are doing, ahead of placement. Each scene says when it applies (from the
   lines and the music); the layout then places those lines its way, and the camera follows what was placed. New scenes
   are one entry here plus their placement in the layout, nothing else.
   - dash: a fast, dense run of words (a rapid verse, a patter) runs straight on to the right, rising and dipping with the
     beat, so the camera keeps travelling one way like a sprint instead of folding back and turning.
   - roller: a word sung again and again ("走吧 走吧 走吧", "la la la"): from its first time on, each one is placed on the
     next row of a drum — turned half round, beside the one before — and the camera rolls half a turn onto it, left, then
     right, then left…, with a spring in it. The roll's pace, force and how far it swings follow the camera's own knobs
     (pace, energy, turns). A dash outranks it: a line that dashes never rolls. */
import type { RhythmMap } from '../rhythm/map';
import type { PLine, PWord } from './types';
import type { Line } from '../lyrics/model';

export type SceneId = 'dash' | 'roller';
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

/* ---- roller ---- */
const key = (S: PWord) => S.w.text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
/** How the roller turns one word: sg the roll's direction (−1 left, +1 right), run the repeated word's run, j its place in it. */
export interface Roll { sg: number; run: number; j: number }
const MAX_ROLLS = 4;
/** How long half a turn takes at a camera pace (the pace knob's speed): the same for the scene's rule and the camera. */
export const rollDur = (speed: number) => Math.min(1.9, Math.max(0.55, 1.05 / Math.max(0.3, speed)));
/** The words the roller turns, in singing order: each run of the same word sung back to back (at least two characters,
 *  each within two bars of the one before, never faster than a roll can be followed), from its first word on, at most
 *  four rolls a run. Lines whose scene is a dash keep their own arrangement. */
export function rollsOf(lines: PLine[], scenes: (SceneId | null)[], map: RhythmMap, D: number): Map<PWord, Roll> {
  const out = new Map<PWord, Roll>(), seq = lines.flatMap((P, i) => (scenes[i] === 'dash' ? [] : P.words.map(S => ({ S, i }))));
  let run = 0;
  for (let a = 0; a < seq.length;) {
    const k0 = key(seq[a].S); let b = a + 1;
    while (b < seq.length && [...k0].length >= 2 && key(seq[b].S) === k0 && seq[b].i - seq[b - 1].i <= 1
      && seq[b].S.w.t - seq[b - 1].S.w.t <= 2 * map.meter * map.beatLen(seq[b].S.w.t) && seq[b].S.w.t - seq[b - 1].S.w.t >= 0.3) b++;
    if (b - a >= 2) { run++; let j = 0;
      // a word rolls only when the roll fits between the word before it being sung and the word after it starting, so
      // the camera is never late for the words that follow (the word itself may ride along with the camera)
      for (let q = a; q < b && j < MAX_ROLLS; q++) { const S = seq[q].S, prev = seq[q - 1]?.S, next = seq[q + 1]?.S;
        if (!prev || (seq[q].i === 0 && S.k === 0)) continue;
        if ((next ? next.w.t : Infinity) - Math.min(prev.end, prev.w.t + 1.2) < D) continue;
        out.set(S, { sg: j % 2 ? 1 : -1, run, j }); j++; } }
    a = b;
  }
  return out;
}

export const SCENES: SceneRule[] = [DASH];
/** The scene of each line (null: the ordinary arrangement); a line the roller turns words of is a roller line unless
 *  a scene above it (a dash) claims it. */
export function scenesOf(lines: PLine[], map: RhythmMap, speed: number): { scenes: (SceneId | null)[]; rolls: Map<PWord, Roll> } {
  const scenes = lines.map((_, i) => SCENES.find(r => r.applies(lines, i, map))?.id ?? null), rolls = rollsOf(lines, scenes, map, rollDur(speed));
  for (const S of rolls.keys()) { const i = lines.indexOf(S.line); if (i >= 0 && !scenes[i]) scenes[i] = 'roller'; }
  return { scenes, rolls };
}
