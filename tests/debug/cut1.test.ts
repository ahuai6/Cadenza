import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { presetStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan } from '../../src/director';
import { rawPose, basePose } from '../../src/director/camera';
it('cut1', () => {
  const src = readFileSync(process.env.LRC || 'tests/fixtures/long.lrc', 'utf8'), map = RhythmMap.grid(+(process.env.BPM || 120), 0, 300), p = parse(src);
  const doc = buildLyrics(p, map, 280), st = presetStyle('liquid');
  const P = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd: 280, endLen: 3.5, song: { on: true, title: 'T' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
  console.log(JSON.stringify(P.camera.cuts));
  const k = P.camera.cuts[0];
  for (const t of [k.t - 0.05, k.t - 0.017, k.t - 0.001, k.t + 0.001, k.t + 0.017, k.t + 0.05]) { const r = rawPose(P.camera, t), b = basePose(P.camera, t); console.log(t.toFixed(3), Math.round(r.x), Math.round(r.y), r.z.toFixed(3), '|', Math.round(b.x), Math.round(b.y), b.z.toFixed(3)); }
  console.log(P.camera.moves.filter(m => Math.abs(m.s - k.t) < 3).map(m => JSON.stringify({ s: m.s, a: m.a, dx: Math.round(m.dx), e: m.ease })).join('\n'));
});
