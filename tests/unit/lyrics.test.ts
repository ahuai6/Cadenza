import { describe, it, expect } from 'vitest';
import { parse, parseRange } from '../../src/lyrics/parse';
import { buildLyrics, FUSE } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';

const map = RhythmMap.grid(120, 0, 120);
describe('lyrics', () => {
  it('parses plain, word-timed, repeated and translated lines', () => {
    const p = parse(`[ti:Song]\n[00:01.00]hello world\n[00:01.00]你好世界\n[00:04.00]<00:04.00>sing <00:04.50>a<00:05.00>long <00:06.00>\n[00:08.00][00:20.00]chorus line\n[00:10.00]\n[00:12.00]next`);
    expect(p.meta.ti).toBe('Song');
    expect(p.lines.map(l => l.t)).toEqual([1, 4, 8, 12, 20]);
    expect(p.lines[0].subs).toEqual(['你好世界']);
    expect(p.lines[1].kar!.map(s => s.map(u => u.c).join(''))).toEqual(['sing', 'along']);
    expect(p.lines[1].close).toBe(6);
    expect(p.lines[2].stop).toBe(10);
  });
  it('applies [offset] and the audio range', () => {
    const p = parse(`[offset:+500]\n[00:10.00]a`, 2); expect(p.lines[0].t).toBeCloseTo(7.5, 5);
    expect(parseRange('1:20-3:00')).toEqual({ a: 80, b: 180 }); expect(parseRange('')).toEqual({ a: 0, b: null });
  });
  it('fast word timing is one gesture: <25.570>１ <25.600>２ <25.630>３ share a framing group', () => {
    const d = buildLyrics(parse('[00:25.57]<00:25.570>１ <00:25.600>２ <00:25.630>３<00:25.660>'), map, 60);
    const w = d.lines[0].words; expect(w.map(x => x.text)).toEqual(['１', '２', '３']);
    expect(new Set(w.map(x => x.group)).size).toBe(1);
    expect(w[2].t - w[0].t).toBeLessThan(FUSE);
  });
  it('paces line-timed words on the beat, in order, inside the line', () => {
    const d = buildLyrics(parse('[00:02.00] 我們 沿著 街道 慢慢走\n[00:08.00] next'), map, 30);
    const w = d.lines[0].words; expect(w.length).toBe(4);
    for (let i = 1; i < w.length; i++) expect(w[i].t).toBeGreaterThan(w[i - 1].t);
    expect(w[3].t).toBeLessThan(d.lines[0].end);
    const onGrid = w.slice(1).filter(x => Math.abs(x.t * 4 - Math.round(x.t * 4)) < 0.01).length; expect(onGrid).toBeGreaterThanOrEqual(2);
    expect(d.lines[0].words[3].rest).toBeGreaterThan(1);
  });
  it('breaks an unspaced line by the beat into words of a few characters', () => {
    const d = buildLyrics(parse('[00:01.00]我們沿著熟悉的街道慢慢走回家\n[00:09.00]x'), map, 20);
    const w = d.lines[0].words; expect(w.length).toBeGreaterThan(2); for (const x of w) expect([...x.text].length).toBeLessThanOrEqual(7);
    expect(w.map(x => x.text).join('')).toBe('我們沿著熟悉的街道慢慢走回家');
  });
});
