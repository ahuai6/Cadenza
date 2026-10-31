/* Where the words of a line are cut, by the singing. The segmenter (spacing.ts) cuts a line into words as a dictionary
   reads it — 我們 看過 的 故事 — finer than a lyric video wants: here a word is what comes in together and what the
   camera frames once, and that is the singer's phrasing. So the segmenter's cuts are only the places a line *may* be
   cut (a word is never split), and the singing picks among them:
   - word-timed lines: a cut stays where the singer pauses — the next word comes in clearly later than the run of the
     line goes (against the line's own pace and the beat), or the word before is held out and stops short of it;
     elsewhere the words are sung on as one and are one;
   - line-timed lines (no times within the line): where the voice breathes — the separated vocal stem (the rhythm
     analysis' `voice`) falls silent within the line's time — its characters spread over the stretches it sings, and a
     cut taken at the segmenter's boundary nearest each silence; without that reading, a word of one character goes
     with its neighbour;
   - and a phrase is never longer than PHRASE_MAX characters (it is cut at the latest place it may be, short of that).
   Only words of Chinese and Japanese are joined (they are written without spaces); Latin words, Korean, punctuation, a
   harmony, a word sung again right after itself, a line the listener spaced themselves are as they were. The lines themselves are never joined or broken. */
import type { Parsed, RawLine, RawWord, RawUnit } from './parse';

/** Han, kana and their marks: words written without spaces, which can be joined. */
const CJ = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆〇]+$/u;
/** The longest phrase (characters): about what a camera frames as one, never a whole long line. */
export const PHRASE_MAX = 6;
interface Grid { beatLen(t: number): number; voice?(t: number): number | null }
/** The voice level (0..1) above which it sings, the shortest stretch of singing (s), the step it is read at (s). */
const SINGS = 0.35, MIN_SUNG = 0.08, STEP = 0.02;

/** The lines, their words joined into the phrases they are sung in. */
export function phrase(p: Parsed, map: Grid): Parsed {
  return { ...p, lines: p.lines.map((L, i) => (L.own ? L : phraseLine(L, Math.min(p.lines[i + 1]?.t ?? L.t + 12, L.stop ?? Infinity), map))) };
}

/** Where a line timed as a whole is cut by its singing: before which of its words (indices), or null where the voice is
 *  not known there. Its stretches of singing between t0 and t1, a silence shorter than a breath (GAP) bridged; its
 *  characters spread over them by their length; each silence taken at the segmenter's boundary nearest it, if any is
 *  near enough. */
export function voiceCuts(ws: RawWord[], t0: number, t1: number, map: Grid): Set<number> | null {
  if (!map.voice || map.voice(t0) == null || t1 - t0 < 0.3) return null;
  const gap = Math.max(0.16, 0.3 * map.beatLen(t0)), runs: [number, number][] = [];
  let on = -1;
  for (let t = t0; t <= t1 + 1e-9; t += STEP) { const s = (map.voice(t) ?? 0) >= SINGS;
    if (s && on < 0) on = t; else if (!s && on >= 0) { runs.push([on, t]); on = -1; } }
  if (on >= 0) runs.push([on, t1]);
  const sung = runs.filter(([a, b]) => b - a >= MIN_SUNG), joined: [number, number][] = [];
  for (const r of sung) { const l = joined[joined.length - 1]; if (l && r[0] - l[1] < gap) l[1] = r[1]; else joined.push([...r] as [number, number]); }
  const out = new Set<number>(); if (joined.length < 2) return joined.length ? out : null;
  const lens = ws.map(w => [...w.text].length), N = lens.reduce((a, b) => a + b, 0), total = joined.reduce((a, [x, y]) => a + y - x, 0);
  const at: number[] = []; let c = 0; for (let k = 1; k < ws.length; k++) { c += lens[k - 1]; at.push(c); }   // (the boundary before word k: at[k - 1] characters in)
  let done = 0;
  for (let j = 0; j + 1 < joined.length; j++) { done += joined[j][1] - joined[j][0]; const want = N * done / total;
    let best = -1, bd = Infinity; at.forEach((x, i) => { const d = Math.abs(x - want); if (d < bd) { bd = d; best = i + 1; } });
    if (best > 0 && bd <= Math.max(1.5, 0.25 * N / joined.length)) out.add(best); }
  return out;
}

function phraseLine(L: RawLine, t1: number, map: Grid): RawLine {
  const ws = L.words; if (ws.length < 2) return L;
  const timed = !!L.kar && ws.every(w => w.units && w.units.length);
  // (timed as a whole: where the voice breathes, if that is known)
  const breaths = timed ? null : voiceCuts(ws, L.t, t1, map);
  // the line's own pace: the typical time from one syllable to the next within it
  const ts = timed ? ws.flatMap(w => w.units!.map(u => u.t)) : [], iois = ts.slice(1).map((t, i) => t - ts[i]).filter(d => d > 0).sort((a, b) => a - b);
  const pace = iois.length ? iois[iois.length >> 1] : 0;
  /** May the line be cut between a and b (b the word after a)? */
  const cut = (a: RawWord, b: RawWord, len: number, k: number) => {
    if (!CJ.test(a.text) || !CJ.test(b.text) || a.harm || b.mark) return true;   // (only CJ joins; a harmony stays with its word, a chorus mark starts its own)
    if (a.text === b.text) return true;                                             // (a word sung again is each time a hit of its own: the roller's repeats)
    if (len + b.text.length > PHRASE_MAX) return true;
    if (!timed) return breaths ? breaths.has(k) : a.text.length > 1 && b.text.length > 1;   // (untimed: where it breathes — else a lone character joins its neighbour)
    const la = a.units![a.units!.length - 1], fb = b.units![0], beat = map.beatLen(fb.t);
    // a pause: the next word comes in clearly later than the line's pace, or the word before stops well short of it
    const late = fb.t - la.t >= Math.max(0.5 * beat, 1.8 * pace, 0.22);
    const rest = la.e != null && fb.t - la.e >= Math.max(0.2 * beat, 0.12);
    return late || rest;
  };
  const out: RawWord[] = []; let cur: RawWord = copy(ws[0]);
  for (let k = 1; k < ws.length; k++) {
    const b = ws[k];
    if (cut(ws[k - 1], b, cur.text.length, k)) { out.push(cur); cur = copy(b); continue; }
    // joined: one word, its units one run (the last of them ends the word)
    cur.text += b.text; if (b.box) cur.box = true;
    if (cur.units && b.units) { cur.units[cur.units.length - 1] = { ...cur.units[cur.units.length - 1], sp: false }; cur.units.push(...b.units.map(u => ({ ...u }))); }
    if (b.harm) cur.harm = b.harm;
  }
  out.push(cur);
  if (out.length === ws.length) return L;
  return { ...L, words: out, ...(L.kar ? { kar: out.map(w => w.units || []) } : {}) };
}
const copy = (w: RawWord): RawWord => ({ ...w, ...(w.units ? { units: w.units.map((u: RawUnit) => ({ ...u })) } : {}) });
