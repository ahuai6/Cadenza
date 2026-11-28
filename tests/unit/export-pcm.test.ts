import { describe, expect, it } from 'vitest';
import { exportPcm } from '../../src/engine/export-pcm';

const rate = 48000;

function audio(...channels: Float32Array[]) {
  return {
    sampleRate: rate,
    numberOfChannels: channels.length,
    getChannelData: (i: number) => channels[i],
  } as AudioBuffer;
}

describe('sample-aligned export PCM', () => {
  it('preserves stereo, film time and frame order across encode chunks', async () => {
    const left = new Float32Array(rate * 3);
    const right = new Float32Array(rate * 3);
    left[rate + 4800] = 0.8;
    right[rate + 4801] = -0.5;
    const read = await exportPcm(audio(left, right), rate, 2 * rate, 1, 1, false);

    expect(read(0, 4800).every((sample) => sample === 0)).toBe(true);
    const next = read(4800, 4800);
    expect(next[0]).toBeCloseTo(0.8);
    expect(next[4801]).toBe(-0.5);
    expect(read(rate, 4800).every((sample) => sample === 0)).toBe(true);
  });

  it('pads a negative offset and copies mono to both channels with the same fade', async () => {
    const samples = new Float32Array(rate * 3).fill(1);
    const read = await exportPcm(audio(samples), rate, rate * 3, -0.01, 2, true);
    const opening = read(479, 482);
    expect(opening[0]).toBe(0);
    expect(opening[1]).toBeCloseTo(0.5);
    expect(opening[481]).toBe(1);
    expect(opening.subarray(0, 482)).toEqual(opening.subarray(482));
    const tail = read(2 * rate - 1, 2);
    expect(tail[0]).toBeCloseTo(1 / (1.6 * rate), 8);
    expect(tail[1]).toBe(0);
    expect(samples[0]).toBe(1);
  });
});
