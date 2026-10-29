// Motion signals derived from the rhythm, shared by everything that moves with the music: the backdrop's breathing,
// the beat rings, the camera's bounce. Each is the sum of closed-form responses to the events before t, so it can be
// read at any time (preview, export, look-ahead) and always gives the same value.
import { clamp, sstep } from '../core/math';
import { impulse } from '../core/spring';
import { rnd } from '../core/rng';
import type { RhythmMap, BeatPos } from './map';
import type { RhythmEvent } from './types';

const TIER_W = [0.25, 0.65, 1];

export interface RhythmSample extends BeatPos {
  /** a quick rise and decay on every event, 0..1 (breathing, rings, spectra) */ pulse: number;
  /** subwoofer cone: a damped spring kicked by the low-end accents; >0 pushed out, small rebound below 0 */ cone: number;
  /** the same spring with an alternating sign per hit (for a slight roll that answers the cone) */ coneRoll: number;
  level: number; loud: number; sounding: number; build: number; still: number;
}

export interface ConeTuning { /** natural frequency (Hz) */ hz: number; /** damping ratio */ zeta: number }
/** A woofer's cone: pushed out within ~80 ms, back through rest with one small rebound (about a fifth), still in ~0.4 s. */
export const CONE: ConeTuning = { hz: 2.6, zeta: 0.42 };

export class Signals {
  constructor(readonly map: RhythmMap, readonly cone = CONE) {}

  /** Event pulse at t: every event rises over 12 ms and decays over about a third of a beat. */
  pulse(t: number, idle = 0): number {
    const len = this.map.beatLen(t), tau = clamp(0.32 * len, 0.1, 0.28);
    let s = 0;
    for (const e of this.map.eventsIn(t - 6 * tau, t)) {
      const dt = t - e.t; if (dt < 0) continue;
      s += TIER_W[e.tier] * Math.min(1.6, e.s) * sstep(dt / 0.012) * Math.exp(-dt / tau);
    }
    return (1 - Math.exp(-s * 1.2)) * this.map.sounding(t, idle);
  }
  /* The groove's hits: the accents a listener feels and nods to, not every note an onset detector finds. An event counts
     when it stands out from what is around it (louder than the bar's usual events) and sits where the ear expects
     weight — the downbeat, the backbeat, the other beats, and a syncopated push ("卡點") between them when it really
     stands out; the small, busy notes are left to the background's pulse. At most one hit a fifth of a beat apart. */
  private hits: { t: number; a: number }[] | null = null;
  grooveHits(): { t: number; a: number }[] {
    if (this.hits) return this.hits;
    const ev = this.map.events.filter(e => e.tier > 0), meter = this.map.meter, out: { t: number; a: number; s: number }[] = [];
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i], bar = meter * this.map.beatLen(e.t), around: number[] = [];
      for (let j = i - 1; j >= 0 && e.t - ev[j].t <= bar; j--) around.push(ev[j].s);
      for (let j = i + 1; j < ev.length && ev[j].t - e.t <= bar; j++) around.push(ev[j].s);
      around.sort((a, b) => a - b); const med = around.length ? around[around.length >> 1] : e.s, stand = e.s / Math.max(0.05, med);
      const fr = e.pos - Math.floor(e.pos), onB = fr < 0.12 || fr > 0.88, beat = ((Math.round(e.pos) % meter) + meter) % meter;
      const place = onB ? (beat === 0 ? 1 : meter === 4 && beat % 2 === 1 ? 0.85 : 0.7) : Math.abs(fr - 0.5) < 0.1 ? (stand >= 1.25 ? 0.6 : 0) : stand >= 1.6 ? 0.3 : 0;
      const lowish = e.band === 'low' || e.band === 'broad', score = place * clamp((stand - 0.85) / 0.6, 0, 1.4) * (lowish ? 1 : 0.75) * clamp(e.s / 1.4, 0.3, 1.2);
      if (score < 0.28) continue;
      const a = clamp(score, 0, 1.3) * (e.tier === 2 ? 1 : 0.8), last = out[out.length - 1], gap = 0.2 * this.map.beatLen(e.t);
      if (last && e.t - last.t < gap) { if (a > last.a) out[out.length - 1] = { t: e.t, a, s: e.s }; continue; }
      out.push({ t: e.t, a, s: e.s });
    }
    return (this.hits = out.map(({ t, a }) => ({ t, a })));
  }
  /** The cone's displacement (about -0.3 .. 1.5) and its alternating roll partner: kicked by the groove's hits only. */
  coneAt(t: number, idle = 0): { z: number; r: number } {
    const w = 2 * Math.PI * this.cone.hz, z0 = this.cone.zeta, H = this.grooveHits(); let z = 0, r = 0;
    let lo = 0, hi = H.length; while (lo < hi) { const m = (lo + hi) >> 1; if (H[m].t < t - 1.4) lo = m + 1; else hi = m; }
    for (let i = lo; i < H.length && H[i].t <= t; i++) { const h = H[i], v = h.a * impulse(t - h.t, w, z0); z += v; r += v * (rnd(h.t * 13.7) < 0.5 ? -1 : 1); }
    const k = this.map.sounding(t, idle); return { z: z * k, r: r * k };
  }
  sample(t: number, idle = 0): RhythmSample {
    const p = this.map.beatAt(t), c = this.coneAt(t, idle), b = this.map.build(t);
    return { ...p, pulse: this.pulse(t, idle), cone: c.z, coneRoll: c.r, level: this.map.level(t), loud: this.map.loud(t), sounding: this.map.sounding(t, idle), build: b.k, still: b.still };
  }
}
