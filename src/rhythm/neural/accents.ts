// What each beat sounds like: how hard it lands, where its energy sits, whether its bar has rhythm at all, whether it
// is a felt beat (Beat This! now and then counts a level below the felt beat: the eighths of a 6/8, a slow song at
// twice its tempo), and stretches the model is unsure of. Read off the same mel spectrogram the model ran on.
// Ported from Folia (https://github.com/chthollyphile/folia-major, AGPL-3.0): src/services/analysis/beatAccents.ts,
// version 10 of its measurement. The thresholds are Folia's, measured there on real tracks (the comments name them);
// they are kept as they are. Part of Cadenza, AGPL-3.0-only (LICENSE, NOTICE.md).
import { BEAT_THIS_FPS, MEL_BANDS, melBandCentresHz, type MelSpectrogram } from './mel';

/** Per frame (50 fps): percussive and total energy, from HPSS on the GPU (wgsl/percussive.ts). */
export interface PercussiveEnergy {
  percussive: Float32Array;
  total: Float32Array;
}

export interface BeatAccents {
  /** one entry per beat of the grid, in order */
  impact: number[];
  low: number[];
  mid: number[];
  high: number[];
  /** 1 when the beat's bar has rhythm, 0 when it is sustained sound only (or the model is unsure there) */
  rhythmic: number[];
  /** 1 for a felt beat, 0 for one counted between them */
  pulse: number[];
  /** each beat's logit: how sure the model was */
  confidence: number[];
  /** 0.45..1, a ballad whose beats barely rise moves less */
  trackScale: number;
  /** the whole track's percussive share of the energy (null without HPSS) */
  percussiveShare: number | null;
  meter: BeatMeter;
}
export interface BeatMeter {
  bpm: number;
  barLengths: [number, number][];
  usual: number;
  byPosition: number[];
  confidenceByPosition: number[];
  /** beats per felt beat: 3 (compound time, or a waltz felt a bar at a time), 2 (counted at twice the tempo), else 1 */
  group: number;
  unsure: number;
  driven: number;
}

const LOW_MAX_HZ = 150,
  MID_MAX_HZ = 2000;
const PEAK_BEFORE = 1,
  PEAK_AFTER = 2,
  BASE_FROM = 6,
  BASE_TO = 2;
const IMPACT_WEIGHTS = { low: 0.5, mid: 0.3, high: 0.2 } as const;
const LOUDNESS_HALF = 12,
  IMPACT_RISE_SHARE = 0.4,
  NORM_LO = 0.1,
  NORM_HI = 0.9,
  IMPACT_CURVE = 0.7,
  MIN_BEATS = 8;
export const TRACK_SCALE_MIN = 0.45;
const TRACK_SCALE_RISE_LOW = 0.1,
  TRACK_SCALE_RISE_HIGH = 0.35;
/** a bar under this share of the median bar's percussive share has no rhythm (Folia: 裏表ラバーズ' horn intro 0.10/0.31, every drummed bar ≥ 0.54) */
export const PERCUSSIVE_GATE = 0.45;
const MIN_BARS = 4,
  FALLBACK_BAR_BEATS = 4;
const PULSE_GROUPS = [
  { size: 3, ratio: 1.2, riseRatio: 1.2, minBpm: 120 },
  { size: 2, ratio: 0, riseRatio: 1.5, minBpm: 90 },
] as const;
const WHOLE_BAR_GROUP = { size: 3, ratio: 1.2, riseRatio: 1.5, minBpm: 90 } as const;
const MIN_PULSE_SPACING = 0.7,
  MIN_GATED_SHARE = 0.15,
  UNSURE_SHARE = 0.55;
const DRIVEN_TRACK_SHARE = 0.3,
  DRIVEN_OFFBEAT_SHARE = 0.6,
  DRIVEN_HALF = 8,
  UNSURE_HALF = 4,
  UNSURE_RUN = 8;
const PULSE_CONFIDENCE_GAP = 0.7,
  MIN_PULSE_BARS = 8,
  CONFIDENCE_HALF = 2;

let BAND_OF: Uint8Array | null = null;
const bandOf = () =>
  (BAND_OF ??= Uint8Array.from(melBandCentresHz(), (hz) => (hz < LOW_MAX_HZ ? 0 : hz < MID_MAX_HZ ? 1 : 2)));
function splitBands(mel: MelSpectrogram) {
  const of = bandOf(),
    cnt = [0, 0, 0];
  of.forEach((b) => cnt[b]++);
  const low = new Float32Array(mel.frames),
    mid = new Float32Array(mel.frames),
    high = new Float32Array(mel.frames),
    all = new Float32Array(mel.frames);
  for (let f = 0; f < mel.frames; f++) {
    let l = 0,
      m = 0,
      h = 0;
    const o = f * MEL_BANDS;
    for (let b = 0; b < MEL_BANDS; b++) {
      const v = mel.data[o + b],
        w = of[b];
      if (w === 0) l += v;
      else if (w === 1) m += v;
      else h += v;
    }
    low[f] = cnt[0] ? l / cnt[0] : 0;
    mid[f] = cnt[1] ? m / cnt[1] : 0;
    high[f] = cnt[2] ? h / cnt[2] : 0;
    all[f] = (l + m + h) / MEL_BANDS;
  }
  return { low, mid, high, all };
}
const at = (a: Float32Array, i: number) => a[Math.min(a.length - 1, Math.max(0, i))];
function riseAt(track: Float32Array, frame: number) {
  if (!track.length) return 0;
  let peak = -Infinity;
  for (let i = frame - PEAK_BEFORE; i <= frame + PEAK_AFTER; i++) peak = Math.max(peak, at(track, i));
  let base = 0;
  for (let i = frame - BASE_FROM; i <= frame - BASE_TO; i++) base += at(track, i);
  base /= BASE_FROM - BASE_TO + 1;
  return Math.max(0, peak - base);
}
function loudnessAt(track: Float32Array, frame: number) {
  if (!track.length) return 0;
  let s = 0;
  for (let i = frame - LOUDNESS_HALF; i <= frame + LOUDNESS_HALF; i++) s += at(track, i);
  return s / (2 * LOUDNESS_HALF + 1);
}
const percentile = (sorted: readonly number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] : 0;
const median = (v: readonly number[]) =>
  percentile(
    [...v].sort((a, b) => a - b),
    0.5,
  );
const round3 = (v: number) => Math.round(v * 1000) / 1000;
function normaliser(sorted: readonly number[]) {
  const lo = percentile(sorted, NORM_LO),
    hi = percentile(sorted, NORM_HI);
  return hi - lo > 1e-6 ? (v: number) => Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : null;
}

function barStarts(beats: readonly number[], downs: readonly number[]) {
  const ds = new Set(downs),
    s: number[] = [];
  if (downs.length >= 2) {
    beats.forEach((t, i) => {
      if (i === 0 || ds.has(t)) s.push(i);
    });
    return s;
  }
  for (let i = 0; i < beats.length; i += FALLBACK_BAR_BEATS) s.push(i);
  return s;
}
function trackPercussiveShare(e: PercussiveEnergy | null) {
  if (!e) return null;
  let h = 0,
    a = 0;
  for (let f = 0; f < e.total.length; f++) {
    h += e.percussive[f];
    a += e.total[f];
  }
  return a > 0 ? h / a : null;
}
export function rhythmicBeats(
  e: PercussiveEnergy | null | undefined,
  beats: readonly number[],
  downs: readonly number[],
): number[] {
  const out = beats.map(() => 1);
  if (!e) return out;
  const starts = barStarts(beats, downs);
  if (starts.length < MIN_BARS) return out;
  const step = (t: number) => Math.min(e.total.length, Math.max(0, Math.floor(t * BEAT_THIS_FPS))),
    lastGap = beats.length > 1 ? beats[beats.length - 1] - beats[beats.length - 2] : 0.5;
  const shares = starts.map((first, bar) => {
    const from = step(beats[first]),
      until = bar + 1 < starts.length ? step(beats[starts[bar + 1]]) : step(beats[beats.length - 1] + lastGap);
    let h = 0,
      a = 0;
    for (let f = from; f < until; f++) {
      h += e.percussive[f];
      a += e.total[f];
    }
    return a > 0 ? h / a : 0;
  });
  const usual = median(shares);
  if (usual < MIN_GATED_SHARE) return out;
  const th = usual * PERCUSSIVE_GATE;
  starts.forEach((first, bar) => {
    if (shares[bar] >= th) return;
    const end = bar + 1 < starts.length ? starts[bar + 1] : beats.length;
    for (let i = first; i < end; i++) out[i] = 0;
  });
  return out;
}
export const beatConfidence = (logits: ArrayLike<number>, beats: readonly number[]) =>
  beats.map((t) => {
    const f = Math.round(t * BEAT_THIS_FPS);
    let p = -Infinity;
    for (let i = f - CONFIDENCE_HALF; i <= f + CONFIDENCE_HALF; i++)
      if (i >= 0 && i < logits.length) p = Math.max(p, logits[i]);
    return Number.isFinite(p) ? round3(p) : 0;
  });
const downStarts = (beats: readonly number[], downs: readonly number[]) => {
  const ds = new Set(downs),
    s: number[] = [];
  beats.forEach((t, i) => {
    if (ds.has(t)) s.push(i);
  });
  return s;
};

export function readBeatMeter(
  rises: readonly number[],
  beats: readonly number[],
  downs: readonly number[],
  conf: readonly number[] | null,
): BeatMeter {
  const gap = median(beats.slice(1).map((t, i) => t - beats[i]));
  const m: BeatMeter = {
    bpm: gap > 0 ? Math.round(60 / gap) : 0,
    barLengths: [],
    usual: 0,
    byPosition: [],
    confidenceByPosition: [],
    group: 1,
    unsure: 0,
    driven: 0,
  };
  const starts = downStarts(beats, downs);
  if (starts.length < 2) return m;
  const counts = new Map<number, number>();
  for (let b = 0; b + 1 < starts.length; b++) {
    const L = starts[b + 1] - starts[b];
    counts.set(L, (counts.get(L) ?? 0) + 1);
  }
  m.barLengths = [...counts].sort((a, b) => b[1] - a[1]);
  const [usual, bars] = m.barLengths[0];
  m.usual = usual;
  m.byPosition = Array.from({ length: usual }, () => 0);
  const lg: number[][] = Array.from({ length: usual }, () => []);
  for (let b = 0; b + 1 < starts.length; b++) {
    if (starts[b + 1] - starts[b] !== usual) continue;
    for (let p = 0; p < usual; p++) {
      m.byPosition[p] += rises[starts[b] + p] / bars;
      if (conf) lg[p].push(conf[starts[b] + p]);
    }
  }
  if (conf) m.confidenceByPosition = lg.map(median);
  if (bars < MIN_PULSE_BARS) return m;
  const { byPosition: R, confidenceByPosition: C } = m;
  const standsOut = (head: number, need: number) => {
    const bf = (head + usual - 1) % usual,
      af = (head + 1) % usual;
    if (need > 0 && !(R[head] > need * Math.max(R[bf], R[af]))) return false;
    return !conf || C[head] - Math.max(C[bf], C[af]) > PULSE_CONFIDENCE_GAP;
  };
  const found = [...PULSE_GROUPS, WHOLE_BAR_GROUP].find(({ size, ratio, riseRatio, minBpm }) => {
    if (usual % size !== 0 || m.bpm < minBpm) return false;
    const need = conf ? ratio : riseRatio;
    if (usual === size) return standsOut(0, need);
    for (let h = size; h < usual; h += size) if (!standsOut(h, need)) return false;
    return true;
  });
  if (found) m.group = found.size;
  return m;
}
function groupHeads(m: BeatMeter, beats: readonly number[], downs: readonly number[]) {
  const pulse = beats.map(() => 1),
    g = m.group;
  if (g === 1) return pulse;
  const starts = downStarts(beats, downs);
  for (let i = 0; i < starts[0]; i++) pulse[i] = (starts[0] - i) % g === 0 ? 1 : 0;
  starts.forEach((s, b) => {
    const end = b + 1 < starts.length ? starts[b + 1] : beats.length;
    for (let i = s; i < end; i++) pulse[i] = (i - s) % g === 0 ? 1 : 0;
  });
  return pulse;
}
function pulseFromMeter(m: BeatMeter, beats: readonly number[], downs: readonly number[]) {
  const pulse = groupHeads(m, beats, downs),
    gap = median(beats.slice(1).map((t, i) => t - beats[i]));
  if (!(gap > 0) || beats.length < MIN_BEATS) return pulse;
  const spacing = MIN_PULSE_SPACING * gap * m.group,
    ds = new Set(downs);
  let last = -1;
  beats.forEach((t, i) => {
    if (!pulse[i]) return;
    if (last < 0 || t - beats[last] >= spacing) {
      last = i;
      return;
    }
    if (ds.has(t) && !ds.has(beats[last])) {
      pulse[last] = 0;
      last = i;
    } else pulse[i] = 0;
  });
  return pulse;
}
export function unsureBeats(conf: readonly number[] | null, pulse: readonly number[]) {
  const out = pulse.map(() => 0);
  if (!conf) return out;
  const felt = pulse.map((_, i) => i).filter((i) => pulse[i]);
  if (felt.length < UNSURE_RUN) return out;
  const lg = felt.map((i) => conf[i]),
    floor =
      UNSURE_SHARE *
      percentile(
        [...lg].sort((a, b) => a - b),
        0.75,
      );
  const low = lg.map((_, k) => {
    const a = lg.slice(Math.max(0, k - UNSURE_HALF), k + UNSURE_HALF + 1);
    return a.reduce((s, v) => s + v, 0) / a.length < floor;
  });
  let st = -1;
  for (let k = 0; k <= low.length; k++) {
    if (k < low.length && low[k]) {
      if (st < 0) st = k;
      continue;
    }
    if (st >= 0 && k - st >= UNSURE_RUN) for (let i = felt[st]; i <= felt[k - 1]; i++) out[i] = 1;
    st = -1;
  }
  return out;
}
export function restoreDrivenBeats(
  pulse: number[],
  group: number,
  conf: readonly number[] | null,
  share: number | null,
  unsure: readonly number[] = [],
) {
  if (group !== 2 || !conf || share === null || share < DRIVEN_TRACK_SHARE) return 0;
  const felt = pulse.map((_, i) => i).filter((i) => pulse[i]);
  const groups = felt
    .slice(0, -1)
    .map((head, k) => {
      const between: number[] = [];
      for (let i = head + 1; i < felt[k + 1]; i++) between.push(i);
      return { head, between };
    })
    .filter(({ head }) => !unsure[head]);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const driven = groups.map((_, k) => {
    const ar = groups.slice(Math.max(0, k - DRIVEN_HALF), k + DRIVEN_HALF + 1),
      off = ar.flatMap((e) => e.between.map((i) => conf[i]));
    if (!off.length) return false;
    const heads = mean(ar.map((e) => conf[e.head]));
    return heads > 0 && mean(off) >= DRIVEN_OFFBEAT_SHARE * heads;
  });
  let n = 0;
  groups.forEach(({ between }, k) => {
    if (!driven[k]) return;
    between.forEach((i) => {
      pulse[i] = 1;
      n++;
    });
  });
  return n;
}
export const resolveTrackScale = (r: number) =>
  r > 0
    ? round3(
        TRACK_SCALE_MIN +
          (1 - TRACK_SCALE_MIN) *
            Math.min(1, Math.max(0, (r - TRACK_SCALE_RISE_LOW) / (TRACK_SCALE_RISE_HIGH - TRACK_SCALE_RISE_LOW))),
      )
    : TRACK_SCALE_MIN;

/** The accents of `beats` (seconds, sorted) on the spectrogram they were found on. */
export function computeBeatAccents(
  mel: MelSpectrogram,
  beats: readonly number[],
  downs: readonly number[],
  energy: PercussiveEnergy | null,
  logits: ArrayLike<number> | null,
): BeatAccents {
  const tr = splitBands(mel),
    conf = logits ? beatConfidence(logits, beats) : null;
  const rises = beats.map((t) => {
    const f = Math.round(t * BEAT_THIS_FPS),
      low = riseAt(tr.low, f),
      mid = riseAt(tr.mid, f),
      high = riseAt(tr.high, f);
    return {
      low,
      mid,
      high,
      raw: low * IMPACT_WEIGHTS.low + mid * IMPACT_WEIGHTS.mid + high * IMPACT_WEIGHTS.high,
      loud: loudnessAt(tr.all, f),
    };
  });
  const meter = readBeatMeter(
      rises.map((r) => r.raw),
      beats,
      downs,
      conf,
    ),
    share = trackPercussiveShare(energy);
  const A: BeatAccents = {
    impact: [],
    low: [],
    mid: [],
    high: [],
    rhythmic: rhythmicBeats(energy, beats, downs),
    pulse: pulseFromMeter(meter, beats, downs),
    confidence: conf ?? beats.map(() => 0),
    trackScale: 1,
    percussiveShare: share,
    meter,
  };
  const sortedRaw = rises.map((r) => r.raw).sort((a, b) => a - b),
    rise = normaliser(sortedRaw),
    loud = normaliser(rises.map((r) => r.loud).sort((a, b) => a - b));
  const flat = beats.length < MIN_BEATS || (!rise && !loud),
    rs = !loud ? 1 : !rise ? 0 : IMPACT_RISE_SHARE;
  for (const r of rises) {
    const mixed = rs * (rise ? rise(r.raw) : 0) + (1 - rs) * (loud ? loud(r.loud) : 0);
    A.impact.push(flat ? 1 : round3(mixed ** IMPACT_CURVE));
    const s = r.low + r.mid + r.high;
    A.low.push(s > 0 ? round3(r.low / s) : 0.333);
    A.mid.push(s > 0 ? round3(r.mid / s) : 0.333);
    A.high.push(s > 0 ? round3(r.high / s) : 0.333);
  }
  if (beats.length >= MIN_BEATS) A.trackScale = resolveTrackScale(median(sortedRaw));
  const un = unsureBeats(conf, A.pulse);
  un.forEach((v, i) => {
    if (v) A.rhythmic[i] = 0;
  });
  meter.unsure = un.filter(Boolean).length;
  meter.driven = restoreDrivenBeats(A.pulse, meter.group, conf, share, un);
  return A;
}
/** One line on how a track's bars read (Folia's [BeatMeter] line), for the log. */
export const formatBeatMeter = (m: BeatMeter, pulse: readonly number[]) =>
  `bpm ${m.bpm} | bars ${
    m.barLengths
      .slice(0, 5)
      .map(([l, c]) => `${l}x${c}`)
      .join(' ') || '-'
  } | usual ${m.usual} | ` +
  `${m.group === 1 ? 'every beat' : `1 in ${m.group}`} (${pulse.filter(Boolean).length}/${pulse.length})${m.unsure ? ` | unsure ${m.unsure}` : ''}${m.driven ? ` | driven ${m.driven}` : ''}`;
