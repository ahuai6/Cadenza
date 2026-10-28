import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { presetStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan } from '../../src/director';
it('num', () => {
  const src = readFileSync(process.env.LRC!, 'utf8'), map = RhythmMap.grid(120, 0, 60), p = parse(src), doc = buildLyrics(p, map, 30);
  for (const L of doc.lines) console.log(JSON.stringify({ t: L.t, end: +L.end.toFixed(2), sung: +L.sung.toFixed(2), words: L.words.map(w => ({ x: w.text, t: +w.t.toFixed(2), e: +w.end.toFixed(2), latin: w.latin, cjk: w.cjk, g: w.group, u: w.units.length })) }));
  const P = plan({ doc, map, style: presetStyle('cover'), measure: approxMeasurer(), aspect: 16 / 9, musicEnd: 30, endLen: 3.5, song: { on: true, title: 'T' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
  for (const s of P.camera.stops) console.log('stop', s.t.toFixed(2), s.words.map(w => w.w.text).join('|'), 'z', s.z.toFixed(2), 'lw', Math.round(s.words[0].lw), 's', s.words[0].s.toFixed(2));
});
