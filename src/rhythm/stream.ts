// Streaming: a song starts at once on a quick reading of its opening, the whole reading following in the background
// (the engine puts it in place while the song plays: engine.ts trySwap). The opening's reading is extended over the
// rest of the song on its own beat — its tempo, its bars, its level — so the effects already follow the beat everywhere,
// only coarser until the whole reading arrives. It is marked partial and never kept in the cache.
import { analyzeInBackground } from './index';
import type { RhythmAnalysis, RhythmEvent, Tier } from './types';

type PCM = {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  duration: number;
  getChannelData(i: number): Float32Array;
};
/** How much of the opening is read before the song starts (s): about a third of a second of work for the built-in analysis. */
export const HEAD_SECONDS = 30;

/** The quick reading: the built-in analysis of the opening only, extended over the whole song. */
export async function analyzeHead(buf: PCM, secs = HEAD_SECONDS): Promise<RhythmAnalysis> {
  const n = Math.min(buf.length, Math.round(secs * buf.sampleRate));
  const head = {
    numberOfChannels: buf.numberOfChannels,
    sampleRate: buf.sampleRate,
    getChannelData: (i: number) => buf.getChannelData(i).subarray(0, n),
  };
  const a = await analyzeInBackground(head, undefined, { engine: 'dsp', urgent: true });
  return extendHead(a, buf.duration);
}
/** A reading of the opening carried on to `duration`: beats at its closing beat length, an accent on every beat (the
 *  downbeats strong) in its bar pattern, its level and sections held. */
export function extendHead(a: RhythmAnalysis, duration: number): RhythmAnalysis {
  if (duration <= a.duration + 0.5 || a.beats.length < 4) return { ...a, partial: true };
  // (the beat carried on is the line fitted through the opening's later beats — its period and phase from many beats, not
  // the last few, so a song in steady time stays on its beat to the end; the beats at the cut itself are left out)
  const B = a.beats.filter((t) => t < a.duration - 0.6),
    meter = a.meter || 4;
  if (B.length < 4) return { ...a, partial: true };
  const n = Math.min(48, B.length),
    i0 = B.length - n;
  let si = 0,
    st = 0,
    sii = 0,
    sit = 0;
  for (let i = i0; i < B.length; i++) {
    si += i;
    st += B[i];
    sii += i * i;
    sit += i * B[i];
  }
  const len = (n * sit - si * st) / (n * sii - si * si),
    c = (st - len * si) / n;
  const beats = [...B],
    events: RhythmEvent[] = a.events.filter((e) => e.t < a.duration - 0.6);
  for (let i = B.length, t = c + len * i; t < duration + len; i++, t = c + len * i) {
    if (t < B[B.length - 1] + len * 0.5) continue;
    beats.push(t);
    const inBar = (((i - a.downbeat) % meter) + meter) % meter;
    if (t >= a.duration - 0.6)
      events.push({
        t,
        s: inBar === 0 ? 1.3 : inBar % 2 ? 0.7 : 0.9,
        tier: (inBar === 0 ? 2 : 1) as Tier,
        band: inBar % 2 ? 'mid' : 'low',
        pos: inBar,
        off: false,
      });
  }
  const frames = Math.ceil(duration * a.rate) + 1,
    mean = (x: number[]) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : 0.6);
  const hold = (x: number[], v: number) => {
    const out = x.slice(0, frames);
    while (out.length < frames) out.push(v);
    return out;
  };
  const tail = (x: number[]) => mean(x.slice(Math.max(0, x.length - Math.round(10 * a.rate))));
  const sections = a.sections.length
    ? a.sections.map((s, i, all) => (i === all.length - 1 ? { ...s, t1: duration } : s))
    : [{ t0: 0, t1: duration, energy: 0.7, density: 1, drop: false }];
  return {
    ...a,
    duration,
    beats,
    events,
    sections,
    level: hold(a.level, tail(a.level)),
    loud: hold(a.loud, tail(a.loud)),
    odf: hold(a.odf, 0),
    ...(a.spec ? { spec: hold(a.spec as unknown as number[], 0) as unknown as number[][] } : {}),
    bars: undefined,
    accents: undefined,
    partial: true,
  };
}
