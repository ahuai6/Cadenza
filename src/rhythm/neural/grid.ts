// Beat This!'s output contract: the 30-second chunks the model takes, their stitching back into one prediction per
// frame, and the peak picking that turns the two logit tracks into beat and downbeat times (no DBN: a beat is simply a
// positive local maximum over seven frames, which imposes no tempo and no meter).
// Ported from Folia (https://github.com/chthollyphile/folia-major, AGPL-3.0): src/services/analysis/beatThis.ts.
// Part of Cadenza, AGPL-3.0-only (LICENSE, NOTICE.md).
import { BEAT_THIS_FPS, MEL_BANDS, type MelSpectrogram } from './mel';

/** Frames the model takes in one call: thirty seconds at 50 fps (the export refuses anything longer). */
export const MODEL_CHUNK_FRAMES = 1500;
/** Frames dropped at each end of every chunk's prediction: there a frame has only half its context. */
const BORDER_FRAMES = 6;

export interface MelChunk {
  data: Float32Array;
  frames: number;
  /** frame of the piece at this chunk's first row (negative before the start) */ start: number;
}
export interface ChunkPrediction {
  start: number;
  frames: number;
  beat: Float32Array;
  downbeat: Float32Array;
}
export interface BeatGrid {
  beats: number[];
  /** a subset of `beats` (each snapped onto its nearest beat) */ downbeats: number[];
}

/** Where each chunk begins, as the reference implementation does it (the last pulled back to end flush). */
function chunkStarts(frames: number): number[] {
  const stride = MODEL_CHUNK_FRAMES - 2 * BORDER_FRAMES,
    starts: number[] = [];
  for (let s = -BORDER_FRAMES; s < frames - BORDER_FRAMES; s += stride) starts.push(s);
  if (!starts.length) return [-BORDER_FRAMES];
  if (frames > stride) starts[starts.length - 1] = frames - (MODEL_CHUNK_FRAMES - BORDER_FRAMES);
  return starts;
}
export function splitForModel(mel: MelSpectrogram): MelChunk[] {
  if (!mel.frames) return [];
  return chunkStarts(mel.frames).map((start) => {
    const from = Math.max(0, start),
      to = Math.min(start + MODEL_CHUNK_FRAMES, mel.frames),
      leftPad = Math.max(0, -start);
    const rightPad = Math.max(0, Math.min(BORDER_FRAMES, start + MODEL_CHUNK_FRAMES - mel.frames)),
      frames = leftPad + Math.max(0, to - from) + rightPad;
    const data = new Float32Array(frames * MEL_BANDS);
    if (to > from) data.set(mel.data.subarray(from * MEL_BANDS, to * MEL_BANDS), leftPad * MEL_BANDS);
    return { data, frames, start };
  });
}
/** One prediction per frame of the piece; where chunks overlap the earlier one wins (the reference's keep_first). */
export function aggregateChunks(
  preds: readonly ChunkPrediction[],
  frames: number,
): { beat: Float32Array; downbeat: Float32Array } {
  const beat = new Float32Array(frames).fill(-1000),
    downbeat = new Float32Array(frames).fill(-1000);
  for (let i = preds.length - 1; i >= 0; i--) {
    const c = preds[i],
      wide = c.frames >= 2 * BORDER_FRAMES,
      from = wide ? BORDER_FRAMES : 0,
      to = wide ? c.frames - BORDER_FRAMES : c.frames;
    for (let o = from; o < to; o++) {
      const t = c.start + o;
      if (t < 0 || t >= frames) continue;
      beat[t] = c.beat[o];
      downbeat[t] = c.downbeat[o];
    }
  }
  return { beat, downbeat };
}
/** Peaks within `width` frames of each other merged into their running mean (one beat fired on two frames). */
function deduplicate(peaks: number[], width: number): number[] {
  if (!peaks.length) return [];
  const out: number[] = [];
  let m = peaks[0],
    n = 1;
  for (let i = 1; i < peaks.length; i++) {
    const p = peaks[i];
    if (p - m <= width) {
      n++;
      m += (p - m) / n;
    } else {
      out.push(Math.round(m));
      m = p;
      n = 1;
    }
  }
  out.push(Math.round(m));
  return out;
}
export function beatsFromLogits(beatL: ArrayLike<number>, downL: ArrayLike<number>, fps = BEAT_THIS_FPS): BeatGrid {
  const pick = (l: ArrayLike<number>) => {
    const peaks: number[] = [];
    for (let i = 0; i < l.length; i++) {
      const v = l[i];
      if (!(v > 0)) continue;
      let pk = true;
      for (let o = -3; o <= 3 && pk; o++) {
        const j = i + o;
        if (j >= 0 && j < l.length && l[j] > v) pk = false;
      }
      if (pk) peaks.push(i);
    }
    return deduplicate(peaks, 1);
  };
  const beats = pick(beatL).map((f) => f / fps),
    downs = pick(downL).map((f) => f / fps);
  if (!beats.length) return { beats, downbeats: [] };
  // (a downbeat is a beat: moved onto the nearest one, never left a frame or two off it)
  const snapped = downs.map((t) => {
    let best = beats[0];
    for (const b of beats) if (Math.abs(b - t) < Math.abs(best - t)) best = b;
    return best;
  });
  return { beats, downbeats: [...new Set(snapped)].sort((a, b) => a - b) };
}
