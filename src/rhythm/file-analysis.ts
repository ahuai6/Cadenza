import { analyzeSpectrum, dspBands, DSP_HOP, DSP_RATE, DSP_SIZE, SPEC_BANDS, type AnalyzeOptions } from './analyze';
import { bandEnergies, MonoResampler, type Spectrogram } from './dsp';
import { LoudnessMeter } from './loudness';
import { clamp } from '../core/math';
import type { RhythmAnalysis, RhythmPreviewSlice } from './types';

const FEATURE_LIMIT = 1_200_000;
const PCM_BLOCK = 4096;
/** How much of a song's opening is read before a first reading of it is given (s): the song starts on that reading,
 *  carried over the rest of the song on its own beat (rhythm/stream.ts extendHead), until the whole one arrives. */
export const OPENING_SECONDS = 30;

export class AnalysisFeatures {
  private readonly mono: MonoResampler;
  private readonly meter: LoudnessMeter;
  private readonly chunks: Spectrogram[] = [];
  private readonly pending = new Float32Array(DSP_RATE + DSP_SIZE + PCM_BLOCK * 3);
  private frames = 0;
  private samples = 0;
  private length = 0;

  constructor(
    channels: number,
    rate: number,
    private readonly onlyLoudness: boolean,
    private readonly preview?: (slice: RhythmPreviewSlice) => void,
  ) {
    this.mono = new MonoResampler(rate, DSP_RATE);
    this.meter = new LoudnessMeter(channels, rate);
  }
  push(channels: Float32Array[]) {
    this.meter.push(channels);
    if (!this.onlyLoudness) this.consume(this.mono.push(channels));
  }
  private consume(values: Float32Array) {
    let start = 0;
    while (start < values.length) {
      const n = Math.min(values.length - start, this.pending.length - this.length);
      this.pending.set(values.subarray(start, start + n), this.length);
      this.length += n;
      this.samples += n;
      start += n;
      if (this.length >= DSP_RATE + DSP_SIZE) this.collect(false);
    }
  }
  private collect(final: boolean) {
    if (this.length < DSP_SIZE && (!final || this.frames)) return;
    const chunk = bandEnergies(this.pending.subarray(0, this.length), DSP_RATE, DSP_SIZE, DSP_HOP, dspBands);
    const first = this.frames;
    this.frames += chunk.frames;
    if (this.frames > FEATURE_LIMIT) throw new Error('rhythm feature budget');
    this.chunks.push(chunk);
    if (this.preview) this.publish(chunk, first);
    if (!final) {
      const consumed = chunk.frames * DSP_HOP;
      this.pending.copyWithin(0, consumed, this.length);
      this.length -= consumed;
    }
  }
  private publish(chunk: Spectrogram, first: number) {
    // Preserve global hop phase across irregular PCM blocks, while keeping the display stream small.
    const decimation = 3;
    const offset = (decimation - (first % decimation)) % decimation;
    const n = Math.max(0, Math.ceil((chunk.frames - offset) / decimation));
    if (!n) return;
    const stride = SPEC_BANDS + 1;
    const samples = new Float32Array(n * stride);
    const bands = dspBands.length / SPEC_BANDS;
    for (let i = 0; i < n; i++) {
      const f = offset + i * decimation;
      samples[i * stride] = clamp((chunk.rms[f] + 64) / 46);
      for (let b = 0; b < SPEC_BANDS; b++) {
        let peak = 0;
        for (let k = 0; k < bands; k++) peak = Math.max(peak, chunk.E[f * dspBands.length + b * bands + k]);
        samples[i * stride + b + 1] = clamp((10 * Math.log10(1e-12 + peak) + 72) / 52);
      }
    }
    this.preview?.({ start: (first + offset) / chunk.fps, rate: chunk.fps / decimation, stride, samples });
  }
  loudness() {
    return this.meter.finish();
  }
  /** Seconds of the song read so far. */
  get seconds() {
    return this.samples / DSP_RATE;
  }
  /** The built-in reading of what has been read so far (the features go on being collected): the song's opening. */
  reading(): RhythmAnalysis | null {
    if (this.onlyLoudness || !this.frames) return null;
    const rms = new Float32Array(this.frames);
    const energy = new Float32Array(this.frames * dspBands.length);
    let offset = 0;
    for (const part of this.chunks) {
      rms.set(part.rms, offset);
      energy.set(part.E, offset * dspBands.length);
      offset += part.frames;
    }
    return analyzeSpectrum(
      { fps: DSP_RATE / DSP_HOP, frames: this.frames, bands: dspBands, rms, E: energy },
      (this.frames * DSP_HOP) / DSP_RATE,
      this.loudness(),
    );
  }
  finish(options: AnalyzeOptions = {}) {
    if (this.onlyLoudness) throw new Error('rhythm features unavailable');
    this.consume(this.mono.push([], true));
    if (!this.samples) throw new Error('analysis audio is empty');
    this.collect(true);
    const rms = new Float32Array(this.frames);
    const energy = new Float32Array(this.frames * dspBands.length);
    let offset = 0;
    for (const part of this.chunks) {
      rms.set(part.rms, offset);
      energy.set(part.E, offset * dspBands.length);
      offset += part.frames;
    }
    this.chunks.length = 0;
    return analyzeSpectrum(
      { fps: DSP_RATE / DSP_HOP, frames: this.frames, bands: dspBands, rms, E: energy },
      this.samples / DSP_RATE,
      this.loudness(),
      options,
    );
  }
}

// CDP1: rate and channel count, then length-prefixed interleaved f32 blocks, and a required EOF marker.
export async function consumePcm(
  body: ReadableStream<Uint8Array>,
  start: (channels: number, rate: number) => void,
  block: (values: Float32Array[]) => void | Promise<void>,
) {
  const reader = body.getReader();
  let remaining: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let channels = 0;
  let complete = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (complete) throw new Error('audio after analysis EOF');
      const bytes = remaining.length ? new Uint8Array(remaining.length + value.length) : value;
      if (remaining.length) {
        bytes.set(remaining);
        bytes.set(value, remaining.length);
      }
      const view = new DataView(bytes.buffer);
      let pos = 0;
      if (!channels && bytes.length >= 12) {
        if (view.getUint32(0, false) !== 0x43445031) throw new Error('invalid analysis PCM header');
        const rate = view.getUint32(4, true);
        channels = view.getUint32(8, true);
        if (rate < 8000 || rate > 384000 || channels < 1 || channels > 2)
          throw new Error('invalid analysis PCM format');
        start(channels, rate);
        pos = 12;
      }
      while (channels && pos + 4 <= bytes.length) {
        const n = view.getUint32(pos, true);
        if (!n) {
          complete = true;
          pos += 4;
          if (pos < bytes.length) throw new Error('audio after analysis EOF');
          break;
        }
        if (n > PCM_BLOCK * channels * 4 || n % (4 * channels)) throw new Error('invalid analysis PCM block');
        if (pos + 4 + n > bytes.length) break;
        const frames = n / (channels * 4);
        const values = Array.from({ length: channels }, () => new Float32Array(frames));
        pos += 4;
        for (let i = 0; i < frames; i++) {
          for (const channel of values) {
            const sample = view.getFloat32(pos, true);
            if (!Number.isFinite(sample)) throw new Error('invalid PCM sample');
            channel[i] = sample;
            pos += 4;
          }
        }
        await block(values);
      }
      remaining = bytes.slice(pos);
    }
    if (!complete || remaining.length) throw new Error('analysis decoder stopped before EOF');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
