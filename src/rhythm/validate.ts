// Is a rhythm analysis sound? A reading that came out wrong — a run that failed half-way, a file cut short, a cache
// written by a buggy version, numbers that are not numbers — must never be played on: it is analysed again instead.
// The checks are on what every reader relies on, not on taste: beats that exist and go forward, a tempo that agrees
// with them, series that are numbers, the per-beat readings one per beat.
import { RHYTHM_VERSION, type RhythmAnalysis } from './types';

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** Why an analysis cannot be used, or null when it can. `duration`: the song's own length (s), when known. */
export function checkAnalysis(a: unknown, duration?: number): string | null {
  if (!a || typeof a !== 'object') return 'not an analysis';
  const r = a as RhythmAnalysis;
  if (r.version !== RHYTHM_VERSION) return `version ${r.version} (this is ${RHYTHM_VERSION})`;
  if (!finite(r.duration) || r.duration <= 0) return 'no duration';
  if (duration && Math.abs(r.duration - duration) > Math.max(2, duration * 0.02))
    return `made for ${r.duration.toFixed(1)} s of audio, the song is ${duration.toFixed(1)} s`;
  const B = r.beats;
  if (!Array.isArray(B)) return 'no beats';
  if (r.source === 'unavailable') return 'analysis is not ready';
  if (r.beatEvidence === 'none' && B.length) return 'beat evidence does not match the observed beats';
  if (r.beatEvidence !== 'none' && B.length < 2 && r.duration > 20) return 'no beats';
  for (let i = 0; i < B.length; i++) {
    if (!finite(B[i])) return `beat ${i} is not a number`;
    if (i && B[i] <= B[i - 1]) return `beat ${i} goes backwards`;
  }
  if (B.length && (B[0] < -1 || B[B.length - 1] > r.duration + 2)) return 'beats outside the song';
  if (!r.tempo || !finite(r.tempo.bpm) || r.tempo.bpm < 30 || r.tempo.bpm > 300) return `tempo ${r.tempo?.bpm}`;
  if (B.length >= 8) {
    // The tempo is read from the beats in one of two ways: the median beat, or (the neural engine's, analyze.ts
    // feltGrid) the median of spans of eight beats, which averages out the 20 ms frame grid. A song that pauses or
    // slows makes the two differ by more than the tolerance (4.0.0-alpha.6: such readings were thrown away as broken),
    // so a tempo agreeing with either is sound.
    const median = (span: number) => {
      const g = B.slice(span)
        .map((t, i) => (t - B[i]) / span)
        .sort((x, y) => x - y);
      return 60 / g[g.length >> 1];
    };
    const readings = [median(1), median(Math.min(8, B.length - 1))];
    // (the tempo may be the felt one — half or double the counted beat — but it must be one of them)
    const agrees = (bpm: number) =>
      [0.5, 1, 2, 1 / 3, 3, 2 / 3, 1.5].some((m) => Math.abs(bpm * m - r.tempo.bpm) / r.tempo.bpm < 0.06);
    if (!readings.some(agrees))
      return `tempo ${r.tempo.bpm.toFixed(1)} disagrees with the beats (${readings[0].toFixed(1)})`;
  }
  if (!finite(r.meter) || r.meter < 1 || r.meter > 16) return `meter ${r.meter}`;
  if (!finite(r.rate) || r.rate <= 0) return 'no rate';
  for (const k of ['level', 'loud', 'odf'] as const) {
    const s = r[k];
    if (!Array.isArray(s)) return `no ${k}`;
    for (let i = 0; i < s.length; i += 37) if (!finite(s[i])) return `${k} is not numbers`;
  }
  if (!Array.isArray(r.events)) return 'no events';
  for (const e of r.events) if (!finite(e.t) || !finite(e.s)) return 'an event is not numbers';
  if (r.bars)
    for (const b of r.bars) if (!Number.isInteger(b) || b < 0 || b >= B.length) return 'a bar outside the beats';
  if (r.accents) {
    const A = r.accents as unknown as Record<string, unknown>;
    for (const k of ['impact', 'rhythmic']) {
      const s = A[k];
      if (s != null && (!Array.isArray(s) || s.length !== B.length)) return `accents.${k}: not one a beat`;
    }
  }
  return null;
}
