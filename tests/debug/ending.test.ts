import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { Signals } from '../../src/rhythm/signals';
import { presetStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan, cameraAt, basePose } from '../../src/director';
it('camera around the ending', () => {
  const map = RhythmMap.grid(112, 0.3, 200), p = parse(readFileSync('tests/fixtures/long.lrc', 'utf8')), last = Math.max(...p.lines.map(l => l.t)), musicEnd = last + 12, doc = buildLyrics(p, map, musicEnd);
  for (const th of ['cover', 'liquid']) {
    const P = plan({ doc, map, style: presetStyle(th), measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } }), sig = new Signals(P.map);
    console.log(th, 'last line', last.toFixed(1), 'musicEnd', musicEnd.toFixed(1), 'dur', P.dur.toFixed(1), 'idle', JSON.stringify(P.camera.idle.slice(-1)));
    for (let t = last; t < P.dur; t += 1) { const f = cameraAt(P, sig, t, 1), b = basePose(P.camera, t);
      console.log(t.toFixed(1), 'base', b.x.toFixed(0), b.y.toFixed(0), b.z.toFixed(3), b.r.toFixed(1), '| cam', f.cam.x.toFixed(0), f.cam.y.toFixed(0), f.cam.z.toFixed(3), f.cam.r.toFixed(1), '| fx', f.fx.x.toFixed(1), f.fx.y.toFixed(1), f.fx.z.toFixed(3), 'idle', f.idle.toFixed(2), 'rest', f.rest.toFixed(2)); }
  }
});
