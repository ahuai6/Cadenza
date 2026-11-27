// Folia's live inputs, written from Cadenza's rhythm: the beat clock (vendored beatFxLive, fed the
// song's beats and downbeats with their accents) and the audio bands its visualizers read. Folia
// measures these off the playing audio; here they come from the analysis every other picture uses,
// so a Folia style follows the same beats as the director, the now-playing page and the space.
import type { RhythmMap } from '../rhythm/map';
import { beginBeatFxTrack, setBeatFxEvents, tickBeatFx, isBeatFxReady } from './vendor/services/beatFx/beatFxLive';
import type { BeatFxEvent } from './vendor/services/beatFx/clock';
import { audioPower, bass, lowMid, mid, vocal, treble } from './shim/motionSignals';
import { setDrumHits } from './shim/drumHits';
import { setBeatFxLiveEffects } from './vendor/services/beatFx/beatFxLive';
import type { AudioBands } from './vendor/types';
import type { MotionValue } from './shim/framerMotion';

let installed: { key: string; map: RhythmMap | null } | null = null;

/* Cadenza's coarse spectrum (map.spec) is log-spaced from 30 Hz to 10 kHz; a stretch of it in Hz, as a share of it. */
const LOG_SPAN = Math.log(10000 / 30);
const at = (hz: number) => Math.min(1, Math.max(0, Math.log(hz / 30) / LOG_SPAN));
/** The mean of the spectrum's bands over [lo, hi] (shares of it), each band weighed by how much of it lies inside. */
function bandMean(s: readonly number[], lo: number, hi: number) {
  const n = s.length;
  let v = 0,
    w = 0;
  for (let k = 0; k < n; k += 1) {
    const o = Math.min(hi * n, k + 1) - Math.max(lo * n, k);
    if (o > 0) {
      v += s[k] * o;
      w += o;
    }
  }
  return w ? v / w : 0;
}
/** Folia's bands (its analyser's ranges, usePlaybackVisualizerBridge): bass, low mids, mids, the voice's range, treble. */
const BANDS = {
  bass: [at(20), at(150)],
  lowMid: [at(150), at(400)],
  mid: [at(400), at(1200)],
  vocal: [at(1000), at(3500)],
  treble: [at(3500), at(12000)],
} as const;
/** Folia's beat accents' three ranges (beatAccents.ts: low under 150 Hz, mid to 2 kHz, high above). */
const TONE = { low: [0, at(150)], mid: [at(150), at(2000)], high: [at(2000), 1] } as const;

const quantileOf = (v: number[], q: number) => {
  const a = [...v].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))] : 0;
};

/**
 * The beat list the clock fires: every beat, the bar's first as a downbeat, each with how hard it lands and what it
 * sounds like, measured as Folia's beatAccents measures them — on Cadenza's spectrum and loudness instead of its mel
 * spectrogram: the rise of the low, mid and high ranges at the beat over the moment before it (their shares are its
 * tone; low weighs most), mixed with how loud the music is around it, each normalised over the song (its 10th to 90th
 * percentile) and curved so that most beats of a driving song read as real hits.
 */
export function beatEvents(map: RhythmMap): BeatFxEvent[] {
  const meter = Math.max(1, map.meter || 4);
  const shared = map.a.accents;
  if (shared && shared.impact.length === map.beats.length) {
    let since: number | null = null;
    return Array.from(map.beats, (t, index) => {
      const down = map.isDownbeat(t);
      if (down) since = 0;
      else if (since !== null) since++;
      return {
        t,
        kind: down ? 'downbeat' : 'beat',
        impact: Math.min(1, Math.max(0, shared.impact[index] * shared.trackScale)),
        tone: { low: shared.low[index], mid: shared.mid[index], high: shared.high[index] },
        barPos: since,
        rhythmic: !!shared.rhythmic[index],
      };
    });
  }
  const spec: number[] = [];
  const has = map.hasAudio && !!map.spec(0, spec);
  const F = 1 / 50; // (the analysis' frame)
  const tone = (t: number) => {
    const s = map.spec(t, spec) || [];
    return { low: bandMean(s, ...TONE.low), mid: bandMean(s, ...TONE.mid), high: bandMean(s, ...TONE.high) };
  };
  const rises: { low: number; mid: number; high: number }[] = [],
    rise: number[] = [],
    loud: number[] = [];
  if (has)
    for (const t of map.beats) {
      const peak = { low: 0, mid: 0, high: 0 },
        base = { low: 0, mid: 0, high: 0 };
      for (let k = -1; k <= 2; k += 1) {
        const v = tone(t + k * F);
        peak.low = Math.max(peak.low, v.low);
        peak.mid = Math.max(peak.mid, v.mid);
        peak.high = Math.max(peak.high, v.high);
      }
      for (let k = -6; k <= -2; k += 1) {
        const v = tone(t + k * F);
        base.low += v.low / 5;
        base.mid += v.mid / 5;
        base.high += v.high / 5;
      }
      const r = {
        low: Math.max(0, peak.low - base.low),
        mid: Math.max(0, peak.mid - base.mid),
        high: Math.max(0, peak.high - base.high),
      };
      rises.push(r);
      rise.push(r.low * 0.5 + r.mid * 0.3 + r.high * 0.2);
      let l = 0;
      for (let k = -12; k <= 12; k += 1) l += map.loud(t + k * F) / 25;
      loud.push(l);
    }
  const norm = (v: number[]) => {
    const lo = quantileOf(v, 0.1),
      hi = quantileOf(v, 0.9);
    return (x: number) => (hi > lo ? Math.min(1, Math.max(0, (x - lo) / (hi - lo))) : 1);
  };
  const nRise = norm(rise),
    nLoud = norm(loud),
    few = map.beats.length < 8;
  // a bar with no rhythm — sustained sound only — fires no beat effects (Folia gates on the bar's percussive share):
  // here, no drum hit off the separated drum stem within the bar around the beat; without the stem, near silence
  const D = map.a.drums,
    drums = D && D.t.length ? D.t.map((x) => x - map.offset) : null,
    bar = (60 / Math.max(30, map.bpm || 120)) * meter;
  const drumsNear = (t: number) => {
    if (!drums) return true;
    let lo = 0,
      hi = drums.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (drums[m] < t - bar / 2) lo = m + 1;
      else hi = m;
    }
    return lo < drums.length && drums[lo] <= t + bar / 2;
  };
  const out: BeatFxEvent[] = [];
  let since: number | null = null;
  for (let i = 0; i < map.beats.length; i += 1) {
    const t = map.beats[i];
    const down = map.isDownbeat(t);
    if (down) since = 0;
    else if (since !== null) since = (since + 1) % meter;
    const r = rises[i];
    const sum = r ? r.low + r.mid + r.high : 0;
    out.push({
      t,
      kind: down ? 'downbeat' : 'beat',
      impact: has
        ? few
          ? 1
          : Math.pow(0.4 * nRise(rise[i]) + 0.6 * nLoud(loud[i]), 0.7)
        : Math.min(1, map.accentAt(t)),
      ...(r
        ? {
            tone:
              sum > 0
                ? { low: r.low / sum, mid: r.mid / sum, high: r.high / sum }
                : { low: 1 / 3, mid: 1 / 3, high: 1 / 3 },
          }
        : {}),
      barPos: since,
      rhythmic: !map.hasAudio ? true : drums ? drumsNear(t) : map.loud(t) > 0.06,
    });
  }
  return out;
}

/** Installs a song's beats in the clock (once per song and rhythm). */
export function installBeats(key: string, map: RhythmMap | null) {
  if (installed && installed.key === key && installed.map === map) return;
  installed = { key, map };
  beginBeatFxTrack(key);
  if (map && map.beats.length) setBeatFxEvents(key, beatEvents(map), 'beat_this');
  // the drum hits (kick, snare, hats) the neural engine read off the separated drum stem, in song time
  const d = map?.a.drums;
  if (map && d && d.t.length) {
    const n = d.t.length;
    const times = new Float64Array(n),
      strengths = new Float32Array(n),
      kinds = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      times[i] = d.t[i] - map.offset;
      strengths[i] = d.s[i] ?? 1;
      kinds[i] = d.k[i] ?? 0;
    }
    setDrumHits(key, { times, strengths, kinds });
  } else setDrumHits(key, null);
}

/** Which of Folia's beat effects play now, and how strongly (0..2): each style asks for its own by id. */
export function setBeatEffects(strengths: Record<string, number>) {
  setBeatFxLiveEffects(strengths);
}

const heard = { paused: true, ended: false, currentTime: 0 };
const spec: number[] = [];

/**
 * One frame of the live inputs at song time `t`. Each band is the analysis' coarse spectrum read at
 * the moment (0..1; Folia's 0..255 readers accept both), the power the section-relative loudness.
 */
/** Folia's five bands and power at song time `t`, as its readers take them (0..255): each band its analyser's range
 *  read off Cadenza's coarse spectrum, raised by Folia's own curve (the power from the bass and low mids, as there);
 *  all 0 while paused. */
export function bandsAt(map: RhythmMap | null, t: number, playing: boolean) {
  const out = { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0, power: 0 };
  if (!map || !playing) return out;
  const s = map.spec(t, spec);
  if (!s || !s.length) {
    // (no spectrum — no audio analysis —: the loudness for all of them)
    const l = map.loud(t);
    out.bass = out.lowMid = out.mid = out.vocal = out.treble = l * 255;
    out.power = l ** 3 * 255;
    return out;
  }
  const v = (b: readonly [number, number]) => bandMean(s, b[0], b[1]);
  const bass = v(BANDS.bass),
    lowMid = v(BANDS.lowMid);
  out.bass = bass ** 1.8 * 255;
  out.lowMid = lowMid ** 2 * 255;
  out.mid = v(BANDS.mid) ** 2 * 255;
  out.vocal = v(BANDS.vocal) ** 1.5 * 255;
  out.treble = v(BANDS.treble) ** 2 * 255;
  out.power = ((bass + lowMid) / 2) ** 3 * 255;
  return out;
}

/** One frame of the live inputs at song time `t` (the beat clock and the bands the lyric styles read). */
export function tickLive(t: number, playing: boolean, map: RhythmMap | null) {
  heard.paused = !playing;
  heard.currentTime = t;
  tickBeatFx(heard as unknown as HTMLMediaElement, null);
  if (!map) return;
  const b = bandsAt(map, t, playing);
  bass.set(b.bass);
  lowMid.set(b.lowMid);
  mid.set(b.mid);
  vocal.set(b.vocal);
  treble.set(b.treble);
  audioPower.set(b.power);
}

export const liveBands: AudioBands = { bass, lowMid, mid, vocal, treble };
export const livePower: MotionValue<number> = audioPower;
export { isBeatFxReady };
