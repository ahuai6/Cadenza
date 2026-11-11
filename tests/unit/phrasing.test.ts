// The words joined into the phrases they are sung in (lyrics/phrasing.ts): the segmenter's cuts are where a line may
// be cut, the singing picks among them.
import { describe, it, expect } from 'vitest';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { phrase, PHRASE_MAX } from '../../src/lyrics/phrasing';
import { voiceLevel } from '../../src/rhythm/neural/vocals';
import { RhythmMap } from '../../src/rhythm/map';

const map = RhythmMap.grid(120, 0, 60); // (a beat of half a second)
const words = (src: string) => buildLyrics(parse(src), map, 30).lines.map((L) => L.words.map((w) => w.text));
/** A word-timed line: [text, start] per word, one syllable per character, `step` apart within a word. */
const kar = (t: number, ws: [string, number][], step = 0.15) =>
  `[00:${String(t).padStart(2, '0')}.00]` +
  ws
    .map(([w, s]) => [...w].map((c, i) => `<00:${(s + i * step).toFixed(2).padStart(5, '0')}>${c}`).join(''))
    .join(' ') +
  `<00:${(ws[ws.length - 1][1] + 1).toFixed(2).padStart(5, '0')}>`;

describe('phrasing', () => {
  it('word-timed: words sung on without a pause are one; a pause keeps them apart', () => {
    // 我們 看過 sung straight on, a breath, then 的 故事 straight on
    const w = words(
      kar(2, [
        ['我們', 2],
        ['看過', 2.3],
        ['的', 3.6],
        ['故事', 3.75],
      ]),
    );
    expect(w[0]).toEqual(['我們看過', '的故事']);
  });
  it('a word held out and stopping short of the next keeps them apart (its end stamp)', () => {
    const src = '[00:02.00]<00:02.00>夜<00:02.15>空<00:02.30> <00:02.75>星<00:02.90>光<00:03.40>';
    expect(words(src)[0]).toEqual(['夜空', '星光']);
  });
  it('never longer than PHRASE_MAX characters, never splitting a word', () => {
    const w = words(
      kar(2, [
        ['我們', 2],
        ['沿著', 2.3],
        ['熟悉的', 2.6],
        ['街道', 3.05],
        ['慢慢走', 3.35],
      ]),
    )[0];
    for (const x of w) expect(x.length).toBeLessThanOrEqual(PHRASE_MAX);
    expect(w.join('|')).toBe('我們沿著|熟悉的街道|慢慢走');
  });
  it('line-timed: only a lone character goes with its neighbour', () => {
    expect(words('[00:02.00]走過 這條 街\n[00:06.00]我們 看過 故事')).toEqual([
      ['走過', '這條街'],
      ['我們', '看過', '故事'],
    ]);
  });
  it("Latin words, a word sung again, a harmony and the listener's own spacing are left as they are", () => {
    expect(
      words(
        kar(2, [
          ['走吧', 2],
          ['走吧', 2.3],
          ['走吧', 2.6],
        ]),
      )[0],
    ).toEqual(['走吧', '走吧', '走吧']);
    expect(words('[00:02.00]<00:02.00>sing <00:02.15>a <00:02.30>long<00:03.00>')[0]).toEqual(['sing', 'a', 'long']);
    const p = parse(
      kar(2, [
        ['我們', 2],
        ['看過', 2.3],
      ]),
    );
    p.lines[0].own = true;
    expect(phrase(p, map).lines[0].words.map((w) => w.text)).toEqual(['我們', '看過']);
  });
  it("joined, a word keeps every syllable's own time (still sung one at a time)", () => {
    const d = buildLyrics(
        parse(
          kar(2, [
            ['我們', 2],
            ['看過', 2.3],
          ]),
        ),
        map,
        30,
      ),
      W = d.lines[0].words[0];
    expect(W.text).toBe('我們看過');
    expect(W.units.map((u) => u.t)).toEqual([2, 2.15, 2.3, 2.45]);
  });
  describe('line-timed, with the voice known (the separated vocal stem)', () => {
    /** A beat grid with a voice singing over the given stretches (s). */
    const sings = (...runs: [number, number][]) =>
      Object.assign(RhythmMap.grid(120, 0, 60), {
        voice: (t: number): number | null => (runs.some(([a, b]) => t >= a && t < b) ? 0.8 : 0.02),
      });
    const cut = (src: string, m: ReturnType<typeof sings>) =>
      buildLyrics(parse(src), m, 30).lines.map((L) => L.words.map((w) => w.text));
    it("cut where the voice breathes, at the segmenter's boundary nearest the breath", () => {
      expect(cut('[00:02.00]我們 看過 的 故事\n[00:06.00]x', sings([2, 2.8], [3.2, 4]))[0]).toEqual([
        '我們看過',
        '的故事',
      ]);
    });
    it('sung in one breath: one phrase (up to PHRASE_MAX characters)', () => {
      expect(cut('[00:02.00]我們 看過 故事\n[00:06.00]x', sings([2, 3.6]))[0]).toEqual(['我們看過故事']);
    });
    it('a breath shorter than a breath (a consonant, a vibrato dip) is no cut', () => {
      expect(cut('[00:02.00]我們 看過 故事\n[00:06.00]x', sings([2, 2.7], [2.78, 3.6]))[0]).toEqual(['我們看過故事']);
    });
    it('a song without the reading: a lone character goes with its neighbour, as before', () => {
      expect(
        cut('[00:02.00]走過 這條 街\n[00:06.00]x', Object.assign(RhythmMap.grid(120, 0, 60), { voice: () => null }))[0],
      ).toEqual(['走過', '這條街']);
    });
  });
  it('the voice level off a vocal stem: 0 where it is silent, up where it sings; none for a song without singing', () => {
    const n = 44100 * 2,
      mix = new Float32Array(n),
      voc = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      mix[i] = 0.3 * Math.sin(i * 0.05);
      voc[i] = i < n / 2 ? 0.25 * Math.sin(i * 0.11) : 0;
    }
    const v = voiceLevel(voc, mix)!;
    expect(v.length).toBe(100);
    expect(Math.min(...v.slice(5, 45))).toBeGreaterThan(0.8);
    expect(Math.max(...v.slice(55, 95))).toBe(0);
    expect(
      voiceLevel(
        voc.map((x) => x * 0.001),
        mix,
      ),
    ).toBeNull();
  });
});
