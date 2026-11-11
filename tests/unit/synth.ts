// Synthetic songs with exact ground truth, for testing the rhythm analysis: drums, bass and pads placed by a score.
import { mulberry32 } from '../../src/core/rng';

export type Hit = { t: number; kind: 'kick' | 'snare' | 'hat' | 'crash' | 'bass' | 'clap'; gain?: number; f?: number };
export interface Song {
  sr: number;
  dur: number;
  hits: Hit[];
  pads?: { t0: number; t1: number; gain: number; f: number[] }[];
}

export function render(song: Song): Float32Array {
  const { sr, dur } = song,
    n = Math.ceil(dur * sr),
    out = new Float32Array(n),
    rng = mulberry32(7);
  const noise = new Float32Array(sr);
  for (let i = 0; i < noise.length; i++) noise[i] = rng() * 2 - 1;
  const tail = (i: number, len: number) => Math.min(1, (len - i) / (0.02 * sr));
  for (const h of song.hits) {
    const g = h.gain ?? 1,
      i0 = Math.round(h.t * sr);
    if (h.kind === 'kick') {
      let ph = 0;
      for (let i = 0; i < 0.35 * sr && i0 + i < n; i++) {
        const t = i / sr,
          f = 50 + 110 * Math.exp(-t * 28);
        ph += (2 * Math.PI * f) / sr;
        out[i0 + i] += g * 0.9 * Math.sin(ph) * Math.exp(-t * 9) * Math.min(1, i / 30) * tail(i, 0.35 * sr);
      }
    } else if (h.kind === 'snare' || h.kind === 'clap') {
      let lp = 0;
      for (let i = 0; i < 0.22 * sr && i0 + i < n; i++) {
        const t = i / sr,
          w = noise[(i * 3) % sr];
        const hp = w - lp;
        lp += 0.25 * (w - lp);
        out[i0 + i] +=
          g *
          (0.45 * hp * Math.exp(-t * 18) + 0.3 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 25)) *
          tail(i, 0.22 * sr);
      }
    } else if (h.kind === 'hat') {
      let prev = 0;
      for (let i = 0; i < 0.05 * sr && i0 + i < n; i++) {
        const t = i / sr,
          w = noise[(i * 7 + i0) % sr];
        out[i0 + i] += g * 0.22 * (w - prev) * Math.exp(-t * 70);
        prev = w;
      }
    } else if (h.kind === 'crash') {
      let prev = 0;
      for (let i = 0; i < 1.2 * sr && i0 + i < n; i++) {
        const t = i / sr,
          w = noise[(i * 5 + 11) % sr];
        out[i0 + i] += g * 0.3 * (w - prev * 0.6) * Math.exp(-t * 2.5) * tail(i, 1.2 * sr);
        prev = w;
      }
    } else if (h.kind === 'bass') {
      const f = h.f ?? 55,
        len = (h as any).len ?? 0.4;
      for (let i = 0; i < len * sr && i0 + i < n; i++) {
        const t = i / sr;
        out[i0 + i] +=
          g *
          0.35 *
          (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t)) *
          Math.min(1, t * 200) *
          Math.exp(-t * 1.2) *
          tail(i, len * sr);
      }
    }
  }
  for (const p of song.pads || []) {
    for (let i = Math.round(p.t0 * sr); i < Math.min(n, Math.round(p.t1 * sr)); i++) {
      const t = i / sr,
        env = Math.min(1, (t - p.t0) * 2, (p.t1 - t) * 2);
      let v = 0;
      for (const f of p.f) v += Math.sin(2 * Math.PI * f * t);
      out[i] += p.gain * 0.08 * v * env;
    }
  }
  // gentle limiter
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 0.9);
  return out;
}

/** A steady groove: kick on 1 and 3, snare on 2 and 4, eighth hats. Returns the song and its true beats/downbeats. */
export function groove(
  bpm: number,
  bars: number,
  opts: { meter?: number; t0?: number; gain?: number; hats?: boolean; sr?: number } = {},
) {
  const m = opts.meter ?? 4,
    b = 60 / bpm,
    t0 = opts.t0 ?? 0.5,
    g = opts.gain ?? 1,
    hits: Hit[] = [],
    beats: number[] = [],
    downs: number[] = [];
  for (let k = 0; k < bars * m; k++) {
    const t = t0 + k * b,
      pos = k % m;
    beats.push(t);
    if (pos === 0) downs.push(t);
    if (m === 4) {
      if (pos === 0 || pos === 2) hits.push({ t, kind: 'kick', gain: g * (pos === 0 ? 1 : 0.85) });
      if (pos === 1 || pos === 3) hits.push({ t, kind: 'snare', gain: g * 0.8 });
    } else {
      if (pos === 0) {
        hits.push({ t, kind: 'kick', gain: g });
        hits.push({ t, kind: 'bass', gain: g * 0.8, f: 55 });
      } else hits.push({ t, kind: 'snare', gain: g * 0.35 });
    }
    if (opts.hats !== false) {
      hits.push({ t, kind: 'hat', gain: g * 0.6 });
      hits.push({ t: t + b / 2, kind: 'hat', gain: g * 0.4 });
    }
    if (pos === 0 && m === 4) {
      const bar = Math.floor(k / m);
      hits.push({ t, kind: 'bass', gain: g * 0.9, f: [55, 49, 41.2, 46.2][bar % 4], len: m * b * 0.95 } as Hit);
      if (bar % 4 === 0) hits.push({ t, kind: 'crash', gain: g * 0.5 });
    }
  }
  return { hits, beats, downs, end: t0 + bars * m * b };
}
