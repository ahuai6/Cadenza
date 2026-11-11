// The volume balance's measurement: BS.1770 loudness at the analysis rate, and the gain it leads to.
import { describe, it, expect } from 'vitest';
import { loudness, balanceDb } from '../../src/rhythm/loudness';

const sine = (fs: number, sec: number, hz: number, dbfs: number) => {
  const a = 10 ** (dbfs / 20),
    x = new Float32Array(Math.round(fs * sec));
  for (let i = 0; i < x.length; i++) x[i] = a * Math.sin((2 * Math.PI * hz * i) / fs);
  return x;
};
describe('loudness (BS.1770)', () => {
  for (const fs of [22050, 44100, 48000])
    it(`a 1 kHz stereo sine at −23 dBFS reads −23 LUFS (EBU Tech 3341 case 1), at ${fs} Hz`, () => {
      const x = sine(fs, 20, 997, -23),
        l = loudness([x, x], fs);
      expect(Math.abs(l.lufs + 23)).toBeLessThan(0.15);
      expect(Math.abs(20 * Math.log10(l.peak) + 23)).toBeLessThan(0.05);
    });
  it('weights the bass less (K-weighting) and gates out silence', () => {
    const lo = loudness([sine(22050, 10, 40, -20), sine(22050, 10, 40, -20)], 22050),
      mid = loudness([sine(22050, 10, 997, -20), sine(22050, 10, 997, -20)], 22050);
    expect(lo.lufs).toBeLessThan(mid.lufs - 1);
    const x = new Float32Array(22050 * 20);
    x.set(sine(22050, 10, 997, -20));
    const gated = loudness([x, x], 22050);
    expect(Math.abs(gated.lufs - mid.lufs)).toBeLessThan(0.2); // the silent half does not drag it down
  });
  it('the balance gain: towards the target, a boost never past the headroom, a cut always', () => {
    expect(balanceDb({ lufs: -8, peak: 1 })).toBeCloseTo(-10, 5); // a loud master comes down 10 dB, to -18
    expect(balanceDb({ lufs: -22, peak: 10 ** (-3 / 20) })).toBeCloseTo(2, 5); // a quiet one: up, but only 3 dB − 1 of headroom
    expect(balanceDb({ lufs: -22, peak: 1 })).toBe(0); // no headroom: no boost
    expect(balanceDb(null)).toBe(0);
    expect(balanceDb({ lufs: -70, peak: 0 })).toBe(0);
  });
});
