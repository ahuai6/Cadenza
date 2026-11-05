/* A line's sub-lines as they are shown — on the play page and in the effect lyrics' captions alike: its translations
   with their readings (romanisation, kana) under them, a translation's part in brackets on a line of its own (shown as a
   harmony is: smaller, softer), and a reading that only repeats the line (an English line "read" as itself) left out. */
export type SubKind = 'read' | 'sub' | 'harm';
export interface SubLine { s: string; kind: SubKind }

const OPEN = /[(（]/, CLOSE = /[)）]/;
/** A translation's main text and its bracketed part(s). */
export function splitBrackets(s: string): { main: string; harm: string } {
  let main = '', harm = '', depth = 0;
  for (const ch of s) { if (OPEN.test(ch)) { if (depth++ === 0 && harm) harm += ' '; continue; } if (CLOSE.test(ch)) { depth = Math.max(0, depth - 1); continue; } if (depth) harm += ch; else main += ch; }
  return { main: main.replace(/\s+/g, ' ').trim(), harm: harm.replace(/\s+/g, ' ').trim() };
}
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
/** Does a reading only repeat the line itself? */
export const sameAsLine = (read: string, line: string) => norm(read) === norm(line);
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const ROMAJI_WORD = /^(?:(?:[kgsztdnhbpmyrwfjc]?h?y?|sh|ch|ts)[aiueo]|n|[aiueo]{1,2}|[kgsztdpbmc](?=[kgsztdpbmc]))+$/;
/** Is this sub-line of a kana line its romanisation (romaji words only, as most LRC files give it with a translation)? */
export function looksRomaji(sub: string, line: string) {
  if (!KANA.test(line)) return false;
  const ws = sub.toLowerCase().normalize('NFKC').split(/[^a-zāēīōū']+/).filter(Boolean); if (ws.length === 0 || /[^\x00-\x7fĀ-ſ\s\p{P}]/u.test(sub)) return false;
  const ok = ws.filter(w => ROMAJI_WORD.test(w.replace(/[āēīōū]/g, m => 'aeiou'['āēīōū'.indexOf(m)]).replace(/'/g, ''))).length;
  return ok / ws.length >= 0.85;
}
/** A line's translations and readings as shown: translations first (as AMLL and Apple Music show them), then readings. `reads`: shown at all (the play page's setting). */
export function subLines(L: { text: string; subs: string[]; reads?: string[] }, reads = true): SubLine[] {
  const out: SubLine[] = [];
  for (const t of L.subs) { const { main, harm } = splitBrackets(t); if (main) out.push({ s: main, kind: 'sub' }); if (harm) out.push({ s: harm, kind: 'harm' }); }
  // (a reading's part in brackets too: every kind of lyric line treats its brackets — full- or half-width — as a harmony)
  if (reads) for (const r of L.reads || []) { if (sameAsLine(r, L.text)) continue; const { main, harm } = splitBrackets(r); if (main) out.push({ s: main, kind: 'read' }); if (harm) out.push({ s: harm, kind: 'harm' }); }
  return out;
}
