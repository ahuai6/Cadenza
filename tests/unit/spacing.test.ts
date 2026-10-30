// Word spacing: the segmenter's (Folia's icu-folia: jieba, BudouX, ICU), the listener's overrides, timed lines regrouped.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadSegmenter } from '../../src/text/segment';
import { autoSpacing, respace, spacingKey, unspace } from '../../src/lyrics/spacing';
import { parse } from '../../src/lyrics/parse';

beforeAll(async () => { expect(await loadSegmenter()).toBe(true); });
describe('spacing', () => {
  it('Chinese by dictionary words, its particles kept on their word', () => {
    expect(autoSpacing('我們看過的故事')).toBe('我們 看過的 故事');
    expect(autoSpacing('天和地')).toBe('天 和 地');
  });
  it('the source\'s own spaces between CJK characters are taken out first (never random)', () => {
    expect(unspace('我 們看 過的故事')).toBe('我們看過的故事');
    expect(autoSpacing('我 們看 過的故 事')).toBe(autoSpacing('我們看過的故事'));
  });
  it('Japanese by bunsetsu', () => { expect(autoSpacing('君の夢に会いたい')).toBe('君の 夢に 会いたい'); });
  it('Latin and Korean keep their own spaces, mixed lines keep the boundary between scripts', () => {
    expect(autoSpacing('rock-and-roll  tonight')).toBe('rock-and-roll tonight');
    expect(autoSpacing('사랑해 너를')).toBe('사랑해 너를');
    expect(autoSpacing('Baby我想你')).toBe('Baby 我 想 你');
  });
  it('an untimed line becomes the segmenter\'s words; an override of the line wins while it fits it', () => {
    const p = respace(parse('[00:01.00]我們看過的故事\n[00:05.00]天和地'));
    expect(p.lines[0].words.map(w => w.text)).toEqual(['我們', '看過的', '故事']);
    const q = respace(parse('[00:01.00]我們看過的故事'), { [spacingKey('我們看過的故事')]: '我們看過 的故事' });
    expect(q.lines[0].words.map(w => w.text)).toEqual(['我們看過', '的故事']);
    const r = respace(parse('[00:01.00]我們看過的故事'), { [spacingKey('我們看過的故事')]: '別的 字' });
    expect(r.lines[0].words.map(w => w.text)).toEqual(['我們', '看過的', '故事']);
  });
  it('a timed line keeps every unit and its time, only regrouped (never split inside a unit)', () => {
    const p = respace(parse('[00:01.00]<00:01.00>我<00:01.30>們<00:01.60>看<00:01.90>過<00:02.10>的<00:02.40>故<00:02.70>事<00:03.00>'));
    const ws = p.lines[0].words; expect(ws.map(w => w.text)).toEqual(['我們', '看過的', '故事']);
    expect(ws.flatMap(w => w.units!.map(u => u.t))).toEqual([1, 1.3, 1.6, 1.9, 2.1, 2.4, 2.7]);
    const q = respace(parse('[00:01.00]<00:01.00>我們看<00:01.60>過的<00:02.10>故事<00:03.00>'));
    expect(q.lines[0].words.map(w => w.text)).toEqual(['我們看過的', '故事']);   // (看 and 們 share a unit: no break between them)
  });
});

describe('a chorus mark inside a regrouped word', () => {
  it('keeps its own syllable\'s time when the segmenter joins it to the syllables before', async () => {
    const { buildLyrics } = await import('../../src/lyrics/model'), { RhythmMap } = await import('../../src/rhythm/map');
    const p = respace(parse('[00:20.00]<00:20.00>ずっと<00:20.80>そばに<00:21.40>あな<00:21.93>#1た<00:22.40>と<00:23.00>'));
    const W = p.lines[0].words.find(w => w.mark)!;
    expect(W.text.length).toBeGreaterThan(1);               // (joined: the mark's word begins before its syllable)
    const d = buildLyrics(p, RhythmMap.grid(112, 0.3, 160), 30);
    expect(d.marks[0].t).toBeCloseTo(21.93, 2); expect(d.marks[0].exact).toBe(true);
  });
});
