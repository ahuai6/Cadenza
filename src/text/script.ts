// Writing systems: which script a piece of text is in, how it breaks into graphemes, how many syllables it has.

export const RE_CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯ᄀ-ᇿ＀-￯]/;
/** shaped scripts: keep words whole */
export const RE_COMPLEX = /[֐-׿؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿ऀ-෿฀-໿က-႟]/;
export const RE_RTL = /[֐-׿؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
export const isLatin = (s: string) => !RE_CJK.test(s) && !RE_COMPLEX.test(s);
/** characters that turn sideways in vertical text */
export const ROTATE_IN_VERTICAL = new Set([...'ー～〜…‥—―-－()（）「」『』[]【】〈〉《》=＝']);

const SEG =
  typeof Intl !== 'undefined' && (Intl as any).Segmenter
    ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
    : null;
export const graphemes = (s: string): string[] => (SEG ? [...SEG.segment(s)].map((x: any) => x.segment) : [...s]);
/** the units a word is animated by: graphemes, or the whole word in shaped scripts */
export const unitsOf = (w: string) => (RE_COMPLEX.test(w) ? [w] : graphemes(w));

/** Rough syllable count, so line-timed words are paced like singing. */
export function syllables(text: string): number {
  let n = 0;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (RE_COMPLEX.test(w)) n += Math.max(1, Math.ceil(graphemes(w).length / 3));
    else if (RE_CJK.test(w)) n += Math.max(1, graphemes(w).filter((c) => !/[\p{P}\p{S}]/u.test(c)).length);
    else
      n += Math.max(1, (w.toLowerCase().match(/[aeiouyàáâäãåèéêëìíîïòóôöõùúûüœæøаеёиоуыэюяαεηιουω]+/g) || []).length);
  }
  return n;
}
