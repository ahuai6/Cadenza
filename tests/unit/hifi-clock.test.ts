import { expect, test } from 'vitest';
import { HifiClock } from '../../src/app/playback/hifi-clock';

test('native time is bounded by submitted PCM and an observation timeout', () => {
  const clock = new HifiClock();
  clock.reset(4);
  expect(clock.time(9_000)).toBe(4);
  expect(clock.observe({ epoch: 2, t: 4.01, run: true, limit: 4.035 }, 9_000)).toBe(true);
  expect(clock.time(9_010)).toBeCloseTo(4.02, 6);
  expect(clock.time(9_900)).toBeCloseTo(4.035, 6);
  expect(clock.observe({ epoch: 2, t: 4.04, run: true, limit: 5 }, 9_900)).toBe(true);
  expect(clock.time(10_400)).toBeCloseTo(4.095, 6);
});

test('jitter stays monotonic, a device loss freezes, and a new device rejects the old epoch', () => {
  const clock = new HifiClock();
  clock.reset(1);
  clock.observe({ epoch: 7, t: 1.02, run: true, limit: 1.06 }, 100);
  expect(clock.time(128)).toBeCloseTo(1.048, 6);
  clock.observe({ epoch: 7, t: 1.04, run: true, limit: 1.08 }, 128);
  expect(clock.time(128)).toBeCloseTo(1.048, 6);
  clock.observe({ epoch: 7, t: 1.04, run: false, limit: 1.04 }, 142);
  expect(clock.time(1500)).toBe(1.04);
  expect(clock.observe({ epoch: 8, t: 1.05, run: true, limit: 1.1 }, 1510)).toBe(true);
  expect(clock.observe({ epoch: 7, t: 2, run: true, limit: 3 }, 1515)).toBe(false);
  expect(clock.time(1515)).toBeCloseTo(1.055, 6);
  clock.reset(0.3);
  expect(clock.time(3000)).toBe(0.3);
});
