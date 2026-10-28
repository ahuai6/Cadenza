/* The lyric model: lines → words → units, with times in song seconds. Built once per song from the parsed lyrics and
   the rhythm (line-timed words are paced on the beat). Everything that shows lyrics reads this model: the effect view,
   the now-playing page, the lyric list, the workshop timeline.

   Time normalisation: what a listener hears as one gesture is one gesture here too. Words that start closer together
   than the ear separates a camera move (FUSE) form one *group*: the camera frames the group once, instead of starting a
   move for each (word timing like <25.570>１ <25.600>２ <25.630>３ used to start three moves in 60 ms). */
import type { Parsed, RawLine } from './parse';
import { splitByBeats } from './split';
import { graphemes, unitsOf, isLatin, RE_CJK, RE_COMPLEX, RE_RTL, splitWord, syllables } from './script';
import type { RhythmMap } from '../rhythm/map';

export interface Unit { c: string; /** sung time, or null when the line is timed only as a whole */ t: number | null }
export interface Word {
  id: number; line: number; k: number;
  text: string; units: Unit[];
  /** sung from, sung until (the word is over) */
  t: number; end: number;
  timed: boolean; latin: boolean; cjk: boolean; complex: boolean;
  /** framing group: consecutive words closer than FUSE share one */
  group: number;
  /** the pause after this word when it ends its line (0 otherwise) */
  rest: number;
}
export interface Line {
  i: number; t: number;
  /** when the line stops being current (next line, an empty stamp, or a few bars after it is sung) */
  end: number;
  /** when its singing is over */
  sung: number;
  text: string; subs: string[]; words: Word[];
  kar: boolean; rtl: boolean;
}
export interface LyricDoc { lines: Line[]; words: Word[]; meta: Record<string, string>; groups: number }

/** Words starting closer than this (s) are one gesture for the camera and the entrance. */
export const FUSE = 0.12;

const syllableTime = (n: number, bpm: number) => n * 0.3 * Math.sqrt(120 / bpm);

/** end: where the song's music ends (song time) — the last line stays current until a few bars after it is sung. */
export function buildLyrics(p: Parsed, map: RhythmMap, end: number): LyricDoc {
  const bpm = map.bpm, raw = p.lines, lines: Line[] = [];
  const sungEndOf = (L: RawLine) => {
    if (L.kar) { const lk = Math.max(...L.kar.flat().map(u => u.t)); return L.close ?? lk + 0.5; }
    return L.t + syllableTime(syllables(L.text), bpm) + 0.8;
  };
  raw.forEach((R, i) => {
    const next = i + 1 < raw.length ? raw[i + 1].t : end, sung = Math.min(sungEndOf(R), R.stop ?? Infinity);
    let lend = Math.min(next, R.stop ?? Infinity, sung + Math.max(2.5, 8 * 60 / bpm));
    lend = Math.max(lend, Math.min(next, R.t + 0.6));
    lines.push({ i, t: R.t, end: lend, sung, text: R.text, subs: R.subs, words: [], kar: !!R.kar, rtl: RE_RTL.test(R.text) });
  });
  const words: Word[] = []; let gid = -1;
  lines.forEach((L, i) => {
    const R = raw[i];
    let texts: string[], timedUnits: (Unit[] | null)[];
    if (R.kar) { texts = R.kar.map(s => s.map(u => u.c).join('')); timedUnits = R.kar.map(s => s.map(u => ({ c: u.c, t: Math.max(u.t, L.t) }))); }
    else {
      const toks = R.text.split(/\s+/).filter(Boolean), beat = map.beatLen(L.t);
      texts = toks.length === 1 ? splitByBeats(toks[0], Math.min(L.end, L.sung) - 0.8 - L.t, beat) : toks.flatMap(splitWord);
      timedUnits = texts.map(() => null);
    }
    L.words = texts.map((w, k) => {
      const tu = timedUnits[k], units: Unit[] = tu ? tu : unitsOf(w).map(c => ({ c, t: null }));   // sung syllables stay whole
      return { id: words.length + k, line: i, k, text: w, units, t: tu ? tu[0].t! : L.t, end: 0, timed: !!tu,
        latin: isLatin(w), cjk: RE_CJK.test(w) && !RE_COMPLEX.test(w), complex: RE_COMPLEX.test(w), group: 0, rest: 0 };
    });
    if (!R.kar) paceWords(L, map);
    // when each word is over
    L.words.forEach((W, k) => {
      const nx = k + 1 < L.words.length ? L.words[k + 1].t : Infinity;
      if (W.timed) W.end = Math.max(...W.units.map(u => u.t!)) + 0.25;
      else W.end = Math.min(nx, W.t + syllableTime(syllables(W.text), bpm) + 0.35, L.end);
      W.end = Math.max(W.end, W.t + 0.12);
    });
    // groups: a fast run is one gesture
    L.words.forEach((W, k) => {
      const P = k ? L.words[k - 1] : null;
      if (!P || W.t - P.t >= FUSE) gid++;
      W.group = gid;
    });
    const last = L.words[L.words.length - 1];
    if (last) last.rest = Math.max(0, (i + 1 < lines.length ? lines[i + 1].t : end) - last.end);
    words.push(...L.words);
  });
  return { lines, words, meta: p.meta, groups: gid + 1 };
}

/** Line-timed words: each starts at its share of the line's syllables across the sung part, drawn onto a beat when
 *  one is close (an eighth otherwise), always after the word before. */
function paceWords(L: Line, map: RhythmMap) {
  const n = L.words.length; if (!n) return;
  const beat = map.beatLen(L.t), q = beat / 2;
  const D = Math.max(n * q / 2, Math.min(L.end, L.sung) - L.t), R = n > 1 ? Math.min(2 * beat, D * 0.3) : 0, avail = D - R;
  let step = Math.max(q / 2, Math.round(avail / n / q) * q); if (step * n > avail + 1e-6) step = avail / n;
  const syl = L.words.map(W => Math.max(1, syllables(W.text))), tot = syl.reduce((a, b) => a + b, 0), span = Math.min(avail, step * n * 1.15);
  let acc = 0; L.words.forEach((W, k) => { W.t = L.t + span * acc / tot; acc += syl[k]; });
  for (let k = 1; k < n; k++) {
    const W = L.words[k], b = map.snap(W.t, Math.min(0.35 * beat, span / n * 0.5), 1);
    const x = b !== W.t ? b : map.snap(W.t, Math.min(0.2 * beat, span / n * 0.4), 2);
    W.t = x > L.words[k - 1].t + 0.1 ? x : Math.max(W.t, L.words[k - 1].t + 0.1);
  }
}

/** The line current at t (the last one started), or -1. */
export function lineAt(doc: LyricDoc, t: number): number {
  let lo = 0, hi = doc.lines.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (doc.lines[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
export { graphemes };
