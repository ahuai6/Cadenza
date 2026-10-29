import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { vertRuns } from '../../src/director/layout';
it('vert', () => { const o: string[] = [];
  for (const f of (process.env.LRCS || '').split(',')) { const p = parse(readFileSync(f, 'utf8')), map = RhythmMap.grid(112, 0.3, 300), doc = buildLyrics(p, map, Math.max(...p.lines.map(l => l.t)) + 6);
    const v = vertRuns(doc.lines); o.push(`${f.split('/').pop()}: ${doc.lines.length} lines, vertical ${[...v].join(',')} | units ${doc.lines.map(L => L.words.map(w => w.units.length).join('+')).join(' ')}`); }
  writeFileSync(require('node:os').tmpdir() + '/vert.txt', o.join('\n')); });
