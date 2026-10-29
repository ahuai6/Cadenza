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
  /* The groove's hits: one on every felt beat, each as hard as the beat lands — the way a listener nods along. A beat's
     impact is how much it rises (the strongest onset on it, the low end counting most) and how loud the music is around
     it (about a quarter second each way), each placed in the whole song's own range (its 10th to 90th percentile) and
     mixed, the loudness weighing more: a sparse intro, where every hit stands out of the quiet, is not the strongest
     part, nor a full chorus, where the hits land on an already loud mix, the weakest. A gentle curve lifts the middle
     and a floor keeps a weak beat seen, so a driving song shakes on every beat with its downbeats and loud passages
     strongest. A bar with no onset on any of its beats (a held pad, a free intro) shakes not at all. A song whose beats
     barely rise (a ballad) moves less overall. Besides the beats, a clearly standing-out push between them (a syncopated
     hit, 卡點) is a hit of its own. A beat counted twice as fast as it is felt (above ~165 BPM) is felt every other beat. */
  private hits: { t: number; a: number }[] | null = null;
  grooveHits(): { t: number; a: number }[] {
    if (this.hits) return this.hits;
    const map = this.map, B = map.beats, meter = map.meter, ev = map.events, n = B.length;
    if (n < 4) return (this.hits = ev.filter(e => e.tier > 0).map(e => ({ t: e.t, a: clamp(e.s / 1.4, 0.3, 1) })));
    // the neural engine measured every felt beat itself (Folia's accents: the same rise and loudness, the bars without
    // rhythm and the stretches it is unsure of already gated); only the pushes between the beats are added below
    const A = map.a.accents, neural = !!A && A.impact.length === n;
    const bw = (e: RhythmEvent) => (e.band === 'low' || e.band === 'broad' ? 1 : e.band === 'mid' ? 0.8 : 0.45);
    const near = (t: number, tol: number) => { let lo = 0, hi = ev.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].t < t - tol) lo = m + 1; else hi = m; }
      let best = 0; for (let i = lo; i < ev.length && ev[i].t <= t + tol; i++) best = Math.max(best, ev[i].s * bw(ev[i])); return best; };
    const loudAt = (t: number) => { let v = 0; for (const d of [-0.25, -0.12, 0, 0.12, 0.25]) v += map.loud(t + d); return v / 5; };
    const half = !neural && map.bpm >= 165 ? 2 : 1;                       // (felt at half the counted pace; the neural engine's beats are the felt ones already)
    const rise: number[] = [], loud: number[] = [], pos: number[] = [];
    for (let i = 0; i < n; i++) { const tol = Math.min(0.07, 0.18 * map.beatLen(B[i])); rise.push(near(B[i], tol)); loud.push(loudAt(B[i])); pos.push(map.beatAt(B[i] + 1e-4).inBar); }
    const pct = (a: number[], q: number) => { const s = a.filter(x => x > 0).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
    const r10 = pct(rise, 0.1), r90 = pct(rise, 0.9), l10 = pct(loud, 0.1), l90 = pct(loud, 0.9), rMed = pct(rise, 0.5);
    const norm = (v: number, a: number, b: number) => clamp((v - a) / Math.max(1e-6, b - a));
    const scale = clamp(0.45 + 0.55 * (rMed / Math.max(0.05, r90)) * 1.4, 0.45, 1);   // a song whose beats barely rise moves less
    const out: { t: number; a: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (neural) { if (!A!.rhythmic[i]) continue; const place = pos[i] === 0 ? 1 : meter === 4 && pos[i] % 2 === 1 ? 0.92 : 0.84;
        out.push({ t: B[i], a: clamp((0.28 + 0.72 * A!.impact[i]) * place * A!.trackScale * 1.15, 0, 1.25) }); continue; }
      if (half > 1 && pos[i] % 2 === 1) continue;
      // a bar with no onset on any of its beats: no hits there
      const b0 = i - pos[i], barHas = (() => { for (let j = Math.max(0, b0); j < Math.min(n, b0 + meter); j++) if (rise[j] > 0) return true; return false; })(); if (!barHas) continue;
      // (a beat with no onset of its own counts only inside a running groove: a hit just before it and just after)
      if (rise[i] <= 0 && !(i > 0 && rise[i - 1] > 0 && i + 1 < n && rise[i + 1] > 0)) continue;
      const imp = 0.4 * norm(rise[i], r10, r90) + 0.6 * norm(loud[i], l10, l90), place = pos[i] === 0 ? 1 : meter === 4 && pos[i] % 2 === 1 ? 0.92 : 0.84;
      const a = (0.28 + 0.72 * imp ** 0.75) * place * scale * (rise[i] > 0 ? 1 : 0.6);
      out.push({ t: B[i], a: clamp(a * 1.15, 0, 1.25) });
    }
    // the pushes between the beats: a strong hit off the beat that stands well above the bar's usual onset
    for (let k = 0; k < ev.length; k++) { const e = ev[k]; if (!e.off || e.tier < 2) continue; const bl = map.beatLen(e.t);
      const around: number[] = []; for (let j = k - 1; j >= 0 && e.t - ev[j].t <= meter * bl; j--) around.push(ev[j].s); for (let j = k + 1; j < ev.length && ev[j].t - e.t <= meter * bl; j++) around.push(ev[j].s);
      around.sort((x, y) => x - y); const med = around.length ? around[around.length >> 1] : e.s; if (e.s / Math.max(0.05, med) < 1.6) continue;
      if (out.some(h => Math.abs(h.t - e.t) < 0.3 * bl)) continue;
      out.push({ t: e.t, a: clamp(0.5 + 0.35 * clamp((e.s / med - 1.6) / 1.2), 0, 1) * (neural ? A!.trackScale : scale) }); }
    out.sort((x, y) => x.t - y.t);
    return (this.hits = out);
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
