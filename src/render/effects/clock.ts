// The clock the floating things share (feathers, motes, petals, bokeh lights, the liquid's flow, the glyph pane, line
// fragments, wireframe solids): it runs with the music but
// slows on each heavy beat (a strong accent on a downbeat) — braking within a tenth of a second to a fifth of its speed, holding a moment, then
// easing back over a little over a second — so everything drifting hangs in the air on the hit and drifts on. One rule
// for all of them: a new floating effect reads its time here, never from f.t. One table per plan (30 samples a second).
import { clamp } from '../../core/math';
import { eOut, eIO } from '../../core/ease';
import type { RenderFrame } from '../frame';

const FCLK = new WeakMap<object, Float32Array>(), FR = 30;
function table(plan: RenderFrame['plan']): Float32Array {
  let tb = FCLK.get(plan); if (tb) return tb;
  const n = Math.ceil((plan.dur + 2) * FR) + 1, sp = new Float32Array(n).fill(1);
  // (only the heavy beats: a strong accent on a downbeat, at most one a bar — never the hits in between)
  const map = plan.map, meter = map.meter; let last = -1e9;
  const dipAt = (t: number, k: number) => { for (let i = Math.max(0, Math.floor(t * FR)); i < n; i++) { const u = i / FR - t; if (u > 1.6) break;
    const dip = u < 0.1 ? eOut(u / 0.1) : u < 0.3 ? 1 : 1 - eIO((u - 0.3) / 1.3), v = 1 - 0.8 * k * dip; if (v < sp[i]) sp[i] = v; } };
  // the rhythm engine's own reading when it measured every beat (the neural engine): a downbeat of a bar with rhythm
  // that lands hard (its impact, the same measure the groove uses), as deep as it lands
  const A = map.a.accents;
  if (A && A.impact.length === map.beats.length) {
    for (let i = 0; i < map.beats.length; i++) { const t = map.beats[i]; if (!A.rhythmic[i] || A.impact[i] < 0.72 || map.beatAt(t + 1e-4).inBar !== 0 || t - last < meter * map.beatLen(t) * 0.9) continue;
      last = t; dipAt(t, clamp(0.6 + (A.impact[i] - 0.72) / 0.28 * 0.4, 0.6, 1) * A.trackScale ** 0.5); }
  } else for (const e of map.events) { const fr = e.pos - Math.round(e.pos), down = !e.off && Math.abs(fr) < 0.12 && ((Math.round(e.pos) % meter) + meter) % meter === 0;
    if (e.tier < 2 || e.s < 1 || !down || e.t - last < meter * map.beatLen(e.t) * 0.9) continue; last = e.t; dipAt(e.t, clamp((e.s - 1) / 0.8 + 0.6, 0.6, 1)); }
  tb = new Float32Array(n); for (let i = 1; i < n; i++) tb[i] = tb[i - 1] + (sp[i - 1] + sp[i]) / 2 / FR; FCLK.set(plan, tb); return tb;
}
/** The drifting things' time at this frame (seconds, slowed on the accents). */
export function accentClock(f: Pick<RenderFrame, 'plan' | 't'>): number {
  if (f.t < 0) return f.t; const tb = table(f.plan), x = clamp(f.t * FR, 0, tb.length - 1), i = Math.floor(x), j = Math.min(tb.length - 1, i + 1);
  return tb[i] + (tb[j] - tb[i]) * (x - i) + Math.max(0, f.t - (tb.length - 1) / FR);
}
/** How fast that clock runs now (1 normal, about 0.2 at the bottom of an accent's slow-down). */
export function accentSpeed(f: Pick<RenderFrame, 'plan' | 't'>): number { const a = accentClock({ plan: f.plan, t: f.t - 0.02 }), b = accentClock(f); return clamp((b - a) / 0.02, 0, 1.2); }
