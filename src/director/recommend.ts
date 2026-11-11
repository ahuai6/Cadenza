/* Which motion style (theme/style.ts MOTIONS) fits a song: read off its rhythm and its lyrics, a recommendation only —
   offered beside the others, never put in place by itself (a new song keeps the cover look's own, 敘事). The first of
   these that fits is the one:
   - 舞台 (stage): no lyrics to speak of (an instrumental's one line);
   - 漂浮 (float): no drums (the separated drum stem found none) — pads, ambience;
   - 特寫 (close): dense lyrics, more than DENSE characters a second sung;
   - 圓舞 (waltz): three beats to the bar, or slow (under SLOW BPM) and not driving;
   - 律動 (groove): fast (over FAST BPM) and driving (drums hit often);
   - 敘事 (story): the rest. */
import type { LyricDoc } from '../lyrics/model';
import type { RhythmMap } from '../rhythm/map';
import type { RhythmAnalysis } from '../rhythm/types';

const DENSE = 5,
  SLOW = 90,
  FAST = 120,
  DRIVING = 3;
export interface RecommendInput {
  doc: LyricDoc;
  map: RhythmMap;
  analysis: RhythmAnalysis | null;
}
export interface SongTraits {
  lines: number;
  density: number;
  bpm: number;
  meter: number;
  drumless: boolean;
  driving: boolean;
}

/** What the recommendation reads of a song. */
export function songTraits({ doc, map, analysis }: RecommendInput): SongTraits {
  const sung = doc.lines.filter((L) => L.words.length);
  let chars = 0,
    secs = 0;
  for (const L of sung) {
    chars += L.words.reduce((a, W) => a + W.units.length, 0);
    secs += Math.max(0.4, Math.min(L.sung, L.end) - L.t);
  }
  // (driving: the drums hit often — off the drum stem where there is one, else the song's strong onsets)
  const dur = Math.max(1, analysis?.duration ?? 1),
    hits = analysis?.drums
      ? analysis.drums.t.length / dur
      : (analysis?.events.filter((e) => e.s >= 0.8).length ?? 0) / dur;
  return {
    lines: sung.length,
    density: secs ? chars / secs : 0,
    bpm: map.bpm,
    meter: map.meter,
    drumless: analysis?.stems === 'drumless',
    driving: !!analysis && analysis.source !== 'grid' && hits >= DRIVING,
  };
}
export function recommendMotion(inp: RecommendInput): string {
  const T = songTraits(inp);
  if (T.lines <= 1) return 'stage';
  if (T.drumless) return 'float';
  if (T.density > DENSE) return 'close';
  if (T.meter === 3 || (T.bpm < SLOW && !T.driving)) return 'waltz';
  if (T.bpm > FAST && T.driving) return 'groove';
  return 'story';
}
