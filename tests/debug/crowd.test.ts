import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan } from '../../src/director';
it('crowd', () => {
  const out: string[] = [];
  for (const f of (process.env.LRCS || '').split(',')) { const src = readFileSync(f, 'utf8');
    const map = RhythmMap.grid(112, 0.3, 300), p = parse(src), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6, doc = buildLyrics(p, map, musicEnd);
    for (const th of ['cover', 'liquid']) { const st = normalizeStyle({ ...presetStyle(th), preset: 'custom' });
      const P = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
      const st2 = [0, ...P.passages.map(q => q.line).sort((a, b) => a - b), P.lines.length]; let mx = 0; for (let i = 1; i < st2.length; i++) mx = Math.max(mx, st2[i] - st2[i - 1]);
      out.push(`${f.split('/').pop()} ${th} lines ${P.lines.length} passages ${P.passages.map(q => q.line + ':' + q.reason).join(' ')} maxRun ${mx}`);
      const gaps = P.lines.slice(1).map((L, i) => (L.words[0]?.show ?? L.L.t) - Math.min(P.lines[i].L.sung, P.lines[i].L.end)); out.push('gaps ' + gaps.map(g => g.toFixed(2)).join(' ')); } }
  writeFileSync(require('node:os').tmpdir() + '/crowd.txt', out.join('\n'));
});
