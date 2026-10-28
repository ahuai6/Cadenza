/* Passages: after a few lines, a clear pause in the singing starts a new passage — the whole frame loses focus, the
   camera cuts while it is blurred, and the next lines start fresh somewhere else. Timed by the music:
   - the blur rises over about a beat and a half and clears over about one beat (longer than a quick fade: unhurried),
     so it starts early, inside the pause, and the picture is clear exactly when the next line is sung;
   - the cut (the blur's peak) lands on the strongest grid point the pause allows: a downbeat or an accent first, then a
     beat, then an eighth; when the next line starts with a pickup (before the beat), the clear still completes on the
     pickup, so the cut moves earlier with it. */
import { clamp } from '../core/math';
import type { RhythmMap } from '../rhythm/map';
import type { Passage } from './types';

export interface PassageTiming { t: number; inn: number; out: number }

/** endPrev: when the previous words are sung; nextT: when the next line's first word appears. */
export function timePassage(endPrev: number, nextT: number, map: RhythmMap, quick: boolean): PassageTiming {
  const bl = map.beatLen(nextT), gap = Math.max(0, nextT - endPrev);
  let out = quick ? clamp(0.6 * bl, 0.22, 0.4) : clamp(1.0 * bl, 0.35, 0.8);
  let inn = quick ? clamp(0.75 * bl, 0.25, 0.45) : clamp(1.5 * bl, 0.45, 1.1);
  const avail = gap + 0.15 - 0.06;                         // the blur may begin just before the last word ends
  if (inn + out > avail) { const k = Math.max(0.2, avail) / (inn + out); inn = Math.max(0.22, inn * k); out = Math.max(0.18, out * k); }
  const latest = nextT - 0.06 - out, earliest = Math.min(latest, endPrev - 0.15 + inn);
  // the strongest grid point in [earliest, latest], later preferred (the blur then sits right before the new words)
  let best = latest, bv = -Infinity;
  let grid = map.grid(earliest, latest, 2);
  if (!grid.length) { const g = map.grid(latest - 2 * bl, latest, 2); if (g.length) grid = [g[g.length - 1]]; }   // too short a window: the nearest grid point before it
  for (const g of grid) {
    const p = map.beatAt(g), onBeat = p.phase < 0.08 || p.phase > 0.92, down = onBeat && (p.inBar === 0 || (p.phase > 0.92 && p.inBar === map.meter - 1));
    const v = (down ? 3 : onBeat ? 2 : 1) + 1.5 * Math.min(1.5, map.accentAt(g, 0.05)) + 0.8 * (g - earliest) / Math.max(1e-3, latest - earliest);
    if (v > bv) { bv = v; best = g; }
  }
  const t = Math.min(best, latest);
  return { t, inn: Math.max(0.22, Math.min(inn, t - (endPrev - 0.3))), out: Math.max(0.18, Math.min(out, nextT - 0.04 - t)) };
}

export interface GapLine { t: number; sungEnd: number }
/** The pauses that start passages: long enough (two beats, at least 0.9 s), at least three lines and eight seconds after
 *  the last passage, not at the very start or end of the song. */
export function gapPassages(lines: GapLine[], map: RhythmMap, musicEnd: number, enabled: boolean): Passage[] {
  const out: Passage[] = []; if (!enabled) return out;
  let lastI = 0, lastT = -1e9;
  for (let i = 1; i < lines.length; i++) {
    const A = lines[i - 1], B = lines[i], gap = B.t - A.sungEnd, bl = map.beatLen(B.t);
    if (gap >= Math.max(0.9, 2 * bl) && i - lastI >= 3 && B.t - lastT >= 8 && B.t >= 5 && B.t < musicEnd - 3) {
      const tm = timePassage(A.sungEnd, B.t, map, false);
      out.push({ ...tm, line: i, quick: false, reason: 'gap' }); lastI = i; lastT = B.t;
    }
  }
  return out;
}
/** How blurred the frame is at t (0..1). */
export function transK(passages: Passage[], t: number): number {
  let k = 0;
  for (const p of passages) { const x = t - p.t; if (x < -p.inn || x > p.out) continue;
    const u = x < 0 ? (x + p.inn) / p.inn : 1 - x / p.out; k = Math.max(k, u * u * (3 - 2 * u)); }
  return k;
}
