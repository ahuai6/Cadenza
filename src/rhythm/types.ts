// The rhythm SDK's data: what an analysis of a song contains. Plain arrays only, so it can be cached as JSON, sent
// between threads, and read by any part of the app. Times are in seconds of the audio file.

export const RHYTHM_VERSION = 1;

/** How strong a rhythmic event is felt: 0 light (hats, ghost notes), 1 medium (backbeats, ordinary kicks), 2 strong (重拍:
 *  downbeat hits, accents, drops). */
export type Tier = 0 | 1 | 2;
/** Where the energy of an event sits. */
export type Band = 'low' | 'mid' | 'high' | 'broad';

export interface RhythmEvent {
  /** time in the file (s) */
  t: number;
  /** perceived strength, about 0..3 (1 ≈ a typical accent of this song) */
  s: number;
  tier: Tier;
  band: Band;
  /** position in the bar in beats (0 = downbeat; 1.5 = the "and" of beat 2) */
  pos: number;
  /** off the beat (an eighth or sixteenth position, not on a beat) */
  off: boolean;
  /** an accent heard ahead of the beat it belongs to (an anticipation / push): the beat time it anticipates */
  push?: number;
}

export interface Section {
  t0: number; t1: number;
  /** level of this section within the song, 0 (quietest) .. 1 (loudest) */
  energy: number;
  /** density of events per beat */
  density: number;
  /** a section that starts with a jump in level (a drop) */
  drop: boolean;
}

export interface RhythmAnalysis {
  version: number;
  /** 'grid' when made from a tempo alone (no audio) */
  source?: 'audio' | 'grid';
  duration: number;
  /** frame rate of the series below (frames per second) */
  rate: number;
  tempo: { bpm: number; confidence: number };
  /** beat times (s) */
  beats: number[];
  /** beats per bar (3 or 4) and the index in `beats` of the first downbeat */
  meter: number; downbeat: number;
  /** bar index (in bars from the first downbeat) where 4-bar phrases start, modulo 4 */
  phrase: number;
  /** half-time feel (backbeat on 3) */
  halfTime: boolean;
  events: RhythmEvent[];
  sections: Section[];
  /** builds into drops: [t0, t1] file seconds */
  builds: [number, number][];
  /** smoothed level 0..1 at `rate` (song-relative: 0 its quietest passages, 1 its loudest) */
  level: number[];
  /** short-term loudness 0..1 at `rate` (song-relative, fast) */
  loud: number[];
  /** onset strength per frame at `rate` (normalised), for displays */
  odf: number[];
}
