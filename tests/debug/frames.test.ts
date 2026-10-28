// Lyric frames on CJK lyrics (karaoke and plain): small targets, framed whole, no extra push-in.
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan } from '../../src/director';
const D = process.env.LRC_DIR || '';
for (const f of ['pop_zh.lrc', 'pop_plain.lrc', 'rap.lrc', 'pop_mix.lrc']) it(f, () => {
  let src = ''; try { src = readFileSync(D + '/' + f, 'utf8'); } catch { return; }
  const map = RhythmMap.grid(112, 0.3, 240), p = parse(src), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6, doc = buildLyrics(p, map, musicEnd);
  const st = normalizeStyle({ ...presetStyle('cover'), preset: 'custom', cut: 'glide', fx: { ...presetStyle('cover').fx, frame: true } });
  const P = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
  const Fs = [...new Set(P.words.map(S => S.frame).filter(Boolean))] as any[];
  console.log(f, 'lines', P.lines.length, 'frames', Fs.length, Fs.slice(0, 8).map(F => F.words.map((S: any) => S.w.text).join('|')).join('  '));
  for (const F of Fs) expect(F.words.length).toBeLessThanOrEqual(2);
});
