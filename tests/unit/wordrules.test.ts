// The word rules (lyrics/rules.ts), on the words as finally cut: the first — a line ending in one Han character left on
// its own (the singing breathes before it, or the listener spaced it so) sets that character apart: bigger, nearer
// than every word of its line before it, and so drawn over them.
import { describe, it, expect } from 'vitest';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan } from '../../src/director';

const map = RhythmMap.grid(112, 0.3, 60);
const mk = (src: string) => {
  const p = parse(src),
    doc = buildLyrics(p, map, 20);
  return {
    doc,
    P: plan({
      doc,
      map,
      style: normalizeStyle({ ...presetStyle('cover'), preset: 'custom' }),
      measure: approxMeasurer(),
      aspect: 16 / 9,
      musicEnd: 20,
      endLen: 3.5,
      song: { on: true, title: 'T', artist: 'A' },
      labels: { composer: 'c', lyricist: 'l', artist: 'a' },
    }),
  };
};

describe('word rules', () => {
  it('a lone Han character ending a line: its own word, bigger, nearer and over the line', () => {
    // (word-timed, with a pause before the last character: the singing leaves it on its own)
    const { doc, P } = mk(
      '[00:01.00]<00:01.00>我<00:01.30>們 <00:01.60>一<00:01.90>起 <00:03.20>走<00:03.60>\n[00:05.00]<00:05.00>天<00:05.30>空 <00:05.60>好<00:05.90>藍<00:06.20>\n[00:09.00]<00:09.00>那<00:09.30>天 <00:09.60>下<00:09.90>著 <00:11.20>雨<00:11.60>',
    );
    expect(doc.lines[0].words.map((w) => w.text)).toEqual(['我們一起', '走']);
    expect(doc.lines[0].words[1].lift?.rule).toBe('trailing-han');
    expect(doc.lines[1].words.some((w) => w.lift)).toBe(false); // (no lone character at the end)
    for (const i of [0, 2]) {
      const ws = P.lines[i].words,
        last = ws[ws.length - 1],
        rest = ws.slice(0, -1);
      expect(last.s).toBeGreaterThan(Math.max(...rest.map((S) => S.s)) * 1.1);
      expect(last.d).toBeLessThan(Math.min(...rest.map((S) => S.d)));
      expect(last.order).toBeGreaterThan(Math.max(...rest.map((S) => S.order)));
    }
  });
  it('not a Latin letter, not a line of one word, not a line with no Han before it', () => {
    const { doc } = mk('[00:01.00]hello world a\n[00:05.00]走\n[00:09.00]ねえ 君');
    expect(doc.words.some((w) => w.lift)).toBe(false);
  });
  it('the same lyrics read again (a rebuild) set it apart once, not twice', () => {
    const p = parse('[00:01.00]<00:01.00>我<00:01.30>們 <00:01.60>一<00:01.90>起 <00:03.20>走<00:03.60>');
    buildLyrics(p, map, 20);
    const d2 = buildLyrics(p, map, 20);
    expect(d2.lines[0].words[1].lift?.scale).toBe(1.2);
  });
});
describe('word rules: the phrases first', () => {
  it('a lone character the singing joins to its neighbour is no longer alone: nothing is set apart', () => {
    const doc = buildLyrics(parse('[00:01.00]我們 一起 走'), map, 20);
    expect(doc.lines[0].words.map((w) => w.text)).toEqual(['我們', '一起走']);
    expect(doc.words.some((w) => w.lift)).toBe(false);
  });
});
