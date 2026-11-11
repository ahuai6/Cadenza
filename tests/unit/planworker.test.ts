// Planning off the page's thread (engine/plan.worker.ts) lays the words out from a table the page measured beforehand
// (director/plan.ts, measuresFor). The plan must be exactly the one made with the measurer itself — for every camera
// style, lyric type and exit (the spread exit lays words out letter by letter) — and the table must hold every word
// the layout asks for. The plan also crosses to the page by structured clone: it must survive one unchanged.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer, tableMeasurer } from '../../src/text/metrics';
import { plan, measuresFor } from '../../src/director';

const LRC = readFileSync(new URL('../fixtures/long.lrc', import.meta.url), 'utf8');
// (a few lines of other scripts and a harmony, so upright CJK columns, right-to-left words and Latin words come up)
const MIXED =
  LRC +
  '\n[03:10.00]夜空 の 星 (ほし)\n[03:14.00]hello world again\n[03:18.00]مرحبا بالعالم\n[03:22.00]한국어 노래 가사';
function inputs(cut: string, ltype: string, tout?: string) {
  const map = RhythmMap.grid(112, 0.3, 260),
    p = parse(MIXED),
    musicEnd = Math.max(...p.lines.map((l) => l.t)) + 6;
  const doc = buildLyrics(p, map, musicEnd),
    base = presetStyle('cover');
  const style = normalizeStyle({ ...base, preset: 'custom', cut, ltype, ...(tout ? { tout } : {}) } as any);
  return {
    doc,
    map,
    style,
    aspect: 16 / 9,
    musicEnd,
    endLen: 3.5,
    song: { on: true, title: 'T', artist: 'A' },
    labels: { composer: 'c', lyricist: 'l', artist: 'a' },
  };
}
const strip = (p: any) => {
  const { map: _m, style: _s, ...rest } = p;
  return rest;
};

describe('planning from a measured table', () => {
  it.each([
    ['glide', 'flow'],
    ['punch', 'flow'],
    ['waltz', 'flow'],
    ['close', 'flow'],
    ['hover', 'orbit'],
    ['center', 'line'],
    ['glide', 'flow', 'spread'],
  ] as [string, string, string?][])('is the same plan (%s, %s, %s)', (cut, ltype, tout) => {
    const inp = inputs(cut, ltype, tout),
      m = approxMeasurer();
    const direct = plan({ ...inp, measure: m });
    let miss = 0;
    const table = measuresFor(inp.doc, inp.style, m);
    const fromTable = plan({ ...inp, measure: tableMeasurer(table, () => miss++) });
    expect(miss).toBe(0);
    expect(strip(fromTable)).toEqual(strip(direct));
  });
  it('survives the trip to the page unchanged (structured clone)', () => {
    const inp = inputs('glide', 'flow'),
      p = plan({ ...inp, measure: approxMeasurer() });
    const back = structuredClone(strip(p));
    expect(back).toEqual(strip(p));
    // (its words still point at their own lines, as on the page)
    expect(back.words.every((S: any) => back.lines.includes(S.line))).toBe(true);
  });
});
