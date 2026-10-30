// Curtains asked for in the lyrics ('@N'): read off the stamp they follow, never shown; and the opening's curve.
import { describe, it, expect } from 'vitest';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { CURTAINS } from '../../src/render/curtain';

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
});
