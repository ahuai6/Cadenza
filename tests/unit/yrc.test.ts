import { expect, test } from 'vitest';
import { parseLyrics } from '../../src/lyrics/parse';

test('renders native YRC with a file-time offset and millisecond syllable starts', () => {
  const [line] = parseLyrics('[1000,700](1012,188,0)one (1300,400,0)two\n\n', 0.25).lines;
  expect(line.t).toBeCloseTo(0.75, 4);
  expect(line.words.flatMap((word) => word.units ?? []).map((unit) => unit.t)).toEqual([
    expect.closeTo(0.762, 4),
    expect.closeTo(1.05, 4),
  ]);
  expect(line.words[0].units?.[0].e).toBeCloseTo(0.95, 4);
  expect(line.close).toBeCloseTo(1.45, 4);
});

test('renders native KRC with relative word timestamps and a file-time offset', () => {
  const [line] = parseLyrics('\uFEFF[1000,700]<12,188,0>one <300,400,0>two\n\n', 0.25).lines;
  expect(line.t).toBeCloseTo(0.75, 4);
  const units = line.words.flatMap((word) => word.units ?? []);
  expect(units.map((unit) => unit.t)).toEqual([expect.closeTo(0.762, 4), expect.closeTo(1.05, 4)]);
  expect(line.close).toBeCloseTo(1.45, 4);
});
