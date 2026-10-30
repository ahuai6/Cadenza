import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/rhythm/analyze';
import { render, groove, type Hit } from './synth';

const SR = 44100;
const run = (hits: Hit[], dur: number, pads?: any[]) => analyze([render({ sr: SR, dur, hits, pads })], SR);
// beat-tracking F-measure with a ±70 ms window
function fmeasure(est: number[], ref: number[], tol = 0.07) {
  const used = new Set<number>(); let tp = 0;
  for (const r of ref) { let best = -1, bd = tol; est.forEach((e, i) => { const d = Math.abs(e - r); if (d <= bd && !used.has(i)) { bd = d; best = i; } }); if (best >= 0) { used.add(best); tp++; } }
  const p = tp / Math.max(1, est.length), rc = tp / Math.max(1, ref.length); return p + rc ? 2 * p * rc / (p + rc) : 0;
}
const near = <T extends { t: number }>(evs: T[], t: number, tol = 0.03) => evs.find(e => Math.abs(e.t - t) <= tol);

describe('rhythm: tempo and beats', () => {
  for (const bpm of [72, 98, 120, 140]) it(`steady 4/4 at ${bpm} BPM`, () => {
    const g = groove(bpm, 12); const a = run(g.hits, g.end + 1);
    expect(Math.abs(a.tempo.bpm - bpm) / bpm).toBeLessThan(0.02);
    const inSong = a.beats.filter(b => b >= g.beats[0] - 0.1 && b <= g.end);
    expect(fmeasure(inSong, g.beats)).toBeGreaterThan(0.93);
    expect(a.meter).toBe(4);
    // the first true downbeat is a downbeat in the analysis
    const i = a.beats.findIndex(b => Math.abs(b - g.downs[1]) < 0.07);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(((i - a.downbeat) % a.meter + a.meter) % a.meter).toBe(0);
  });
  it('3/4 waltz at 92 BPM', () => {
    const g = groove(92, 16, { meter: 3 }); const a = run(g.hits, g.end + 1);
    expect(Math.abs(a.tempo.bpm - 92) / 92).toBeLessThan(0.03);
    expect(a.meter).toBe(3);
    const i = a.beats.findIndex(b => Math.abs(b - g.downs[2]) < 0.07);
    expect(((i - a.downbeat) % 3 + 3) % 3).toBe(0);
  });
  it('follows a tempo that drifts from 116 to 126 BPM', () => {
    const hits: Hit[] = [], truth: number[] = []; let t = 0.5;
    for (let k = 0; k < 64; k++) { const bpm = 116 + 10 * k / 63, b = 60 / bpm; truth.push(t);
      hits.push({ t, kind: k % 2 ? 'snare' : 'kick' }); hits.push({ t, kind: 'hat', gain: 0.5 }); t += b; }
    const a = run(hits, t + 1);
    expect(fmeasure(a.beats.filter(b => b <= t), truth)).toBeGreaterThan(0.9);
  });
});

describe('rhythm: events', () => {
  it('finds every drum hit with millisecond timing', () => {
    const g = groove(120, 8); const a = run(g.hits, g.end + 1);
    const drums = g.hits.filter(h => h.kind === 'kick' || h.kind === 'snare');
    const found = drums.map(h => near(a.events, h.t)).filter(Boolean) as { t: number }[];
    expect(found.length / drums.length).toBeGreaterThan(0.95);
    const err = drums.map(h => near(a.events, h.t)).filter(Boolean).map((e, k) => Math.abs(e!.t - drums[k].t));
    expect(err.reduce((x, y) => x + y, 0) / err.length).toBeLessThan(0.012);
  });
  it('sorts events into tiers: downbeat kicks strong, eighth hats light', () => {
    const g = groove(110, 10); const a = run(g.hits, g.end + 1);
    const down = g.downs.slice(1).map(t => near(a.events, t)).filter(Boolean);
    expect(down.filter(e => e!.tier >= 1).length / down.length).toBeGreaterThan(0.9);
    const offHats = g.hits.filter(h => h.kind === 'hat' && (h.gain ?? 1) < 0.5).map(h => near(a.events, h.t, 0.02)).filter(Boolean);
    expect(offHats.filter(e => e!.tier === 0).length / Math.max(1, offHats.length)).toBeGreaterThan(0.8);
  });
  it('keeps two hits within one beat apart (a double kick) and marks off-beat accents', () => {
    const bpm = 100, b = 60 / bpm, hits: Hit[] = [];
    for (let k = 0; k < 32; k++) { const t = 0.5 + k * b; hits.push({ t, kind: k % 2 ? 'snare' : 'kick', gain: 0.7 }); hits.push({ t, kind: 'hat', gain: 0.4 });
      if (k % 4 === 1) hits.push({ t: t + b * 0.5, kind: 'kick', gain: 1 }); // syncopated kick on the "and" of 2
      if (k % 8 === 4) hits.push({ t: t + 0.11, kind: 'kick', gain: 1 }); }  // a second kick 110 ms after the first
    const a = run(hits, 0.5 + 32 * b + 1);
    const doubles = hits.filter((h, i) => h.kind === 'kick' && hits.some(o => o !== h && o.kind === 'kick' && Math.abs(o.t - h.t - 0.11) < 0.001));
    for (const h of doubles.slice(1)) { expect(near(a.events, h.t)).toBeTruthy(); expect(near(a.events, h.t + 0.11)).toBeTruthy(); }
    const sync = hits.filter(h => h.kind === 'kick' && h.gain === 1 && Math.abs(((h.t - 0.5) / b) % 1 - 0.5) < 0.01).slice(1);
    const se = sync.map(h => near(a.events, h.t)).filter(Boolean);
    expect(se.length / sync.length).toBeGreaterThan(0.9);
    expect(se.filter(e => (e as any).off).length / se.length).toBeGreaterThan(0.9);
  });
  it('hears an accent pushed ahead of the downbeat as that downbeat, early', () => {
    const b = 0.5, hits: Hit[] = [];
    for (let bar = 0; bar < 16; bar++) for (let k = 0; k < 4; k++) {
      const t = 0.5 + (bar * 4 + k) * b;
      const pushNext = bar % 2 === 1 && k === 3;                 // every other bar the next downbeat is pushed to the "and" of 4
      const pushedHere = bar % 2 === 0 && bar > 0 && k === 0;
      if (!pushedHere) hits.push({ t, kind: k % 2 ? 'snare' : 'kick', gain: k === 0 ? 1 : 0.7 });
      hits.push({ t, kind: 'hat', gain: 0.35 });
      if (pushNext) { hits.push({ t: t + b / 2, kind: 'kick', gain: 1.2 }); hits.push({ t: t + b / 2, kind: 'crash', gain: 1 }); }
    }
    const a = run(hits, 0.5 + 64 * b + 1);
    const pushes = a.events.filter(e => e.push != null);
    expect(pushes.length).toBeGreaterThanOrEqual(5);
    for (const e of pushes) expect(e.push! - e.t).toBeGreaterThan(0.15);
  });
});

describe('rhythm: structure', () => {
  it('finds the sections of a song: quiet intro, verse, build, drop', () => {
    const bpm = 124, b = 60 / bpm, bar = 4 * b, hits: Hit[] = [];
    const intro0 = 0.5, verse0 = intro0 + 8 * bar, build0 = verse0 + 8 * bar, drop0 = build0 + 4 * bar, end = drop0 + 8 * bar;
    const pads = [{ t0: 0.2, t1: verse0, gain: 0.12, f: [220, 277, 330] }];
    for (let k = 0; k < 32; k++) { const t = verse0 + k * b; hits.push({ t, kind: k % 2 ? 'snare' : 'kick', gain: 0.7 }); hits.push({ t, kind: 'hat', gain: 0.35 }); }
    for (let k = 0; k < 16; k++) { const t = build0 + k * b, n = 1 + Math.floor(k / 4); for (let j = 0; j < n * 2; j++) hits.push({ t: t + j * b / (n * 2), kind: 'snare', gain: 0.2 + 0.25 * k / 16 }); }
    for (let k = 0; k < 32; k++) { const t = drop0 + k * b; hits.push({ t, kind: 'kick', gain: 1.2 }); if (k % 2) hits.push({ t, kind: 'clap', gain: 1 }); hits.push({ t: t + b / 2, kind: 'hat', gain: 0.8 }); hits.push({ t, kind: 'bass', gain: 1.2, f: 49 });
      if (k % 4 === 0) hits.push({ t, kind: 'crash', gain: 0.6 }); }
    const a = run(hits, end + 1, pads);
    const starts = a.sections.map(s => s.t0);
    expect(starts.some(t => Math.abs(t - verse0) < bar)).toBe(true);
    expect(starts.some(t => Math.abs(t - drop0) < bar)).toBe(true);
    const drop = a.sections.find(s => Math.abs(s.t0 - drop0) < bar)!;
    expect(drop.drop).toBe(true);
    expect(drop.energy).toBeGreaterThan(0.6);
    expect(a.builds.some(([x, y]) => Math.abs(y - drop0) < bar && y - x >= 2 * bar - 0.1)).toBe(true);
    // the intro is quiet: its level is low
    expect(a.level[Math.round(3 * a.rate)]).toBeLessThan(0.3);
  });
});

describe('rhythm: robustness', () => {
  it('does not depend on the mix level (the same song 20 dB quieter gives the same events)', () => {
    const g = groove(118, 10); const pcm = render({ sr: SR, dur: g.end + 1, hits: g.hits });
    const quiet = pcm.map(v => v * 0.1);
    const a = analyze([pcm], SR), b = analyze([quiet], SR);
    expect(Math.abs(a.tempo.bpm - b.tempo.bpm)).toBeLessThan(0.6);
    const strongA = a.events.filter(e => e.tier >= 1), strongB = b.events.filter(e => e.tier >= 1);
    const same = strongA.filter(e => strongB.some(x => Math.abs(x.t - e.t) < 0.01)).length;
    expect(same / strongA.length).toBeGreaterThan(0.9);
  });
  it('a long silence carries no events and a low level', () => {
    const g1 = groove(120, 6), g2 = groove(120, 6, { t0: g1.end + 12 });
    const a = run([...g1.hits, ...g2.hits], g2.end + 1);
    const inGap = a.events.filter(e => e.t > g1.end + 1 && e.t < g2.beats[0] - 0.2);
    expect(inGap.length).toBe(0);
    expect(a.level[Math.round((g1.end + 6) * a.rate)]).toBeLessThan(0.15);
  });
  it('drum & bass at 174 BPM is tracked at 174 or its half (87), on the beat', () => {
    const bpm = 174, b = 60 / bpm, hits: Hit[] = [], truth: number[] = [];
    for (let k = 0; k < 96; k++) { const t = 0.5 + k * b; truth.push(t); const p = k % 4;
      if (p === 0) hits.push({ t, kind: 'kick' }); if (p === 2) hits.push({ t: t + b / 2, kind: 'kick', gain: 0.8 });
      if (p === 1 || p === 3) hits.push({ t, kind: 'snare' }); hits.push({ t, kind: 'hat', gain: 0.4 }); hits.push({ t: t + b / 2, kind: 'hat', gain: 0.3 }); }
    const a = run(hits, 0.5 + 96 * b + 1);
    const r = a.tempo.bpm / bpm; expect(Math.abs(r - 1) < 0.02 || Math.abs(r - 0.5) < 0.01).toBe(true);
    const ref = Math.abs(r - 1) < 0.02 ? truth : truth.filter((_, i) => i % 2 === 0);
    const alt = truth.filter((_, i) => i % 2 === 1);
    expect(Math.max(fmeasure(a.beats, ref), fmeasure(a.beats, alt))).toBeGreaterThan(0.9);
  });
});
