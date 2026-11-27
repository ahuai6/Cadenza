import { expect, test } from 'vitest';
import { analyze } from '../../src/rhythm/analyze';
import { AnalysisFeatures, consumePcm } from '../../src/rhythm/file-analysis';
import { checkAnalysis } from '../../src/rhythm/validate';
import { RhythmMap } from '../../src/rhythm/map';
import { NeuralWindows } from '../../src/rhythm/neural-windows';

test.each([16000, 22000, 22050, 48000])('streaming DSP equals one-pass DSP at %i Hz', (rate) => {
  const count = rate * 12 + 395;
  const input = Float32Array.from({ length: count }, (_, i) => {
    const t = i / rate;
    const period = t < 6 ? 0.5 : 0.44;
    return Math.sin(t * 2 * Math.PI * 94) * Math.exp(-(t % period) * 55) * 0.8;
  });
  const right = input.map((n) => n * 0.75);
  const streamed = new AnalysisFeatures(2, rate, false);
  for (let i = 0; i < count; i += 1993) streamed.push([input.subarray(i, i + 1993), right.subarray(i, i + 1993)]);
  const result = streamed.finish();
  const reference = analyze([input, right], rate);
  expect(result).toEqual(reference);
  expect(checkAnalysis(result)).toBeNull();
});

test('analyzed silence has no beats or artificial pulses', () => {
  const silence = new AnalysisFeatures(1, 8000, false);
  for (let i = 0; i < 24; i++) silence.push([new Float32Array(8000)]);
  const result = silence.finish();
  const map = new RhythmMap(result);
  expect(checkAnalysis(result)).toBeNull();
  expect(result.beatEvidence).toBe('none');
  expect(map.events).toEqual([]);
  expect(map.grid(0, 5)).toEqual([]);
  expect(map.beatAt(0.7).phase).toBe(0);
  expect(map.isDownbeat(0.7)).toBe(false);
});

test('a sustained tone keeps its energy envelope without generating a beat grid', () => {
  const rate = 22050;
  const input = Float32Array.from({ length: rate * 24 }, (_, i) => 0.7 * Math.sin((2 * Math.PI * 440 * i) / rate));
  const result = analyze([input], rate);
  expect(checkAnalysis(result)).toBeNull();
  expect(result.beatEvidence).toBe('none');
  expect(result.spec?.flat().some((value) => value > 0)).toBe(true);
});

test('PCM framing handles fragmented delivery and rejects truncation', async () => {
  const wire = new Uint8Array(24);
  const view = new DataView(wire.buffer);
  view.setUint32(0, 0x43445031);
  view.setUint32(4, 22050, true);
  view.setUint32(8, 1, true);
  view.setUint32(12, 4, true);
  view.setFloat32(16, 0.3, true);
  const source = (len: number) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < len; i += 3) controller.enqueue(wire.slice(i, Math.min(i + 3, len)));
        controller.close();
      },
    });
  const seen: number[] = [];
  await consumePcm(
    source(24),
    (channels, rate) => {
      expect(channels).toBe(1);
      expect(rate).toBe(22050);
    },
    (channels) => {
      seen.push(channels[0][0]);
    },
  );
  expect(seen).toEqual([Math.fround(0.3)]);
  await expect(
    consumePcm(
      source(22),
      () => {},
      () => {},
    ),
  ).rejects.toThrow('before EOF');
});

test('neural windows discard overlap context and preserve absolute beat and drum times', async () => {
  const observed: number[] = [];
  const windows = new NeuralWindows(100, 1, async ([samples], rate) => {
    const count = Math.floor(samples.length / rate);
    const beats = Array.from({ length: count }, (_, i) => i + 0.1);
    observed.push(samples.length);
    const ones = () => beats.map(() => 1);
    return {
      model: 'fixture',
      beats,
      downbeats: beats.filter((_, i) => i % 4 === 0),
      impact: ones(),
      low: ones(),
      mid: ones(),
      high: ones(),
      rhythmic: ones(),
      pulse: ones(),
      confidence: ones(),
      trackScale: 0.8,
      group: 1,
      usual: 4,
      drumless: false,
      drumsRun: true,
      drums: { times: beats, strengths: ones(), kinds: beats.map(() => 0), coverage: 1 },
      ms: { beats: 1, drums: 1 },
    };
  });
  for (let start = 0; start < 9100; start += 137) await windows.push([new Float32Array(Math.min(137, 9100 - start))]);
  const merged = (await windows.finish())!;
  expect(observed).toEqual([3000, 3000, 3000, 1300]);
  expect(merged.beats.map((t) => Number(t.toFixed(3)))).toEqual(Array.from({ length: 91 }, (_, i) => i + 0.1));
  expect(merged.drums?.times).toEqual(merged.beats);
  expect(merged.trackScale).toBeCloseTo(0.8);
});
