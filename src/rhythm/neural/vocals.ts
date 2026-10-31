// Where the voice sings: HTDemucs' vocal stem (separated with the drums, in the same pass) read as a level, VOICE_RATE
// frames a second, 0 (no voice) .. 1 (the song's loud singing). The lyrics read it to cut a line where the singer
// breathes (lyrics/phrasing.ts), for lines timed only as a whole. A song with no real voice (an instrumental: the stem
// is what leaked in) has none. Part of Cadenza, AGPL-3.0-only (LICENSE, NOTICE.md).
import { energyFrames } from './drums';

/** Frames a second of the voice level (each the mean of two of energyFrames' hundredths). */
export const VOICE_RATE = 50;
/** The level's range: from VOICE_RANGE dB under the song's loud singing (0) up to it (1). */
const VOICE_RANGE = 30;
/** A song whose singing, at its loud, is this far (dB) under the mix's is taken to have no voice. */
const NO_VOICE_DB = 24;

const db = (e: number) => 10 * Math.log10(e + 1e-12);
const pct = (a: number[], q: number) => { const s = a.filter(x => x > -100).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : -120; };

/** The voice level of a vocal stem (mono, 44.1 kHz) against its mix; null for a song without singing. */
export function voiceLevel(vocals: Float32Array, mix: Float32Array): number[] | null {
  const ev = energyFrames(vocals), em = energyFrames(mix), n = Math.floor(ev.length / 2);
  const v: number[] = new Array(n), m: number[] = new Array(n);
  for (let i = 0; i < n; i++) { v[i] = db((ev[2 * i] + ev[2 * i + 1]) / 2); m[i] = db((em[2 * i] + em[2 * i + 1]) / 2); }
  const top = pct(v, 0.95), mixTop = pct(m, 0.95);
  if (top < mixTop - NO_VOICE_DB) return null;
  return v.map(x => Math.round(Math.min(1, Math.max(0, (x - (top - VOICE_RANGE)) / VOICE_RANGE)) * 100) / 100);
}
