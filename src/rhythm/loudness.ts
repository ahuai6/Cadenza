/* How loud a song is, the way ITU-R BS.1770 measures it (and EBU R128, ReplayGain 2 after it): the signal through the
   K-weighting (a high shelf for the head's acoustics, a high-pass below the bass the ear barely weighs), mean square
   over 400 ms blocks every 100 ms, blocks below −70 LUFS left out, then those more than 10 LU under the loud ones; the
   integrated loudness of what is left. And the sample peak, so a gain can be kept within the song's own headroom.
   The filters are derived for whatever rate the samples have (the analysis decodes at 22 kHz). */
export interface Loudness {
  /** integrated loudness, LUFS */ lufs: number;
  /** sample peak, linear (1 = full scale) */ peak: number;
}

function kFilter(fs: number) {
  // stage 1: the high shelf (+4 dB above ~1.7 kHz); stage 2: the high-pass (~38 Hz)
  let K = Math.tan((Math.PI * 1681.974450955533) / fs),
    Q = 0.7071752369554196,
    Vh = 10 ** (3.999843853973347 / 20),
    Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const b = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a = [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  K = Math.tan((Math.PI * 38.13547087602444) / fs);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const a2 = [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  // (both stages' states in double precision: the high-pass's poles sit close to 1)
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0,
    z1 = 0,
    z2 = 0,
    w1 = 0,
    w2 = 0;
  return (v: number) => {
    const s = b[0] * v + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = s;
    const o = s - 2 * z1 + z2 - a2[0] * w1 - a2[1] * w2;
    z2 = z1;
    z1 = s;
    w2 = w1;
    w1 = o;
    return Math.fround(o);
  };
}
export class LoudnessMeter {
  private readonly filters: Array<(sample: number) => number>;
  private readonly hop: number;
  private readonly block: number;
  private readonly recent: Float64Array;
  private readonly powers: number[] = [];
  private peak = 0;
  private inHop = 0;
  private slots = 0;
  private sum = 0;

  constructor(
    private readonly channels: number,
    rate: number,
  ) {
    this.filters = Array.from({ length: channels }, () => kFilter(rate));
    this.hop = Math.round(rate * 0.1);
    this.block = Math.round(rate * 0.4);
    this.recent = new Float64Array(Math.ceil(this.block / this.hop));
  }

  push(channels: Float32Array[]) {
    const n = channels[0]?.length || 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < this.channels; j++) {
        const sample = channels[j][i];
        this.peak = Math.max(this.peak, Math.abs(sample));
        const weighted = this.filters[j](sample);
        this.sum += weighted * weighted;
      }
      if (++this.inHop < this.hop) continue;
      this.recent[this.slots++ % this.recent.length] = this.sum;
      this.inHop = 0;
      this.sum = 0;
      if (this.slots >= this.recent.length) {
        let total = 0;
        for (const part of this.recent) total += part;
        const power = total / this.block;
        if (level(power) > -70) this.powers.push(power);
      }
    }
  }

  finish(): Loudness {
    if (!this.powers.length) return { lufs: -70, peak: this.peak };
    const relative = level(this.powers.reduce((sum, power) => sum + power, 0) / this.powers.length) - 10;
    let sum = 0;
    let count = 0;
    for (const power of this.powers)
      if (level(power) > relative) {
        sum += power;
        count++;
      }
    return { lufs: level(sum / Math.max(1, count)), peak: this.peak };
  }
}
const level = (power: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, power));

export function loudness(channels: Float32Array[], fs: number): Loudness {
  const meter = new LoudnessMeter(Math.min(channels.length, 2), fs);
  meter.push(channels);
  return meter.finish();
}
/** The volume balance's gain for a song, in dB: towards `target` LUFS, but never past its own headroom (a boost keeps
 *  1 dB under full scale, so nothing ever clips and nothing needs a limiter), within ±12 dB. The target sits low (−18,
 *  under most masters): nearly every song is brought down to it, few need a boost their peaks would not allow — so the
 *  songs really come out alike, not the quiet, dynamic ones left quieter than the rest. */
export function balanceDb(l: Loudness | null | undefined, target = -18): number {
  if (!l || !isFinite(l.lufs) || l.lufs <= -69) return 0;
  const head = -20 * Math.log10(Math.max(1e-6, l.peak)) - 1;
  return Math.max(-12, Math.min(12, target - l.lufs, Math.max(0, head)));
}
