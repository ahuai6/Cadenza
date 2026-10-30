/* The cover theme's backdrop: the ambient field (the song's colours, ambient.ts — the now-playing page's backdrop) turned
   liquid as the effect lyrics come up. Over it, the liquid theme's field of colour regions pressing into one another
   (backdrops.ts), in the cover's own colours, squeezed out from under the cover by the low end: the subwoofer spring of
   the shared rhythm signals pushes the regions away from the cover on a kick, and they flow back through rest with one
   small rebound. The ambient field shows through it, so the cover's texture stays in the colours.
   With the now-playing page's backdrop alone (view.effect 0) only the ambient field is drawn: the page and the cover
   theme hand over to each other without a change of backdrop. */
import { clamp } from '../../core/math';
import { mix } from '../../core/color';
import type { Ctx } from './registry';
import type { RenderFrame } from '../frame';
import { drawAmbient } from './ambient';
import { renderLiquid, liquidCache } from './backdrops';

const C = liquidCache();
/** Draw the backdrop over the whole frame (plus bleed); (cx, cy) the cover's middle (frame px); a veil keeps white text readable. */
export function drawLiquid(g: Ctx, f: RenderFrame, Ev: number, ox: number, oy: number, cx: number, cy: number, veil: number) {
  drawAmbient(g, f, Ev, 0);
  const k = clamp(f.view.effect);
  if (k > 0.002) {
    // (the cover's colours, deepened into its base a little, so the field glows behind white text without washing it out)
    const A = f.ambient, cols = (A.cols.length ? A.cols : [A.base]).slice(0, 4).map(c => mix(A.base, c, 0.82));
    while (cols.length < 4) cols.push(mix(cols[cols.length - 1], A.base, 0.35));
    const low = renderLiquid(f, Ev, ox, oy, { cols, push: { x: cx, y: cy, k: f.motion >= 1 ? f.rs.cone : f.rs.cone * 0.4 } }, C);
    g.save(); g.globalAlpha = 0.78 * k; g.imageSmoothingEnabled = true; (g as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
    g.drawImage(low, -Ev, -Ev, f.W + 2 * Ev, f.H + 2 * Ev); g.restore();
  }
  if (veil > 0) { g.fillStyle = `rgba(0,0,0,${veil})`; g.fillRect(-Ev, -Ev, f.W + 2 * Ev, f.H + 2 * Ev); }
}
