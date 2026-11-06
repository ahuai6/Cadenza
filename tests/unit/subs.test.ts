// A line's sub-lines as shown (lyrics/subs.ts): bracketed parts of a translation on a line of their own, readings that
// only repeat the line left out (or all readings, when the play page hides them), romaji told from a translation; and
// the camera's frame (director/layout.ts boxIn) holding a word's harmony as well as the word.
import { describe, it, expect } from 'vitest';
import { splitBrackets, sameAsLine, looksRomaji, subLines } from '../../src/lyrics/subs';
import { boxIn, harmBox } from '../../src/director/layout';

describe('sub-lines', () => {
  it('splits a translation\'s bracketed part off', () => {
    expect(splitBrackets('我愛你（我愛你）')).toEqual({ main: '我愛你', harm: '我愛你' });
    expect(splitBrackets('hold on (hold on) to me (yeah)')).toEqual({ main: 'hold on to me', harm: 'hold on yeah' });
    expect(splitBrackets('no brackets')).toEqual({ main: 'no brackets', harm: '' });
    expect(splitBrackets('(all bracketed)')).toEqual({ main: '', harm: 'all bracketed' });
  });
  it('leaves out a reading that only repeats the line', () => {
    expect(sameAsLine('Hello, World!', 'hello world')).toBe(true);
    expect(sameAsLine('ｈｅｌｌｏ', 'hello')).toBe(true);
    expect(sameAsLine('yoru no sora', '夜の空')).toBe(false);
    const L = { text: 'hello world', reads: ['Hello world', 'helo'], subs: ['你好世界（世界）'] };
    expect(subLines(L)).toEqual([{ s: '你好世界', kind: 'sub' }, { s: '世界', kind: 'harm' }, { s: 'helo', kind: 'read' }]);
    expect(subLines(L, false)).toEqual([{ s: '你好世界', kind: 'sub' }, { s: '世界', kind: 'harm' }]);
    // (a reading's brackets as well)
    expect(subLines({ text: '夜空 (星)', reads: ['yozora (hoshi)'], subs: [] })).toEqual([{ s: 'yozora', kind: 'read' }, { s: 'hoshi', kind: 'harm' }]);
  });
  it('tells romaji from a translation (kana lines only)', () => {
    expect(looksRomaji('yozora no hoshi ga kirakira', '夜空の星がきらきら')).toBe(true);
    expect(looksRomaji('kyakyakya kyapi', 'きゃきゃきゃきゃぴ')).toBe(true);
    expect(looksRomaji('the stars in the night sky', '夜空の星がきらきら')).toBe(false);
    expect(looksRomaji('夜空的星星', '夜空の星がきらきら')).toBe(false);
    expect(looksRomaji('yozora no hoshi', 'night sky stars')).toBe(false);   // (not a kana line)
  });
});

describe('the camera frames harmonies', () => {
  it('holds a word\'s harmony in its box', () => {
    const S = { x: 0, y: 0, lw: 100, lh: 40, tilt: 0, s: 1, w0: 100, h0: 40, harm: { w0: 160, h0: 40 } };
    const h = harmBox(S)!, b = boxIn([S], 0, 0, true), plain = boxIn([{ ...S, harm: null } as unknown as typeof S], 0, 0, true);
    expect(b.h).toBeGreaterThan(plain.h);
    // (right under the word, its first character under the word's first: their left edges line up)
    expect(h.y - h.lh / 2).toBeGreaterThan(S.y + S.lh / 2 - 1e-6); expect(Math.abs((h.x - h.lw / 2) - (S.x - S.lw / 2))).toBeLessThan(1e-6);
    // (every corner of the harmony inside the frame)
    expect(b.x + b.w / 2).toBeGreaterThanOrEqual(h.x + h.lw / 2 - 1e-6);
    expect(b.y + b.h / 2).toBeGreaterThanOrEqual(h.y + h.lh / 2 - 1e-6);
  });
});
