// The framing pass (director/fit.ts) on a moment where a lyric frame too wide to hold is dropped and no character is
// being sung: measured on nothing, it once added log 0 and ∞·0 to the camera's path — two seconds of a camera that was
// not a number, the picture stuck and the play page's backdrop black (the 「きゃきゃ…」 line). The path stays finite.
import { describe, it, expect } from 'vitest';
import { fitFrames } from '../../src/director/fit';

describe('framing a frame that cannot be held, with nothing being sung', () => {
  it('leaves the camera path finite (and as it was there)', () => {
    const rate = 60,
      n = 600,
      W = 1280,
      H = 720,
      z = () => new Float32Array(n);
    const path = { rate, n, seg: new Int32Array(n), cutT: [] as number[], x: z(), y: z(), lz: z(), r: z(), d: z() };
    const line: any = { L: { end: 9, t: 0 }, secEnd: 20, secIn: 0.3 };
    const S: any = {
      x: 0,
      y: 0,
      lw: W * 6,
      lh: 80,
      tilt: 0,
      d: 0,
      s: 1,
      units: [{ c: 'き', ox: 0, oy: 0, w: 80, h: 80, t: 8 }],
      w: { t: 8, text: 'き' },
      end: 8.5,
      line,
    };
    const F: any = { ts: 0.5, pad: 10, words: [S] };
    S.frame = F;
    fitFrames({ path } as any, [S], W, H);
    for (const a of [path.x, path.y, path.lz]) expect(Array.from(a).every(Number.isFinite)).toBe(true);
    expect(path.lz[Math.round(2 * rate)]).toBe(0);
  });
});

import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { presetStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan } from '../../src/director';
import { boxIn } from '../../src/director/layout';
describe('a long harmony', () => {
  it('never draws the camera over to it: a stop aims at its words, and draws back at most a little', () => {
    const src =
      '[00:02.00]<00:02.00>hold <00:02.40>on<00:02.80>(<00:02.90>oh oh oh oh oh oh oh oh oh oh oh oh oh oh yeah<00:09.00>)\n[00:10.00]<00:10.00>next <00:10.50>line\n[00:14.00]end';
    const map = RhythmMap.grid(120, 0, 30),
      doc = buildLyrics(parse(src), map, 30);
    const P = plan({
      doc,
      map,
      style: presetStyle('cover'),
      measure: approxMeasurer(),
      aspect: 16 / 9,
      musicEnd: 30,
      endLen: 3.5,
      song: { on: true, title: 'T', artist: 'A' },
      labels: { composer: 'c', lyricist: 'l', artist: 'a' },
    });
    for (const s of P.camera.stops.filter((x) => x.words.some((w) => w.harm))) {
      const B = boxIn(s.words, s.box.tilt),
        Bh = boxIn(s.words, s.box.tilt, 0, true);
      expect(Bh.w).toBeGreaterThan(B.w);
      expect(Math.hypot(s.box.x - B.x, s.box.y - B.y)).toBeLessThan(1); // (aimed at the words)
    }
  });
});
