// An analysis as stored may carry values that are not numbers (a NaN written to JSON reads back as null; a beat list that
// steps back). Every frame reads it, and one NaN in the frame's transform made the canvas ignore what was drawn: the
// picture stuck, the play page's backdrop black, no error. RhythmMap puts such an analysis right as it reads it.
import { describe, it, expect } from 'vitest';
import { RhythmMap, repairAnalysis } from '../../src/rhythm/map';
import { Signals } from '../../src/rhythm/signals';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { presetStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan, cameraAt } from '../../src/director';

const finite = (o: any): boolean => Object.values(o).every(v => typeof v !== 'number' || Number.isFinite(v));
function broken() {
  const g = RhythmMap.grid(120, 0.25, 60).a, a: any = JSON.parse(JSON.stringify({ ...g, source: 'dsp' }));
  a.beats[40] = null; a.beats[41] = a.beats[39]; a.beats.splice(60, 0, 3);                // (a null beat, one repeated, one stepping back)
  a.loud = a.loud.map((v: number, i: number) => (i % 37 === 0 ? null : v)); a.level[100] = NaN; a.events.push({ t: NaN, s: 1, tier: 2, band: 'low' });
  return a;
}
describe('an analysis with values that are not numbers', () => {
  it('is put right as it is read (and a sound one left as it is)', () => {
    const { a, fixes } = repairAnalysis(broken());
    expect(fixes.length).toBeGreaterThan(0);
    for (let i = 1; i < a.beats.length; i++) expect(a.beats[i]).toBeGreaterThan(a.beats[i - 1]);
    expect(Array.from(a.loud as ArrayLike<number>).every(Number.isFinite)).toBe(true);
    const sound = RhythmMap.grid(120, 0.25, 60).a; expect(repairAnalysis(sound).a).toBe(sound);
  });
  it('gives a finite camera and rhythm sample at every moment', () => {
    const map = new RhythmMap(broken()), doc = buildLyrics(parse('[00:02.00]hello there\n[00:10.00]きゃきゃきゃきゃきゃきゃきゃきゃ……きゃぴ\n[00:20.00]end'), map, 40);
    const P = plan({ doc, map, style: presetStyle('cover'), measure: approxMeasurer(), aspect: 16 / 9, musicEnd: 40, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
    const sig = new Signals(P.map);
    for (let t = 0; t < 40; t += 0.05) { const f = cameraAt(P, sig, t, 1); expect(finite(f.cam) && finite(f.fx) && finite(f.cont) && finite(f.rs), `t=${t.toFixed(2)}`).toBe(true); }
  });
});
