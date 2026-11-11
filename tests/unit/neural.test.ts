// The neural engine's pure parts (the chunking and peak picking around Beat This!, the accents, the drum picking, the
// bar arithmetic) and the one interface it feeds: a NeuralRhythm handed to analyze() comes out as the same
// RhythmAnalysis every module reads. The models themselves run in tests/neural.cjs (WebGPU).
import { describe, it, expect } from 'vitest';
import { splitForModel, aggregateChunks, beatsFromLogits, MODEL_CHUNK_FRAMES } from '../../src/rhythm/neural/grid';
import { readBeatMeter, rhythmicBeats, unsureBeats } from '../../src/rhythm/neural/accents';
import {
  pickDrumHits,
  drumCoverage,
  segmentStarts,
  segmentWindow,
  halve,
  HTDEMUCS_SEGMENT,
} from '../../src/rhythm/neural/drums';
import { MEL_BANDS, BEAT_THIS_FPS, melBandCentresHz, melSpectrogram } from '../../src/rhythm/neural/mel';
import { unpackWeights } from '../../src/rhythm/neural/weights';
import { barIndexer } from '../../src/rhythm/bars';
import { analyze } from '../../src/rhythm/analyze';
import { RhythmMap, Signals } from '../../src/rhythm';
import type { NeuralRhythm } from '../../src/rhythm/neural/types';

describe('Beat This! around the model', () => {
  it('cuts a long spectrogram into overlapping 30 s chunks and stitches the predictions back frame for frame', () => {
    const frames = 4000,
      mel = { data: new Float32Array(frames * MEL_BANDS), frames };
    for (let f = 0; f < frames; f++) mel.data[f * MEL_BANDS] = f; // each frame carries its own index
    const chunks = splitForModel(mel);
    expect(chunks.every((c) => c.frames <= MODEL_CHUNK_FRAMES)).toBe(true);
    expect(chunks[0].start).toBe(-6);
    expect(chunks[chunks.length - 1].start + chunks[chunks.length - 1].frames).toBe(frames + 6); // (the last pulled back flush with the end)
    // a "model" that answers each row's own frame index: the stitched track must read 0, 1, 2, … everywhere
    const preds = chunks.map((c) => {
      const b = new Float32Array(c.frames);
      for (let o = 0; o < c.frames; o++) b[o] = o < Math.max(0, -c.start) ? -1 : c.data[o * MEL_BANDS];
      return { start: c.start, frames: c.frames, beat: b, downbeat: b };
    });
    const { beat } = aggregateChunks(preds, frames);
    for (let f = 1; f < frames; f++) expect(beat[f]).toBe(f);
  });
  it('picks positive local maxima, merges a beat fired on two frames, and snaps each downbeat onto a beat', () => {
    const n = 500,
      b = new Float32Array(n).fill(-5),
      d = new Float32Array(n).fill(-5);
    for (let f = 10; f < n; f += 25) {
      b[f] = 4;
      b[f + 1] = 4;
    } // two equal frames: one beat
    for (let f = 11; f < n; f += 100) d[f + 1] = 3; // downbeats two frames off their beat
    const g = beatsFromLogits(b, d);
    expect(g.beats.length).toBe(20);
    expect(g.downbeats.length).toBe(5);
    for (const t of g.downbeats) expect(g.beats).toContain(t);
  });
});

describe("accents (Folia's measurement)", () => {
  const beatsAt = (n: number, gap: number) => Array.from({ length: n }, (_, i) => +(0.5 + i * gap).toFixed(4));
  it('reads a song counted in eighths as felt in dotted quarters (6/8: one in three)', () => {
    const beats = beatsAt(6 * 20, 60 / 168),
      downs = beats.filter((_, i) => i % 6 === 0);
    const rises = beats.map((_, i) => (i % 3 === 0 ? 1 : 0.3)),
      conf = beats.map((_, i) => (i % 3 === 0 ? 7.8 : 5.9));
    expect(readBeatMeter(rises, beats, downs, conf).group).toBe(3);
  });
  it('leaves a 4/4 counted right alone (every beat felt)', () => {
    const beats = beatsAt(4 * 20, 0.5),
      downs = beats.filter((_, i) => i % 4 === 0);
    const rises = beats.map((_, i) => (i % 4 === 0 ? 1 : 0.8)),
      conf = beats.map((_, i) => (i % 4 === 0 ? 7 : 6.7));
    expect(readBeatMeter(rises, beats, downs, conf).group).toBe(1);
  });
  it('gates the bars without percussion (a pad intro) and the stretches the model is unsure of', () => {
    const beats = beatsAt(64, 0.5),
      downs = beats.filter((_, i) => i % 4 === 0),
      frames = Math.ceil(33 * BEAT_THIS_FPS);
    const percussive = new Float32Array(frames),
      total = new Float32Array(frames).fill(1);
    for (let f = 0; f < frames; f++) percussive[f] = f / BEAT_THIS_FPS > 8.5 ? 0.5 : 0.02; // drums in after four bars
    const r = rhythmicBeats({ percussive, total }, beats, downs);
    expect(r.slice(0, 16).every((v) => v === 0)).toBe(true);
    expect(r.slice(17).every((v) => v === 1)).toBe(true);
    const conf = beats.map((_, i) => (i < 12 ? 2.5 : 7)),
      un = unsureBeats(
        conf,
        beats.map(() => 1),
      );
    expect(un.slice(0, 10).every((v) => v === 1) && un.slice(16).every((v) => v === 0)).toBe(true);
  });
});

describe('drums', () => {
  it('lays the segments a quarter over each other, faded across the overlap', () => {
    const st = segmentStarts(HTDEMUCS_SEGMENT * 3),
      w = segmentWindow();
    expect(st[1] - st[0]).toBe(HTDEMUCS_SEGMENT - HTDEMUCS_SEGMENT / 4);
    expect(w[0]).toBe(0);
    expect(w[HTDEMUCS_SEGMENT >> 1]).toBe(1);
  });
  it('picks kicks, snares and hats off a drum spectrogram, as their own kinds', () => {
    const frames = 600,
      data = new Float32Array(frames * MEL_BANDS),
      hz = melBandCentresHz();
    const hit = (f: number, lo: number, hi: number) => {
      for (let k = 0; k < 4; k++)
        for (let b = 0; b < MEL_BANDS; b++)
          if (hz[b] >= lo && hz[b] < hi) data[(f + k) * MEL_BANDS + b] += 3 * (1 - k / 4);
    };
    for (let f = 20; f < frames - 10; f += 50) {
      hit(f, 0, 150);
      hit(f + 25, 150, 4000);
    }
    for (let f = 32; f < frames - 10; f += 50) hit(f, 6000, 1e9);
    const h = pickDrumHits({ data, frames });
    const kinds = [0, 0, 0];
    h.kinds.forEach((k) => kinds[k]++);
    expect(kinds[0]).toBeGreaterThanOrEqual(10);
    expect(kinds[1]).toBeGreaterThanOrEqual(10);
    expect(kinds[2]).toBeGreaterThanOrEqual(10);
  });
  it('calls a song drumless when its "drum" stem is only what leaked in', () => {
    const mix = new Float32Array(400).fill(1),
      leak = new Float32Array(400).fill(0.005),
      kit = new Float32Array(400).fill(0.2);
    expect(drumCoverage(leak, mix)).toBeLessThan(0.08);
    expect(drumCoverage(kit, mix)).toBeGreaterThan(0.9);
  });
  it('halves the rate without passing the upper band through (a 16 kHz tone is gone, a 1 kHz tone stays)', () => {
    const n = 44100,
      lo = new Float32Array(n),
      hi = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      lo[i] = Math.sin((2 * Math.PI * 1000 * i) / 44100);
      hi[i] = Math.sin((2 * Math.PI * 16000 * i) / 44100);
    }
    const rms = (a: Float32Array) => Math.sqrt(a.slice(100, -100).reduce((s, v) => s + v * v, 0) / (a.length - 200));
    expect(rms(halve(lo))).toBeGreaterThan(0.6);
    expect(rms(halve(hi))).toBeLessThan(0.02);
  });
});

describe('the model files', () => {
  it('unpacks the packed format and refuses a file cut short', () => {
    const json = new TextEncoder().encode(JSON.stringify({ bytes: 8, tensors: {} })),
      out = new Uint8Array(8 + json.length + 16);
    out.set([1, 2, 3, 4, 5, 6, 7, 8]);
    out.set(json, 8);
    out.set(new TextEncoder().encode('FOLIABTW'), 8 + json.length);
    new DataView(out.buffer).setBigUint64(out.length - 8, 8n, true);
    const u = unpackWeights<{ bytes: number }>(out.buffer);
    expect(u.weights.length).toBe(8);
    expect(() => unpackWeights(out.buffer.slice(0, out.length - 3))).toThrow();
  });
  it('makes the spectrogram the model expects (128 bands at 50 fps, centred)', () => {
    const m = melSpectrogram(new Float32Array(22050));
    expect(m.frames).toBe(51);
    expect(m.data.length).toBe(51 * MEL_BANDS);
  });
});

describe('bars one by one', () => {
  it('counts beats in bars of their own lengths, the usual bar continuing before and after', () => {
    const b = barIndexer(4, 2, [2, 6, 9, 13]);
    expect(b(2)).toEqual({ bar: 0, inBar: 0, len: 4 });
    expect(b(8)).toEqual({ bar: 1, inBar: 2, len: 3 });
    expect(b(1)).toEqual({ bar: -1, inBar: 3, len: 4 });
    expect(b(18)).toEqual({ bar: 4, inBar: 1, len: 4 });
    expect(b.start(2)).toBe(9);
    expect(b.start(4)).toBe(17);
    expect(b.start(-1)).toBe(-2);
  });
});

/** A song of `secs` at 44.1 kHz: noise bursts on a 120 BPM grid (kick-like low, snare-like mid on 2 and 4). */
function clicks(secs: number, from = 0) {
  const sr = 44100,
    x = new Float32Array(secs * sr);
  let s = 3;
  for (let k = 0; k * 0.5 < secs - 0.5; k++) {
    if (k * 0.5 < from) continue;
    const i0 = Math.round(k * 0.5 * sr),
      low = k % 2 === 0;
    for (let i = 0; i < 3000; i++) {
      s = (s * 16807) % 2147483647;
      const n = s / 1073741823 - 1;
      x[i0 + i] += (low ? Math.sin(i * 0.012) : n * 0.6) * Math.exp(-i / 700);
    }
  }
  return x;
}
describe('one interface: a neural reading becomes the same RhythmAnalysis', () => {
  // the model counted 6/8 eighths at 144 BPM: six beats a bar, felt in dotted quarters (one in three)
  const N = (beats: number[], over: Partial<NeuralRhythm> = {}): NeuralRhythm => ({
    model: 'test',
    beats,
    downbeats: beats.filter((_, i) => i % 6 === 0),
    impact: beats.map((_, i) => (i % 6 === 0 ? 1 : 0.5)),
    low: beats.map(() => 0.5),
    mid: beats.map(() => 0.3),
    high: beats.map(() => 0.2),
    rhythmic: beats.map((t) => (t < 4 ? 0 : 1)),
    pulse: beats.map((_, i) => (i % 3 === 0 ? 1 : 0)),
    confidence: beats.map(() => 6),
    trackScale: 0.9,
    group: 3,
    usual: 6,
    drums: null,
    drumless: false,
    drumsRun: false,
    ms: { beats: 0, drums: 0 },
    ...over,
  });
  const eighths = Array.from({ length: 96 }, (_, i) => +(0.5 + (i * 60) / 144).toFixed(4));
  const x = clicks(Math.ceil(eighths[eighths.length - 1] + 2));
  it('keeps the felt beats, takes the bars as found, and says which engine', () => {
    const a = analyze([x], 44100, { neural: N(eighths) });
    expect(a.engine).toBe('neural');
    expect(a.beats.length).toBe(32); // one in three of 96
    expect(Math.abs(a.tempo.bpm - 48)).toBeLessThan(0.6);
    expect(a.meter).toBe(2);
    expect(a.bars![0]).toBe(0);
    expect(a.accents!.impact.length).toBe(32);
    const map = new RhythmMap(a);
    expect(map.beatAt(a.beats[2] + 0.01).inBar).toBe(0);
    expect(map.beatAt(a.beats[3] + 0.01).inBar).toBe(1);
    expect(map.barTime(3)).toBeCloseTo(a.beats[6], 6);
  });
  it('without a reading (or a short one) the built-in analysis runs as before', () => {
    const a = analyze([x], 44100),
      b = analyze([x], 44100, { neural: N(eighths.slice(0, 5)) });
    expect(a.engine).toBe('dsp');
    expect(b.engine).toBe('dsp');
    expect(a.beats).toEqual(b.beats);
  });
  it('takes the drum hits as the events, and holds back accents in a bar with no rhythm', () => {
    const quarters = Array.from({ length: 60 }, (_, i) => +(0.5 + i * 0.5).toFixed(4)),
      y = clicks(32);
    const drums = {
      times: quarters.map((t) => t + 0.002),
      strengths: quarters.map((_, i) => (i % 2 ? 0.7 : 1)),
      kinds: quarters.map((_, i) => (i % 2 ? 1 : 0)) as (0 | 1)[],
      coverage: 0.9,
    };
    const a = analyze([y], 44100, {
      neural: N(quarters, {
        downbeats: quarters.filter((_, i) => i % 4 === 0),
        group: 1,
        usual: 4,
        pulse: quarters.map(() => 1),
        drums,
        drumsRun: true,
        rhythmic: quarters.map((t) => (t < 8 ? 0 : 1)),
      }),
    });
    expect(a.stems).toBe('drums');
    expect(a.meter).toBe(4);
    expect(a.drums!.t.length).toBe(60);
    const low = a.events.filter((e) => e.band === 'low' && e.t > 8).length,
      mid = a.events.filter((e) => e.band === 'mid' && e.t > 8).length;
    expect(low).toBeGreaterThan(10);
    expect(mid).toBeGreaterThan(10);
    expect(a.events.filter((e) => e.t < 7.8 && e.tier === 2).length).toBe(0); // (the gated bars: nothing strong)
    const g = new Signals(new RhythmMap(a)).grooveHits();
    expect(g.filter((h) => h.t < 7.8).length).toBe(0);
    expect(g.filter((h) => h.t > 8).length).toBeGreaterThan(30);
  });
});
