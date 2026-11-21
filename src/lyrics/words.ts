import type { RawWord } from './parse';

export const OPEN = /[(（]/,
  CLOSE = /[)）]/,
  MARK = /^#([1-3])?/;
/** '$1' before a word: a lyric frame round it. Read as one private character from the start, so the word breaking never
 *  sees the '$' or the digit; never shown. */
export const BOX = '\uE001',
  BOX_SRC = /\$1/g,
  NO_BOX = /\uE001/g;

/** Words from a line's text: broken at spaces; '#N' before a word marks it; brackets make a harmony of the word before. */
export function plainWords(body: string): RawWord[] {
  const out: RawWord[] = [];
  let tok = '',
    harm = '',
    depth = 0,
    mark: number | undefined;
  const push = () => {
    let s = tok;
    tok = '';
    let box = false;
    for (let again = true; again; ) {
      again = false;
      const m = s.match(MARK);
      if (m) {
        mark = m[1] ? +m[1] : 2;
        s = s.slice(m[0].length);
        again = true;
      }
      if (s.startsWith(BOX)) {
        box = true;
        s = s.slice(1);
        again = true;
      }
    }
    if (s.includes(BOX)) {
      box = true;
      s = s.replace(NO_BOX, '');
    }
    // (an older file's '#' inside a word is a break)
    for (const [i, part] of s.split('#').entries()) {
      if (!part) continue;
      out.push({ text: part, ...(mark && i === 0 ? { mark } : {}), ...(box && i === 0 ? { box } : {}) });
      if (i === 0) mark = undefined;
    }
  };
  const addHarm = () => {
    const h = harm
      .replace(/\s+/g, ' ')
      .replace(/#[1-3]?/g, '')
      .replace(NO_BOX, '')
      .trim();
    harm = '';
    if (!h) return;
    const host = out[out.length - 1];
    if (host) host.harm = { text: host.harm ? host.harm.text + ' ' + h : h };
    else out.push({ text: '', harm: { text: h } });
  };
  for (const ch of body) {
    if (depth) {
      if (CLOSE.test(ch)) {
        if (--depth === 0) addHarm();
        else harm += ch;
      } else {
        if (OPEN.test(ch)) depth++;
        harm += ch;
      }
      continue;
    }
    if (OPEN.test(ch)) {
      if (tok) push();
      depth = 1;
      continue;
    }
    if (CLOSE.test(ch)) continue;
    if (/\s/.test(ch)) {
      if (tok) push();
      if (out.length) out[out.length - 1].gap = true;
      continue;
    }
    tok += ch;
  }
  if (tok) push();
  if (depth) addHarm();
  if (out.length) delete out[out.length - 1].gap;
  // a harmony before any word belongs to the first one; a line only in brackets is sung as itself
  const lead = out.findIndex((w) => w.text);
  if (lead < 0) return out.flatMap((w) => (w.harm ? plainWords(w.harm.text.replace(/[()（）]/g, ' ')) : []));
  if (lead > 0) {
    const pre = out
      .slice(0, lead)
      .map((w) => w.harm?.text)
      .filter(Boolean)
      .join(' ');
    out.splice(0, lead);
    if (pre) out[0].harm = { text: out[0].harm ? pre + ' ' + out[0].harm.text : pre };
  }
  return out;
}
