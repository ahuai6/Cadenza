import { clamp } from '../core/math';
import type { RhythmEvent, RhythmPreviewBeats, RhythmPreviewSlice, RhythmPreviewUpdate, Tier } from './types';

/** Short, append-only feature windows owned by one visual request. */
export class RhythmPreview {
  private slices: RhythmPreviewSlice[] = [];
  private beats: RhythmPreviewBeats[] = [];

  add(slice: RhythmPreviewUpdate) {
    if ('events' in slice) {
      if (slice.end <= slice.start || slice.start < (this.beats.at(-1)?.end ?? 0)) return;
      this.beats.push(slice);
      if (this.beats.length > 512) this.beats.splice(0, 16);
      return;
    }
    const prior = this.slices.at(-1);
    if (
      !Number.isFinite(slice.start) ||
      slice.start < 0 ||
      !Number.isFinite(slice.rate) ||
      slice.rate <= 0 ||
      slice.stride !== 7 ||
      !slice.samples.length ||
      slice.samples.length % slice.stride ||
      (prior && slice.start <= prior.start)
    )
      return;
    this.slices.push(slice);
    if (this.slices.length > 8192) this.slices.splice(0, 256);
  }

  private at(time: number) {
    let lo = 0,
      hi = this.slices.length;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (this.slices[m].start <= time) lo = m + 1;
      else hi = m;
    }
    const slice = this.slices[lo - 1];
    if (!slice || (time - slice.start) * slice.rate >= slice.samples.length / slice.stride) return null;
    return slice;
  }

  private read(slice: RhythmPreviewSlice, time: number, band: number) {
    const p = (time - slice.start) * slice.rate;
    const i = Math.floor(p);
    const a = slice.samples[i * slice.stride + band];
    const b = slice.samples[(i + 1) * slice.stride + band] ?? a;
    return clamp(a + (b - a) * (p - i));
  }

  level(time: number) {
    const slice = this.at(time);
    return slice ? this.read(slice, time, 0) : 0;
  }

  spectrum(time: number, out: number[]) {
    const slice = this.at(time);
    if (!slice) return null;
    out.length = slice.stride - 1;
    for (let b = 0; b < out.length; b++) out[b] = this.read(slice, time, b + 1);
    return out;
  }

  events(from: number, to: number, offset: number, tier: Tier): RhythmEvent[] {
    const start = from + offset;
    const end = to + offset;
    const events: RhythmEvent[] = [];
    let lo = 0,
      hi = this.beats.length;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (this.beats[m].end <= start) lo = m + 1;
      else hi = m;
    }
    for (let i = lo; i < this.beats.length && this.beats[i].start <= end; i++)
      for (const event of this.beats[i].events)
        if (event.t >= start && event.t <= end && event.tier >= tier) events.push({ ...event, t: event.t - offset });
    return events;
  }
}
