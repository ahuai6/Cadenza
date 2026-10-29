import { describe, it, expect } from 'vitest';
import { analyze, RhythmMap, Signals } from '../../src/rhythm';
import { render, groove } from './synth';

/* a pop beat that keeps hammering: a kick on every beat (four on the floor), the snare on two and four, eighth hats */
function floor(bpm: number, bars: number) {
  const b = 60 / bpm, t0 = 0.5, hits: any[] = [];
  for (let k = 0; k < bars * 4; k++) { const t = t0 + k * b; hits.push({ t, kind: 'kick', gain: 1 }); if (k % 2) hits.push({ t, kind: 'snare', gain: 0.8 }); hits.push({ t, kind: 'hat', gain: 0.5 }, { t: t + b / 2, kind: 'hat', gain: 0.35 }); }
  return { hits, end: t0 + bars * 4 * b, beats: bars * 4 };
}
describe('groove hits', () => {
  it('a steady, heavy kick shakes the frame on (nearly) every beat, not now and then', () => {
    const f = floor(124, 12), A = analyze([render({ sr: 44100, dur: f.end + 1, hits: f.hits })], 44100), s = new Signals(new RhythmMap(A, 0));
    const H = s.grooveHits().filter(h => h.t > 2 && h.t < f.end - 1), span = (f.end - 1 - 2) / (60 / 124);
    expect(H.length / span).toBeGreaterThan(0.8);
  });
  it('the small notes do not: a groove with kicks on one and three only shakes on those (and the backbeat), never on the hats', () => {
    const g = groove(120, 12), A = analyze([render({ sr: 44100, dur: g.end + 1, hits: g.hits })], 44100), s = new Signals(new RhythmMap(A, 0));
    const H = s.grooveHits().filter(h => h.t > 2 && h.t < g.end - 1), beats = (g.end - 3) / 0.5;
    expect(H.length / beats).toBeLessThanOrEqual(1.05);
    for (const h of H) { const fr = ((h.t - 0.5) / 0.5) % 1; expect(Math.min(fr, 1 - fr), `hit at ${h.t.toFixed(2)}`).toBeLessThan(0.15); }
  });
});
