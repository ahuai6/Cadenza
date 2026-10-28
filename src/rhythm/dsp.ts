// Signal processing for the analysis: resampling, a radix-2 FFT, and log-spaced band energies frame by frame.

/** Mixes channels to mono and resamples to `rate` (anti-aliased by a short windowed-sinc low-pass). */
export function toMono(channels: Float32Array[], sampleRate: number, rate: number): Float32Array {
  const n = channels[0].length, mono = new Float32Array(n), k = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] * k;
  if (Math.abs(sampleRate - rate) < 1) return mono;
  const ratio = sampleRate / rate, out = new Float32Array(Math.floor(n / ratio));
  // low-pass at 0.45 × the new rate, 17 taps (Blackman-windowed sinc), applied only at the output points
  const fc = 0.45 / ratio, R = 8, taps: number[] = [];
  let sum = 0;
  for (let j = -R; j <= R; j++) {
    const x = j === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * j) / (Math.PI * j);
    const w = 0.42 + 0.5 * Math.cos(Math.PI * j / (R + 1)) + 0.08 * Math.cos(2 * Math.PI * j / (R + 1));
    taps.push(x * w); sum += x * w;
  }
  for (let j = 0; j < taps.length; j++) taps[j] /= sum;
  for (let i = 0; i < out.length; i++) {
    const c = i * ratio, c0 = Math.floor(c), f = c - c0;
    let a = 0, b = 0;
    for (let j = -R; j <= R; j++) { const q = c0 + j; if (q >= 0 && q + 1 < n) { a += mono[q] * taps[j + R]; b += mono[q + 1] * taps[j + R]; } }
    out[i] = a + (b - a) * f;
  }
  return out;
}

/** In-place complex FFT (radix 2). re/im have length N, a power of two. */
export function fft(re: Float64Array, im: Float64Array) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const a = i + k, b = a + h, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

export interface BandSpec { lo: number; hi: number }
/** Log-spaced bands between lo and hi Hz. */
export function logBands(n: number, lo: number, hi: number): BandSpec[] {
  const out: BandSpec[] = [], a = Math.log(lo), b = Math.log(hi);
  for (let i = 0; i < n; i++) out.push({ lo: Math.exp(a + (b - a) * i / n), hi: Math.exp(a + (b - a) * (i + 1) / n) });
  return out;
}

export interface Spectrogram {
  fps: number; frames: number; bands: BandSpec[];
  /** band energies, frame-major: E[f * nb + b] (power, linear) */
  E: Float32Array;
  /** RMS level per frame in dBFS */
  rms: Float32Array;
}

/** Band energies every hop samples with a Hann window of `size` samples. */
export function bandEnergies(x: Float32Array, rate: number, size: number, hop: number, bands: BandSpec[]): Spectrogram {
  const frames = Math.max(1, Math.floor((x.length - size) / hop) + 1), nb = bands.length;
  const E = new Float32Array(frames * nb), rms = new Float32Array(frames);
  const win = new Float64Array(size); for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size);
  const re = new Float64Array(size), im = new Float64Array(size), binHz = rate / size;
  // which FFT bins feed each band (at least one bin per band)
  const map = bands.map(b => { const a = Math.max(1, Math.floor(b.lo / binHz)), c = Math.max(a + 1, Math.ceil(b.hi / binHz)); return [a, Math.min(size / 2, c)]; });
  const norm = 1 / (size * size);
  for (let f = 0; f < frames; f++) {
    const o = f * hop; let s2 = 0;
    for (let i = 0; i < size; i++) { const v = x[o + i]; re[i] = v * win[i]; im[i] = 0; s2 += v * v; }
    rms[f] = 10 * Math.log10(s2 / size + 1e-12);
    fft(re, im);
    for (let b = 0; b < nb; b++) {
      const [a, c] = map[b]; let e = 0;
      for (let k = a; k < c; k++) e += re[k] * re[k] + im[k] * im[k];
      E[f * nb + b] = e * norm / (c - a);
    }
  }
  return { fps: rate / hop, frames, bands, E, rms };
}

/** Moving average over a window of 2r+1 samples (edges use what exists). */
export function smooth(a: ArrayLike<number>, r: number): Float32Array {
  const n = a.length, out = new Float32Array(n), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - r), hi = Math.min(n, i + r + 1); out[i] = (pre[hi] - pre[lo]) / (hi - lo); }
  return out;
}
/** Moving median over a window of 2r+1 samples, sampled every `step` and interpolated (fast enough for long songs). */
export function movingMedian(a: ArrayLike<number>, r: number, step = 4): Float32Array {
  const n = a.length, out = new Float32Array(n), pts: number[] = [], vals: number[] = [];
  const buf: number[] = [];
  for (let c = 0; c < n; c += step) {
    buf.length = 0; for (let i = Math.max(0, c - r); i < Math.min(n, c + r + 1); i++) buf.push(a[i]);
    buf.sort((x, y) => x - y); pts.push(c); vals.push(buf[buf.length >> 1]);
  }
  for (let k = 0; k < pts.length; k++) {
    const c0 = pts[k], c1 = k + 1 < pts.length ? pts[k + 1] : n, v0 = vals[k], v1 = k + 1 < vals.length ? vals[k + 1] : v0;
    for (let i = c0; i < c1 && i < n; i++) out[i] = v0 + (v1 - v0) * (i - c0) / Math.max(1, c1 - c0);
  }
  return out;
}
