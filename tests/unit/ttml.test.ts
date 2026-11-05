// TTML lyrics (lyrics/ttml.ts) into the parsed lines everything else reads: timing per line or per syllable, the
// translations and readings of the head, translations written as untagged lines (placeholders dropped), background
// vocals as harmonies, lines that say when they end (and overlap), and the same model as LRC from there on.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTtml, isTtml, ttmlTime } from '../../src/lyrics/ttml';
import { parseLyrics } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';

const F = (n: string) => readFileSync(new URL(`../fixtures/ttml/${n}`, import.meta.url), 'utf8');
describe('TTML', () => {
  it('knows TTML from LRC', () => {
    expect(isTtml(F('line.ttml'))).toBe(true); expect(isTtml(F('word.ttml'))).toBe(true);
    expect(isTtml('[00:01.00]hello')).toBe(false); expect(isTtml('plain words')).toBe(false);
  });
  it('reads its times', () => {
    expect(ttmlTime('2:46.040')).toBeCloseTo(166.04, 3); expect(ttmlTime('00:02.500')).toBeCloseTo(2.5, 3); expect(ttmlTime('1:02:03.5')).toBeCloseTo(3723.5, 3);
    expect(ttmlTime('12.5s')).toBeCloseTo(12.5, 3); expect(ttmlTime('1500ms')).toBeCloseTo(1.5, 3); expect(ttmlTime('62.25')).toBeCloseTo(62.25, 3);
  });
  it('line timing: readings from the head, translations from untagged lines, placeholders dropped, lines that end', () => {
    const p = parseTtml(F('line.ttml'));
    expect(p.lines.map(L => L.text)).toEqual(['Running all the night long', '夜の街を走る', 'Holding on', 'Holding on']);
    expect(p.lines[0].reads).toEqual(['Running all the night long']); expect(p.lines[0].subs).toEqual([]);     // (待翻译: no translation)
    expect(p.lines[1].subs).toEqual(['在夜晚的街上奔跑']); expect(p.lines[1].reads).toEqual(['yoru no machi o hashiru']);
    // (brackets in a line: the harmony, as in LRC)
    expect(p.lines[2].words.map(w => w.text)).toEqual(['Holding', 'on']); expect(p.lines[2].words[1].harm?.text).toBe('君の手を');
    expect(p.lines.map(L => [L.t, L.end])).toEqual([[1, 5], [5.5, 9], [10, 16], [13.5, 16.2]]);
    expect(p.meta.au).toBe('作曲者');
  });
  it('a line sung over another stays up until its own end', () => {
    const p = parseTtml(F('line.ttml')), doc = buildLyrics(p, RhythmMap.grid(120, 0, 40), 30);
    expect(doc.lines[2].end).toBeGreaterThanOrEqual(16); expect(doc.lines[3].t).toBe(13.5);
  });
  it('word timing: syllables, spaces between them, background vocals as a harmony, translations from the head and inline', () => {
    const p = parseTtml(F('word.ttml')), [a, b] = p.lines;
    expect(a.kar).toBeTruthy(); expect(a.words.map(w => w.text)).toEqual(['清晨的', '光']);
    expect(a.words[0].units!.map(u => [u.c, u.t, u.e])).toEqual([['清晨', 2, 2.5], ['的', 2.5, 3.1]]);
    expect(a.words[1].harm?.text).toBe('啊啊'); expect(a.subs).toEqual(['The light of morning']); expect(a.close).toBeCloseTo(4.4, 3);
    expect(b.words.map(w => w.text)).toEqual(['Hello', 'world']); expect(b.subs).toEqual(['你好世界']);
  });
  it('through the one entry: TTML and LRC alike, shifted by the range start', () => {
    expect(parseLyrics(F('word.ttml'), 1).lines[0].t).toBeCloseTo(1, 3);
    expect(parseLyrics('[00:03.00]hello world', 1).lines[0].t).toBeCloseTo(2, 3);
  });
});

import { parse } from '../../src/lyrics/parse';
import { respace } from '../../src/lyrics/spacing';
describe('the lyrics\' own spaces (what the play page shows)', () => {
  it('kept through the segmenter\'s words: after a word that ends at one, inside a word that runs across one', () => {
    const p = respace(parse('[00:01.00]清晨的光 落在窗邊'), { 清晨的光落在窗邊: '清晨的 光落在窗邊' });
    const ws = p.lines[0].words.map(w => [w.text, w.disp ?? w.text, !!w.gap]);
    expect(ws).toEqual([['清晨的', '清晨的', false], ['光落在窗邊', '光 落在窗邊', false]]);
    const q = respace(parse('[00:01.00]清晨的光 落在窗邊'), { 清晨的光落在窗邊: '清晨的光 落在 窗邊' });
    expect(q.lines[0].words.map(w => [w.text, !!w.gap])).toEqual([['清晨的光', true], ['落在', false], ['窗邊', false]]);
  });
  it('word-timed lines: a space between stamped words is kept', () => {
    const p = parse('[00:01.00]<00:01.00>清晨 <00:02.00>的光<00:03.00>窗邊<00:04.00>');
    expect(p.lines[0].words.map(w => [w.text, !!w.gap])).toEqual([['清晨', true], ['的光窗邊', false]]);
  });
});
