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
  it('breaks words at spaces only: an unspaced line is one word, its characters still sung one at a time', () => {
    const d = buildLyrics(parse('[00:01.00]我們沿著熟悉的街道慢慢走回家\n[00:05.00]走過 這條 街\n[00:09.00]x'), map, 20);
    const w = d.lines[0].words; expect(w.map(x => x.text)).toEqual(['我們沿著熟悉的街道慢慢走回家']);
    expect(w[0].paced).toBe(true); for (let i = 1; i < w[0].units.length; i++) expect(w[0].units[i].t!).toBeGreaterThan(w[0].units[i - 1].t!);
    expect(d.lines[1].words.map(x => x.text)).toEqual(['走過', '這條', '街']);
  });
  it('chorus marks (#1 strongest, #2 or a bare #, #3 lighter) are read and never shown', () => {
    const d = buildLyrics(parse('[00:01.00]#1 夜に駆ける\n[00:04.00]走過 #3這條 街\n[00:07.00]#\n[00:08.00]<00:08.00>#2sing <00:08.50>a<00:09.00>long<00:09.50>\n[00:12.00]x'), map, 20);
    expect(d.lines.map(L => L.text)).toEqual(['夜に駆ける', '走過 這條 街', 'sing along', 'x']);
    expect(d.lines.every(L => L.words.every(W => !/[#]/.test(W.text) && W.units.every(u => !/[#]/.test(u.c))))).toBe(true);
    expect(d.marks.map(m => [m.t, m.level])).toEqual([[1, 1], [expect.any(Number), 3], [7, 2], [8, 2]].map(([a, b]) => [a, b]) as never);
    expect(d.marks[1].t).toBeGreaterThan(4);
  });
  it('a harmony in brackets goes with the word before it, its brackets never shown, its own timing kept', () => {
    const d = buildLyrics(parse('[00:01.00]I love you (love you) so\n[00:04.00]想你（想你）\n[00:07.00]<00:07.00>stay <00:07.50>(stay<00:07.80> here) <00:08.20>now<00:08.80>\n[00:12.00](oh oh)'), map, 20);
    const [a, b, c, e] = d.lines;
    expect(a.words.map(W => W.text)).toEqual(['I', 'love', 'you', 'so']); expect(a.words[2].harm!.text).toBe('love you');
    expect(b.words.map(W => W.text)).toEqual(['想你']); expect(b.words[0].harm!.text).toBe('想你');
    expect(c.words.map(W => W.text)).toEqual(['stay', 'now']); expect(c.words[0].harm!.text).toBe('stay here'); expect(c.words[0].harm!.t).toBeCloseTo(7.5, 5);
    expect(e.words.map(W => W.text)).toEqual(['oh', 'oh']);                        // a line only in brackets is sung as itself
    expect(d.lines.every(L => !/[()（）]/.test(L.text))).toBe(true);
  });
  it("an older file's '#' after a sung unit is still a word break", () => {
    const d = buildLyrics(parse('[00:00.00]<00:00.00>清<00:00.25>晨<00:00.50>的#<00:01.00>光<00:01.25>落<00:01.50>在#<00:02.00>窗<00:02.50>邊<00:03.40>\n[00:05.00]x'), map, 20);
    expect(d.lines[0].words.map(W => W.text)).toEqual(['清晨的', '光落在', '窗邊']); expect(d.marks.length).toBe(0);
  });
});

