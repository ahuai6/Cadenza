/* Lyric motions: how the words themselves move with the music once they are sung — apart from the camera (which only
   frames them) and from the entrance (which only brings them in). A motion is one pure function of a unit and the time;
   add one here (and its name, 'lmo.<id>', in the dictionary) and it appears in the motion pane. */
import { clamp } from '../core/math';
import type { RhythmMap } from '../rhythm/map';
import type { PWord } from '../director/types';
import { EM } from '../text/metrics';

export interface UnitMotion { dx: number; dy: number; sc: number; rot: number }
export interface MotionIn { S: PWord; ui: number; t: number; map: RhythmMap; /** the word is being sung (not dimmed yet) */ live: boolean; /** 0..1, the motion setting of the view */ k: number }
export interface LyricMotion { id: string; unit(m: MotionIn): UnitMotion | null }

const STILL: UnitMotion = { dx: 0, dy: 0, sc: 1, rot: 0 };
/** 律動: each sung character hops on the beat — a quick lift and a soft fall, rippling along the word from its first
 *  character, the downbeat highest, every other beat leaning the other way — and settles as its word is left behind. */
const groove: LyricMotion = { id: 'groove', unit({ S, ui, t, map, live, k }) {
  const u = S.units[ui], ut = u.t ?? S.w.t; if (!live || t < ut || k <= 0) return null;
  const on = clamp((t - ut) / 0.25) * k, bp = map.beatAt(t - ui * 0.05 * map.beatLen(t)), p = bp.phase;
  const env = p < 0.1 ? p / 0.1 : Math.exp(-(p - 0.1) * 5.5), w = bp.inBar === 0 ? 1.25 : bp.inBar % 2 ? 0.9 : 0.7, a = env * w * on;
  return { dx: 0, dy: -EM * 0.085 * a, sc: 1 + 0.045 * a, rot: (bp.bt % 2 < 1 ? 1 : -1) * 2.2 * a };
} };
export const LYRIC_MOTIONS: Record<string, LyricMotion> = { none: { id: 'none', unit: () => null }, groove };
export const motionOf = (id: string | undefined): LyricMotion | null => (id && id !== 'none' && LYRIC_MOTIONS[id]) || null;
export { STILL };
