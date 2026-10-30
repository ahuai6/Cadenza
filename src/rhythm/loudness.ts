/* How loud a song is, the way ITU-R BS.1770 measures it (and EBU R128, ReplayGain 2 after it): the signal through the
   K-weighting (a high shelf for the head's acoustics, a high-pass below the bass the ear barely weighs), mean square
   over 400 ms blocks every 100 ms, blocks below −70 LUFS left out, then those more than 10 LU under the loud ones; the
   integrated loudness of what is left. And the sample peak, so a gain can be kept within the song's own headroom.
   The filters are derived for whatever rate the samples have (the analysis decodes at 22 kHz). */
export interface Loudness { /** integrated loudness, LUFS */ lufs: number; /** sample peak, linear (1 = full scale) */ peak: number }

function kFilter(x: Float32Array, fs: number): Float32Array {
  // stage 1: the high shelf (+4 dB above ~1.7 kHz); stage 2: the high-pass (~38 Hz)
  let K = Math.tan(Math.PI * 1681.974450955533 / fs), Q = 0.7071752369554196, Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const b = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a = [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  K = Math.tan(Math.PI * 38.13547087602444 / fs); Q = 0.5003270373238773; a0 = 1 + K / Q + K * K;
  const a2 = [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  const y = new Float32Array(x.length);
  // (both stages' states in double precision: the high-pass's poles sit close to 1)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0, w1 = 0, w2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], s = b[0] * v + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2; x2 = x1; x1 = v; y2 = y1; y1 = s;
    const o = s - 2 * z1 + z2 - a2[0] * w1 - a2[1] * w2; z2 = z1; z1 = s; w2 = w1; w1 = o; y[i] = o;
  }
  return y;
}
export function loudness(channels: Float32Array[], fs: number): Loudness {
  const ch = channels.slice(0, 2); let peak = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > peak) peak = v; }
  const n = Math.min(...ch.map(c => c.length)), blk = Math.round(fs * 0.4), hop = Math.round(fs * 0.1);
  if (!ch.length || n < blk) return { lufs: -70, peak };
  // per-hop sums of squares of the weighted signal, every channel weighted 1 (left and right)
  const nh = Math.floor(n / hop), sq = new Float64Array(nh);
  for (const c of ch) { const y = kFilter(c, fs); for (let h = 0; h < nh; h++) { let s = 0; for (let i = h * hop, e = i + hop; i < e; i++) s += y[i] * y[i]; sq[h] += s; } }
  const per = blk / hop, blocks: number[] = [];
  for (let h = 0; h + per <= nh; h++) { let s = 0; for (let k = 0; k < per; k++) s += sq[h + k]; blocks.push(s / blk); }
  const L = (z: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, z));
  const abs = blocks.filter(z => L(z) > -70); if (!abs.length) return { lufs: -70, peak };
  const rel = L(abs.reduce((a, z) => a + z, 0) / abs.length) - 10, kept = abs.filter(z => L(z) > rel);
  return { lufs: L(kept.reduce((a, z) => a + z, 0) / Math.max(1, kept.length)), peak };
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
