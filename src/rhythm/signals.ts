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
  private coneWeight(e: RhythmEvent) {
    if (e.tier === 0) return 0;
    const lowish = e.band === 'low' || e.band === 'broad';
    if (e.tier === 1 && !lowish) return 0;
    return clamp(e.s, 0, 1.8) / 1.8 * (e.tier === 2 ? 1 : 0.45) * (lowish ? 1 : 0.6);
  }
  /** The cone's displacement (about -0.3 .. 1.5) and its alternating roll partner. */
  coneAt(t: number, idle = 0): { z: number; r: number } {
    const w = 2 * Math.PI * this.cone.hz, z0 = this.cone.zeta; let z = 0, r = 0;
    for (const e of this.map.eventsIn(t - 1.4, t)) {
      const a = this.coneWeight(e); if (!a) continue;
      const v = a * impulse(t - e.t, w, z0); z += v; r += v * (rnd(e.t * 13.7) < 0.5 ? -1 : 1);
    }
    const k = this.map.sounding(t, idle); return { z: z * k, r: r * k };
  }
  sample(t: number, idle = 0): RhythmSample {
    const p = this.map.beatAt(t), c = this.coneAt(t, idle), b = this.map.build(t);
    return { ...p, pulse: this.pulse(t, idle), cone: c.z, coneRoll: c.r, level: this.map.level(t), loud: this.map.loud(t), sounding: this.map.sounding(t, idle), build: b.k, still: b.still };
  }
}
