import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan } from '../../src/director';
it('rolls in the fixture', () => {
  const src = readFileSync('tests/fixtures/long.lrc', 'utf8'), map = RhythmMap.grid(112, 0.3, 160), p = parse(src), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6, doc = buildLyrics(p, map, musicEnd);
  const st = normalizeStyle({ ...presetStyle('cover'), preset: 'custom', cut: 'glide' });
  const P = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
  for (const S of P.words) if (S.roll) console.log(S.w.t.toFixed(2), JSON.stringify(S.w.text), S.roll, S.carry ? [S.carry.t0.toFixed(2), S.carry.t1.toFixed(2)] : '', '| line:', S.line.L.text);
});
