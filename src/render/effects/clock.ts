// The clock the floating things share (feathers, motes, line fragments, wireframe solids): it runs with the music but
// slows on each strong accent — braking within a tenth of a second to a fifth of its speed, holding a moment, then
// easing back over a little over a second — so everything drifting hangs in the air on the hit and drifts on. One rule
// for all of them: a new floating effect reads its time here, never from f.t. One table per plan (30 samples a second).
import { clamp } from '../../core/math';
import { eOut, eIO } from '../../core/ease';
import type { RenderFrame } from '../frame';

const FCLK = new WeakMap<object, Float32Array>(), FR = 30;
function table(plan: RenderFrame['plan']): Float32Array {
  let tb = FCLK.get(plan); if (tb) return tb;
  const n = Math.ceil((plan.dur + 2) * FR) + 1, sp = new Float32Array(n).fill(1);
  for (const e of plan.map.events) { if (e.tier < 2 || e.s < 1.1 || e.off) continue; const k = clamp((e.s - 1.1) / 0.8 + 0.6, 0.6, 1);
    for (let i = Math.max(0, Math.floor(e.t * FR)); i < n; i++) { const u = i / FR - e.t; if (u > 1.6) break;
      const dip = u < 0.1 ? eOut(u / 0.1) : u < 0.3 ? 1 : 1 - eIO((u - 0.3) / 1.3), v = 1 - 0.8 * k * dip; if (v < sp[i]) sp[i] = v; } }
  tb = new Float32Array(n); for (let i = 1; i < n; i++) tb[i] = tb[i - 1] + (sp[i - 1] + sp[i]) / 2 / FR; FCLK.set(plan, tb); return tb;
}
/** The drifting things' time at this frame (seconds, slowed on the accents). */
export function accentClock(f: Pick<RenderFrame, 'plan' | 't'>): number {
  if (f.t < 0) return f.t; const tb = table(f.plan), x = clamp(f.t * FR, 0, tb.length - 1), i = Math.floor(x), j = Math.min(tb.length - 1, i + 1);
  return tb[i] + (tb[j] - tb[i]) * (x - i) + Math.max(0, f.t - (tb.length - 1) / FR);
}
/** How fast that clock runs now (1 normal, about 0.2 at the bottom of an accent's slow-down). */
export function accentSpeed(f: Pick<RenderFrame, 'plan' | 't'>): number { const a = accentClock({ plan: f.plan, t: f.t - 0.02 }), b = accentClock(f); return clamp((b - a) / 0.02, 0, 1.2); }
