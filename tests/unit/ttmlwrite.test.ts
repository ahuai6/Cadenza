import { describe, it, expect } from 'vitest';
import { parseTtml, ttmlToLrc, lrcToTtml } from '../../src/lyrics/ttml';
import { parse } from '../../src/lyrics/parse';

// (made-up lyrics: two word-timed lines, one with a background vocal; a translation in the head by key)
const SRC = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word" xml:lang="zh">
  <head><metadata><ttm:agent type="person" xml:id="v1"/>
    <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><songwriters><songwriter>某人</songwriter></songwriters>
      <translations><translation xml:lang="en"><text for="L1">Morning light</text><text for="L2">See you</text></translation></translations>
    </iTunesMetadata></metadata></head>
  <body dur="20.000"><div begin="1.000" end="9.000">
    <p begin="1.000" end="4.000" itunes:key="L1" ttm:agent="v1"><span begin="1.000" end="2.000">清晨</span><span begin="2.000" end="3.000">的光</span></p>
    <p begin="5.000" end="8.000" itunes:key="L2" ttm:agent="v1"><span begin="5.000" end="6.500">明天</span><span begin="6.500" end="8.000">見</span><span ttm:role="x-bg"><span begin="6.600" end="7.500">見</span></span></p>
  </div></body>
</tt>`;

describe('TTML edited as LRC, written back as TTML', () => {
  it('keeps the head, the keys and the singers, and takes the edits', () => {
    const lrc = ttmlToLrc(SRC).replace('清晨', '黃昏').replace('Morning light', 'Evening light');
    const out = lrcToTtml(lrc, SRC, (s) => parse(s));
    expect(out).toContain('<songwriter>某人</songwriter>');
    expect(out).toContain('itunes:key="L1"');
    expect(out).toContain('ttm:agent="v1"');
    expect(out).toContain('<text for="L1">Evening light</text>');
    expect(out).toContain('ttm:role="x-bg"');
    expect(out).not.toMatch(/^\[\d/m); // (TTML, not LRC)
    const p = parseTtml(out);
    expect(p.lines.map((L) => L.words.map((w) => w.text).join(''))).toEqual(['黃昏的光', '明天見']);
    expect(p.lines[0].subs).toEqual(['Evening light']);
    expect(p.lines[1].words.some((w) => w.harm)).toBe(true);
    expect(p.lines[0].kar?.flat().map((u) => +u.t.toFixed(2))).toEqual([1, 2]);
  });
});
