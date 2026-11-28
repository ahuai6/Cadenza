// Renderer side of the native output. Load and run identities are separate: a seek or
// resume on the same decoder must not accept reports about samples queued before it.
import { createStore } from '../../core/emitter';
import { AudioOut as A } from '../bridge';
import { settings } from '../state';
import type { OutputEvent } from './coordinator';
import { HifiClock, type NativeObservation } from './hifi-clock';

export interface HifiState {
  supported: boolean;
  running: boolean;
  devices: { id: string; name: string }[];
  caps: any;
  device: any;
  track: any;
  error: string | null;
  fallback: boolean;
  exact: boolean;
  hw: { supported: boolean; db: number } | null;
}
export const hifi = createStore<HifiState>({
  supported: false,
  running: false,
  devices: [],
  caps: null,
  device: null,
  track: null,
  error: null,
  fallback: false,
  exact: false,
  hw: null,
});
export const hifiOn = () => !!A && settings.get().audioOut === 'hifi' && hifi.get().supported;
const cmd = (o: Record<string, unknown>) => A?.cmd(o).catch(() => false) ?? Promise.resolve(false);

type Ready = {
  seq: number;
  dur: number | null;
  src: { rate: number; ch: number; bits: number; codec: string };
  out: any;
};
let seq = 0,
  selected = 0,
  runId = 0,
  ticket = 0;
let processEpoch = 0;
let active: { seq: number; runId: number; notify: (event: OutputEvent) => void } | null = null;
/** The next song, preloaded and chained to the one loaded (`after`): the native core plays it right after the last
 *  sample of that one, in the same device stream, as run `runId`. `joined` once it has; `info` from its preload. */
let chained: {
  id: string;
  seq: number;
  runId: number;
  after: number;
  joined: boolean;
  info: Ready | null;
} | null = null;
const waiting = new Map<number, { res: (e: Ready) => void; rej: (e: Error) => void }>();
const barriers = new Map<number, (ok: boolean) => void>();
const clock = new HifiClock();
let meter: { level: number; at: number } | null = null;
export const time = () => clock.time(performance.now());
export const clockBudgetMs = () => clock.remainingMs(performance.now());
const hold = (t: number) => {
  meter = null;
  clock.reset(t);
};
export function nativeMusic() {
  return active && meter && performance.now() - meter.at < 120 ? meter.level : null;
}
const matches = (e: { seq: number; runId: number }) => active?.seq === e.seq && active.runId === e.runId;

/* The native core stamps each position report with the performance counter at the moment it was read. The page's own
   clock rests on the same counter: once their offset is measured (the smallest round trip wins), a report is anchored to
   when it was read instead of when its message arrived through two processes. */
let qpcOffset: number | null = null;
let qpcTrip = Infinity;
let qpcSynced = 0;
async function syncQpc() {
  if (!A || performance.now() - qpcSynced < 30_000) return;
  qpcSynced = performance.now();
  for (let i = 0; i < 5; i++) {
    const before = performance.now();
    const qpc = await A.qpc().catch(() => NaN);
    const after = performance.now();
    if (!Number.isFinite(qpc)) return;
    // (a fresh measurement replaces a stale one, whatever its round trip)
    if (i === 0) qpcTrip = Infinity;
    if (after - before < qpcTrip) {
      qpcTrip = after - before;
      qpcOffset = qpc / 1e4 - (before + after) / 2;
    }
  }
}
/** When a report was read, on the page's clock: its own stamp where it can be trusted, else its arrival. */
function readAt(e: { at100ns?: number | null }, arrived: number) {
  if (qpcOffset === null || typeof e.at100ns !== 'number' || !Number.isFinite(e.at100ns)) return arrived;
  const at = e.at100ns / 1e4 - qpcOffset;
  // a stamp from the future, or older than any message takes, means the offset is off: fall back
  return at <= arrived + 1 && arrived - at < 60 ? Math.min(at, arrived) : arrived;
}

function onPos(
  e: NativeObservation & { seq: number; runId: number; exact: boolean; pcmDb?: number; at100ns?: number },
) {
  const now = performance.now();
  void syncQpc();
  if (!matches(e) || !clock.observe(e, readAt(e, now))) return;
  meter =
    e.run && typeof e.pcmDb === 'number' && Number.isFinite(e.pcmDb)
      ? { level: Math.max(0, Math.min(1, (e.pcmDb + 64) / 46)), at: now }
      : null;
  const owner = active;
  const exact = e.run && !!e.exact;
  if (hifi.get().exact !== exact) hifi.set({ exact });
  if (active === owner) owner?.notify(e.run ? 'running' : 'buffering');
}
let lastGain = -1,
  lastHw: number | null = null;
export function gain(g: number, fixed: number) {
  const v =
    settings.get().fixedVolume !== false
      ? hifi.get().hw?.supported === false
        ? fixed
        : fixed > 0
          ? 1
          : 0
      : Math.max(0, Math.min(4, g));
  if (Math.abs(v - lastGain) <= 0.002 && (v === 0) === (lastGain === 0)) return;
  lastGain = v;
  void cmd({ cmd: 'gain', g: v });
}
export function hwGain(db: number) {
  if (!A || (lastHw !== null && Math.abs(db - lastHw) < 0.05)) return;
  lastHw = db;
  void cmd({ cmd: 'hwgain', db });
}
export function load(id: string, signal: AbortSignal): Promise<Ready> {
  signal.throwIfAborted();
  // the next song already playing on from the one before: taken over as it is, no load
  if (chained?.joined && chained.id === id && chained.info) {
    selected = chained.seq;
    hifi.set({ track: { src: chained.info.src, out: chained.info.out }, exact: false });
    return Promise.resolve(chained.info);
  }
  chained = null;
  const s = ++seq;
  selected = s;
  hifi.set({ track: null, exact: false });
  return new Promise((res, rej) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      waiting.delete(s);
    };
    const fail = (error: Error) => {
      cleanup();
      stop(s);
      rej(error);
    };
    const abort = () => fail(signal.reason);
    const timer = setTimeout(() => fail(new Error('hifi-timeout')), 20_000);
    waiting.set(s, {
      res: (e) => {
        cleanup();
        res(e);
      },
      rej: fail,
    });
    signal.addEventListener('abort', abort, { once: true });
    queueMicrotask(() => {
      if (selected !== s || !waiting.has(s)) return;
      void cmd({ cmd: 'load', id, seq: s }).then((ok) => {
        if (!ok) waiting.get(s)?.rej(new Error('hifi-unavailable'));
      });
    });
  });
}
/** Decode the next song ahead and chain it to the one loaded, so it follows without a gap where the formats allow. */
export function preload(id: string | null) {
  if (!id) {
    chained = null;
    return cmd({ cmd: 'clearnext' });
  }
  if (chained && chained.id === id && chained.after === selected) return Promise.resolve(true);
  const next = { id, seq: ++seq, runId: ++runId, after: selected, joined: false, info: null };
  chained = next;
  return cmd({ cmd: 'load', id, next: true, seq: next.seq }).then((ok) =>
    ok && chained === next ? cmd({ cmd: 'chain', seq: next.after, next: next.seq, run: next.runId }) : false,
  );
}
/** Whether the native core joined this load's song to the one before it and is playing it now. */
export const joined = (seq: number) => !!chained?.joined && chained.seq === seq;
export function start(seq: number, pos: number, notify: (event: OutputEvent) => void) {
  if (seq !== selected) return notify({ error: 'hifi-stale-load' });
  if (joined(seq)) {
    // already playing from its first sample: the run the core was given when it was chained
    active = { seq, runId: chained!.runId, notify };
    chained = null;
    hold(0);
    hifi.set({ exact: false });
    return;
  }
  const run = { seq, runId: ++runId, notify };
  active = run;
  hold(pos);
  hifi.set({ exact: false });
  void cmd({ cmd: 'play', pos, end: null, seq, run: run.runId }).then((ok) => {
    if (!ok && active === run) notify({ error: 'hifi-start-rejected' });
  });
}
export function pause(seq: number) {
  if (seq !== selected) return;
  hold(time());
  active = null;
  hifi.set({ exact: false });
  void cmd({ cmd: 'pause', seq });
}
export function stop(seq: number) {
  if (seq !== selected) return;
  selected = 0;
  active = null;
  hold(time());
  hifi.set({ exact: false });
  void cmd({ cmd: 'stop', seq });
}
async function acknowledge(o: Record<string, unknown>) {
  const n = ++ticket;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const completion = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), 3000);
    barriers.set(n, resolve);
  });
  try {
    return (await cmd({ ...o, ticket: n })) && (await completion);
  } finally {
    clearTimeout(timer);
    barriers.delete(n);
  }
}
export async function release() {
  if (!hifiOn()) return await waitReleased();
  if (!(await cmd({ cmd: 'release' })) || !(await acknowledge({ cmd: 'barrier' }))) throw new Error('hifi-release');
}
export async function closeFile(seq: number) {
  if (!(await acknowledge({ cmd: 'closefile', seq }))) throw new Error('hifi-close-file');
}
export async function waitReleased() {
  if (A && !(await cmd({ cmd: 'wait-released' }))) throw new Error('hifi-release');
}

type Notice = 'fallback' | 'lost' | 'toDefault' | 'back';
const listeners = new Set<(notice: Notice) => void>();
export const onTrouble = (f: (notice: Notice) => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};
const notice = (n: Notice) => listeners.forEach((fn) => fn(n));
export async function refresh() {
  if (!A) return;
  const s = await A.state();
  if (s.processEpoch < processEpoch) return;
  processEpoch = s.processEpoch;
  hifi.set({
    supported: s.supported,
    running: s.running,
    devices: s.devices || [],
    caps: s.caps,
    device: s.device,
    error: s.error,
  });
  if (s.running) void cmd({ cmd: 'devices' });
}
if (A) {
  A.onEvent((e) => {
    if (!Number.isSafeInteger(e.processEpoch) || e.processEpoch < processEpoch) return;
    processEpoch = e.processEpoch;
    switch (e.ev) {
      case 'pos':
        onPos(e);
        break;
      case 'ended':
        if (matches(e) && clock.accepts(e.epoch)) {
          hifi.set({ exact: false });
          active?.notify('ended');
        }
        break;
      case 'barrier':
        barriers.get(e.ticket)?.(e.ok !== false);
        break;
      case 'hello':
        lastGain = -1;
        lastHw = null;
        hifi.set({ running: true, error: null, hw: null, exact: false });
        break;
      case 'hwvol':
        hifi.set({ hw: { supported: !!e.supported, db: e.supported ? +e.db || 0 : 0 } });
        break;
      case 'devices':
        hifi.set({ devices: e.list || [] });
        break;
      case 'caps':
        hifi.set({ caps: e });
        break;
      case 'device':
        hifi.set({
          device: e.open ? e : null,
          fallback: !!e.open && e.requestedExclusive && !e.exclusive,
          exact: false,
        });
        break;
      case 'ready':
        if (e.seq === selected) hifi.set({ track: { src: e.src, out: e.out } });
        waiting.get(e.seq)?.res(e);
        break;
      case 'preloaded': {
        const next = chained;
        if (next && next.seq === e.seq && e.src) next.info = e;
        break;
      }
      case 'joined': {
        // (written into the stream ahead of the speaker: the song before is still heard until its own 'ended')
        const next = chained;
        if (next && next.seq === e.seq && next.runId === e.runId) next.joined = true;
        break;
      }
      case 'fallback':
        if (e.code === 'default' || e.code === 'back') notice(e.code === 'default' ? 'toDefault' : 'back');
        else {
          hifi.set({ fallback: true });
          notice('fallback');
        }
        break;
      case 'lost':
        if (!matches(e) || !clock.accepts(e.epoch)) break;
        meter = null;
        if (e.resume) {
          clock.observe({ ...e, run: false, limit: e.t }, performance.now());
          hifi.set({ exact: false });
          active?.notify('buffering');
          notice('lost');
        } else active?.notify({ error: e.msg || 'hifi-device' });
        break;
      case 'error':
        if (e.code === 'decode' && waiting.has(e.seq)) waiting.get(e.seq)!.rej(new Error('hifi-decode'));
        else if (e.code === 'decode' && e.seq === active?.seq) active?.notify({ error: 'hifi-decode' });
        else if (e.code === 'device' && matches(e) && clock.accepts(e.epoch)) {
          hifi.set({ error: e.msg });
          active?.notify({ error: e.msg || 'hifi-device' });
        }
        break;
      case 'stopped':
      case 'down':
        lastHw = null;
        hifi.set({ running: false, device: null, hw: null, track: null, caps: null, fallback: false, exact: false });
        for (const settle of barriers.values()) settle(false);
        if (e.ev === 'down' || !hifiOn()) {
          const error = 'hifi-' + e.ev;
          for (const w of waiting.values()) w.rej(new Error(error));
          active?.notify({ error });
        }
        break;
    }
  });
  void refresh().catch(() => {});
}
/** What the badge says about the current song: its format, and what reaches the DAC. */
export function describe(h: HifiState) {
  const t = h.track,
    d = h.device;
  if (!t) return null;
  const khz = (r: number) => (r / 1000).toFixed(r % 1000 ? 1 : 0);
  const src = `${(t.src.codec || '').toUpperCase()} ${t.src.bits ? `${t.src.bits}/` : ''}${khz(t.src.rate)}`;
  const out = d || t.out,
    exclusive = !!out.exclusive,
    resample = out.rate !== t.src.rate;
  const bitperfect = !!d && exclusive && h.exact;
  const resolution = out.fmt === 'f32' ? 'float32' : `${out.bits} bit`;
  return { src, out: `${khz(out.rate)} kHz / ${resolution}`, exclusive, resample, bitperfect };
}
