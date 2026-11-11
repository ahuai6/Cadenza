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
