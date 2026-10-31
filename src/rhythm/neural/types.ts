// What the neural engine hands to the rhythm analysis (src/rhythm/analyze.ts), plain arrays only (it crosses threads).
// Part of Cadenza, AGPL-3.0-only (LICENSE, NOTICE.md).
import type { DrumKind } from './drums';

export interface NeuralRhythm {
  /** the model and the device it ran on, for the log ("beat_this final0 · google swiftshader") */
  model: string;
  /** every beat as the model counted it (s), and the downbeats among them */
  beats: number[]; downbeats: number[];
  /** per counted beat (wgsl accents, see accents.ts) */
  impact: number[]; low: number[]; mid: number[]; high: number[]; rhythmic: number[]; pulse: number[]; confidence: number[];
  trackScale: number;
  /** beats per felt beat (3 in compound time or a waltz felt a bar at a time, 2 counted at twice the tempo, else 1),
   *  and the usual bar length in counted beats */
  group: number; usual: number;
  /** the drum hits, null when the song has none (drumless) or they could not be had (no model, separation failed) */
  drums: { times: number[]; strengths: number[]; kinds: DrumKind[]; coverage: number } | null;
  /** whether a separation ran and judged the song drumless (as against not having run) */
  drumless: boolean;
  /** whether the drum stem was asked for and separated (false: skipped, or it failed) */
  drumsRun: boolean;
  /** where the voice sings (vocals.ts: VOICE_RATE frames a second, 0..1), null without singing or a separation */
  voice?: { rate: number; v: number[] } | null;
  /** how long it took (ms): the beats, the drums */
  ms: { beats: number; drums: number };
}
