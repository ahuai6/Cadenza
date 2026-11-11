import { describe, it, expect } from 'vitest';
import { analyze, RhythmMap, Signals } from '../../src/rhythm';
import { render, groove } from './synth';

const g = groove(120, 16),
  A = analyze([render({ sr: 44100, dur: g.end + 1, hits: g.hits })], 44100);

describe('RhythmMap', () => {
  const m = new RhythmMap(A, 0.5); // song time 0 = 0.5 s into the file (the first beat)
  it('reads beats in song time', () => {
    const p = m.beatAt(1.0);
    expect(Math.abs(p.bt - Math.round(p.bt))).toBeLessThan(0.05);
    expect(p.len).toBeCloseTo(0.5, 1);
    expect(m.timeOf(m.beatAt(3.37).bt)).toBeCloseTo(3.37, 3);
  });
  it('gives the grid and snaps to it', () => {
    const gr = m.grid(0, 2, 2);
    expect(gr.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < gr.length; i++) expect(gr[i] - gr[i - 1]).toBeCloseTo(0.25, 1);
    expect(Math.abs(m.snap(1.03, 0.1) - 1.0)).toBeLessThan(0.02);
  });
  it('selects more events as sensitivity rises, never fewer', () => {
    const n = [0.3, 0.7, 1, 1.5, 2].map((s) => m.select({ sensitivity: s, gapBeats: 1 }).length);
    for (let i = 1; i < n.length; i++) expect(n[i]).toBeGreaterThanOrEqual(n[i - 1]);
    expect(m.select({ sensitivity: 0, gapBeats: 1 }).length).toBe(0);
    const sel = m.select({ sensitivity: 1, gapBeats: 2 });
    for (let i = 1; i < sel.length; i++) expect(sel[i].t - sel[i - 1].t).toBeGreaterThanOrEqual(2 * 0.5 - 0.02);
  });
  it('works the same without audio (a tempo grid)', () => {
    const gm = RhythmMap.grid(100, 0.2, 30);
    expect(gm.hasAudio).toBe(false);
    expect(gm.beatAt(0.2 + 0.6 * 3).bt).toBeCloseTo(3, 3);
    expect(gm.sounding(5)).toBe(1);
    expect(gm.select({ sensitivity: 1, gapBeats: 1 }).length).toBeGreaterThan(5);
  });
});

describe('Signals', () => {
  const s = new Signals(new RhythmMap(A, 0));
  it('is a pure function of time (any order, same values)', () => {
    const ts = [5.3, 2.1, 7.77, 2.1, 5.3];
    const v = ts.map((t) => s.coneAt(t).z);
    expect(v[0]).toBe(v[4]);
    expect(v[1]).toBe(v[3]);
  });
  it('the cone pushes out fast after a strong hit and rebounds once, a little', () => {
    const e = s.map.events.find((x) => x.tier === 2 && x.t > 2)!;
    const at = (dt: number) => s.coneAt(e.t + dt).z;
    const peak = Math.max(...[0.04, 0.06, 0.08, 0.1, 0.12].map(at));
    expect(peak).toBeGreaterThan(0.3);
    let tp = 0,
      best = -1;
    for (let dt = 0; dt < 0.3; dt += 0.005) {
      const v = at(dt);
      if (v > best) {
        best = v;
        tp = dt;
      }
    }
    expect(tp).toBeGreaterThan(0.04);
    expect(tp).toBeLessThan(0.14);
  });
  it('pulse stays in 0..1', () => {
    for (let t = 0; t < 20; t += 0.05) {
      const p = s.pulse(t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});
