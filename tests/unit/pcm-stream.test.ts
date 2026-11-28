// The standard output's audio-thread player, run from its own source text as the worklet loads it (4.0.0-alpha.6).
import { afterEach, describe, expect, it } from 'vitest';
import { pcmProcessorSource } from '../../src/engine/stream/pcm-worklet';

const OUT = 48000;
const RAMP = Math.round(OUT * 0.006);
type Message = Record<string, unknown> & { t: string };
type Processor = { process(i: Float32Array[][], o: Float32Array[][]): boolean };

const saved: Record<string, unknown> = {};
function scope() {
  const g = globalThis as Record<string, unknown>;
  for (const k of ['sampleRate', 'currentFrame', 'registerProcessor', 'AudioWorkletProcessor']) saved[k] = g[k];
  let Ctor: new () => Processor & { port: { onmessage: ((e: { data: unknown }) => void) | null } };
  const reports: Message[] = [];
  const fed: Message[] = [];
  class Base {
    port = { postMessage: (m: Message) => reports.push(m), onmessage: null as ((e: { data: unknown }) => void) | null };
  }
  g.sampleRate = OUT;
  g.currentFrame = 0;
  g.AudioWorkletProcessor = Base;
  g.registerProcessor = (_name: string, c: typeof Ctor) => (Ctor = c);
  new Function(pcmProcessorSource())();
  const p = new Ctor!();
  const feed = { postMessage: (m: Message) => fed.push(m), onmessage: null as ((e: { data: unknown }) => void) | null };
  const send = (m: Message) => p.port.onmessage!({ data: m });
  send({ t: 'feed', port: feed });
  const started = new Set<number>();
  /** samples of a stream; the first block of each carries its rate and first frame */
  const data = (seg: number, samples: Float32Array, eof = false, rate = OUT, first = 0) => {
    const opening = !started.has(seg);
    started.add(seg);
    feed.onmessage!({
      data: { t: 'data', seg, samples, eof, ...(opening ? { rate, first, length: 0 } : {}) },
    });
  };
  const render = (quanta: number) => {
    const L: number[] = [],
      R: number[] = [];
    for (let q = 0; q < quanta; q++) {
      const out = [new Float32Array(128), new Float32Array(128)];
      p.process([], [out]);
      L.push(...out[0]);
      R.push(...out[1]);
      g.currentFrame = (g.currentFrame as number) + 128;
    }
    return { L, R };
  };
  const open = (seg: number, fade = 0) => send({ t: 'open', seg, gain: 1, fade });
  const play = (seg: number, prebuffer = 0, fadeIn = false) => send({ t: 'play', seg, prebuffer, fadeIn });
  return { send, data, render, open, play, reports, fed };
}
afterEach(() => Object.assign(globalThis, saved));

const constant = (frames: number, l: number, r = l) => {
  const a = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    a[2 * i] = l;
    a[2 * i + 1] = r;
  }
  return a;
};
const sine = (rate: number, hz: number, from: number, frames: number) => {
  const a = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) a[2 * i] = a[2 * i + 1] = 0.3 * Math.sin((2 * Math.PI * hz * (from + i)) / rate);
  return a;
};
/** the largest jump in a sine's recurrence x[n+1] = 2cos(w)x[n] - x[n-1] over [from, to) */
const residual = (x: number[], hz: number, from: number, to: number) => {
  const k = 2 * Math.cos((2 * Math.PI * hz) / OUT);
  let worst = 0;
  for (let n = from; n < to; n++) worst = Math.max(worst, Math.abs(x[n + 1] - k * x[n] + x[n - 1]));
  return worst;
};

describe('PCM processor', () => {
  it('copies a song at the output rate bit for bit and joins a chained one on the next sample', () => {
    const w = scope();
    w.open(1);
    w.open(2);
    w.data(1, constant(300, 0.5, 0.4), true);
    w.data(2, constant(300, -0.25, -0.2), true);
    w.send({ t: 'chain', seg: 1, next: 2 });
    w.play(1);
    const { L, R } = w.render(5);
    expect(L.slice(0, 300).every((x) => x === 0.5)).toBe(true);
    expect(R.slice(0, 300).every((x) => Math.fround(x) === Math.fround(0.4))).toBe(true);
    expect(L.slice(300, 600).every((x) => x === -0.25)).toBe(true);
    expect(L.slice(600).every((x) => x === 0)).toBe(true);
    expect(w.reports.find((r) => r.t === 'ended')).toMatchObject({ seg: 1, frame: 300 });
    expect(w.reports.filter((r) => r.t === 'started')[1]).toMatchObject({ seg: 2, frame: 300, pos: 0, chained: true });
    expect(w.reports.filter((r) => r.t === 'ended').map((r) => r.seg)).toEqual([1, 2]);
    expect(w.fed).toContainEqual({ t: 'closed', seg: 1 });
  });

  it('resamples across the join of two chained songs with one filter: no gap, no edge', () => {
    const w = scope();
    const SRC = 44100,
      HZ = 441,
      CUT = 33333;
    w.open(1);
    w.open(2);
    w.send({ t: 'chain', seg: 1, next: 2 });
    w.data(1, sine(SRC, HZ, 0, CUT), true, SRC, 0);
    w.data(2, sine(SRC, HZ, CUT, 30000), true, SRC, 0);
    w.play(1);
    const { L } = w.render(Math.ceil(((CUT + 30000) * OUT) / SRC / 128) + 4);
    const join = Math.round((CUT * OUT) / SRC);
    const ended = w.reports.find((r) => r.t === 'ended' && r.seg === 1)!;
    expect(Math.abs((ended.frame as number) - join)).toBeLessThanOrEqual(1);
    const typical = residual(L, HZ, 2000, 20000);
    const atJoin = residual(L, HZ, join - 200, join + 200);
    expect(typical).toBeLessThan(1e-4);
    expect(atJoin).toBeLessThan(typical * 2 + 1e-5);
    // the sine itself, sample by sample, across the join
    let err = 0;
    for (let n = join - 2000; n < join + 2000; n++)
      err = Math.max(err, Math.abs(L[n] - 0.3 * Math.sin((2 * Math.PI * HZ * n) / OUT)));
    expect(err).toBeLessThan(1e-3);
  });

  it('waits for the prebuffer, then reports starving and resuming with positions in seconds', () => {
    const w = scope();
    w.open(1);
    w.play(1, 200 / OUT);
    w.data(1, constant(100, 1));
    expect(w.render(1).L.every((x) => x === 0)).toBe(true);
    expect(w.reports.some((r) => r.t === 'started')).toBe(false);
    w.data(1, constant(150, 1));
    const first = w.render(2).L;
    expect(first.slice(0, 250).every((x) => x === 1)).toBe(true);
    expect(first.slice(250).every((x) => x === 0)).toBe(true);
    expect(w.reports.find((r) => r.t === 'starved')).toMatchObject({ seg: 1, pos: 250 / OUT });
    w.data(1, constant(10, 1), true);
    w.render(1);
    expect(w.reports.find((r) => r.t === 'resumed')).toMatchObject({ seg: 1, pos: 250 / OUT });
    expect(w.reports.at(-1)).toMatchObject({ t: 'ended', seg: 1, pos: 260 / OUT });
  });

  it('ramps out over 6 ms when paused and back in when resumed, losing no sample', () => {
    const w = scope();
    w.open(1);
    w.data(1, constant(OUT, 1));
    w.play(1);
    w.render(1);
    w.send({ t: 'pause', seg: 1 });
    const down = w.render(4).L;
    expect(down[0]).toBeLessThan(1);
    expect(down[RAMP - 2]).toBeGreaterThan(0);
    expect(down.slice(RAMP).every((x) => x === 0)).toBe(true);
    for (let i = 1; i < RAMP; i++) expect(down[i]).toBeLessThanOrEqual(down[i - 1]);
    expect(w.reports.find((r) => r.t === 'paused')).toMatchObject({ pos: (128 + RAMP) / OUT });
    w.play(1, 0, true);
    const up = w.render(4).L;
    expect(up[0]).toBeGreaterThan(0);
    expect(up[0]).toBeLessThan(0.01);
    expect(up[RAMP + 5]).toBe(1);
    expect(w.reports.filter((r) => r.t === 'started').at(-1)).toMatchObject({ pos: (128 + RAMP) / OUT });
  });

  it('fades a song out over its last seconds, from the length known at its end', () => {
    const w = scope();
    w.open(1, 100 / OUT);
    w.data(1, constant(300, 1), true);
    w.play(1);
    const { L } = w.render(3);
    expect(L.slice(0, 200).every((x) => x === 1)).toBe(true);
    expect(L[250]).toBeCloseTo(0.5, 2);
    expect(L[299]).toBeCloseTo(0.01, 2);
    expect(L[300]).toBe(0);
  });

  it('ramps the stream playing out before a seek starts the new one, and releases its reader', () => {
    const w = scope();
    w.open(1);
    w.data(1, constant(OUT, 1));
    w.play(1);
    w.render(1);
    w.open(2);
    w.data(2, constant(OUT, -1), false, OUT, OUT * 10);
    w.send({ t: 'stop', seg: 1 });
    w.play(2, 0, true);
    const { L } = w.render(8);
    expect(L[0]).toBeGreaterThan(0);
    const firstNegative = L.findIndex((x) => x < 0);
    expect(firstNegative).toBeGreaterThanOrEqual(RAMP - 1);
    expect(L.slice(0, firstNegative).every((x) => x >= 0)).toBe(true);
    expect(L.at(-1)).toBe(-1);
    expect(w.fed).toContainEqual({ t: 'closed', seg: 1 });
    expect(w.reports.find((r) => r.t === 'started' && r.seg === 2)).toMatchObject({ pos: 10 });
  });

  it('starts a chained song on its own when it cannot join (another rate), from its beginning', () => {
    const w = scope();
    w.open(1);
    w.open(2);
    w.send({ t: 'chain', seg: 1, next: 2 });
    w.data(1, constant(200, 0.5), true);
    w.data(2, sine(44100, 441, 0, 4410), true, 44100, 0);
    w.play(1);
    w.render(6);
    const started = w.reports.filter((r) => r.t === 'started');
    expect(started.map((r) => [r.seg, r.chained])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('accepts samples that arrive before the stream is opened', () => {
    const w = scope();
    w.data(1, constant(64, 0.75), true);
    w.open(1);
    w.play(1);
    expect(
      w
        .render(1)
        .L.slice(0, 64)
        .every((x) => x === 0.75),
    ).toBe(true);
  });
});
