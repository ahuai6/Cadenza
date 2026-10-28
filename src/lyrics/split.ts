// Where words break when the lyrics do not say: by the singer's pauses (word-timed lines) or by the beat (line-timed
// unspaced lines: Chinese, Japanese, Thai).
import { graphemes, wordBreaks, chunkDP, PUNCT, RE_CJK } from './script';
import { clamp } from '../core/math';
import type { RawUnit } from './parse';

/** A long word-timed run with no '#' is broken where the singer pauses, preferring word boundaries. */
export function splitByTiming(seg: RawUnit[]): RawUnit[][] {
  if (seg.length <= 7) return [seg];
  const gaps = seg.slice(1).map((u, i) => u.t - seg[i].t), med = [...gaps].sort((a, b) => a - b)[gaps.length >> 1] || 0.2;
  const wb = wordBreaks(seg.map(u => u.c).join('')); let pos = 0; const at = seg.map(u => (pos += graphemes(u.c).length));
  const cut = (i: number) => { const pause = Math.max(0, Math.min(10, (gaps[i - 1] / med - 1) * 5));
    return (PUNCT.test(seg[i - 1].c.slice(-1)) ? -3 : wb.has(at[i - 1]) ? wb.get(at[i - 1])! : 6) - pause; };
  return chunkDP(seg.length, 4.5, 7, cut).map(([a, b]) => seg.slice(a, b));
}
/** An unspaced line timed only as a whole: about one chunk per beat it is sung over (two for fast songs), cut at
 *  punctuation and dictionary word boundaries, never into single characters unless the line is that short. */
export function splitByBeats(w: string, sungSeconds: number, beatLen: number): string[] {
  const g = graphemes(w), thai = /[฀-๿]/.test(w); if (!(RE_CJK.test(w) || thai) || g.length < 4) return [w];
  const per = beatLen < 0.4 ? 2 : 1, n = clamp(Math.round(Math.max(beatLen, sungSeconds) / (beatLen * per)), 1, Math.ceil(g.length / 2));
  const target = clamp(g.length / n, 2, thai ? 9 : 5), wb = wordBreaks(w), cut = (i: number) => (PUNCT.test(g[i - 1]) ? -3 : wb.has(i) ? wb.get(i)! : thai ? 40 : 5);
  return chunkDP(g.length, target, Math.ceil(target * 1.6) + 1, cut).map(([a, b]) => g.slice(a, b).join(''));
}
