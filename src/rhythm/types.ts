// The rhythm SDK's data: what an analysis of a song contains. Plain arrays only, so it can be cached as JSON, sent
// between threads, and read by any part of the app. Times are in seconds of the audio file.

export const RHYTHM_VERSION = 3;              // 2: the coarse spectrum (spec); 3: the neural engine (engine, bars, accents, drums)

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
  /** the song's integrated loudness and sample peak (BS.1770), for the volume balance; absent in older analyses */
  loudness?: { lufs: number; peak: number };
  /** onset strength per frame at `rate` (normalised), for displays */
  odf: number[];
  /** a coarse spectrum at `rate`: a few bands, low to high, each 0..1 song-relative (for displays) */
  spec?: number[][];
  /** which engine found the beats: 'neural' (Beat This! and HTDemucs on the GPU, src/rhythm/neural) or 'dsp' (the
   *  built-in analysis, also the fallback when there is no GPU or no model) */
  engine?: 'neural' | 'dsp';
  /** the neural engine's drum stem: separated ('drums'), separated and found drumless, or not run ('skipped': the
   *  song was needed at once; a full pass follows in the background) */
  stems?: 'drums' | 'drumless' | 'skipped';
  /** the index in `beats` of every downbeat, when the bars were found one by one (they may differ in length); absent:
   *  a bar every `meter` beats from `downbeat` */
  bars?: number[];
  /** per beat (the neural engine): how it lands and whether it is played at all */
  accents?: BeatAccentSeries;
  /** drum hits read off the separated drum stem (the neural engine); absent for a song without drums */
  drums?: { t: number[]; s: number[]; k: (0 | 1 | 2)[] };
}

/** One entry per beat of `beats`. */
export interface BeatAccentSeries {
  /** 0..1 how hard the beat lands: its rise and the loudness around it, each placed in the song's own range */
  impact: number[];
  /** 1 when the beat's bar has rhythm (not a held pad, not a stretch the model is unsure of), else 0 */
  rhythmic: number[];
  /** each band's share of the beat's rise (they add up to 1) */
  low: number[]; mid: number[]; high: number[];
  /** how sure the model was of each beat (its logit) */
  conf: number[];
  /** 0.45..1: a song whose beats barely rise moves less */
  trackScale: number;
}
