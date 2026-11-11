// A stretch without words is a rest only when the music rests: a driving outro keeps the frame shaking on the beat (it
// used to float and settle, the quietest part of the song), a quiet one still rests.
import { describe, it, expect } from 'vitest';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { Signals } from '../../src/rhythm/signals';
import { analyze } from '../../src/rhythm/analyze';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan, cameraAt } from '../../src/director';
import { render, groove, type Hit } from './synth';

const SR = 22050,
  LRC = Array.from({ length: 12 }, (_, i) => {
    const t = 2 + i * 2.5;
    return `[00:${String(Math.floor(t)).padStart(2, '0')}.${t % 1 ? '50' : '00'}]歌詞 第${i}行 測試`;
  }).join('\n');
function song(outroGain: number) {
  const g = groove(128, 48, { sr: SR }),
    hits: Hit[] = g.hits.map((h) => (h.t > 36 ? { ...h, gain: (h.gain ?? 1) * outroGain } : h)),
    dur = g.end + 1;
  const a = analyze([render({ sr: SR, dur, hits })], SR),
    map = new RhythmMap(a, 0),
    doc = buildLyrics(parse(LRC), map, dur);
  const P = plan({
    doc,
    map,
    style: normalizeStyle({ ...presetStyle('cover'), preset: 'custom', cut: 'punch' }),
    measure: approxMeasurer(),
    aspect: 16 / 9,
    musicEnd: dur,
    endLen: 3.5,
    song: { on: true, title: 'T', artist: 'A' },
    labels: { composer: 'c', lyricist: 'l', artist: 'a' },
  });
  const sig = new Signals(P.map);
  const shake = (t0: number, t1: number) => {
    let z = 0,
      n = 0;
    for (let t = t0; t < t1; t += 1 / 60) {
      const f = cameraAt(P, sig, t);
      z += Math.abs(Math.log(f.fx.z)) + Math.abs(f.fx.r) * 0.01;
      n++;
    }
    return z / n;
  };
  const rest = (t: number) => cameraAt(P, sig, t).rest;
  return { P, shake, rest };
}
describe('the outro', () => {
  const loud = song(1),
    quiet = song(0.12);
  it('driving: the frame shakes on the beat at least as hard as while the words were sung, and never rests', () => {
    expect(loud.P.camera.idle.length).toBe(1);
    expect(loud.shake(44, 80)).toBeGreaterThanOrEqual(loud.shake(8, 28));
    // (also in the seconds right after the words stop, before the camera goes idle)
    expect(loud.shake(loud.P.camera.idle[0].g + 1, loud.P.camera.idle[0].a)).toBeGreaterThan(loud.shake(8, 28) * 0.9);
    for (const t of [50, 65, 80]) expect(loud.rest(t)).toBeLessThan(0.05);
  });
  it('quiet: the picture still comes to rest', () => {
    expect(quiet.rest(70)).toBeGreaterThan(0.5);
    expect(quiet.shake(50, 80)).toBeLessThan(loud.shake(50, 80));
  });
});
