/* TTML lyrics (Timed Text Markup Language, as Apple Music and the lyric tools that follow it write them) into the same
   parsed lines LRC gives (parse.ts), so everything after — the words, the phrasing, the scene, the play page — reads one
   model whichever format the lyrics came in.
     <tt itunes:timing="Line|Word">          the timing is per line, or per syllable (<span begin end>)
     <head> … <iTunesMetadata>
       <translations><translation xml:lang><text for="L1">…</text>   a translation of line L1
       <transliterations><transliteration xml:lang><text for="L1">…   a reading of it (romanisation, kana)
     <body><div><p begin end itunes:key="L1" ttm:agent="v1">…</p>     a line: its own start and end
       <span begin end>syllable</span>     a timed syllable; space between spans breaks words
       <span ttm:role="x-bg">…</span>      background vocals, sung with the line: its harmony
       <span ttm:role="x-translation|x-roman">…</span>   a translation / reading written inside the line
   A line with no key and the very timing of the line before is that line's translation (as some tools write them);
   a placeholder there ("待翻译") is no translation. A line ends when it says it does, so a line sung over another (a
   background line, a duet) stays up as long as it is sung. The XML is read by a small reader of its own (the lyrics are
   also read where no DOM parser is, in the tests and the planning worker's tools). */
import type { Parsed, RawLine, RawUnit, RawWord } from './parse';
import { plainWords } from './parse';

interface El { tag: string; attrs: Record<string, string>; kids: (El | string)[] }
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unesc = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
/** The elements of an XML text (comments, processing instructions and CDATA handled; namespaces kept in the names). */
export function readXml(src: string): El {
  const root: El = { tag: '#root', attrs: {}, kids: [] }, stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.kids.push(m[1]);
    else if (m[2]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === m[2]) { stack.length = i; break; } }
    else if (m[3]) {
      const attrs: Record<string, string> = {}; for (const a of (m[4] || '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unesc(a[2] ?? a[3] ?? '');
      const el: El = { tag: m[3], attrs, kids: [] }; top.kids.push(el); if (!m[5]) stack.push(el);
    } else if (m[6] != null) top.kids.push(unesc(m[6]));
  }
  return root;
}
const local = (tag: string) => tag.slice(tag.indexOf(':') + 1);
const attr = (e: El, name: string) => { for (const k in e.attrs) if (local(k) === name) return e.attrs[k]; return undefined; };
const els = (e: El) => e.kids.filter((k): k is El => typeof k !== 'string');
function* walk(e: El): Generator<El> { for (const k of els(e)) { yield k; yield* walk(k); } }
const find = (e: El, name: string) => { for (const k of walk(e)) if (local(k.tag) === name) return k; return undefined; };
const textOf = (e: El | string): string => (typeof e === 'string' ? e : e.kids.map(textOf).join(''));

/** A TTML time: "1:02.5", "1:02:03.25", "62.5", "62.5s", "1500ms", "01:02:03:12" (frames, at 30). */
export function ttmlTime(v: string | undefined): number | null {
  if (!v) return null; v = v.trim();
  let m = v.match(/^(-?[\d.]+)(h|m|s|ms|f|t)$/); if (m) { const n = +m[1]; return ({ h: n * 3600, m: n * 60, s: n, ms: n / 1000, f: n / 30, t: n / 1e7 } as Record<string, number>)[m[2]]; }
  m = v.match(/^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)(?::(\d+))?$/); if (!m) return null;
  const parts = [m[1], m[2]].filter(x => x != null).map(Number), s = +m[3], frames = m[4] ? +m[4] / 30 : 0;
  return parts.length === 2 ? parts[0] * 3600 + parts[1] * 60 + s + frames : parts.length === 1 ? parts[0] * 60 + s + frames : s + frames;
}
/** Text that stands in for a translation not written yet. */
const PLACEHOLDER = /^\s*(待翻[译譯]|翻[译譯]待[补補]|暂无翻[译譯]|暫無翻譯|无翻[译譯]|無翻譯|translation pending|tbd|n\/a|-+|…+|\.\.\.)\s*$/i;
/** Is this TTML (rather than LRC or plain text)? */
export const isTtml = (src: string) => /^\s*(?:﻿)?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<tt[\s>]/i.test(src);

/** Parse TTML, shifted so that `off` (the audio range start) is time 0; lines beyond `len` dropped. */
export function parseTtml(src: string, off = 0, len = Infinity): Parsed {
  const doc = readXml(src), tt = find(doc, 'tt'); if (!tt) return { lines: [], meta: {}, marks: [], curtains: [] };
  const meta: Record<string, string> = {};
  const lang = attr(tt, 'lang'); if (lang) meta.lang = lang;
  // the head: songwriters, and the translations and readings of each line, by its key
  const trs = new Map<string, string[]>(), rds = new Map<string, string[]>();
  for (const e of walk(tt)) {
    const n = local(e.tag);
    if (n === 'songwriter') meta.au = meta.au ? meta.au + ' / ' + textOf(e).trim() : textOf(e).trim();
    if (n !== 'translation' && n !== 'transliteration') continue;
    const to = n === 'translation' ? trs : rds;
    for (const t of els(e)) { const key = attr(t, 'for'); const s = textOf(t).replace(/\s+/g, ' ').trim(); if (!key || !s || PLACEHOLDER.test(s)) continue; (to.get(key) || to.set(key, []).get(key)!).push(s); }
  }
  const body = find(tt, 'body'); if (!body) return { lines: [], meta, marks: [], curtains: [] };
  const lines: RawLine[] = []; let prev: { L: RawLine; b: number; e: number | null } | null = null;
  for (const p of walk(body)) {
    if (local(p.tag) !== 'p') continue;
    const b = ttmlTime(attr(p, 'begin')), e = ttmlTime(attr(p, 'end')), key = attr(p, 'key');
    if (b == null) continue;
    // a line with no key and the timing of the one before: its translation (a placeholder is none)
    if (!key && prev && Math.abs(prev.b - b) < 0.005 && (e == null || prev.e == null || Math.abs(prev.e - e) < 0.005)) {
      const s = textOf(p).replace(/\s+/g, ' ').trim(); if (s && !PLACEHOLDER.test(s)) prev.L.subs.push(s); continue; }
    const L = lineOf(p, b, e); if (!L) continue;
    for (const s of trs.get(key || '') || []) if (!L.subs.includes(s)) L.subs.push(s);
    for (const s of rds.get(key || '') || []) if (!(L.reads ||= []).includes(s)) L.reads.push(s);
    lines.push(L); prev = { L, b, e };
  }
  lines.sort((a, b) => a.t - b.t);
  const shift = (d: number) => { for (const L of lines) { L.t -= d; if (L.close != null) L.close -= d; if (L.end != null) L.end -= d;
    for (const w of L.words) { for (const u of w.units || []) { u.t -= d; if (u.e != null) u.e -= d; } for (const u of w.harm?.units || []) { u.t -= d; if (u.e != null) u.e -= d; } } } };
  shift(off);
  return { lines: lines.filter(L => L.t > -0.05 && L.t < len - 0.3), meta, marks: [], curtains: [] };
}

/** One <p>: timed syllables (spans with times) or a line timed as a whole; background vocals as its harmony. */
function lineOf(p: El, b: number, e: number | null): RawLine | null {
  const L: RawLine = { t: b, text: '', subs: [], words: [] }; if (e != null && e > b) L.end = e;
  const timed = [...walk(p)].some(x => local(x.tag) === 'span' && ttmlTime(attr(x, 'begin')) != null && !role(x));
  if (!timed) {
    // (inline translations and readings taken out first; background vocals become a bracketed harmony, as in LRC)
    let txt = ''; const visit = (n: El | string) => { if (typeof n === 'string') { txt += n; return; } if (local(n.tag) === 'br') { txt += ' '; return; } const r = role(n);
      if (r === 'x-translation') { pushSub(L, textOf(n)); return; } if (r === 'x-roman' || r === 'x-reading') { pushRead(L, textOf(n)); return; }
      if (r === 'x-bg') { txt += ' (' + textOf(n).replace(/[()（）]/g, '').trim() + ') '; return; } n.kids.forEach(visit); };
    p.kids.forEach(visit);
    L.words = plainWords(txt.replace(/\s+/g, ' ').trim()); if (!L.words.length) return null;
    L.text = L.words.map(w => w.text).join(' '); return L;
  }
  // timed syllables, in order; whitespace between them (or inside one, at its end) breaks a word
  const words: RawWord[] = []; let cur: RawWord | null = null, gap = false, lastEnd: number | null = null;
  const flush = () => { if (cur && cur.units!.length) words.push(cur); cur = null; };
  const unit = (s: El, into: 'main' | 'bg') => {
    const t = ttmlTime(attr(s, 'begin')), en = ttmlTime(attr(s, 'end')), raw = textOf(s); if (t == null) return;
    const c = raw.replace(/[()（）]/g, '').trim(); if (!c) return;
    const u: RawUnit = { t, c, sp: /\s$/.test(raw), ...(en != null && en > t ? { e: en } : {}) };
    if (into === 'bg') { const host = cur && cur.units!.length ? cur : words[words.length - 1]; if (!host) return; const h = (host.harm ||= { text: '', units: [] });
      if (/^\s/.test(raw) && h.units!.length) h.units![h.units!.length - 1].sp = true; h.units!.push(u); return; }
    if ((gap || /^\s/.test(raw)) && cur) { cur.gap = true; flush(); } gap = false;
    (cur ||= { text: '', units: [] }).units!.push(u); cur.text += c; if (u.sp) { cur.gap = true; flush(); }
    if (en != null) lastEnd = Math.max(lastEnd ?? en, en);
  };
  const visit = (n: El | string, into: 'main' | 'bg') => {
    if (typeof n === 'string') { if (/\s/.test(n) && into === 'main') gap = true; return; }
    if (local(n.tag) === 'br') { gap = true; return; }
    const r = role(n);
    if (r === 'x-translation') { pushSub(L, textOf(n)); return; } if (r === 'x-roman' || r === 'x-reading') { pushRead(L, textOf(n)); return; }
    if (r === 'x-bg') { for (const k of n.kids) visit(k, 'bg'); return; }
    if (local(n.tag) === 'span' && ttmlTime(attr(n, 'begin')) != null && !els(n).some(k => ttmlTime(attr(k, 'begin')) != null)) { unit(n, into); return; }
    for (const k of n.kids) visit(k, into);
  };
  p.kids.forEach(k => visit(k, 'main')); flush(); if (words.length) delete words[words.length - 1].gap;
  for (const w of words) if (w.harm) w.harm.text = w.harm.units!.map(u => u.c + (u.sp ? ' ' : '')).join('').trim();
  if (!words.length) return null;
  L.words = words; L.kar = words.map(w => w.units!); L.close = lastEnd ?? e ?? undefined; if (L.close == null) delete L.close;
  L.text = words.map(w => w.text).join(' '); return L;
}
const role = (e: El) => attr(e, 'role');
const pushSub = (L: RawLine, s: string) => { s = s.replace(/\s+/g, ' ').trim(); if (s && !PLACEHOLDER.test(s) && !L.subs.includes(s)) L.subs.push(s); };
const pushRead = (L: RawLine, s: string) => { s = s.replace(/\s+/g, ' ').trim(); if (s && !(L.reads ||= []).includes(s)) L.reads.push(s); };

/** The lyrics as LRC, for editing (the editor and its cue tools work on LRC): word timing as <mm:ss.xx> stamps, a
 *  harmony in brackets, translations and readings as lines under the same stamp, an empty stamp where a line ends
 *  before the next begins. A line sung over another cannot be said in LRC: it comes after it. */
export function ttmlToLrc(src: string): string {
  const p = parseTtml(src), out: string[] = [], ts = (t: number) => { const m = Math.floor(Math.max(0, t) / 60), s = Math.max(0, t) - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
  if (p.meta.au) out.push(`[au:${p.meta.au}]`);
  p.lines.forEach((L, i) => {
    let body: string;
    if (L.kar) body = L.words.map(w => (w.units || []).map(u => `<${ts(u.t)}>${u.c}`).join('') + (w.harm?.units?.length ? '(' + w.harm.units.map(u => `<${ts(u.t)}>${u.c}`).join('') + ')' : '')).join(' ') + (L.close != null ? `<${ts(L.close)}>` : '');
    else body = L.words.map(w => w.text + (w.harm ? ` (${w.harm.text})` : '')).join(' ');
    out.push(`[${ts(L.t)}]${body}`);
    for (const s of [...(L.reads || []), ...L.subs]) out.push(`[${ts(L.t)}]${s}`);
    const nx = p.lines[i + 1]?.t ?? Infinity; if (L.end != null && L.end + 0.05 < nx) out.push(`[${ts(L.end)}]`);
  });
  return out.join('\n');
}
