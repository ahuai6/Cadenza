// LRC and enhanced (word-timed) LRC into raw lines of words. Times are seconds from the start of the audio range.
//   [mm:ss.xx]line                      a line; words break at spaces only (an unspaced line is one word)
//   [mm:ss.xx]<mm:ss.xx>word <mm:ss.xx>word<mm:ss.xx>     word timing (karaoke); a trailing stamp closes the line
//   #1 / #2 / #3 (or #) before a word    a chorus comes in here: #1 strongest, #2 ordinary (a bare #), #3 lighter
//   word (harmony) / word（和聲）          the part in brackets is a harmony sung with the word before it
//   <…>a<…>b#<…>c                        (older files) a '#' right after a sung unit is a word break, like a space
//   [mm:ss.xx][mm:ss.xx]chorus           one line, several times
//   [mm:ss.xx]                           an empty stamp ends the line before it (an instrumental gap)
//   two lines with the same time         the second is a translation / subtitle of the first
//   [offset:+ms], [ti:], [ar:], [al:], [au:]
// None of the markers (spaces, '#', the brackets) is ever part of the words shown.

import { BOX, BOX_SRC, CLOSE, MARK, NO_BOX, OPEN, plainWords } from './words';

export interface RawUnit {
  t: number;
  c: string;
  sp: boolean;
  /** when it stops sounding, where a stamp with nothing after it (or only a space) says so */ e?: number;
}
/** A harmony sung with a word (the part in brackets after it), with its own timing when the line has it. */
export interface RawHarm {
  text: string;
  units?: RawUnit[];
}
export interface RawWord {
  text: string;
  units?: RawUnit[];
  harm?: RawHarm;
  /** a chorus comes in on this word: 1 strongest .. 3 lighter */ mark?: number;
  /** where the mark was written (timed lines: its syllable's stamp) — kept when the words are regrouped */ markT?: number;
  /** a lyric frame asked for on this word ('$1' before it) */ box?: boolean;
  /** the lyrics have a space after it (what the play page shows; the words themselves may be cut elsewhere) */ gap?: boolean;
  /** the word as shown, where the lyrics have a space inside it (a word joined across one) */ disp?: string;
  /** set apart by a word rule (rules.ts) */ lift?: import('./rules').WordLift;
}
export interface RawLine {
  t: number;
  text: string;
  subs: string[];
  /** the line's words (broken at spaces only), each with its harmony and chorus mark, if any */
  words: RawWord[];
  /** word-timed lines: the words' timed units */
  kar?: RawUnit[][];
  /** the line's closing stamp (when its last word ends), if given */
  close?: number;
  /** an empty stamp ending this line early */
  stop?: number;
  /** spaced by the listener (spacing.ts): its words are theirs, never joined into phrases (phrasing.ts) */
  own?: boolean;
  /** its readings (romanisation, kana), apart from its translations (subs): what the lyrics say are readings */
  reads?: string[];
  /** when the line ends, where the lyrics say (TTML): it stays up that long, over a line that starts before */
  end?: number;
}
export interface Parsed {
  lines: RawLine[];
  meta: Record<string, string>;
  /** chorus marks on a stamp of their own (no words) */ marks: { t: number; level: number }[];
  /** curtain openings asked for ('@N': curtain N closed at once at that stamp, then drawn open) */ curtains?: {
    t: number;
    kind: number;
  }[];
}

const tsec = (m: string, s: string, f?: string) => +m * 60 + +s + (f ? +('0.' + f) : 0);
const STAMP = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;

export function parseOffset(str: string | null | undefined): number | null {
  str = (str || '').trim();
  if (!str) return null;
  const m = str.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (m) return +m[1] * 60 + +m[2];
  const n = parseFloat(str);
  return isFinite(n) ? n : null;
}
/** An audio range "0:00-3:00", "1:20-", "-3:00" or empty (the whole file). */
export function parseRange(str: string | null | undefined): { a: number; b: number | null } {
  str = (str || '').trim();
  if (!str) return { a: 0, b: null };
  const m = str.split(/\s*[-–~～]\s*/),
    a = parseOffset(m[0]) ?? 0,
    b = m.length > 1 ? parseOffset(m[1]) : null;
  return { a: Math.max(0, a), b: b != null && b > a ? b : null };
}

/** '@N' (N 1..9): a curtain — closed over the picture at once at that moment, then drawn open (render/curtain.ts). */
const CURTAIN = /@[1-9]/,
  CURTAIN_ALL = /@[1-9]/g,
  CURTAIN_SCAN = /<(\d+):(\d+)(?:[.:](\d+))?>|@([1-9])/g;
/** The cue symbols a lyric can carry, as an editor offers them (one key each: Alt + key types it at the cursor). One
 *  list for every editor — a new kind of cue is one more entry here and its reading in this file. */
export const CUE_SYMBOLS: readonly { text: string; key: string; label: string }[] = [
  { text: '#1', key: '1', label: 'lyr.cue.1' },
  { text: '#2', key: '2', label: 'lyr.cue.2' },
  { text: '#3', key: '3', label: 'lyr.cue.3' },
  { text: '$1', key: '4', label: 'lyr.cue.box' },
  { text: '@1', key: '5', label: 'lyr.cue.curtain1' },
];
function parseKar(body: string, shift: number): { words: RawWord[]; close: number | null } {
  const re = /<(\d+):(\d+)(?:[.:](\d+))?>([^<]*)/g;
  let m: RegExpExecArray | null;
  const words: RawWord[] = [];
  let cur: RawWord | null = null,
    close: number | null = null,
    inHarm = false,
    lastHarm: { t: number; e?: number } | null = null,
    depth = 0,
    mark: number | undefined,
    boxNext = body.slice(0, Math.max(0, body.indexOf('<'))).includes(BOX);
  // a chorus mark written before the first stamp marks the first word
  {
    const lead = body
      .slice(0, Math.max(0, body.indexOf('<')))
      .trim()
      .match(MARK);
    if (lead) mark = lead[1] ? +lead[1] : 2;
  }
  const flush = () => {
    if (cur && (cur.units?.length || cur.harm)) words.push(cur);
    cur = null;
  };
  while ((m = re.exec(body))) {
    const tt = tsec(m[1], m[2], m[3]) + shift;
    let raw = m[4];
    const mk = depth ? null : raw.match(/^\s*#([1-3])?/);
    if (mk) {
      flush();
      mark = mk[1] ? +mk[1] : 2;
      raw = raw.slice(mk[0].length);
    }
    // ('$1' in a unit: the frame goes round the word this unit's character is in — the next one, when it starts one)
    if (raw.includes(BOX)) {
      boxNext = true;
      raw = raw.replace(NO_BOX, '');
    }
    // the unit's characters, the brackets taken out (they only say that the unit is a harmony): a unit is the harmony's
    // when it starts inside brackets or opens them
    let c = '',
      pre = '';
    const before = depth;
    let opened = false;
    for (const ch of raw) {
      if (OPEN.test(ch)) {
        // (characters before the bracket, in a unit that opens it — `<00:06.50>見(` — are the line's own, not the
        // harmony's: they were taken into it, and the word lost its last character)
        if (!before && !opened) {
          pre = c;
          c = '';
        }
        depth++;
        opened = true;
        continue;
      }
      if (CLOSE.test(ch)) {
        depth = Math.max(0, depth - 1);
        continue;
      }
      c += ch;
    }
    if (pre.trim() && !before) {
      const pt = pre.replace(/#/g, '').trim();
      if (!cur) {
        cur = { text: '', units: [], ...(mark ? { mark } : {}) };
        mark = undefined;
      }
      cur.units!.push({ t: tt, c: pt, sp: /\s$/.test(pre) });
      cur.text += pt;
      inHarm = false;
      close = null;
      if (!c.trim()) continue;
    }
    const legacyBreak = /#\s*$/.test(c);
    c = c.replace(/#/g, '');
    const txt = c.trim(),
      sp = /\s$/.test(c) || legacyBreak;
    if (txt) {
      const u = { t: tt, c: txt, sp },
        lead = /^\s/.test(c); // (a space before the unit breaks just as one after the one before)
      if (before > 0 || opened) {
        const host = cur && cur.units?.length ? cur : words[words.length - 1] || (cur ||= { text: '', units: [] }),
          hu = (host.harm ||= { text: '', units: [] }).units!;
        if (lead && hu.length) hu[hu.length - 1].sp = true;
        hu.push(u);
        inHarm = true;
        lastHarm = u;
      } else {
        inHarm = false;
        if (lead && cur && cur.units?.length) {
          cur.gap = true;
          flush();
        }
        if (!cur) {
          cur = { text: '', units: [], ...(mark ? { mark } : {}) };
          mark = undefined;
        }
        cur.units!.push(u);
        cur.text += txt;
        if (boxNext) {
          cur.box = true;
          boxNext = false;
        }
        if (sp) {
          cur.gap = true;
          flush();
        }
      }
      close = null;
    } else {
      // a stamp with nothing to sing after it (or only a space, as in `stop <00:21.180> <00:22.260>feeling`): where the
      // unit before it stops — it is sustained until then, and the time to the next one is a breath, not a word
      // (after a harmony: where the harmony stops — the line's own voice ended before it, and is not held for it)
      if (inHarm) {
        if (lastHarm && tt > lastHarm.t) lastHarm.e = tt;
        if (cur && /\s/.test(c)) flush();
        continue;
      }
      const prev = cur && cur.units?.length ? cur.units : words[words.length - 1]?.units;
      if (prev?.length) {
        const u = prev[prev.length - 1];
        if (tt > u.t) u.e = tt;
      }
      if (cur && /\s/.test(c)) flush();
      close = tt;
    }
  }
  flush();
  if (words.length) delete words[words.length - 1].gap;
  for (const w of words)
    if (w.harm)
      w.harm.text = w.harm
        .units!.map((u) => u.c + (u.sp ? ' ' : ''))
        .join('')
        .trim();
  return {
    words: words
      .filter((w) => w.text || w.harm)
      .map((w) => (w.text ? w : { text: w.harm!.text, units: w.harm!.units })),
    close,
  };
}

/** Parse, shifted so that `off` (the audio range start, file seconds) is time 0; lines beyond `len` are dropped. */
export function parse(src: string, off = 0, len = Infinity): Parsed {
  const map = new Map<number, RawLine>(),
    breaks: number[] = [],
    meta: Record<string, string> = {},
    marks: { t: number; level: number }[] = [],
    curtains: { t: number; kind: number }[] = [];
  const add = (tt: number, body: string, shift: number) => {
    // a curtain ('@N', N a digit): at the stamp it is written after — the word's, in a word-timed line, else the line's —
    // and taken out of the text (read once per line, not again for a line's repeats under other stamps' translations)
    if (CURTAIN.test(body)) {
      let last = tt;
      for (const m of body.matchAll(CURTAIN_SCAN)) {
        if (m[1] != null) last = tsec(m[1], m[2], m[3]) + shift;
        else curtains.push({ t: last, kind: +m[4] });
      }
      body = body.replace(CURTAIN_ALL, '');
    }
    body = body.replace(BOX_SRC, BOX);
    const key = Math.round(tt * 100),
      e = map.get(key),
      stripped = body.replace(/<[^>]*>/g, ''),
      plain = stripped
        .replace(/#[1-3]?/g, '')
        .replace(NO_BOX, '')
        .replace(/[()（）]/g, '')
        .trim();
    if (e) {
      if (plain)
        e.subs.push(
          stripped
            .replace(/#[1-3]?/g, '')
            .replace(NO_BOX, '')
            .trim(),
        );
      return;
    }
    // a stamp with only a chorus mark: the chorus comes in here (and the line before it ends, as with an empty stamp)
    if (!plain) {
      const mk = stripped.trim().match(MARK);
      if (mk) marks.push({ t: tt, level: mk[1] ? +mk[1] : 2 });
      breaks.push(tt);
      return;
    }
    const L: RawLine = { t: tt, text: '', subs: [], words: [] };
    if (/<\d+:\d+(?:[.:]\d+)?>/.test(body)) {
      const k = parseKar(body, shift);
      if (!k.words.length) return;
      L.words = k.words;
      L.kar = k.words.map((w) => w.units || []);
      if (k.close != null) L.close = k.close;
    } else {
      const bar = body.indexOf('|');
      if (bar >= 0) {
        const s = body.slice(bar + 1).trim();
        if (s) L.subs.push(s);
        body = body.slice(0, bar);
      }
      L.words = plainWords(body);
      if (!L.words.length) return;
    }
    L.text = L.words.map((w) => w.text).join(' ');
    map.set(key, L);
  };
  for (const row of src.split(/\r?\n/)) {
    const mt = row.match(/^\s*\[(ti|ar|al|au|by|offset|length|re|ve):([^\]]*)\]\s*$/i);
    if (mt) {
      meta[mt[1].toLowerCase()] = mt[2].trim();
      continue;
    }
    const lead = row.match(/^\s*((?:\[\d+:\d+(?:[.:]\d+)?\]\s*)+)(.*)$/);
    if (!lead) continue;
    const stamps = [...lead[1].matchAll(STAMP)].map((m) => tsec(m[1], m[2], m[3]));
    let body = lead[2].replace(/\{\w+\}/g, '');
    // word stamps written as [mm:ss] inside the line are read as karaoke tags
    if (/\[\d+:\d+(?:[.:]\d+)?\]/.test(body))
      body =
        `<${Math.floor(stamps[0] / 60)}:${(stamps[0] % 60).toFixed(3)}>` +
        body.replace(STAMP, (_m, a, b, c) => `<${a}:${b}${c ? '.' + c : ''}>`);
    for (const tt of stamps) add(tt, body, tt - stamps[0]);
  }
  const out = [...map.values()].sort((a, b) => a.t - b.t);
  if (!out.length) return { lines: out, meta, marks: [], curtains: [] };
  const shiftAll = (d: number) => {
    for (const L of out) {
      L.t -= d;
      if (L.close != null) L.close -= d;
      for (const w of L.words) {
        for (const units of [w.units, w.harm?.units]) {
          for (const u of units || []) {
            u.t -= d;
            if (u.e != null) u.e -= d;
          }
        }
      }
    }
    for (let i = 0; i < breaks.length; i++) breaks[i] -= d;
    for (const m of marks) m.t -= d;
    for (const c of curtains) c.t -= d;
  };
  const lo = parseFloat(meta.offset);
  if (isFinite(lo) && lo) shiftAll(lo / 1000); // [offset:+ms] shows lyrics that much earlier
  shiftAll(off);
  const lines = out.filter((L) => L.t > -0.05 && L.t < len - 0.3),
    br = breaks.sort((a, b) => a - b);
  lines.forEach((L, i) => {
    const nx = lines[i + 1] ? lines[i + 1].t : Infinity,
      b = br.find((x) => x > L.t + 0.05 && x < nx + 0.01);
    if (b != null) L.stop = b;
  });
  return {
    lines,
    meta,
    marks: marks.filter((m) => m.t > -0.05 && m.t < len).sort((a, b) => a.t - b.t),
    curtains: curtains.filter((c) => c.t > -0.05 && c.t < len).sort((a, b) => a.t - b.t),
  };
}

/** Lyrics in either format: TTML when the text is TTML, else LRC (or plain lines). */
import { isTtml, parseTtml } from './ttml';
const yrcLine = /^\[(\d+),(\d+)\](?=\(\d+,\d+,\d+\))/;
const krcLine = /^\[(\d+),(\d+)\](?=<\d+,\d+,\d+>)/;
function wordLyricsForPlayback(src: string, relative: boolean): string {
  const stamp = (ms: number) =>
    Math.floor(ms / 60000) +
    ':' +
    String(Math.floor(ms / 1000) % 60).padStart(2, '0') +
    '.' +
    String(ms % 1000).padStart(3, '0');
  return src
    .split(/\r?\n/)
    .map((line) => {
      const match = (relative ? krcLine : yrcLine).exec(line);
      if (!match) return line;
      const start = Number(match[1]);
      const words = line
        .slice(match[0].length)
        .replace(
          relative ? /<(\d+),(\d+),\d+>(.*?)(?=<\d+,\d+,\d+>|$)/g : /\((\d+),(\d+),\d+\)(.*?)(?=\(\d+,\d+,\d+\)|$)/g,
          (_, begin, duration, text) => {
            const time = Number(begin) + (relative ? start : 0);
            return '<' + stamp(time) + '>' + text + '<' + stamp(time + Number(duration)) + '>';
          },
        );
      return '[' + stamp(start) + ']' + words;
    })
    .join('\n');
}
export function parseLyrics(src: string, off = 0, len = Infinity): Parsed {
  if (isTtml(src)) return parseTtml(src, off, len);
  src = src.replace(/^\uFEFF/, '');
  if (/^\[\d+,\d+\]\(\d+,\d+,\d+\)/m.test(src)) return parse(wordLyricsForPlayback(src, false), off, len);
  if (/^\[\d+,\d+\]<\d+,\d+,\d+>/m.test(src)) return parse(wordLyricsForPlayback(src, true), off, len);
  return parse(src, off, len);
}
