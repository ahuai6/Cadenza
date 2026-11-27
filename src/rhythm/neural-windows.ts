import type { NeuralRhythm } from './neural/types';

// Window ownership is half-open in media frames. Context frames are never emitted twice.
export class NeuralWindows {
  private readonly span: number;
  private readonly context: number;
  private readonly ring: Float32Array[];
  private length = 0;
  private origin = 0;
  private first = true;
  private failed = false;
  private result: NeuralRhythm | null = null;
  private groups = new Map<string, number>();
  private scales = 0;
  private weights = 0;

  constructor(
    private rate: number,
    channels: number,
    private infer: (channels: Float32Array[], rate: number) => Promise<NeuralRhythm | null>,
  ) {
    this.span = rate * 30;
    this.context = rate * 2;
    this.ring = Array.from({ length: channels }, () => new Float32Array(this.span));
  }

  async push(channels: Float32Array[]) {
    if (this.failed) return;
    let offset = 0;
    while (offset < channels[0].length) {
      const size = Math.min(this.span - this.length, channels[0].length - offset);
      for (let i = 0; i < channels.length; i++)
        this.ring[i].set(channels[i].subarray(offset, offset + size), this.length);
      offset += size;
      this.length += size;
      if (this.length === this.span && !(await this.flush(false))) return;
    }
  }

  private async flush(final: boolean) {
    if (!this.length) return true;
    const start = this.first ? 0 : this.context;
    const end = final ? this.length : this.length - this.context;
    const result = await this.infer(
      this.ring.map((channel) => channel.slice(0, this.length)),
      this.rate,
    );
    if (!result) {
      this.failed = true;
      return false;
    }
    if (this.first && final) {
      this.result = result;
      return true;
    }
    const span = (end - start) / this.rate;
    const owned = (sec: number) => sec >= start / this.rate && sec < end / this.rate;
    const at = (sec: number) => this.origin / this.rate + sec;
    const merged = (this.result ??= {
      model: result.model,
      beats: [],
      downbeats: [],
      impact: [],
      low: [],
      mid: [],
      high: [],
      rhythmic: [],
      pulse: [],
      confidence: [],
      trackScale: 0,
      group: 1,
      usual: 4,
      drums: null,
      drumless: true,
      drumsRun: true,
      ms: { beats: 0, drums: 0 },
    });
    const shape = JSON.stringify([result.group, result.usual]);
    this.groups.set(shape, (this.groups.get(shape) || 0) + span);
    this.scales += result.trackScale * span;
    this.weights += span;
    merged.drumsRun &&= result.drumsRun;
    merged.drumless &&= result.drumless;
    const downbeats = new Set(result.downbeats);
    for (const [index, second] of result.beats.entries()) {
      if (!owned(second)) continue;
      const t = at(second);
      // Two adjacent predictions of one attack can jitter across their ownership boundary.
      if (merged.beats.length && t - merged.beats[merged.beats.length - 1] < 0.075) continue;
      merged.beats.push(t);
      if (downbeats.has(second)) merged.downbeats.push(t);
      for (const feature of ['impact', 'low', 'mid', 'high', 'rhythmic', 'pulse', 'confidence'] as const)
        merged[feature].push(result[feature][index]);
    }
    if (result.drums) {
      const drum = (merged.drums ??= { times: [], strengths: [], kinds: [], coverage: 0 });
      for (const [index, second] of result.drums.times.entries()) {
        if (!owned(second)) continue;
        drum.times.push(at(second));
        drum.strengths.push(result.drums.strengths[index]);
        drum.kinds.push(result.drums.kinds[index]);
      }
      drum.coverage += result.drums.coverage * span;
    }
    if (result.voice) {
      const voice = (merged.voice ??= { rate: result.voice.rate, v: [] });
      const firstFrame = Math.round(at(start / this.rate) * voice.rate);
      while (voice.v.length < firstFrame) voice.v.push(0);
      for (let i = Math.round((start / this.rate) * voice.rate); i < Math.round((end / this.rate) * voice.rate); i++)
        voice.v[firstFrame + i - Math.round((start / this.rate) * voice.rate)] = result.voice.v[i] || 0;
    }
    merged.ms.beats += result.ms.beats;
    merged.ms.drums += result.ms.drums;

    if (!final) {
      const advance = this.length - 2 * this.context;
      this.origin += advance;
      this.length -= advance;
      this.first = false;
      for (const channel of this.ring) channel.copyWithin(0, advance);
    }
    return true;
  }

  async finish() {
    if (this.failed || !(await this.flush(true))) return null;
    const result = this.result;
    if (result && this.weights) {
      result.trackScale = this.scales / this.weights;
      const [shape] = [...this.groups].sort((a, b) => b[1] - a[1])[0];
      [result.group, result.usual] = JSON.parse(shape);
      if (result.drums) result.drums.coverage /= this.weights;
    }
    return result;
  }
}
