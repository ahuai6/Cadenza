// A song's drum hits, read off HTDemucs' drum stem: the song cut into the model's 3.9 s segments (a step of three
// quarters, each faded across the quarter it shares with a neighbour by a triangular window, the sum divided by the
// weight: the reference demucs `_chunked_separate_single`), then three bands of the stem's mel spectrogram (kick,
// snare, hats) where it rises against each band's own loud hits. A song whose drums play in less than 8 % of its
// audible stretches has none: HTDemucs still hands back a "drum" stem there, and it is what leaked in (a bass line).
// Ported from Folia (https://github.com/chthollyphile/folia-major, AGPL-3.0): src/services/analysis/drumStem.ts,
// stemRange.ts (the segment grid and window) and drumHits.ts (the picking and the drumless guard), whole-song at once
// here. Part of Cadenza, AGPL-3.0-only (LICENSE, NOTICE.md).
import { BEAT_THIS_FPS, MEL_BANDS, melBandCentresHz, type MelSpectrogram } from './mel';

/** HTDemucs' rate and segment (samples per channel). */
export const STEM_RATE = 44100;
export const HTDEMUCS_SEGMENT = 172032;
export type DrumKind = 0 | 1 | 2;                 // kick, snare, hats
export interface DrumHits { times: number[]; strengths: number[]; kinds: DrumKind[] }

const PEAK_BEFORE = 1, PEAK_AFTER = 2, BASE_FROM = 6, BASE_TO = 2;
const HIT_TOP = 0.99, HIT_ONSET_FLOOR = 0.15, PEAK_HALF = 3, MIN_HIT_GAP = 0.09;
const KICK_MAX_HZ = 150, SNARE_MAX_HZ = 4000, HAT_MIN_HZ = 6000;
const ENERGY_HOP = 441, SHARE_WINDOW = 25, SHARE_AUDIBLE = 0.05, DRUMS_PLAYING_SHARE = 0.03;
/** Folia, on 21 separated tracks: the drumless ones 0.006–0.043, every one with a kit from 0.135 up. */
export const DRUMLESS_COVERAGE = 0.08;

export function segmentStarts(total: number, segment = HTDEMUCS_SEGMENT): number[] {
  const stride = segment - Math.floor(segment / 4), count = Math.max(1, Math.ceil(total / stride)), out: number[] = [];
  for (let c = 0; c < count; c++) { const s = c * stride; if (s >= total && c > 0) break; out.push(s); }
  return out;
}
export function segmentWindow(segment = HTDEMUCS_SEGMENT): Float32Array {
  const ov = Math.floor(segment / 4), w = new Float32Array(segment).fill(1);
  for (let i = 0; i < ov; i++) { const r = i / (ov - 1); w[i] = r; w[segment - 1 - i] = r; }
  return w;
}
/** The stems of a stereo song at 44.1 kHz (as many as `separate` hands back per segment, in its order), each as mono;
 *  null as soon as a segment cannot be separated or `go` says no. */
export async function separateStems(left: Float32Array, right: Float32Array, separate: (l: Float32Array, r: Float32Array) => Promise<{ left: Float32Array; right: Float32Array }[] | null>,
  progress?: (k: number) => void, go: () => boolean = () => true): Promise<Float32Array[] | null> {
  const seg = HTDEMUCS_SEGMENT, total = left.length, win = segmentWindow(seg), starts = segmentStarts(total, seg);
  const weight = new Float32Array(total), inL = new Float32Array(seg), inR = new Float32Array(seg); let out: Float32Array[] | null = null;
  for (let k = 0; k < starts.length; k++) {
    if (!go()) return null;
    const s = starts[k], n = Math.min(seg, total - s);
    inL.fill(0); inR.fill(0); inL.set(left.subarray(s, s + n)); inR.set(right.subarray(s, s + n));     // (the last runs past the end: zeros)
    const st = await separate(inL, inR); if (!st || !st.length) return null;
    out ??= st.map(() => new Float32Array(total));
    for (let j = 0; j < out.length; j++) { const o = out[j], a = st[j]; for (let i = 0; i < n; i++) o[s + i] += ((a.left[i] + a.right[i]) / 2) * win[i]; }
    for (let i = 0; i < n; i++) weight[s + i] += win[i];
    progress?.((k + 1) / starts.length);
  }
  if (!out) return null;
  for (const o of out) for (let i = 0; i < total; i++) o[i] /= Math.max(weight[i], 1e-8);
  return out;
}
/** The drum stem alone (separateStems with one source). */
export async function separateDrums(left: Float32Array, right: Float32Array, separate: (l: Float32Array, r: Float32Array) => Promise<{ left: Float32Array; right: Float32Array } | null>,
  progress?: (k: number) => void, go: () => boolean = () => true): Promise<Float32Array | null> {
  const st = await separateStems(left, right, async (l, r) => { const o = await separate(l, r); return o ? [o] : null; }, progress, go);
  return st ? st[0] : null;
}

function bandTrack(mel: MelSpectrogram, fromHz: number, toHz: number) {
  const bands = melBandCentresHz().map((hz, b) => (hz >= fromHz && hz < toHz ? b : -1)).filter(b => b >= 0), out = new Float32Array(mel.frames);
  for (let f = 0; f < mel.frames; f++) { let s = 0; for (const b of bands) s += mel.data[f * MEL_BANDS + b]; out[f] = bands.length ? s / bands.length : 0; }
  return out;
}
function riseAt(tr: Float32Array, f: number) {
  let peak = 0; for (let i = f - PEAK_BEFORE; i <= f + PEAK_AFTER; i++) if (i >= 0 && i < tr.length) peak = Math.max(peak, tr[i]);
  let base = 0, n = 0; for (let i = f - BASE_FROM; i <= f - BASE_TO; i++) if (i >= 0 && i < tr.length) { base += tr[i]; n++; }
  return Math.max(0, peak - (n ? base / n : 0));
}
function riseShares(tr: Float32Array) {
  const rise = new Float32Array(tr.length); for (let f = 0; f < tr.length; f++) rise[f] = riseAt(tr, f);
  const loud = rise.filter(v => v > 0).sort(), top = (loud.length ? loud[Math.min(loud.length - 1, Math.floor(HIT_TOP * loud.length))] : 0) || 1;
  return rise.map(v => Math.min(1, v / top));
}
/** The hits of a drum stem's spectrogram: the largest of the three bands' rises, at a local peak, at least 90 ms apart. */
export function pickDrumHits(mel: MelSpectrogram): DrumHits {
  const frames = mel.frames, bands = [bandTrack(mel, 0, KICK_MAX_HZ), bandTrack(mel, KICK_MAX_HZ, SNARE_MAX_HZ), bandTrack(mel, HAT_MIN_HZ, Infinity)].map(riseShares);
  const top = new Float32Array(frames), kindOf = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) for (let k = 0; k < 3; k++) if (bands[k][f] > top[f]) { top[f] = bands[k][f]; kindOf[f] = k; }
  const times: number[] = [], strengths: number[] = [], kinds: DrumKind[] = [];
  for (let f = 0; f < frames; f++) {
    const s = top[f]; if (s < HIT_ONSET_FLOOR) continue;
    let pk = true; for (let i = Math.max(0, f - PEAK_HALF); i <= Math.min(frames - 1, f + PEAK_HALF) && pk; i++) if (top[i] > s || (top[i] === s && i < f)) pk = false;
    if (!pk) continue;
    const t = f / BEAT_THIS_FPS, last = times.length - 1;
    if (last >= 0 && t - times[last] < MIN_HIT_GAP) { if (s > strengths[last]) { times[last] = t; strengths[last] = s; kinds[last] = kindOf[f] as DrumKind; } continue; }
    times.push(t); strengths.push(s); kinds.push(kindOf[f] as DrumKind);
  }
  return { times, strengths, kinds };
}
export function energyFrames(x: Float32Array): Float32Array { const o = new Float32Array(Math.ceil(x.length / ENERGY_HOP)); for (let i = 0; i < x.length; i++) o[Math.floor(i / ENERGY_HOP)] += x[i] * x[i]; return o; }
/** How much of the song the drums play in: of its audible quarter-second windows, the share where the stem holds a real part of the energy. */
export function drumCoverage(drum: Float32Array, mix: Float32Array): number {
  const wins: { d: number; m: number }[] = [];
  for (let a = 0; a < mix.length; a += SHARE_WINDOW) { let d = 0, m = 0; for (let i = a; i < Math.min(mix.length, a + SHARE_WINDOW); i++) { d += drum[i] ?? 0; m += mix[i]; } wins.push({ d, m }); }
  const ms = wins.map(w => w.m).sort((a, b) => a - b), floor = (ms[Math.min(ms.length - 1, Math.floor(0.5 * ms.length))] ?? 0) * SHARE_AUDIBLE;
  const aud = wins.filter(w => w.m > floor && w.m > 0); if (!aud.length) return 0;
  return aud.filter(w => w.d >= DRUMS_PLAYING_SHARE * w.m).length / aud.length;
}
/** 44.1 kHz to 22.05 kHz: a half-band low-pass (windowed sinc, 63 taps) and every other sample. */
export function halve(x: Float32Array): Float32Array {
  const N = 31, h = new Float32Array(2 * N + 1); let sum = 0;
  for (let k = -N; k <= N; k++) { const sinc = k === 0 ? 0.5 : Math.sin(Math.PI * k / 2) / (Math.PI * k), w = 0.42 + 0.5 * Math.cos(Math.PI * k / (N + 1)) + 0.08 * Math.cos(2 * Math.PI * k / (N + 1)); h[k + N] = sinc * w; sum += h[k + N]; }
  for (let k = 0; k < h.length; k++) h[k] /= sum;
  const out = new Float32Array(Math.ceil(x.length / 2));
  for (let j = 0; j < out.length; j++) { const c = 2 * j; let v = 0; for (let k = -N; k <= N; k++) { const i = c + k; if (i >= 0 && i < x.length) v += x[i] * h[k + N]; } out[j] = v; }
  return out;
}
