// The distance fields the GPU lyric layer draws glyphs from (render/glyphs.ts): how true their edge is. Checked on a
// shape whose edge is known exactly — a square turned 30°, with corners and slants, drawn anti-aliased — the field's
// distance near the edge against the true distance. (3.1.2: found on a mask three times finer, the field's edge is true
// to a small fraction of a pixel; found on the field's own pixels it was off by a third of one on slants and corners,
// which a glyph shown two or three times larger drew as a ragged, eaten-away edge.)
import { describe, it, expect } from 'vitest';
import { distanceField } from '../../src/render/sdf';

/** (as glyphs.ts's SDF_SPREAD) */
const SDF_SPREAD = 8;

/** a square of half-side R turned 30° about (cx, cy): its signed distance (positive inside) at (x, y) */
const shape = (cx: number, cy: number, R: number) => (x: number, y: number) => {
  const c = Math.cos(Math.PI / 6),
    s = Math.sin(Math.PI / 6),
    u = Math.abs((x - cx) * c + (y - cy) * s) - R,
    v = Math.abs(-(x - cx) * s + (y - cy) * c) - R,
    out = Math.hypot(Math.max(u, 0), Math.max(v, 0)),
    inn = Math.min(Math.max(u, v), 0);
  return -(out + inn);
};
/** the shape drawn anti-aliased at `ss` mask pixels per field pixel (coverage from 8 × 8 samples a pixel), as RGBA */
function mask(w: number, h: number, ss: number, sd: (x: number, y: number) => number) {
  const W = w * ss,
    H = h * ss,
    a = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) if (sd((x + (i + 0.5) / 8) / ss, (y + (j + 0.5) / 8) / ss) > 0) n++;
      a[(y * W + x) * 4 + 3] = Math.round((n / 64) * 255);
    }
  return a;
}
function error(ss: number) {
  const w = 64,
    h = 64,
    sd = shape(32, 32, 18),
    f = distanceField(mask(w, h, ss, sd), w, h, SDF_SPREAD, ss);
  let worst = 0,
    sum = 0,
    n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const truth = sd(x + 0.5, y + 0.5);
      if (Math.abs(truth) > 2) continue; // (the edge's own neighbourhood: what draws it)
      const got = ((f[(y * w + x) * 4 + 3] - 128) / 127) * SDF_SPREAD,
        e = Math.abs(got - truth);
      worst = Math.max(worst, e);
      sum += e;
      n++;
    }
  return { worst, mean: sum / n };
}
describe('glyph distance fields', () => {
  it('are true to the edge on slants and round corners, found on a finer mask', () => {
    const coarse = error(1),
      fine = error(3);
    expect(fine.mean).toBeLessThan(0.12);
    expect(fine.worst).toBeLessThan(0.35);
    expect(fine.mean).toBeLessThan(coarse.mean * 0.6);
  });
});
