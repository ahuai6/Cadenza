import { describe, expect, it } from 'vitest';
import { emptyRhythm } from '../../src/rhythm/analyze';
import { AnalysisFeatures } from '../../src/rhythm/file-analysis';
import { RhythmMap } from '../../src/rhythm/map';
import { RhythmPreview } from '../../src/rhythm/preview';
import { NeuralWindows } from '../../src/rhythm/neural-windows';
import type { NeuralRhythm } from '../../src/rhythm/neural/types';

describe('progressive measured rhythm features', () => {
  it('exposes an audible signal before EOF inside the measured media interval only', () => {
    const rate = 22050;
    const preview = new RhythmPreview();
    const dsp = new AnalysisFeatures(1, rate, false, (slice) => preview.add(slice));
    const map = new RhythmMap(emptyRhythm(180, 'unavailable'), 0.2, preview);
    const band = (i: number) => {
      const t = i / rate;
      return t < 0.3 ? 0 : 0.65 * Math.sin(t * 2 * Math.PI * 90);
    };
    for (let offset = 0; offset < rate * 2; offset += 2048) {
      dsp.push([Float32Array.from({ length: 2048 }, (_, i) => band(i + offset))]);
    }
    expect(map.level(0)).toBe(0);
    expect(map.level(0.4)).toBeGreaterThan(0.6);
    expect(map.spec(0.4)?.[1]).toBeGreaterThan(0.5);
    expect(map.spec(15)).toBeNull();
    expect(map.level(15)).toBe(0);
    expect(map.grid(0, 180)).toEqual([]);
    expect(map.beats).toHaveLength(0);
    expect(map.events).toHaveLength(0);
  });

  it('publishes owned neural accents while the stems still have not returned', async () => {
    const preview = new RhythmPreview();
    const reading: NeuralRhythm = {
      model: 'fixture',
      beats: [1, 2, 29],
      downbeats: [1],
      impact: [0.8, 0.2, 0.9],
      confidence: [1, 1, 1],
      low: [1, 0, 1],
      mid: [0, 0, 0],
      high: [0, 1, 0],
      rhythmic: [1, 0, 1],
      pulse: [1, 0, 1],
      trackScale: 1,
      group: 1,
      usual: 4,
      drums: null,
      drumless: false,
      drumsRun: false,
      ms: { beats: 1, drums: 0 },
    };
    let release!: () => void;
    const ending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rate = 8000;
    const windows = new NeuralWindows(
      rate,
      1,
      async (_pcm, _rate, ready) => {
        ready(reading);
        await ending;
        return reading;
      },
      (window) => preview.add(window),
    );
    const work = windows.push([new Float32Array(rate * 30)]);
    const map = new RhythmMap(emptyRhythm(80, 'unavailable'), 0.25, preview);
    expect(map.eventsIn(0, 80)).toMatchObject([{ t: 0.75, tier: 2 }]);
    expect(map.grid(0, 80)).toEqual([]);
    release();
    await work;
  });
});
