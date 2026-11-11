// The log-mel spectrogram Beat This! was trained on, and the FFT it is made with.
// Ported from Folia (https://github.com/chthollyphile/folia-major, AGPL-3.0): src/services/analysis/beatThis.ts
// (melSpectrogram, the filterbank) and src/services/automix/signalAnalysis.ts (fft). Synchronous here: it runs in the
// neural engine's own worker, never on the page's thread. Part of Cadenza, AGPL-3.0-only (LICENSE, NOTICE.md).
//
// Every constant is a contract with the checkpoint, not a tuning knob (read off the reference C++ port,
// mosynthkey/beat_this_cpp, MIT): changing one makes the model confidently wrong, not slightly different.

/** Beat This! runs at 22.05 kHz mono. */
export const BEAT_THIS_SAMPLE_RATE = 22050;
const N_FFT = 1024;
const HOP = 441;
/** 22050 / 441: every output frame is a fiftieth of a second. */
export const BEAT_THIS_FPS = BEAT_THIS_SAMPLE_RATE / HOP;
const N_MELS = 128;
const F_MIN = 30;
const F_MAX = 11000;
/** Inside log1p, so the compressed scale matches what the checkpoint saw. */
const LOG_MULTIPLIER = 1000;
const AMIN = 1e-10;
/** Mel bands per spectrogram frame. */
export const MEL_BANDS = N_MELS;

export interface MelSpectrogram {
  /** frames × 128, row-major, ready for the model as [1, frames, 128] */
  data: Float32Array;
  frames: number;
}

/** Slaney mel, the torchaudio default: linear to 1 kHz, logarithmic above. */
const hzToMel = (hz: number) => {
  const fSp = 200 / 3;
  return hz < 1000 ? hz / fSp : 1000 / fSp + Math.log(hz / 1000) / (Math.log(6.4) / 27);
};
const melToHz = (mel: number) => {
  const fSp = 200 / 3,
    minLog = 1000 / fSp;
  return mel < minLog ? fSp * mel : 1000 * Math.exp((Math.log(6.4) / 27) * (mel - minLog));
};

interface MelBand {
  weights: Float64Array;
  start: number;
  end: number;
}
/** Triangles laid out in hertz between mel-spaced corners (as torchaudio does); each band keeps the bins it covers. */
function buildFilterbank(): MelBand[] {
  const bins = N_FFT / 2 + 1,
    m0 = hzToMel(F_MIN),
    m1 = hzToMel(F_MAX);
  const corners = Array.from({ length: N_MELS + 2 }, (_, i) => melToHz(m0 + ((m1 - m0) * i) / (N_MELS + 1)));
  return Array.from({ length: N_MELS }, (_, band) => {
    const row = new Float64Array(bins),
      [left, centre, right] = [corners[band], corners[band + 1], corners[band + 2]];
    for (let bin = 0; bin < bins; bin++) {
      const hz = (bin * BEAT_THIS_SAMPLE_RATE) / N_FFT,
        up = centre === left ? 0 : (hz - left) / (centre - left),
        down = right === centre ? 0 : (right - hz) / (right - centre);
      row[bin] = Math.max(0, Math.min(up, down));
    }
    let start = 0;
    while (start < bins && row[start] === 0) start++;
    let end = bins;
    while (end > start && row[end - 1] === 0) end--;
    return { weights: row, start, end };
  });
}
/** Centre frequency of each mel band (Hz): where its triangle peaks. */
export const melBandCentresHz = (): number[] => {
  const m0 = hzToMel(F_MIN),
    m1 = hzToMel(F_MAX);
  return Array.from({ length: N_MELS }, (_, b) => melToHz(m0 + ((m1 - m0) * (b + 1)) / (N_MELS + 1)));
};

const REV = new Map<number, Uint32Array>();
function bitReversalOf(n: number) {
  let r = REV.get(n);
  if (r) return r;
  r = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let x = i,
      y = 0;
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    r[i] = y;
  }
  REV.set(n, r);
  return r;
}
/** In-place radix-2 FFT. */
export function fft(real: Float64Array, imag: Float64Array) {
  const n = real.length,
    rev = bitReversalOf(n);
  for (let i = 1; i < n; i++) {
    const j = rev[i];
    if (i < j) {
      let s = real[i];
      real[i] = real[j];
      real[j] = s;
      s = imag[i];
      imag[i] = imag[j];
      imag[j] = s;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len,
      wr = Math.cos(ang),
      wi = Math.sin(ang),
      h = len / 2;
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < h; k++) {
        const ar = real[i + k],
          ai = imag[i + k],
          br = real[i + k + h] * cr - imag[i + k + h] * ci,
          bi = real[i + k + h] * ci + imag[i + k + h] * cr;
        real[i + k] = ar + br;
        imag[i + k] = ai + bi;
        real[i + k + h] = ar - br;
        imag[i + k + h] = ai - bi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

let FB: MelBand[] | null = null,
  HANN: Float64Array | null = null;
/** The spectrogram, centred like torch.stft(center=True, pad_mode='reflect'): without the half-window reflection every
 *  beat comes out 23 ms late, most of the tolerance a grid is judged on. */
export function melSpectrogram(mono: Float32Array): MelSpectrogram {
  if (!FB) FB = buildFilterbank();
  if (!HANN) {
    HANN = new Float64Array(N_FFT);
    for (let i = 0; i < N_FFT; i++) HANN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N_FFT));
  }
  const pad = N_FFT / 2,
    padded = new Float64Array(mono.length + 2 * pad);
  // (reflect without repeating the edge sample: numpy's 'reflect', torch's default)
  for (let i = 0; i < pad; i++) {
    padded[i] = mono[Math.min(pad - i, mono.length - 1)] ?? 0;
    padded[padded.length - 1 - i] = mono[Math.max(0, mono.length - 1 - (pad - i))] ?? 0;
  }
  padded.set(mono, pad);
  const frames = Math.floor((padded.length - N_FFT) / HOP) + 1;
  if (frames <= 0) return { data: new Float32Array(0), frames: 0 };
  const data = new Float32Array(frames * N_MELS),
    re = new Float64Array(N_FFT),
    im = new Float64Array(N_FFT),
    mag = new Float64Array(N_FFT / 2 + 1),
    scale = 1 / Math.sqrt(N_FFT);
  for (let f = 0; f < frames; f++) {
    const s = f * HOP;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = padded[s + i] * HANN[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < mag.length; b++) mag[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b]) * scale;
    for (let band = 0; band < N_MELS; band++) {
      const { weights, start, end } = FB[band];
      let e = 0;
      for (let b = start; b < end; b++) e += mag[b] * weights[b];
      data[f * N_MELS + band] = Math.log1p(LOG_MULTIPLIER * Math.max(e, AMIN));
    }
  }
  return { data, frames };
}
