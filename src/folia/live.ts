// Folia's live inputs, written from Cadenza's rhythm: the beat clock (vendored beatFxLive, fed the
// song's beats and downbeats with their accents) and the audio bands its visualizers read. Folia
// measures these off the playing audio; here they come from the analysis every other picture uses,
// so a Folia style follows the same beats as the director, the now-playing page and the space.
import type { RhythmMap } from '../rhythm/map';
import {
  beginBeatFxTrack,
  setBeatFxEvents,
  tickBeatFx,
  isBeatFxReady,
  createBeatFxRuntime,
  withBeatFxRuntime,
} from './vendor/services/beatFx/beatFxLive';
import type { BeatFxEvent } from './vendor/services/beatFx/clock';
import type { BeatFxSourceKind } from './shim/beatFxSource';
import { audioPower, bass, lowMid, mid, vocal, treble } from './shim/motionSignals';
import { setDrumHits } from './shim/drumHits';
import { setBeatFxLiveEffects } from './vendor/services/beatFx/beatFxLive';
import type { AudioBands } from './vendor/types';
import type { MotionValue } from './shim/framerMotion';

type BeatRuntime = ReturnType<typeof createBeatFxRuntime>;
const installed = new WeakMap<BeatRuntime, { key: string; map: RhythmMap | null }>();
const defaultRuntime = createBeatFxRuntime();

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
/** Map already-analysed events into the Folia clock. The DSP path consumes published hits and their bands. */
export function beatEvents(map: RhythmMap): BeatFxEvent[] {
  if (map.a.source === 'unavailable' || map.a.beatEvidence === 'none') return [];
  const accents = map.a.accents;
  const shared = accents?.impact.length === map.beats.length ? accents : undefined;
  let since: number | null = null;
  return Array.from(map.beats, (t, index) => {
    const down = map.isDownbeat(t);
    if (down) since = 0;
    else if (since !== null) since++;
    const hit = shared ? null : map.eventNear(t);
    const band = hit?.band;
    const tone = shared
      ? { low: shared.low[index], mid: shared.mid[index], high: shared.high[index] }
      : band && band !== 'broad'
        ? { low: Number(band === 'low'), mid: Number(band === 'mid'), high: Number(band === 'high') }
        : undefined;
    return {
      t,
      kind: down ? 'downbeat' : 'beat',
      impact: shared ? shared.impact[index] : map.hasAudio ? Math.min(1, map.accentAt(t)) : 1,
      ...(tone ? { tone } : {}),
      barPos: since,
      rhythmic: shared ? !!shared.rhythmic[index] : !map.hasAudio || !!hit,
    };
  });
}
interface WorldRhythm {
  events: BeatFxEvent[];
  source: BeatFxSourceKind;
  scale: number;
  drums: Parameters<typeof setDrumHits>[1];
}
const readings = new WeakMap<RhythmMap, WorldRhythm>();
function reading(map: RhythmMap): WorldRhythm {
  const hit = readings.get(map);
  if (hit) return hit;
  const events = beatEvents(map);
  const source = map.a.source === 'grid' ? 'grid' : map.a.engine === 'neural' ? 'beat_this' : 'dsp';
  const scale = map.a.accents?.impact.length === map.beats.length ? map.a.accents.trackScale : 1;
  // the drum hits (kick, snare, hats) the neural engine read off the separated drum stem, in song time
  const d = map.a.drums;
  let drums: WorldRhythm['drums'] = null;
  if (d && d.t.length) {
    const n = d.t.length;
    const times = new Float64Array(n),
      strengths = new Float32Array(n),
      kinds = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      times[i] = d.t[i] - map.offset;
      strengths[i] = d.s[i] ?? 1;
      kinds[i] = d.k[i] ?? 0;
    }
    drums = { times, strengths, kinds };
  }
  const result = { events, source, scale, drums } satisfies WorldRhythm;
  readings.set(map, result);
  return result;
}

/** Two worlds may alternate during a fade. Convert the music data only once for each rhythm revision. */
export function installBeats(key: string, map: RhythmMap | null, runtime = defaultRuntime) {
  const previous = installed.get(runtime);
  if (previous?.key === key && previous.map === map) return;
  installed.set(runtime, { key, map });
  beginBeatFxTrack(key);
  const r = map && reading(map);
  if (r?.events.length) setBeatFxEvents(key, r.events, r.source, undefined, r.scale);
}

export class FoliaFrameMusic {
  private readonly runtime = createBeatFxRuntime();
  frame<T>(
    key: string,
    map: RhythmMap,
    strengths: Record<string, number>,
    time: number,
    playing: boolean,
    measured: number[] | undefined,
    draw: () => T,
  ): T {
    return withBeatFxRuntime(this.runtime, () => {
      installBeats(key, map, this.runtime);
      setDrumHits(key, reading(map).drums);
      setBeatEffects(strengths);
      tickLive(time, playing, map, measured);
      try {
        return draw();
      } finally {
        setDrumHits(key, null);
      }
    });
  }
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
export function bandsAt(map: RhythmMap | null, t: number, playing: boolean, measured?: number[]) {
  const out = { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0, power: 0 };
  if (!map || !playing) return out;
  const s = measured ?? map.spec(t, spec);
  if (!s || !s.length) {
    // Loudness can still drive overall power. Missing frequency bands stay unknown.
    const l = map.loud(t);
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
export function tickLive(t: number, playing: boolean, map: RhythmMap | null, measured?: number[]) {
  heard.paused = !playing;
  heard.currentTime = t;
  tickBeatFx(heard as unknown as HTMLMediaElement, null, t);
  const b = bandsAt(map, t, playing, measured);
  bass.set(b.bass);
  lowMid.set(b.lowMid);
  mid.set(b.mid);
  vocal.set(b.vocal);
  treble.set(b.treble);
  audioPower.set(b.power);
}

export const liveBands: AudioBands = { bass, lowMid, mid, vocal, treble };
export const livePower: MotionValue<number> = audioPower;
export function sonnetLineLift(map: RhythmMap, t: number, playing: boolean): number {
  if (!playing) return 0;
  let smoothed = 0;
  // Same attack/release as the upstream 60 Hz reader. Bounded history makes a seek reproducible.
  for (let i = 54; i >= 0; i--) {
    const bands = map.spec(t - i / 60, spec);
    const treble = bands ? bandMean(bands, ...BANDS.treble) ** 2 : 0;
    const target = Math.min(1, Math.max(0, (treble - 0.04) / 0.35));
    smoothed += (target - smoothed) * (target > smoothed ? 0.25 : 0.08);
  }
  return smoothed;
}
export { isBeatFxReady };
