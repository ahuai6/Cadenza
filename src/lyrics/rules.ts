/* Rules on the words as finally cut — the segmenter's (or the listener's), joined into the phrases they are sung in —
   each looks at a line and may mark some of its words to be set apart: bigger, nearer the camera, drawn over the rest.
   The director reads the marks (layout.ts). A new rule is one more entry in WORD_RULES and nothing else. */
import type { RawLine, RawWord } from './parse';

/** How a word is set apart: its size against the rest, and how much nearer the camera than the line's other words it
 *  stands (layout depth units; nearer is also drawn over them). */
export interface WordLift { scale: number; near: number; rule: string }
export interface WordRule { id: string; apply(L: RawLine): void }

const HAN = /^\p{Script=Han}$/u;
/** A line ending in one Han character cut on its own (…的 光, …下 雨): that character lands as the line's last beat —
 *  a little bigger, nearer, over the words before it. */
const trailingHan: WordRule = { id: 'trailing-han', apply(L) {
  const n = L.words.length; if (n < 2) return; const last = L.words[n - 1];
  if (!HAN.test(last.text) || last.harm || !L.words.slice(0, -1).some(w => /\p{Script=Han}/u.test(w.text))) return;
  lift(last, { scale: 1.2, near: 120, rule: this.id });
} };

export const WORD_RULES: WordRule[] = [trailingHan];
// (each rule marks a word once: the same lyrics are read again on every rebuild)
const lift = (W: RawWord, l: WordLift) => { if (W.lift?.rule.split('+').includes(l.rule)) return; W.lift = W.lift ? { scale: W.lift.scale * l.scale, near: W.lift.near + l.near, rule: W.lift.rule + '+' + l.rule } : l; };
/** Every rule on every line (buildLyrics calls this once the words are joined into phrases). */
export function applyWordRules(lines: RawLine[]) { for (const L of lines) for (const r of WORD_RULES) r.apply(L); }
