import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/rhythm/analyze';
import { extendHead, HEAD_SECONDS } from '../../src/rhythm/stream';
import { checkAnalysis } from '../../src/rhythm/validate';
import { RhythmMap } from '../../src/rhythm/map';
import { render, groove } from './synth';

const SR = 22050;

describe('rhythm: streaming (a reading of the opening, carried over the song)', () => {
  const g = groove(118, 44, { sr: SR }), dur = g.end + 1, pcm = render({ sr: SR, dur, hits: g.hits });
  const head = analyze([pcm.subarray(0, HEAD_SECONDS * SR)], SR), a = extendHead(head, dur);
  it('covers the whole song and is a sound reading, marked partial', () => {
    expect(a.partial).toBe(true);
    expect(a.duration).toBeCloseTo(dur, 3);
    expect(checkAnalysis(a, dur)).toBeNull();
    expect(a.level.length).toBeGreaterThanOrEqual(Math.ceil(dur * a.rate));
    expect(a.events.some(e => e.t > dur - 5)).toBe(true);
    expect(() => new RhythmMap(a, 0)).not.toThrow();
  });
  it('a steady song: the carried beats stay on the true ones to the end', () => {
    const late = g.beats.filter(t => t > HEAD_SECONDS + 1);
    const off = late.map(t => Math.min(...a.beats.map(b => Math.abs(b - t))));
    expect(Math.max(...off)).toBeLessThan(0.07);
  });
  it('the carried bars keep the downbeats', () => {
    const m = new RhythmMap(a, 0), d = g.downs[g.downs.length - 4];
    const i = a.beats.findIndex(b => Math.abs(b - d) < 0.07);
    expect(i).toBeGreaterThan(0);
    expect(((i - a.downbeat) % a.meter + a.meter) % a.meter).toBe(0);
    expect(m.bpm).toBeGreaterThan(110);
  });
  it('a song no longer than its opening is left as it is', () => {
    const b = extendHead(head, head.duration);
    expect(b.beats).toEqual(head.beats);
    expect(b.partial).toBe(true);
  });
});
