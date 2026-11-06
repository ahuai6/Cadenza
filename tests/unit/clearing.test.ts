// Clearing the page (director/plan.ts): a line still up whose words a new word covers too much starts to fade out the
// moment that word comes in — never one still being sung, never for a slight touch.
import { describe, it, expect } from 'vitest';
import { fadeOverlapped, OVERLAP_FADE } from '../../src/director/plan';

const word = (x: number, y: number, show: number) => ({ x, y, lw: 200, lh: 80, tilt: 0, show });
const line = (words: ReturnType<typeof word>[], sung: number, end: number) => ({ words, L: { sung, end }, secEnd: Infinity, secIn: 0.6, sec: 0 }) as never;

describe('clearing: new words over old ones', () => {
  it('an old line under a new word fades from that moment, over a quarter second', () => {
    const A = line([word(0, 0, 1), word(220, 0, 1.5)], 2, 6), B = line([word(500, 300, 3), word(30, 10, 3.6)], 4.5, 8);
    fadeOverlapped([A, B]);
    expect((A as any).secEnd).toBeCloseTo(3.6 + OVERLAP_FADE, 5); expect((A as any).secIn).toBeCloseTo(OVERLAP_FADE, 5);
    expect((A as any).L.end).toBeLessThanOrEqual(3.6 + OVERLAP_FADE);
    expect((B as any).secEnd).toBe(Infinity);
  });
  it('never a line still being sung, never a slight touch', () => {
    const A = line([word(0, 0, 1)], 5, 6), B = line([word(10, 0, 3)], 4, 8);
    fadeOverlapped([A, B]); expect((A as any).secEnd).toBe(Infinity);
    const C = line([word(0, 0, 1)], 2, 6), D = line([word(190, 70, 3)], 4, 8);                 // (10 × 10 of 200 × 80)
    fadeOverlapped([C, D]); expect((C as any).secEnd).toBe(Infinity);
  });
});
