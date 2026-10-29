// RhythmMap: the one place every part of the app asks about the music's time. It reads an analysis in song time
// (seconds from the start of the audio range; the analysis itself is in file time) and answers: where is the beat,
// which events fall here, how loud is this part, which section is this, is a build under way. Without audio it is
// built from a tempo grid, so everything downstream works the same way.
import { bisect, clamp, sampleSeries, sstep, lerp } from '../core/math';
import type { RhythmAnalysis, RhythmEvent, Section, Tier } from './types';
import { RHYTHM_VERSION } from './types';
import { barIndexer, type BarIndexer } from './bars';

export interface BeatPos {
  /** continuous beat index (0 = first beat) */ bt: number;
  /** phase within the beat 0..1 */ phase: number;
  /** beat within the bar 0..meter-1 */ inBar: number;
  /** bar index (from the first downbeat; negative before it) */ bar: number;
  /** length of this beat in seconds */ len: number;
}
export interface SelectOptions {
  /** 0 nothing, 1 the default (the song's strong accents), 2 the most */
  sensitivity: number;
  /** minimum spacing between selected events, in beats (may depend on the event) */
  gapBeats?: number | ((e: RhythmEvent, level: number) => number);
  /** only within [t0, t1] (song time) */
  t0?: number; t1?: number;
}

export class RhythmMap {
  readonly a: RhythmAnalysis;
  readonly offset: number;              // file time at song time 0
  readonly beats: Float64Array;         // song time
  readonly events: RhythmEvent[];       // song time, sorted
  readonly evT: Float64Array;
  readonly sections: Section[];         // song time
  readonly bpm: number; readonly meter: number;
  /** bars one by one (the neural engine's), else every `meter` beats from the first downbeat */
  private barOf: BarIndexer;

  constructor(a: RhythmAnalysis, offset = 0) {
    this.a = a; this.offset = offset;
    this.beats = Float64Array.from(a.beats, b => b - offset);
    this.events = a.events.map(e => ({ ...e, t: e.t - offset, push: e.push != null ? e.push - offset : undefined }));
    this.evT = Float64Array.from(this.events, e => e.t);
    this.sections = a.sections.map(s => ({ ...s, t0: s.t0 - offset, t1: s.t1 - offset }));
    this.bpm = a.tempo.bpm; this.meter = a.meter; this.barOf = barIndexer(a.meter, a.downbeat, a.bars);
  }

  /** A map from a tempo alone (no audio): beats on a grid from beat0, downbeats every bar, a steady level. */
  static grid(bpm: number, beat0: number, duration: number, meter = 4): RhythmMap {
    const b = 60 / bpm, beats: number[] = [], events: RhythmEvent[] = [];
    let first = beat0 % b; if (first < 0) first += b;
    for (let t = first, k = 0; t < duration + b; t += b, k++) {
      beats.push(t); const inBar = k % meter;
      events.push({ t, s: inBar === 0 ? 1.4 : inBar % 2 ? 0.8 : 1.0, tier: (inBar === 0 ? 2 : 1) as Tier, band: inBar % 2 ? 'mid' : 'low', pos: inBar, off: false });
    }
    const n = Math.ceil(duration * 10) + 1;
    return new RhythmMap({ version: RHYTHM_VERSION, source: 'grid', duration, rate: 10, tempo: { bpm, confidence: 1 }, beats, meter, downbeat: 0, phrase: 0, halfTime: false,
      events, sections: [{ t0: 0, t1: duration, energy: 0.7, density: 1, drop: false }], builds: [], level: new Array(n).fill(0.7), loud: new Array(n).fill(0.7), odf: new Array(n).fill(0) });
  }
  get hasAudio() { return this.a.source !== 'grid'; }

  /** Where t falls in the beats (beyond the ends the first/last beat length continues the grid). */
  beatAt(t: number): BeatPos {
    const B = this.beats, n = B.length;
    if (n < 2) { const len = 60 / this.bpm, bt = t / len; return { bt, phase: bt - Math.floor(bt), inBar: ((Math.floor(bt) % this.meter) + this.meter) % this.meter, bar: Math.floor(bt / this.meter), len }; }
    let i = bisect(B, t), bt: number, len: number;
    if (i < 0) { len = B[1] - B[0]; bt = (t - B[0]) / len; }
    else if (i >= n - 1) { len = B[n - 1] - B[n - 2]; bt = n - 1 + (t - B[n - 1]) / len; }
    else { len = B[i + 1] - B[i]; bt = i + (t - B[i]) / len; }
    const k = Math.floor(bt), b = this.barOf(k);
    return { bt, phase: bt - k, inBar: b.inBar, bar: b.bar, len };
  }
  /** Song time of continuous beat index bt (inverse of beatAt). */
  timeOf(bt: number): number {
    const B = this.beats, n = B.length; if (n < 2) return bt * 60 / this.bpm;
    if (bt <= 0) return B[0] + bt * (B[1] - B[0]);
    if (bt >= n - 1) return B[n - 1] + (bt - (n - 1)) * (B[n - 1] - B[n - 2]);
    const i = Math.floor(bt); return B[i] + (bt - i) * (B[i + 1] - B[i]);
  }
  beatLen(t: number) { return this.beatAt(t).len; }
  /** Song time of the downbeat of bar `bar` (bar 0 = the first downbeat). */
  barTime(bar: number) { return this.timeOf(this.barOf.start(bar)); }
  /** Grid points between t0 and t1: beats subdivided into `div` parts (2: eighths, 3: triplets, 4: sixteenths). */
  grid(t0: number, t1: number, div = 2): number[] {
    const a = this.beatAt(t0), out: number[] = [];
    for (let k = Math.ceil(a.bt * div - 1e-9); ; k++) { const t = this.timeOf(k / div); if (t > t1 + 1e-9) break; if (t >= t0 - 1e-9) out.push(t); if (out.length > 10000) break; }
    return out;
  }
  /** The nearest grid point within tol (seconds), else t. */
  snap(t: number, tol: number, div = 2): number {
    let best = t, d = tol + 1e-9; for (const x of this.grid(t - tol, t + tol, div)) if (Math.abs(x - t) < d) { d = Math.abs(x - t); best = x; }
    return best;
  }
  isDownbeat(t: number, tol = 0.06) { const p = this.beatAt(t); return p.inBar === 0 && (p.phase * p.len < tol) || (p.inBar === this.barOf(Math.floor(p.bt)).len - 1 && (1 - p.phase) * p.len < tol); }

  /** Events in [t0, t1] at or above a tier. */
  eventsIn(t0: number, t1: number, minTier: Tier = 0): RhythmEvent[] {
    const out: RhythmEvent[] = []; let i = Math.max(0, bisect(this.evT, t0 - 1e-9) + 1);
    if (i > 0 && this.evT[i - 1] >= t0) i--;
    for (; i < this.events.length && this.evT[i] <= t1; i++) if (this.events[i].tier >= minTier && this.evT[i] >= t0) out.push(this.events[i]);
    return out;
  }
  /** The strongest event within tol of t (or null). */
  eventNear(t: number, tol = 0.06, minTier: Tier = 0): RhythmEvent | null {
    let best: RhythmEvent | null = null; for (const e of this.eventsIn(t - tol, t + tol, minTier)) if (!best || e.s > best.s) best = e; return best;
  }
  /** How hard the music hits at t: 0 (nothing) .. ~2. */
  accentAt(t: number, tol = 0.07): number { const e = this.eventNear(t, tol); return e ? e.s * (e.tier === 2 ? 1 : e.tier === 1 ? 0.8 : 0.5) : 0; }

  /** Song-relative level 0..1 (slow: the section's loudness) and loudness (fast). */
  level(t: number) { return sampleSeries(this.a.level, this.a.rate, t + this.offset); }
  loud(t: number) { return sampleSeries(this.a.loud, this.a.rate, t + this.offset); }
  /** The coarse spectrum at t (bands low to high, 0..1), or null without audio analysis. */
  spec(t: number, out: number[] = []): number[] | null { const S = this.a.spec; if (!S || !S.length) return null; for (let k = 0; k < S.length; k++) out[k] = sampleSeries(S[k], this.a.rate, t + this.offset); out.length = S.length; return out; }
  /** How much music is really sounding at t (0..1): soft threshold on the fast loudness; `idle` lowers it. */
  sounding(t: number, idle = 0): number { if (!this.hasAudio) return 1; const th = lerp(0.18, 0.08, idle); return sstep(clamp((this.loud(t) - th) / 0.3)); }
  section(t: number): { i: number; s: Section | null } {
    for (let i = 0; i < this.sections.length; i++) if (t >= this.sections[i].t0 && t < this.sections[i].t1) return { i, s: this.sections[i] };
    return { i: -1, s: null };
  }
  /** Inside a build: 0 outside, rising to 1 at the drop; `still` is the half beat right before the drop. */
  build(t: number): { k: number; still: number } {
    for (const [a0, a1] of this.a.builds) { const t0 = a0 - this.offset, t1 = a1 - this.offset;
      if (t >= t0 && t < t1) { const u = (t - t0) / (t1 - t0), bl = this.beatLen(t1), st = t > t1 - bl * 0.5 ? sstep(clamp((t - (t1 - bl * 0.5)) / (bl * 0.15))) : 0; return { k: u ** 1.6, still: st }; } }
    return { k: 0, still: 0 };
  }

  /** Events for triggered effects (flash, impact, glass…). The sensitivity moves the threshold through this song's own
   *  ranking of accents, never their strength: at 1 the strong tier in passages that are really playing; below 1 the
   *  strongest of those; above 1, medium accents of the louder passages join. Spacing keeps them musical. */
  select(o: SelectOptions): RhythmEvent[] {
    const s = clamp(o.sensitivity, 0, 2); if (s <= 0.02) return [];
    const t0 = o.t0 ?? -Infinity, t1 = o.t1 ?? Infinity;
    const lv = (e: RhythmEvent) => this.level(e.t);
    let cand = this.events.filter(e => e.t >= t0 && e.t <= t1);
    if (s <= 1) {
      const strong = cand.filter(e => e.tier === 2 && lv(e) >= 0.3).sort((a, b) => b.s - a.s);
      cand = strong.slice(0, Math.round(strong.length * s ** 1.3));
    } else {
      const k = s - 1;
      cand = cand.filter(e => (e.tier === 2 && lv(e) >= 0.3 * (1 - k)) || (e.tier === 1 && !e.off && lv(e) >= 0.6 - 0.2 * k && e.s >= 1.1 - 0.4 * k));
    }
    // spacing: the strongest first (drops and phrase-start accents before ordinary ones)
    cand.sort((a, b) => b.s - a.s);
    const out: RhythmEvent[] = [];
    for (const e of cand) {
      const g = typeof o.gapBeats === 'function' ? o.gapBeats(e, lv(e)) : o.gapBeats ?? 2, gap = g * this.beatLen(e.t);
      if (out.every(x => Math.abs(x.t - e.t) >= gap)) out.push(e);
    }
    return out.sort((a, b) => a.t - b.t);
  }
}
