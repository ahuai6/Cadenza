/* Where a line breaks into words. Lyrics are spaced however their source spaced them (often not at all, or at random);
   here the spaces between Chinese and Japanese characters are taken out and put back where the word segmenter
   (text/segment: jieba for Chinese, BudouX for Japanese, ICU for the rest) finds the words — 我們 看過的 故事, 君の 夢に.
   Spaces that are part of the writing stay as they are: between Latin words, around Korean words, between a CJK word
   and a Latin one.

   The listener may change any line's spacing (song data `spacing`: the line's characters, spaced as they want), and
   can go back to the segmenter's at once (the overrides dropped). Timed lines keep their timing: their units are only
   regrouped, a boundary that falls inside a timed unit is not taken. Everything that picks a word — the layout, the
   camera, the emphasis colour — reads these words. */
import { segmentText } from '../text/segment';
import type { Parsed, RawWord, RawUnit } from './parse';

/** Han, kana and their marks: the characters written without spaces between words. */
const CJ = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆〇]/u;
/** A line's characters without its spaces: the key its spacing is kept under. */
const WORDCH = /[\p{L}\p{N}]/u;
export const spacingKey = (text: string) => text.replace(/\s+/g, '');
/** Take out the spaces that stand between two Chinese/Japanese characters (no word in those scripts is spaced). */
export const unspace = (text: string) => text.replace(/(?<=\S)\s+(?=\S)/gu, (m, i: number, s: string) => (CJ.test(s[i - 1]) && CJ.test(s[i + m.length]) ? '' : m));
/** The segmenter's spacing of a line: one space between words where the writing has none (never two, never at the ends). */
export function autoSpacing(text: string): string {
  const pieces = segmentText(unspace(text.trim())); let out = '';
  for (let i = 0; i < pieces.length; i++) { const p = pieces[i];
    if (/^\s+$/.test(p)) { out += ' '; continue; }
    // (a space between two words where either is Chinese/Japanese — not before punctuation, never doubled)
    const a = out[out.length - 1], b = p[0];
    if (out && !/\s/.test(a) && WORDCH.test(a) && WORDCH.test(b) && (CJ.test(a) || CJ.test(b))) out += ' ';
    out += p; }
  return out.replace(/\s+/g, ' ').trim();
}
/** Overrides kept only where they still fit their line (same characters); the rest are dropped. */
export type Spacing = Record<string, string>;

/** The words of every line, spaced by the segmenter or by the listener. */
export function respace(p: Parsed, overrides: Spacing = {}): Parsed {
  for (const L of p.lines) {
    if (!L.words.length) continue;
    const base = L.words.map(w => w.text).join(' '), key = spacingKey(base), own = overrides[key];
    const spaced = own != null && spacingKey(own) === key ? own : autoSpacing(base);
    const want = spaced.split(/\s+/).filter(Boolean); if (!want.length) continue;
    L.words = regroup(L.words, want); if (own != null && spacingKey(own) === key) L.own = true; else delete L.own;
    if (L.kar) L.kar = L.words.map(w => w.units || []);
  }
  return p;
}
/** The line's words, cut anew into `want` (the same characters, other boundaries); timed units are never split. */
function regroup(words: RawWord[], want: string[]): RawWord[] {
  // where the new words begin, over the line's characters without spaces
  const starts = new Set<number>(); let n = 0; for (const w of want) { starts.add(n); n += w.length; }
  const timed = words.every(w => w.units && w.units.length);
  const out: RawWord[] = []; let cur: RawWord | null = null, pos = 0, spaceBefore = false;
  // (the lyrics' own spaces go along: after a new word that ends where one was, or inside one that runs across it)
  const open = () => { if (cur && spaceBefore) cur.gap = true; spaceBefore = false; cur = { text: '', disp: '', ...(timed ? { units: [] as RawUnit[] } : {}) }; out.push(cur); return cur; };
  const put = (c: string) => { if (spaceBefore) { cur!.disp += ' '; spaceBefore = false; } cur!.text += c; cur!.disp += c; };
  for (const w of words) {
    // (the new word this word's first character goes to: a new one where one begins here, else the one going on)
    const first = !cur || starts.has(pos) ? out.length : out.length - 1;
    // a new word begins only where a wanted one does and a unit (or, untimed, a character) begins — a timed unit is never
    // split, so a wanted break inside one is not taken (the words either side of it stay one)
    if (timed) for (const u of w.units!) { const c = spacingKey(u.c); if (!cur || starts.has(pos)) open(); cur!.units!.push({ ...u, sp: false }); put(c); pos += c.length; }
    else for (const ch of spacingKey(w.text)) { if (!cur || starts.has(pos)) open(); put(ch); pos++; }
    // its chorus mark with its first character, its harmony with its last
    // (its time stays its own syllable's: a new word that begins earlier must not pull the chorus earlier with it)
    if (w.box && out[first]) out[first].box = true;
    if (w.mark && out[first]) { out[first].mark ??= w.mark; const mt = w.markT ?? w.units?.[0]?.t; if (mt != null && out[first].markT == null) out[first].markT = mt; }
    if (w.harm && cur) (cur as RawWord).harm = w.harm;
    if (w.gap) spaceBefore = true;
  }
  for (const w of out) if (w.disp === w.text) delete w.disp;
  if (timed) for (const w of out) { const u = w.units![w.units!.length - 1]; if (u) u.sp = true; }
  return out.filter(w => w.text || w.harm);
}
