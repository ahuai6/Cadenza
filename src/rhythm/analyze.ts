/* The rhythm analysis: from samples to the song's beats, bars, accents and sections, the way a listener hears them.

   1. Spectrum. Mono at 22 kHz, a 46 ms Hann window every 10 ms, energies in 24 log-spaced bands (30 Hz – 10 kHz),
      compressed against each band's own noise floor so the result does not depend on the mix's overall level.
   2. Onsets. Spectral flux per band (the rise of each band against the strongest neighbour of the previous frame, which
      ignores vibrato and slides), summed into a low, a mid and a high onset function. Peaks above a moving median are
      onsets; their times are refined by parabolic interpolation. Every onset is an event candidate.
   3. Tempo. Autocorrelation of the onset function, scored as a comb (the beat period and its multiples), weighed by a
      perceptual preference for tempi near 120 BPM (a log-normal "resonance" curve).
   4. Beats. Dynamic programming (after Ellis 2007) over the onset function with a local tempo that may drift, then each
      beat is drawn to a clear onset close to it, so pushed or laid-back beats are followed.
   5. Bars. The meter (3 or 4) and the downbeat phase from where the low end hits and where the sound changes.
   6. Accents. Each event gets a perceived strength from three things at once (after Lerdahl & Jackendoff): how much
      arrives (onset size, loudness, which band), how unexpected it is (against what this bar position has been doing),
      and where it falls in the bar. Strength sorts events into light, medium and strong tiers, song-relative. Several
      events of different strengths may fall within one beat; off-beat accents and pushes are marked.
   7. Structure. Beat-synchronous timbre and loudness give a self-similarity matrix; its novelty marks section changes,
      snapped to bars. Each section has a level and an event density; a big rise in level is a drop, the climb before it
      a build. */
import { clamp, quantile, median, mean, bisect } from '../core/math';
import { toMono, bandEnergies, logBands, smooth, movingMedian } from './dsp';
import { loudness } from './loudness';
import { RHYTHM_VERSION, type RhythmAnalysis, type RhythmEvent, type Section, type Band, type Tier } from './types';

const RATE = 22000, SIZE = 1024, HOP = 220, FPS = RATE / HOP;   // 100 frames per second
const OUT_RATE = 50;                                               // rate of the series stored in the result
/** Bias of a detected onset against the true attack (window centre vs. flux response), measured on clicks. */
const ONSET_BIAS = 0.037;

export interface AnalyzeOptions { /** report progress 0..1 */ progress?: (k: number) => void }

/** A coarse spectrum for displays: the compressed band energies in SPEC_BANDS groups, low to high, each lightly smoothed
 *  and scaled song-relative (0 its quiet floor, 1 its loud peaks), so a display moves with the music whatever the mix. */
export const SPEC_BANDS = 6;
function specBands(L: Float32Array, F: number, nb: number): Float32Array[] {
  const per = nb / SPEC_BANDS, out: Float32Array[] = [];
  for (let k = 0; k < SPEC_BANDS; k++) {
    const b0 = Math.floor(k * per), b1 = Math.floor((k + 1) * per), v = new Float32Array(F);
    for (let f = 0; f < F; f++) { let a = 0; for (let b = b0; b < b1; b++) a += L[f * nb + b]; v[f] = a / Math.max(1, b1 - b0); }
    const g = smooth(v, 1), lo = quantile(g, 0.08), hi = quantile(g, 0.985) || 1;
    for (let f = 0; f < F; f++) v[f] = clamp((g[f] - lo) / Math.max(1e-6, hi - lo));
    out.push(v);
  }
  return out;
}

export function analyze(channels: Float32Array[], sampleRate: number, opts: AnalyzeOptions = {}): RhythmAnalysis {
  const prog = opts.progress || (() => {});
  const x = toMono(channels, sampleRate, RATE); prog(0.1);
  const duration = x.length / RATE;
  const bands = logBands(24, 30, 10000), nb = bands.length;
  const sp = bandEnergies(x, RATE, SIZE, HOP, bands); prog(0.45);
  const F = sp.frames;

  /* ---- 1–2. compressed bands, flux, onset functions ---- */
  const L = new Float32Array(F * nb);
  for (let b = 0; b < nb; b++) {
    const col = new Float32Array(F); for (let f = 0; f < F; f++) col[f] = sp.E[f * nb + b];
    let mx = 0; for (let f = 0; f < F; f++) if (col[f] > mx) mx = col[f];
    const floor = Math.max(mx * 1e-7, 1e-30, quantile(col, 0.3) * 0.5 + quantile(col, 0.5) * 0.05);   // relative: independent of the mix level
    for (let f = 0; f < F; f++) L[f * nb + b] = Math.log1p(col[f] / floor);
  }
  const centre = bands.map(b => Math.sqrt(b.lo * b.hi));
  const grp = centre.map(c => (c < 200 ? 0 : c < 2500 ? 1 : 2));
  const cnt = [0, 0, 0]; grp.forEach(g => cnt[g]++);
  const lo = new Float32Array(F), mi = new Float32Array(F), hi = new Float32Array(F);
  for (let f = 1; f < F; f++) {
    for (let b = 0; b < nb; b++) {
      const p = Math.max(L[(f - 1) * nb + b], b > 0 ? L[(f - 1) * nb + b - 1] : 0, b + 1 < nb ? L[(f - 1) * nb + b + 1] : 0);
      const d = Math.max(0, L[f * nb + b] - p);
      if (grp[b] === 0) lo[f] += d; else if (grp[b] === 1) mi[f] += d; else hi[f] += d;
    }
    lo[f] /= cnt[0]; mi[f] /= cnt[1]; hi[f] /= cnt[2];
  }
  const odfRaw = new Float32Array(F);
  for (let f = 0; f < F; f++) odfRaw[f] = 1.0 * lo[f] + 0.8 * mi[f] + 0.55 * hi[f];
  const q95 = quantile(odfRaw, 0.95) || 1;
  const odf = new Float32Array(F); for (let f = 0; f < F; f++) odf[f] = odfRaw[f] / q95;

  // loudness: fast (0.15 s) and section level (3 s), both song-relative
  const db = sp.rms;
  let dbMax = -200; for (let f = 0; f < F; f++) if (db[f] > dbMax) dbMax = db[f];
  const audible = Array.from(db).filter(v => v > dbMax - 60);
  const d95 = quantile(audible.length ? audible : db, 0.97), d05 = Math.max(quantile(audible.length ? audible : db, 0.05), d95 - 45);
  // averaged as power, then back to dB (a mean in dB would be dominated by the silence between hits)
  const pw = new Float32Array(F); for (let f = 0; f < F; f++) pw[f] = 10 ** (db[f] / 10);
  const toDb = (a: Float32Array) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = 10 * Math.log10(a[i] + 1e-12); return o; };
  const fastDb = toDb(smooth(pw, Math.round(0.15 * FPS))), slowDb = toDb(smooth(pw, Math.round(1.5 * FPS)));
  const s10 = quantile(slowDb, 0.1), s90 = quantile(slowDb, 0.9), flat = s90 - s10 < 3;
  const loud = new Float32Array(F), level = new Float32Array(F);
  for (let f = 0; f < F; f++) {
    loud[f] = clamp((fastDb[f] - d05) / Math.max(3, d95 - d05));
    level[f] = flat ? (slowDb[f] > d05 + 6 ? 0.75 : 0.1) : clamp((slowDb[f] - s10) / (s90 - s10));
  }
  prog(0.55);

  /* ---- onsets: peaks over a moving median ---- */
  const med = movingMedian(odf, Math.round(0.5 * FPS));
  const cands: { f: number; t: number; v: number }[] = [];
  for (let f = 2; f < F - 2; f++) {
    const v = odf[f]; if (v < med[f] + 0.07 || v < 0.05) continue;
    let peak = true; for (let k = -3; k <= 3; k++) if (k && odf[f + k] > v) { peak = false; break; }
    if (!peak) continue;
    if (cands.length && f - cands[cands.length - 1].f < 4) { if (v > cands[cands.length - 1].v) cands.pop(); else continue; }
    const a = odf[f - 1], c = odf[f + 1], den = a - 2 * v + c, p = den < 0 ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0;
    cands.push({ f, t: (f + p) * HOP / RATE + ONSET_BIAS, v: v - med[f] * 0.5 });
  }

  /* ---- 3. tempo ---- */
  const ce = new Float32Array(F); { const tw = new Float32Array(F); for (let f = 0; f < F; f++) tw[f] = lo[f] + 0.8 * mi[f] + 0.2 * hi[f];
    const mm = smooth(tw, Math.round(0.3 * FPS)); for (let f = 0; f < F; f++) ce[f] = Math.max(0, tw[f] - mm[f]); }
  const acAt = (sig: Float32Array, lag: number, a = 0, b = sig.length) => {
    const l0 = Math.floor(lag), fr = lag - l0; let v = 0, n = 0;
    for (let f = a; f < b - l0 - 1; f++) { v += sig[f] * (sig[f + l0] * (1 - fr) + sig[f + l0 + 1] * fr); n++; }
    return n ? v / n : 0;
  };
  const prior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.1) ** 2);
  const comb = (lag: number, a?: number, b?: number) => acAt(ce, lag, a, b) + 0.5 * acAt(ce, lag * 2, a, b) + 0.33 * acAt(ce, lag * 3, a, b) + 0.25 * acAt(ce, lag * 4, a, b) + 0.35 * acAt(ce, lag / 2, a, b);
  let best = -1, bpm = 120, tot = 0, nT = 0;
  for (let x2 = 50; x2 <= 220; x2 += 0.5) { const v = comb(60 * FPS / x2) * prior(x2); tot += v; nT++; if (v > best) { best = v; bpm = x2; } }
  for (let x2 = bpm - 0.5; x2 <= bpm + 0.5; x2 += 0.05) { const v = comb(60 * FPS / x2) * prior(x2); if (v > best) { best = v; bpm = x2; } }
  bpm = Math.abs(bpm - Math.round(bpm)) < 0.25 ? Math.round(bpm) : Math.round(bpm * 10) / 10;
  const confidence = best / ((tot / nT) || 1);
  prog(0.65);

  /* ---- 4. beats: DP with a locally drifting period ---- */
  const P0 = 60 * FPS / bpm;
  // local period every second from a 6 s window, kept within ±12 % of the global one
  const localP = new Float32Array(F);
  { const win = Math.round(6 * FPS), step = Math.round(FPS); const pts: number[] = [];
    for (let c = 0; c < F; c += step) {
      const a = Math.max(0, c - win / 2), b = Math.min(F, c + win / 2); let bv = -1, bp = P0;
      for (let k = -12; k <= 12; k++) { const p = P0 * (1 + k / 100); const v = acAt(ce, p, a, b) + 0.5 * acAt(ce, 2 * p, a, b); if (v > bv) { bv = v; bp = p; } }
      pts.push(bp);
    }
    const sm = smooth(pts, 2);
    for (let f = 0; f < F; f++) { const k = Math.min(sm.length - 1, Math.floor(f / step)); localP[f] = sm[k]; } }
  const sd = Math.sqrt(mean(odf.map(v => v * v))) || 1;
  const loc = new Float32Array(F); { const g = smooth(odf, 1); for (let f = 0; f < F; f++) loc[f] = g[f] / sd; }
  const score = new Float32Array(F), back = new Int32Array(F).fill(-1), tight = 100;
  for (let f = 0; f < F; f++) {
    const P = localP[f], lo2 = Math.round(P * 0.5), hi2 = Math.round(P * 2); let bv = -1e9, arg = -1;
    for (let tau = f - hi2; tau <= f - lo2; tau++) {
      if (tau < 0) continue; const d = Math.log((f - tau) / P), v = score[tau] - tight * d * d;
      if (v > bv) { bv = v; arg = tau; }
    }
    if (arg >= 0 && bv > 0) { score[f] = loc[f] + bv; back[f] = arg; } else score[f] = loc[f];
  }
  let end = F - 1, ev = -1e9; for (let f = Math.max(0, F - Math.round(P0 * 1.5)); f < F; f++) if (score[f] > ev) { ev = score[f]; end = f; }
  const bf: number[] = []; for (let f = end; f >= 0; f = back[f]) { bf.push(f); if (back[f] < 0) break; }
  bf.reverse();
  // draw each beat to a clear onset close to it (within 6 % of a beat): the played beat, not the grid
  const beats = bf.map(f => {
    const P = localP[f], r = Math.max(2, Math.round(P * 0.06)); let bv = odf[f], bfr = f;
    for (let k = -r; k <= r; k++) { const g = f + k; if (g > 0 && g < F && odf[g] > bv * 1.15 && odf[g] > 0.3) { bv = odf[g]; bfr = g; } }
    return bfr * HOP / RATE + ONSET_BIAS;
  });
  // extend the grid to the start of the file (the DP may begin late in a quiet intro)
  if (beats.length > 4) { const p = beats[1] - beats[0]; while (beats[0] - p > 0.05) beats.unshift(beats[0] - p); }
  prog(0.72);

  /* ---- 5. meter, downbeat, phrases, half-time ---- */
  const nBeats = beats.length;
  const fr = (t: number) => clamp(Math.round((t - ONSET_BIAS) * RATE / HOP), 0, F - 1);
  const maxIn = (a: Float32Array, f: number, r: number) => { let m = 0; for (let k = f - r; k <= f + r; k++) if (k >= 0 && k < F) m = Math.max(m, a[k]); return m; };
  const lowAt = beats.map(t => maxIn(lo, fr(t), 3)), broadAt = beats.map(t => maxIn(odf, fr(t), 2)), midAt = beats.map(t => maxIn(mi, fr(t), 3));
  // timbre change between the beat before and the beat after each beat
  const prof = (a: number, b: number) => { const v = new Float32Array(nb); const f0 = fr(a), f1 = Math.max(f0 + 1, fr(b)); for (let f = f0; f < f1; f++) for (let k = 0; k < nb; k++) v[k] += L[f * nb + k]; for (let k = 0; k < nb; k++) v[k] /= (f1 - f0); return v; };
  const profs = beats.map((t, i) => prof(t, i + 1 < nBeats ? beats[i + 1] : t + (beats[1] - beats[0] || 0.5)));
  const cosd = (a: Float32Array, b: Float32Array) => { let ab = 0, aa = 0, bb = 0; for (let k = 0; k < nb; k++) { ab += a[k] * b[k]; aa += a[k] * a[k]; bb += b[k] * b[k]; } return 1 - ab / (Math.sqrt(aa * bb) || 1); };
  const nov = beats.map((_, i) => (i ? cosd(profs[i - 1], profs[i]) : 0));
  const z = (a: number[]) => { const m = mean(a), s = Math.sqrt(mean(a.map(v => (v - m) ** 2))) || 1; return a.map(v => (v - m) / s); };
  const zl = z(lowAt), zn = z(nov), zb = z(broadAt);
  const barScore = (m: number, p: number) => { let on = 0, no = 0, off = 0, nf = 0; for (let i = 0; i < nBeats; i++) { const v = zl[i] + 0.9 * zn[i] + 0.4 * zb[i]; if (((i - p) % m + m) % m === 0) { on += v; no++; } else { off += v; nf++; } } return (no ? on / no : 0) - (nf ? off / nf : 0); };
  let meter = 4, downbeat = 0, b4 = -1e9, b3 = -1e9, p3 = 0;
  for (let p = 0; p < 4; p++) { const v = barScore(4, p); if (v > b4) { b4 = v; downbeat = p; } }
  for (let p = 0; p < 3; p++) { const v = barScore(3, p); if (v > b3) { b3 = v; p3 = p; } }
  if (b3 > b4 * 1.3 && b3 > 0.35) { meter = 3; downbeat = p3; }
  const isDown = (i: number) => ((i - downbeat) % meter + meter) % meter === 0;
  // half-time: the backbeat lands on 3 rather than on 2 and 4
  let halfTime = false;
  if (meter === 4) { const pos = [0, 0, 0, 0]; for (let i = 0; i < nBeats; i++) pos[((i - downbeat) % 4 + 4) % 4] += midAt[i]; halfTime = pos[2] > 1.35 * Math.max(pos[1], pos[3]); }

  /* ---- 6. events: strength, tier, band, position ---- */
  const posOf = (t: number) => {
    const i = bisect(beats, t); if (i < 0) { const p = beats[1] - beats[0] || 0.5; const k = (t - beats[0]) / p; return { i: Math.floor(k), frac: k - Math.floor(k) }; }
    const nx = i + 1 < nBeats ? beats[i + 1] : beats[i] + (beats[i] - beats[i - 1] || 0.5); return { i, frac: (t - beats[i]) / (nx - beats[i]) };
  };
  const lmBands = grp.map((g, b) => (g < 2 ? b : -1)).filter(b => b >= 0);
  const arrival = (f: number) => { const w = Math.round(0.15 * FPS), A = new Float64Array(lmBands.length), B = new Float64Array(lmBands.length);
    for (let k = 1; k <= w; k++) { const a = f - k - 1, b = f + k + 1; lmBands.forEach((bb, j) => { if (a >= 0) A[j] += L[a * nb + bb]; if (b < F) B[j] += L[b * nb + bb]; }); }
    let ab = 0, aa = 0, bb2 = 0; for (let j = 0; j < A.length; j++) { ab += A[j] * B[j]; aa += A[j] * A[j]; bb2 += B[j] * B[j]; } return 1 - ab / (Math.sqrt(aa * bb2) || 1); };
  // a cymbal that keeps ringing: the high bands stay up for a few hundred ms after the hit
  const hiBands = grp.map((g, b) => (g === 2 ? b : -1)).filter(b => b >= 0);
  const hiMean = (a: number, b: number) => { let v = 0, n = 0; for (let f = Math.max(0, a); f < Math.min(F, b); f++) { for (const bb of hiBands) v += L[f * nb + bb]; n++; } return n ? v / n / hiBands.length : 0; };
  const sustain = (f: number) => Math.max(0, hiMean(f + 8, f + 30) - hiMean(f - 12, f - 2));
  type Ev = RhythmEvent & { raw: number; slot: number; bar: number; f: number; arr: number; sus: number };
  const evs: Ev[] = [];
  for (const c of cands) {
    const f = c.f, l = maxIn(lo, f, 1), m = maxIn(mi, f, 1), h = maxIn(hi, f, 1), sum = l + m + h || 1e-9;
    const band: Band = l / sum > 0.5 ? 'low' : h / sum > 0.55 ? 'high' : l / sum > 0.22 && m / sum > 0.2 && h / sum > 0.15 ? 'broad' : 'mid';
    const { i, frac } = posOf(c.t);
    const bi = ((i - downbeat) % meter + meter) % meter, near = Math.min(frac, 1 - frac);
    const onBeat = near < 0.12, beatIdx = frac > 0.88 ? bi + 1 : bi;
    const pos = onBeat ? (beatIdx % meter) : bi + frac;
    const bar = Math.floor((i - downbeat) / meter) + (frac > 0.88 && bi === meter - 1 ? 1 : 0);
    const slot = Math.round(pos * 2) % (meter * 2);          // eighth-note slot in the bar
    const lw = loud[f];
    const bw = band === 'low' ? 1.15 : band === 'broad' ? 1.1 : band === 'mid' ? 1.0 : 0.6;
    const raw = c.v * (0.45 + 0.55 * lw) * bw;
    evs.push({ t: c.t, s: 0, tier: 0, band, pos, off: !onBeat, raw, slot, bar, f, arr: arrival(f), sus: sustain(f) });
  }
  // surprise: against what this slot has done over the last four bars (a kick on every beat stops being news)
  const medAll = median(evs.map(e => e.raw)) || 1e-3;
  const arrQ = quantile(evs.map(e => e.arr), 0.9) || 1e-3, susQ = quantile(evs.map(e => e.sus), 0.9) || 1e-3;
  const bySlot = new Map<number, { bar: number; raw: number }[]>();
  for (const e of evs) {
    const hist = bySlot.get(e.slot) || []; const recent = hist.filter(h => h.bar >= e.bar - 4 && h.bar < e.bar).map(h => h.raw);
    const ref = recent.length >= 3 ? median(recent) : medAll;
    const sur = e.raw / (ref + 0.25 * medAll);
    const metric = !e.off && Math.round(e.pos) % meter === 0 ? 1.3 : !e.off ? 1.0 : 0.9;
    e.s = e.raw * Math.sqrt(clamp(sur, 0.75, 2.5)) * metric * (1 + 0.7 * clamp(e.arr / arrQ)) * (1 + 0.4 * clamp(e.sus / susQ));
    hist.push({ bar: e.bar, raw: e.raw }); bySlot.set(e.slot, hist);
  }
  const loudEv = evs.filter(e => loud[e.f] > 0.45 && !e.off).map(e => e.s);
  const unit = quantile(loudEv.length > 8 ? loudEv : evs.map(e => e.s), 0.75) || 1e-3;
  for (const e of evs) {
    e.s = e.s / unit;
    e.tier = (e.s >= 1.3 && loud[e.f] >= 0.3 && e.band !== 'high' ? 2 : e.s >= 0.5 ? 1 : 0) as Tier;
  }
  prog(0.82);

  /* ---- 7. structure ---- */
  const bar0 = beats[downbeat] ?? 0;
  const vecs = profs.map(p => Array.from(p));
  const dims = nb, mu = new Float64Array(dims), sg = new Float64Array(dims);
  for (const v of vecs) for (let k = 0; k < dims; k++) mu[k] += v[k] / vecs.length;
  for (const v of vecs) for (let k = 0; k < dims; k++) sg[k] += (v[k] - mu[k]) ** 2 / vecs.length;
  const zv = vecs.map(v => v.map((x2, k) => (x2 - mu[k]) / (Math.sqrt(sg[k]) || 1)));
  const lvAt = beats.map(t => level[fr(t)]);
  const sim = (a: number, b: number) => { const A = zv[a], B = zv[b]; let ab = 0, aa = 0, bb = 0; for (let k = 0; k < dims; k++) { ab += A[k] * B[k]; aa += A[k] * A[k]; bb += B[k] * B[k]; } return ab / (Math.sqrt(aa * bb) || 1) - 1.5 * Math.abs(lvAt[a] - lvAt[b]); };
  const K = 8 * meter / 4 * 2;                     // kernel half-width: about two bars on each side … in beats
  const novS = new Float32Array(nBeats);
  for (let i = K; i < nBeats - K; i++) {
    let v = 0;
    for (let a = -K; a < K; a++) for (let b = -K; b < K; b++) {
      const sgn = (a < 0) === (b < 0) ? 1 : -1, g = Math.exp(-((a + 0.5) ** 2 + (b + 0.5) ** 2) / (2 * (K * 0.6) ** 2));
      v += sgn * g * sim(i + a, i + b);
    }
    novS[i] = Math.max(0, v);
  }
  const nm = mean(novS), ns = Math.sqrt(mean(Array.from(novS).map(v => (v - nm) ** 2))) || 1;
  const bounds: number[] = [];
  const minGap = meter * 4;                        // sections are at least four bars
  const peaks: { i: number; v: number }[] = [];
  for (let i = 1; i < nBeats - 1; i++) if (novS[i] > nm + 0.6 * ns && novS[i] >= novS[i - 1] && novS[i] >= novS[i + 1]) peaks.push({ i, v: novS[i] });
  peaks.sort((a, b) => b.v - a.v);
  for (const p of peaks) {
    // snap to the nearest downbeat
    let j = p.i; for (let d = 0; d < meter; d++) { if (j - d >= 0 && isDown(j - d)) { j = j - d; break; } if (j + d < nBeats && isDown(j + d)) { j = j + d; break; } }
    if (bounds.every(b => Math.abs(b - j) >= minGap)) bounds.push(j);
  }
  bounds.sort((a, b) => a - b);
  const lowLv = new Float32Array(F); { const le = new Float32Array(F); for (let f = 0; f < F; f++) { let v = 0; for (let b = 0; b < nb; b++) if (grp[b] === 0) v += L[f * nb + b]; le[f] = v / cnt[0]; }
    const sm = smooth(le, Math.round(1.5 * FPS)), a10 = quantile(sm, 0.1), a90 = quantile(sm, 0.9); for (let f = 0; f < F; f++) lowLv[f] = clamp((sm[f] - a10) / Math.max(1e-3, a90 - a10)); }
  const levelAt = (t: number) => level[fr(t)];
  const evDensity = (t0: number, t1: number) => { const n = evs.filter(e => e.t >= t0 && e.t < t1 && e.tier >= 1).length, nbt = Math.max(1, (t1 - t0) / (60 / bpm)); return n / nbt; };
  const cuts = [0, ...bounds.map(i => beats[i]), duration];
  const sections: Section[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const t0 = cuts[k], t1 = cuts[k + 1]; if (t1 - t0 < 0.5) continue;
    const a = fr(t0), b = fr(t1); const e = mean(level, a, b);
    const barT = meter * 60 / bpm, before = mean(level, fr(t0 - 2 * barT), a), after = mean(level, a, fr(t0 + 2 * barT));
    const lb = mean(lowLv, fr(t0 - 2 * barT), a), la = mean(lowLv, a, fr(t0 + 2 * barT));
    sections.push({ t0, t1, energy: e, density: evDensity(t0, t1), drop: k > 0 && (after - before >= 0.3 || la - lb >= 0.35) && after >= 0.6 && la >= 0.6 });
  }
  // one drop per eight bars at most
  for (let k = 1; k < sections.length; k++) if (sections[k].drop && sections.slice(0, k).some(s => s.drop && sections[k].t0 - s.t0 < 8 * meter * 60 / bpm)) sections[k].drop = false;
  const builds: [number, number][] = [];
  for (const s of sections) {
    if (!s.drop) continue; const barT = meter * 60 / bpm; let st = s.t0;
    for (let b = 1; b <= 8; b++) { const a = s.t0 - b * barT; if (a < 0) break; if (levelAt(a) > levelAt(a + barT) + 0.02 || evDensity(a, a + barT) > evDensity(a + barT, a + 2 * barT) * 1.3 + 0.1) break; st = a; }
    if (s.t0 - st >= 2 * barT) builds.push([st, s.t0]);
  }
  // a drop's downbeat is a strong event even when the spectrum change is soft
  for (const s of sections) if (s.drop) { const e = evs.find(x2 => Math.abs(x2.t - s.t0) < 0.08); if (e) { e.tier = 2; e.s = Math.max(e.s, 1.6); } }
  // phrases: 4-bar groups, phased so section changes land on phrase starts
  let phrase = 0; { let bv = -1; for (let p = 0; p < 4; p++) { let v = 0; for (const s of sections) { const bar = Math.round((s.t0 - bar0) / (meter * 60 / bpm)); if (((bar - p) % 4 + 4) % 4 === 0) v += 1 + (s.drop ? 1 : 0); } if (v > bv) { bv = v; phrase = p; } } }

  // merge events closer than the ear separates (70 ms): one event, as strong as the stronger plus a little
  const merged: Ev[] = [];
  for (const e of evs) { const p = merged[merged.length - 1]; if (p && e.t - p.t < 0.07) { if (e.s > p.s) { e.s += 0.15 * p.s; merged[merged.length - 1] = e; } else p.s += 0.15 * e.s; continue; } merged.push(e); }
  // pushes: a strong accent just before a beat that itself stays quiet is heard as that beat, early
  for (let k = 0; k < merged.length; k++) {
    const e = merged[k]; if (e.tier < 1 || !e.off) continue;
    const { i, frac } = posOf(e.t); if (frac < 0.45 || i + 1 >= nBeats) continue;
    const nb2 = beats[i + 1];
    // the beat it leads to stays quiet, and it outweighs what surrounds it: it is that beat, played early
    const quiet = !merged.some(x2 => x2 !== e && Math.abs(x2.t - nb2) < 0.06 && x2.tier >= 1);
    const around = merged.filter(x2 => x2 !== e && Math.abs(x2.t - e.t) < (nb2 - beats[i]) * 1.5).map(x2 => x2.s);
    if (quiet && (!around.length || e.s >= Math.max(...around) * 0.9)) { e.push = nb2; e.s *= 1.3; if (e.s >= 1.15) e.tier = 2; }
  }
  prog(0.95);

  const ds = (a: Float32Array) => { const n = Math.floor(a.length * OUT_RATE / FPS), o: number[] = new Array(n); for (let i = 0; i < n; i++) { const j = Math.floor(i * FPS / OUT_RATE); o[i] = +a[j].toFixed(3); } return o; };
  const events: RhythmEvent[] = merged.map(e => { const o: RhythmEvent = { t: +e.t.toFixed(4), s: +e.s.toFixed(3), tier: e.tier, band: e.band, pos: +e.pos.toFixed(3), off: e.off }; if (e.push != null) o.push = +e.push.toFixed(4); return o; });
  prog(1);
  return {
    version: RHYTHM_VERSION, duration, rate: OUT_RATE, tempo: { bpm, confidence: +confidence.toFixed(3) },
    beats: beats.map(b => +b.toFixed(4)), meter, downbeat, phrase, halfTime, events,
    sections: sections.map(s => ({ ...s, energy: +s.energy.toFixed(3), density: +s.density.toFixed(3) })),
    loudness: (({ lufs, peak }) => ({ lufs: +lufs.toFixed(2), peak: +peak.toFixed(4) }))(loudness(channels, sampleRate)),
    builds, level: ds(level), loud: ds(loud), odf: ds(odf), spec: specBands(L, F, nb).map(ds),
  };
}
