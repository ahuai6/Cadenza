// Curtains asked for in the lyrics ('@N'): read off the stamp they follow, never shown; and the opening's curve.
import { describe, it, expect } from 'vitest';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { CURTAINS } from '../../src/render/curtain';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan } from '../../src/director';
import { wordState } from '../../src/director/words';

describe('curtains (@N)', () => {
  it('a line, a word of a word-timed line, and a stamp of its own; the symbol never shown', () => {
    const p = parse('[00:00.00]@1\n[00:04.00]@1我們 沿著 街道\n[00:08.00]<00:08.00>穿<00:08.40>@2過 <00:08.90>光<00:09.40>\n[00:12.00]mail me @ home');
    expect(p.curtains).toEqual([{ t: 0, kind: 1 }, { t: 4, kind: 1 }, { t: 8.4, kind: 2 }]);
    expect(p.lines.map(L => L.text)).toEqual(['我們 沿著 街道', '穿過 光', 'mail me @ home']);
    const doc = buildLyrics(p, RhythmMap.grid(120, 0, 30), 20); expect(doc.curtains.length).toBe(3);
  });
  it('the star opens on a slow-fast-slow curve from a small star to past the frame\'s corners', () => {
    const c = CURTAINS[1]; expect(c.hold).toBeGreaterThanOrEqual(0); expect(c.open).toBeGreaterThan(0.6);
    // (the shape's outer radius: recorded through a path stand-in)
    const radius = (e: number) => { let R = 0; const far = (x: number, y: number) => { R = Math.max(R, Math.hypot(x - 640, y - 720 * 0.46)); }; const g = { moveTo: far, lineTo: far, arcTo: far, closePath() {} } as never; c.shape(g, 1280, 720, e); return R; };
    expect(radius(0)).toBeLessThan(40);
    expect(radius(1) * 0.5).toBeGreaterThan(Math.hypot(640, 720 * 0.54));
  });
  it('clears the scene as it comes down: every line begun before it is gone at that moment, its captions too', () => {
    const src = '[00:01.00]清晨的光 落在窗邊\n[00:01.00]morning light\n[00:04.00]我們沿著 街道\n[00:08.00]@1風輕輕 吹過\n[00:12.00]時間 一直 往前';
    const p = parse(src), map = RhythmMap.grid(112, 0, 30), doc = buildLyrics(p, map, 20);
    const P = plan({ doc, map, style: normalizeStyle({ ...presetStyle('cover'), preset: 'custom', cut: 'glide' }), measure: approxMeasurer(), aspect: 16 / 9, musicEnd: 20, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
    const c = { enter: 0.35, tempo: 1, float: 0, future: 'dim' as const, smooth: true, punch: 0.3, motion: 1, drift: false };
    const shown = (L: number, t: number) => P.lines[L].words.some(S => (wordState(S, t, 0, false, c)?.o ?? 0) > 0.01);
    expect(shown(0, 7.9) || shown(1, 7.9)).toBe(true);                  // (up before it)
    expect(shown(0, 8.05) || shown(1, 8.05)).toBe(false);               // (gone the moment it comes down)
    expect(P.lines[0].L.end).toBeLessThanOrEqual(8.15 + 1e-9);          // (and the captions with them)
    expect(shown(2, 9)).toBe(true); expect(shown(3, 12.5)).toBe(true);  // (the line it is on, and those after)
  });
});
