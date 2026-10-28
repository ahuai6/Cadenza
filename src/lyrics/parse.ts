// LRC and enhanced (word-timed) LRC into raw lines. Times are seconds from the start of the audio range.
//   [mm:ss.xx]line                      a line
//   [mm:ss.xx]<mm:ss.xx>word <mm:ss.xx>word<mm:ss.xx>     word timing (karaoke); a trailing stamp closes the line
//   <…>a<…>b#<…>c                        '#' marks a word break inside unspaced text
//   [mm:ss.xx][mm:ss.xx]chorus           one line, several times
//   [mm:ss.xx]                           an empty stamp ends the line before it (an instrumental gap)
//   two lines with the same time         the second is a translation / subtitle of the first
//   [offset:+ms], [ti:], [ar:], [al:], [au:]
import { splitByTiming } from './split';

export interface RawUnit { t: number; c: string; sp: boolean }
export interface RawLine {
  t: number; text: string; subs: string[];
  /** word-timed lines: words, each a list of timed units */
  kar?: RawUnit[][];
  /** the line's closing stamp (when its last word ends), if given */
  close?: number;
  /** an empty stamp ending this line early */
  stop?: number;
}
export interface Parsed { lines: RawLine[]; meta: Record<string, string> }

const tsec = (m: string, s: string, f?: string) => +m * 60 + +s + (f ? +('0.' + f) : 0);
const STAMP = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;

export function parseOffset(str: string | null | undefined): number | null {
  str = (str || '').trim(); if (!str) return null;
  const m = str.match(/^(\d+):(\d+(?:\.\d+)?)$/); if (m) return +m[1] * 60 + +m[2];
  const n = parseFloat(str); return isFinite(n) ? n : null;
}
/** An audio range "0:00-3:00", "1:20-", "-3:00" or empty (the whole file). */
export function parseRange(str: string | null | undefined): { a: number; b: number | null } {
  str = (str || '').trim(); if (!str) return { a: 0, b: null };
  const m = str.split(/\s*[-–~～]\s*/), a = parseOffset(m[0]) ?? 0, b = m.length > 1 ? parseOffset(m[1]) : null;
  return { a: Math.max(0, a), b: b != null && b > a ? b : null };
}

function parseKar(body: string, shift: number): { segs: RawUnit[][]; close: number | null } {
  const re = /<(\d+):(\d+)(?:[.:](\d+))?>([^<]*)/g; let m: RegExpExecArray | null;
  let segs: RawUnit[][] = [], cur: RawUnit[] = [], close: number | null = null;
  const hash = body.includes('#'), flush = () => { if (cur.length) { segs.push(cur); cur = []; } };
  while ((m = re.exec(body))) {
    const tt = tsec(m[1], m[2], m[3]) + shift, raw = m[4];
    if (raw.startsWith('#')) flush();
    const endCut = raw.replace(/^#+/, '').includes('#'), c = raw.replace(/#/g, '');
    if (c.trim()) { cur.push({ t: tt, c: c.trim(), sp: /\s$/.test(c) }); close = null; }
    else { if (cur.length && /\s/.test(c)) cur[cur.length - 1].sp = true; close = tt; }
    if (endCut) flush();
  }
  flush();
  if (!hash) {   // no '#': words break at spaces, long runs are split where the singing pauses
    const all = segs.flat(); segs = []; let run: RawUnit[] = [];
    for (const u of all) { run.push(u); if (u.sp) { segs.push(run); run = []; } }
    if (run.length) segs.push(run);
    segs = segs.flatMap(splitByTiming);
  }
  return { segs, close };
}

/** Parse, shifted so that `off` (the audio range start, file seconds) is time 0; lines beyond `len` are dropped. */
export function parse(src: string, off = 0, len = Infinity): Parsed {
  const map = new Map<number, RawLine>(), breaks: number[] = [], meta: Record<string, string> = {};
  const add = (tt: number, body: string, shift: number) => {
    const key = Math.round(tt * 100), e = map.get(key), plain = body.replace(/<[^>]*>/g, '').replace(/#/g, '').trim();
    if (e) { if (plain) e.subs.push(plain); return; }
    if (!plain) { breaks.push(tt); return; }
    const L: RawLine = { t: tt, text: '', subs: [] };
    if (/<\d+:\d+(?:[.:]\d+)?>/.test(body)) {
      const k = parseKar(body, shift); if (!k.segs.length) return;
      L.kar = k.segs; if (k.close != null) L.close = k.close; L.text = k.segs.map(s => s.map(u => u.c).join('')).join(' ');
    } else {
      const bar = body.indexOf('|'); if (bar >= 0) { const s = body.slice(bar + 1).trim(); if (s) L.subs.push(s); body = body.slice(0, bar); }
      L.text = body.trim(); if (!L.text) return;
    }
    map.set(key, L);
  };
  for (const row of src.split(/\r?\n/)) {
    const mt = row.match(/^\s*\[(ti|ar|al|au|by|offset|length|re|ve):([^\]]*)\]\s*$/i); if (mt) { meta[mt[1].toLowerCase()] = mt[2].trim(); continue; }
    const lead = row.match(/^\s*((?:\[\d+:\d+(?:[.:]\d+)?\]\s*)+)(.*)$/); if (!lead) continue;
    const stamps = [...lead[1].matchAll(STAMP)].map(m => tsec(m[1], m[2], m[3]));
    let body = lead[2].replace(/\{\w+\}/g, '');
    // word stamps written as [mm:ss] inside the line are read as karaoke tags
    if (/\[\d+:\d+(?:[.:]\d+)?\]/.test(body)) body = `<${Math.floor(stamps[0] / 60)}:${(stamps[0] % 60).toFixed(3)}>` + body.replace(STAMP, (_m, a, b, c) => `<${a}:${b}${c ? '.' + c : ''}>`);
    for (const tt of stamps) add(tt, body, tt - stamps[0]);
  }
  const out = [...map.values()].sort((a, b) => a.t - b.t);
  if (!out.length) return { lines: out, meta };
  const shiftAll = (d: number) => { for (const L of out) { L.t -= d; if (L.close != null) L.close -= d; if (L.kar) for (const s of L.kar) for (const u of s) u.t -= d; } for (let i = 0; i < breaks.length; i++) breaks[i] -= d; };
  const lo = parseFloat(meta.offset); if (isFinite(lo) && lo) shiftAll(lo / 1000);     // [offset:+ms] shows lyrics that much earlier
  shiftAll(off);
  const lines = out.filter(L => L.t > -0.05 && L.t < len - 0.3), br = breaks.sort((a, b) => a - b);
  lines.forEach((L, i) => { const nx = lines[i + 1] ? lines[i + 1].t : Infinity, b = br.find(x => x > L.t + 0.05 && x < nx + 0.01); if (b != null) L.stop = b; });
  return { lines, meta };
}
