// The Hi-Fi output from the page's side. The native player (electron/audio.cjs → native/cadenza-audio) decodes and plays
// the file; the page keeps everything else: the lyrics, the effects, the queue. This module
//   - loads a song there and waits until enough of it is decoded (a song never starts before it can play smoothly)
//   - hands the engine an output whose clock is the native player's: the sample leaving the device, reported every 20 ms
//     and smoothed here so the lyrics move evenly between reports
//   - keeps what the settings page shows: devices, what the device takes, the format of what is playing
import { createStore } from '../../core/emitter';
import type { ExternalOut } from '../../engine';
import { AudioOut as A } from '../bridge';
import { settings } from '../state';

export interface HifiState { supported: boolean; running: boolean; devices: { id: string; name: string }[]; caps: any; device: any; track: any; error: string | null; fallback: boolean;
  /** the volume balance in the device's hardware volume: whether the device has one, and what is applied */ hw: { supported: boolean; db: number } | null }
export const hifi = createStore<HifiState>({ supported: false, running: false, devices: [], caps: null, device: null, track: null, error: null, fallback: false, hw: null });
export const hifiOn = () => !!A && settings.get().audioOut === 'hifi' && hifi.get().supported;

/* ---------- the clock ---------- */
// After a play request the clock holds at the requested position until the player reports from there: what is still in
// the device's buffer from before and the silence while a DAC locks never move the lyrics backwards or early.
const C = { base: 0, at: 0, run: false, hold: false, want: 0, id: null as string | null };
function onPos(e: { id: string; t: number; run: boolean }) {
  if (e.id !== C.id) return;
  if (C.hold) { if (Math.abs(e.t - C.want) > 0.15) return; C.hold = false; }
  const n = performance.now();
  if (!e.run) { C.base = e.t; C.at = n; C.run = false; return; }
  const est = C.run ? C.base + (n - C.at) / 1000 : C.base;
  // a report is only a sample of a steadily running clock: follow it gently, jump only when far off
  if (!C.run || Math.abs(e.t - est) > 0.08) C.base = e.t; else C.base = est + (e.t - est) * 0.1;
  C.at = n; C.run = true;
}
let lastG = -1;
export const output: ExternalOut = {
  play(pos, end) { C.base = pos; C.want = pos; C.at = performance.now(); C.run = false; C.hold = true; lastG = -1; A!.cmd({ cmd: 'play', pos, end: isFinite(end) ? end : null }); },
  stop() { C.base = this.clock(); C.run = false; C.hold = false; A!.cmd({ cmd: 'pause' }); },
  clock() { return C.run ? C.base + (performance.now() - C.at) / 1000 : C.base; },
  // fixed volume: the samples reach the DAC untouched, the volume is the amplifier's; only mute (0) still applies
  gain(g) {
    // (above 1 only with the volume balance's boost, which keeps within the song's headroom)
    const v = settings.get().fixedVolume !== false ? (g > 0 ? 1 : 0) : Math.max(0, Math.min(4, g));
    if (Math.abs(v - lastG) > 0.002 || (v === 0) !== (lastG === 0)) { lastG = v; A!.cmd({ cmd: 'gain', g: v }); }
  },
};

/** The volume balance with a fixed volume: in the device's own hardware volume (dB from the user's level), so the
 *  samples still reach the DAC untouched; a device without one keeps its level (hifi.hw says which). */
let lastHw: number | null = null;
export function hwGain(db: number) { if (!A || (lastHw !== null && Math.abs(db - lastHw) < 0.05)) return; lastHw = db; A.cmd({ cmd: 'hwgain', db }); }

/* ---------- loading ---------- */
let seq = 0;
const waiting = new Map<number, { res: (e: any) => void; rej: (e: Error) => void }>();
/** Load a song as the current one: resolves once it is decoded far enough ahead, with its format and length. */
export function load(id: string): Promise<{ dur: number; src: { rate: number; ch: number; bits: number; codec: string } }> {
  const s = ++seq; C.id = id; C.hold = true; C.want = 0;
  return new Promise((res, rej) => {
    waiting.set(s, { res, rej });
    A!.cmd({ cmd: 'load', id, seq: s }).then(ok => { if (!ok && waiting.has(s)) { waiting.delete(s); rej(new Error('hifi-unavailable')); } });
    setTimeout(() => { if (waiting.has(s)) { waiting.delete(s); rej(new Error('hifi-timeout')); } }, 20000);
  });
}
export const preload = (id: string) => A && A.cmd({ cmd: 'load', id, next: true });
/** Let go of the device (the workshop plays through the standard output). */
export const release = () => A && A.cmd({ cmd: 'release' });

type Trouble = 'fallback' | 'device' | 'down';
const listeners = new Set<(k: Trouble) => void>();
export const onTrouble = (f: (k: Trouble) => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export async function refresh() {
  if (!A) return;
  const s = await A.state();
  hifi.set({ supported: s.supported, running: s.running, devices: s.devices || [], caps: s.caps, device: s.device, error: s.error });
  if (s.running) A.cmd({ cmd: 'devices' });
}
if (A) {
  A.onEvent(e => {
    switch (e.ev) {
      case 'pos': onPos(e); break;
      case 'hello': hifi.set({ running: true, error: null, hw: null }); lastHw = null; break;
      case 'hwvol': hifi.set({ hw: { supported: !!e.supported, db: e.supported ? +e.db || 0 : 0 } }); break;
      case 'devices': hifi.set({ devices: e.list || [] }); break;
      case 'caps': hifi.set({ caps: e, fallback: false }); break;
      case 'device': hifi.set({ device: e.open ? e : null }); break;
      case 'ready': { const w = waiting.get(e.seq); hifi.set({ track: { src: e.src, out: e.out } }); if (w) { waiting.delete(e.seq); w.res(e); } break; }
      case 'fallback': hifi.set({ fallback: true }); listeners.forEach(f => f('fallback')); break;
      case 'error': {
        if (e.code === 'decode' && e.seq && waiting.has(e.seq)) { const w = waiting.get(e.seq)!; waiting.delete(e.seq); w.rej(new Error('hifi-decode')); break; }
        if (e.code === 'device') { hifi.set({ error: e.msg }); listeners.forEach(f => f('device')); }
        break;
      }
      case 'down': lastHw = null; hifi.set({ running: false, device: null, hw: null }); for (const [, w] of waiting) w.rej(new Error('hifi-down')); waiting.clear(); listeners.forEach(f => f('down')); break;
      default: break;
    }
  });
  refresh();
}

/** What the badge says about the current song: its format, and what reaches the DAC. */
export function describe(h: HifiState) {
  const t = h.track, d = h.device; if (!t) return null;
  const khz = (r: number) => (r / 1000).toFixed(r % 1000 ? 1 : 0);
  const src = `${(t.src.codec || '').toUpperCase()} ${t.src.bits ? `${t.src.bits}/` : ''}${khz(t.src.rate)}`;
  const out = d || t.out, exclusive = !!out.exclusive, resample = out.rate !== t.src.rate;
  const bitperfect = exclusive && !resample && !!t.src.bits && t.src.bits <= out.bits && t.src.ch <= 2 && settings.get().fixedVolume !== false;
  return { src, out: `${khz(out.rate)} kHz / ${out.bits} bit`, exclusive, resample, bitperfect };
}
