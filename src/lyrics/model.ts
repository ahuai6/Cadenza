/* The lyric model: lines → words → units, with times in song seconds. Built once per song from the parsed lyrics and
   the rhythm (line-timed words are paced on the beat). Everything that shows lyrics reads this model: the effect view,
   the now-playing page, the lyric list, the workshop timeline.

   Time normalisation: what a listener hears as one gesture is one gesture here too. Words that start closer together
   than the ear separates a camera move (FUSE) form one *group*: the camera frames the group once, instead of starting a
   move for each (word timing like <25.570>１ <25.600>２ <25.630>３ used to start three moves in 60 ms). */
import type { Parsed, RawLine } from './parse';
import { graphemes, unitsOf, isLatin, RE_CJK, RE_COMPLEX, RE_RTL, syllables } from '../text/script';
/** What pacing the words needs from the rhythm (RhythmMap is one): the tempo, the beat's length at a moment, and a
 *  time snapped to the grid within a tolerance. The lyric model reads the beat through this and knows nothing else of it. */
export interface BeatGrid { readonly bpm: number; beatLen(t: number): number; snap(t: number, tol: number, div: number): number }

export interface Unit { c: string; /** sung time, or null when the line is timed only as a whole */ t: number | null }
export interface Word {
  id: number; line: number; k: number;
  text: string; units: Unit[];
  /** sung from, sung until (the word is over) */
  t: number; end: number;
  timed: boolean; latin: boolean; cjk: boolean; complex: boolean;
  /** units timed by estimate (a line timed only as a whole: its characters spread over the word's singing) */
  paced?: boolean;
  /** a harmony sung with this word (shown small beside it), with its units' times */
  harm?: { text: string; units: Unit[]; t: number } | null;
  /** a chorus comes in on this word: 1 strongest, 2 ordinary, 3 lighter */
  mark?: number;
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
export interface LyricDoc { lines: Line[]; words: Word[]; meta: Record<string, string>; groups: number; /** where choruses come in (the lyrics' own marks): time, level 1..3 */ marks: { t: number; level: number }[] }

/** Words starting closer than this (s) are one gesture for the camera and the entrance. */
export const FUSE = 0.12;

const syllableTime = (n: number, bpm: number) => n * 0.3 * Math.sqrt(120 / bpm);

/** end: where the song's music ends (song time) — the last line stays current until a few bars after it is sung. */
export function buildLyrics(p: Parsed, map: BeatGrid, end: number): LyricDoc {
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
    // the words as the lyrics break them: at spaces only (an unspaced line is one word); their harmonies and chorus marks
    const timed = !!R.kar && R.words.every(w => w.units && w.units.length);
    L.words = R.words.map((rw, k) => {
      const w = rw.text, tu = timed ? rw.units!.map(u => ({ c: u.c, t: Math.max(u.t, L.t) })) : null, units: Unit[] = tu ? tu : unitsOf(w).map(c => ({ c, t: null }));   // sung syllables stay whole
      const hu = rw.harm ? (rw.harm.units?.length ? rw.harm.units.map(u => ({ c: u.c, t: Math.max(u.t, L.t) })) : unitsOf(rw.harm.text).map(c => ({ c, t: null as number | null }))) : null;
      return { id: words.length + k, line: i, k, text: w, units, t: tu ? tu[0].t! : L.t, end: 0, timed: !!tu,
        latin: isLatin(w), cjk: RE_CJK.test(w) && !RE_COMPLEX.test(w), complex: RE_COMPLEX.test(w), group: 0, rest: 0,
        harm: rw.harm && hu ? { text: rw.harm.text, units: hu, t: hu[0]?.t ?? NaN } : null, ...(rw.mark ? { mark: rw.mark } : {}) };
    });
    if (!timed) paceWords(L, map);
    // when each word is over
    L.words.forEach((W, k) => {
      const nx = k + 1 < L.words.length ? L.words[k + 1].t : Infinity;
      if (W.timed) W.end = Math.max(...W.units.map(u => u.t!)) + 0.25;
      else W.end = Math.min(nx, W.t + syllableTime(syllables(W.text), bpm) + 0.35, L.end);
      W.end = Math.max(W.end, W.t + 0.12);
      // a word timed only as a whole: its characters spread over its singing, so it is still sung (and followed) one
      // character at a time
      if (!W.timed && W.units.length > 1) { const D = Math.max(0.12, (W.end - W.t) * 0.85); W.units.forEach((u, j) => { u.t = W.t + D * j / W.units.length; }); W.paced = true; }
      // its harmony: with the word when it has no timing of its own
      if (W.harm && !isFinite(W.harm.t)) W.harm.t = W.t;
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
  // the choruses: the words marked, and the stamps that carry only a mark
  const marks = [...words.filter(W => W.mark).map(W => ({ t: W.t, level: W.mark! })), ...(p.marks || [])].sort((a, b) => a.t - b.t);
  return { lines, words, meta: p.meta, groups: gid + 1, marks };
}

/** Line-timed words: each starts at its share of the line's syllables across the sung part, drawn onto a beat when
 *  one is close (an eighth otherwise), always after the word before. */
function paceWords(L: Line, map: BeatGrid) {
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

export { graphemes };
