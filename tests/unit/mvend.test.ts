// An MV shorter than its song: it plays whole, then fades out over its last moments (the song then goes on as it is
// without an MV, in its own theme); one as long as the song is never faded. And the frame shapes: each a size, never a crop.
import { describe, it, expect } from 'vitest';
import { MvSource } from '../../src/engine/media';
import { ASPECTS } from '../../src/director';
import { exportSize } from '../../src/engine/size';

const mv = (duration: number, offset = 0) => {
  const m = new MvSource();
  (m as unknown as { el: { duration: number } }).el = { duration };
  m.offset = offset;
  return m;
};
describe('an MV shorter than the song', () => {
  it('plays at full strength, then fades to nothing by its end', () => {
    const m = mv(60);
    expect(m.endK(10, 0)).toBe(1);
    expect(m.endK(58, 0)).toBe(1);
    expect(m.endK(59, 0)).toBeGreaterThan(0);
    expect(m.endK(59, 0)).toBeLessThan(1);
    expect(m.endK(60, 0)).toBe(0);
    expect(m.endK(120, 0)).toBe(0);
  });
  it('follows its offset against the song', () => {
    expect(mv(60, 10).endK(48, 0)).toBe(1);
    expect(mv(60, 10).endK(50, 0)).toBe(0);
  });
  it('a clip with no length yet is not faded', () => {
    const m = new MvSource();
    expect(m.endK(100, 0)).toBe(1);
  });
});
describe('frame shapes', () => {
  it('16:9, 16:10, 9:16 and 1:1 export at their own size', () => {
    for (const a of ['16:9', '16:10', '9:16', '1:1']) {
      const [w, h] = exportSize(a, 1080, 16 / 9);
      expect(Math.abs(w / h - ASPECTS[a])).toBeLessThan(0.01);
      expect(Math.min(w, h)).toBe(1080);
    }
  });
});
