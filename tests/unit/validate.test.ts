// The analysis check (rhythm/validate.ts): a sound reading passes, a broken one is caught before anything plays on it.
import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/rhythm/analyze';
import { checkAnalysis } from '../../src/rhythm/validate';
import { render, groove } from './synth';

const SR = 22050,
  dur = 24,
  G = groove(120, 12) as any,
  a = analyze([render({ sr: SR, dur, hits: G.hits ?? G })], SR);
const clone = () => JSON.parse(JSON.stringify(a));
describe('analysis integrity', () => {
  it('a real analysis passes', () => {
    expect(checkAnalysis(a)).toBeNull();
    expect(checkAnalysis(a, a.duration)).toBeNull();
  });
  it('a reading of other audio, an old version, missing or broken beats are caught', () => {
    expect(checkAnalysis(a, a.duration + 30)).toMatch(/made for/);
    expect(checkAnalysis({ ...clone(), version: 1 })).toMatch(/version/);
    const b = clone();
    b.beats = [];
    expect(checkAnalysis(b)).toMatch(/no beats/);
    const c = clone();
    c.beats[5] = c.beats[3];
    expect(checkAnalysis(c)).toMatch(/backwards/);
    const d = clone();
    d.beats[2] = null;
    expect(checkAnalysis(d)).toMatch(/not a number/);
    const e = clone();
    e.tempo.bpm = e.tempo.bpm * 1.37;
    expect(checkAnalysis(e)).toMatch(/disagrees/);
    // 4.0.0-alpha.6: a song with pauses, its tempo read over spans of eight beats (as the neural engine reads it)
    const paused = clone();
    let t = 0.5;
    paused.beats = paused.beats.map((_: number, i: number) => {
      const at = t;
      t += i % 8 === 7 ? 1.0 : 0.32;
      return at;
    });
    const spans = paused.beats
      .slice(8)
      .map((b: number, i: number) => (b - paused.beats[i]) / 8)
      .sort((x: number, y: number) => x - y);
    paused.tempo.bpm = 60 / spans[spans.length >> 1];
    expect(Math.abs(paused.tempo.bpm - 187.5) / 187.5).toBeGreaterThan(0.06);
    expect(checkAnalysis(paused)).toBeNull();
    const f = clone();
    f.level[0] = null;
    expect(checkAnalysis(f)).toMatch(/level/);
    const g = clone();
    g.bars = [0, 99999];
    expect(checkAnalysis(g)).toMatch(/bar/);
    expect(checkAnalysis(null)).toBeTruthy();
    expect(checkAnalysis('x')).toBeTruthy();
  });
});
