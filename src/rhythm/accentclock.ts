// The clock the floating things share (feathers, motes, petals, bokeh lights, the liquid's flow, the glyph pane, line
// fragments, wireframe solids): it runs with the music but slows on its accents, as much as each one lands — a light
// accent only eases it a little, briefly; a heavy downbeat brakes it within a tenth of a second to a fifth of its speed,
// holds a moment and eases back over a little over a second — so everything drifting hangs in the air on the hit, in
// proportion, and drifts on. One rule for all of them: a new floating effect reads its time here, never the song's
// time. A rhythm reading, so it lives with the rhythm: one table per map (30 samples a second), the same for the
// preview and an export.
import { clamp } from '../core/math';
import { eOut, eIO } from '../core/ease';
import type { RhythmMap } from './map';

const FCLK = new WeakMap<RhythmMap, Float32Array>(), FR = 30;
function table(map: RhythmMap): Float32Array {
  let tb = FCLK.get(map); if (tb) return tb;
  // (to past the last beat: the map's times are the song's, which can run a little past the file's own length)
  const n = Math.ceil((Math.max(map.a.duration, map.beats[map.beats.length - 1] ?? 0) + 2) * FR) + 1, sp = new Float32Array(n).fill(1);
  // every accent, graded: k (0..1) how hard it lands sets how deep the clock dips (to 1 - 0.8k of its speed), how long it
  // holds and how long it takes to come back — so accents in a row slow it a little each, and a heavy one stands out
  const dipAt = (t: number, k: number) => { if (k <= 0.02) return; const hold = 0.08 + 0.14 * k, back = 0.35 + 0.95 * k;
    for (let i = Math.max(0, Math.floor(t * FR)); i < n; i++) { const u = i / FR - t; if (u > 0.1 + hold + back) break;
      const dip = u < 0.1 ? eOut(u / 0.1) : u < 0.1 + hold ? 1 : 1 - eIO((u - 0.1 - hold) / back), v = 1 - 0.8 * k * dip; if (v < sp[i]) sp[i] = v; } };
  // the rhythm engine's own reading when it measured every beat (the neural engine): each beat with rhythm by how hard it
  // lands (its impact, the measure the groove uses), a downbeat counting a little more
  const A = map.a.accents;
  if (A && A.impact.length === map.beats.length) {
    for (let i = 0; i < map.beats.length; i++) { const t = map.beats[i]; if (!A.rhythmic[i]) continue;
      const down = map.beatAt(t + 1e-4).inBar === 0 ? 1 : 0.8;
      dipAt(t, clamp((A.impact[i] - 0.35) / 0.6) ** 1.3 * down * A.trackScale ** 0.5); }
  } else for (const e of map.events) { const fr = e.pos - Math.round(e.pos), onBeat = !e.off && Math.abs(fr) < 0.12, down = onBeat && ((Math.round(e.pos) % map.meter) + map.meter) % map.meter === 0;
    // (the built-in reading: its events by strength and tier, on the beat more than off it, a downbeat most)
    dipAt(e.t, clamp((e.s - 0.55) / 1.1) ** 1.3 * (e.tier === 2 ? 1 : e.tier === 1 ? 0.7 : 0.35) * (down ? 1 : onBeat ? 0.85 : 0.6)); }
  tb = new Float32Array(n); for (let i = 1; i < n; i++) tb[i] = tb[i - 1] + (sp[i - 1] + sp[i]) / 2 / FR; FCLK.set(map, tb); return tb;
}
/** The drifting things' time at song time t (seconds, slowed on the accents; past the table's end it runs on at speed). */
export function accentClock(map: RhythmMap, t: number): number {
  if (t < 0) return t; const tb = table(map), x = clamp(t * FR, 0, tb.length - 1), i = Math.floor(x), j = Math.min(tb.length - 1, i + 1);
  return tb[i] + (tb[j] - tb[i]) * (x - i) + Math.max(0, t - (tb.length - 1) / FR);
}
