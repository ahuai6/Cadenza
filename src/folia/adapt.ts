// Cadenza's lyrics and look, as Folia's visualizers read them. One lyric model feeds every picture:
// the lines, words, sung times and word boundaries here are the ones the director and the now-playing
// page use (the listener's own segmentation included), never a second parse.
import type { LyricDoc } from '../lyrics/model';
import type { Line as FoliaLine, Word as FoliaWord, LyricSyllable, Theme as FoliaTheme } from './vendor/types';

/** Units of a word with their sung spans: each until the next, the last until the word's end. */
function syllablesOf(units: { c: string; t: number | null }[], t0: number, end: number): LyricSyllable[] | undefined {
  if (units.length < 2 || units.some((u) => u.t === null)) return undefined;
  return units
    .map((u, i) => ({
      text: u.c,
      startTime: u.t as number,
      endTime: i + 1 < units.length ? (units[i + 1].t as number) : Math.max(end, u.t as number),
    }))
    .filter((s) => s.startTime >= t0 - 1e-6);
}

/**
 * The song's lines for a Folia visualizer. `fullText` is the words as shown with the lyrics' own
 * spaces; `wordSegments` are Cadenza's words (a listener's saved segmentation wins there already), so
 * Folia's own segmenter is never asked; a harmony becomes the line's background vocal.
 */
export function foliaLines(doc: LyricDoc): FoliaLine[] {
  return doc.lines
    .filter((L) => L.words.length > 0)
    .map((L) => {
      const segments: string[] = [];
      const words: FoliaWord[] = [];
      L.words.forEach((w, k) => {
        const shown = w.disp ?? w.text;
        const last = k === L.words.length - 1;
        const spaced = !last && (w.gap ?? (w.latin && L.words[k + 1]?.latin));
        segments.push(shown + (spaced ? ' ' : ''));
        const syl = shown === w.text ? syllablesOf(w.units, w.t, w.end) : undefined;
        words.push({ text: shown, startTime: w.t, endTime: Math.max(w.end, w.t), ...(syl ? { syllables: syl } : {}) });
      });
      const harm = L.words.map((w) => w.harm).filter((h): h is NonNullable<typeof h> => !!h);
      const t0 = L.words[0].t;
      const t1 = Math.max(L.sung, ...L.words.map((w) => w.end));
      const line: FoliaLine = {
        id: `L${L.i}`,
        words,
        startTime: t0,
        endTime: t1,
        fullText: segments.join(''),
        wordSegments: segments,
        ...(L.subs[0] ? { translation: L.subs[0] } : {}),
        ...(L.reads?.[0] ? { romanization: L.reads[0] } : {}),
      };
      if (harm.length) {
        const h = harm[0];
        const ht = h.units.find((u) => u.t !== null)?.t ?? h.t;
        line.backgroundVocal = {
          text: harm.map((x) => x.text).join(' '),
          startTime: ht,
          endTime: t1,
          words: harm.map((x) => ({ text: x.text, startTime: x.t, endTime: t1 })),
        };
      }
      return line;
    });
}

export interface LookColours {
  name: string;
  bg: string;
  text: string;
  accent: string;
  secondary: string;
  /** a CSS font family (stack) */
  font: string;
  weight?: number | null;
  /** 0..1 how much the style moves: maps onto Folia's three intensities */
  motion: number;
}

const hex = (rgb: readonly number[]) =>
  '#' +
  rgb
    .slice(0, 3)
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('');

/** A Folia theme from Cadenza's look: its colours, its lyric font and how lively its motion style is. */
export function foliaTheme(o: LookColours): FoliaTheme {
  const serif = /serif|song|ming|mincho|宋|明/i.test(o.font) && !/sans/i.test(o.font);
  const mono = /mono|code/i.test(o.font);
  return {
    name: o.name,
    backgroundColor: o.bg,
    primaryColor: o.text,
    accentColor: o.accent,
    secondaryColor: o.secondary,
    fontStyle: mono ? 'mono' : serif ? 'serif' : 'sans',
    fontFamily: o.font,
    fontFamilyStack: o.font.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')),
    ...(o.weight ? { fontWeight: o.weight } : {}),
    animationIntensity: o.motion < 0.35 ? 'calm' : o.motion > 0.75 ? 'chaotic' : 'normal',
  };
}

export { hex as rgbHex };
