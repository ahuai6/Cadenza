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

/** The beat list the clock fires: every beat, the bar's first as a downbeat, with how hard it lands. */
export function beatEvents(map: RhythmMap): BeatFxEvent[] {
  const out: BeatFxEvent[] = [];
  const meter = Math.max(1, map.meter || 4);
  let since: number | null = null;
  for (let i = 0; i < map.beats.length; i += 1) {
    const t = map.beats[i];
    const down = map.isDownbeat(t);
    if (down) since = 0;
    else if (since !== null) since = (since + 1) % meter;
    const accent = map.accentAt(t);
    out.push({
      t,
      kind: down ? 'downbeat' : 'beat',
      impact: Math.min(1, accent),
      barPos: since,
      rhythmic: map.hasAudio ? map.loud(t) > 0.06 : true,
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
export function tickLive(t: number, playing: boolean, map: RhythmMap | null) {
  heard.paused = !playing;
  heard.currentTime = t;
  tickBeatFx(heard as unknown as HTMLMediaElement, null);
  if (!map) return;
  const s = map.spec(t, spec);
  const n = s?.length ?? 0;
  const band = (lo: number, hi: number) => {
    if (!s || !n) return 0;
    let v = 0,
      c = 0;
    for (let k = Math.floor(lo * n); k < Math.max(Math.floor(lo * n) + 1, Math.ceil(hi * n)); k += 1) {
      v += s[Math.min(n - 1, k)];
      c += 1;
    }
    return c ? v / c : 0;
  };
  const playingK = playing ? 1 : 0;
  bass.set(band(0, 0.18) * playingK);
  lowMid.set(band(0.18, 0.34) * playingK);
  mid.set(band(0.34, 0.55) * playingK);
  vocal.set((map.voice(t) ?? band(0.5, 0.72)) * playingK);
  treble.set(band(0.72, 1) * playingK);
  audioPower.set(map.loud(t) * playingK);
}

export const liveBands: AudioBands = { bass, lowMid, mid, vocal, treble };
export const livePower: MotionValue<number> = audioPower;
export { isBeatFxReady };
