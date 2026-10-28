// Writing systems: which script a piece of text is in, how it breaks into graphemes and words.

export const RE_CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯ᄀ-ᇿ＀-￯]/;
/** shaped scripts: keep words whole */
export const RE_COMPLEX = /[֐-׿؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿ऀ-෿฀-໿က-႟]/;
export const RE_RTL = /[֐-׿؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
export const isLatin = (s: string) => !RE_CJK.test(s) && !RE_COMPLEX.test(s);
/** characters that turn sideways in vertical text */
export const ROTATE_IN_VERTICAL = new Set([...'ー～〜…‥—―-－()（）「」『』[]【】〈〉《》=＝']);
export const PUNCT = /[，,、。．.!！?？;；:：…\s]/;

const SEG = typeof Intl !== 'undefined' && (Intl as any).Segmenter ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' }) : null;
export const graphemes = (s: string): string[] => (SEG ? [...SEG.segment(s)].map((x: any) => x.segment) : [...s]);
/** the units a word is animated by: graphemes, or the whole word in shaped scripts */
export const unitsOf = (w: string) => (RE_COMPLEX.test(w) ? [w] : graphemes(w));

const WSEGS = new Map<string, any>();
const wordSeg = (l: string) => { if (!WSEGS.has(l)) { try { WSEGS.set(l, (Intl as any).Segmenter ? new (Intl as any).Segmenter(l, { granularity: 'word' }) : null); } catch { WSEGS.set(l, null); } } return WSEGS.get(l); };
/** Grapheme offsets where a word ends, from the dictionary segmenter (Chinese, Japanese, Thai have no spaces):
 *  offset → cost of breaking there (0 between words, 2 between two lone characters, often a compound it missed). */
export function wordBreaks(text: string): Map<number, number> {
  const l = /[぀-ヿ]/.test(text) ? 'ja' : /[฀-๿]/.test(text) ? 'th' : /[가-힯]/.test(text) ? 'ko' : 'zh';
  const sg = wordSeg(l), out = new Map<number, number>(); if (!sg) return out;
  let g = 0, prev = 0;
  for (const x of sg.segment(text)) { const n = graphemes(x.segment).length; if (g) out.set(g, prev === 1 && n === 1 ? 2 : 0); g += n; prev = n; }
  return out;
}
/** Split n units into chunks close to `target` long (never over `max`); cut(i) is the cost of a break before unit i. */
export function chunkDP(n: number, target: number, max: number, cut: (i: number) => number): [number, number][] {
  const best = new Float64Array(n + 1).fill(Infinity), from = new Int32Array(n + 1).fill(-1); best[0] = 0;
  for (let j = 1; j <= n; j++) for (let i = Math.max(0, j - max); i < j; i++) {
    if (best[i] === Infinity) continue; const L = j - i;
    const c = best[i] + 0.5 * (L - target) ** 2 + (L === 1 ? 6 : 0) + (i > 0 ? cut(i) : 0);
    if (c < best[j]) { best[j] = c; from[j] = i; }
  }
  const out: [number, number][] = []; for (let j = n; j > 0; j = from[j]) out.unshift([from[j], j]); return out;
}
/** A long run of CJK (or Thai) without spaces, broken at punctuation and word boundaries into balanced chunks. */
export function splitWord(w: string): string[] {
  const g = graphemes(w), thai = /[฀-๿]/.test(w);
  if (!(RE_CJK.test(w) || thai) || g.length <= (thai ? 14 : 7)) return [w];
  const wb = wordBreaks(w), cut = (i: number) => (PUNCT.test(g[i - 1]) ? -3 : wb.has(i) ? wb.get(i)! : thai ? 40 : 8);
  return chunkDP(g.length, thai ? 9 : 4.5, thai ? 16 : 7, cut).map(([a, b]) => g.slice(a, b).join(''));
}
/** Rough syllable count, so line-timed words are paced like singing. */
export function syllables(text: string): number {
  let n = 0;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (RE_COMPLEX.test(w)) n += Math.max(1, Math.ceil(graphemes(w).length / 3));
    else if (RE_CJK.test(w)) n += Math.max(1, graphemes(w).filter(c => !/[\p{P}\p{S}]/u.test(c)).length);
    else n += Math.max(1, (w.toLowerCase().match(/[aeiouyàáâäãåèéêëìíîïòóôöõùúûüœæøаеёиоуыэюяαεηιουω]+/g) || []).length);
  }
  return n;
}
