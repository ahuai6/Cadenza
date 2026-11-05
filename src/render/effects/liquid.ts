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
import { ambientField, AMB_W, AMB_H } from './ambient';
import { makeCanvas } from '../palette';
import { renderLiquid, liquidCache } from './backdrops';

const C = liquidCache();
/** Draw the backdrop over the whole frame (plus bleed); (cx, cy) the cover's middle (frame px); a veil keeps white text readable. */
export function drawLiquid(g: Ctx, f: RenderFrame, Ev: number, ox: number, oy: number, cx: number, cy: number, veil: number) {
  // (all of it is soft, low-detail colour: it is put together small — the ambient field, its veil, the liquid over it,
  // the veil over that — and brought up to the frame once, not four times over the whole picture)
  const k = clamp(f.view.effect), fld = ambientField(f);
  let low: HTMLCanvasElement | null = null;
  if (k > 0.002) {
    // (the cover's colours, deepened into its base a little, so the field glows behind white text without washing it out)
    const A = f.ambient, cols = (A.cols.length ? A.cols : [A.base]).slice(0, 4).map(c => mix(A.base, c, 0.82));
    while (cols.length < 4) cols.push(mix(cols[cols.length - 1], A.base, 0.35));
    low = renderLiquid(f, Ev, ox, oy, { cols, push: { x: cx, y: cy, k: f.motion >= 1 ? f.rs.cone : f.rs.cone * 0.4 } }, C) as HTMLCanvasElement;
  }
  const w = low ? low.width : AMB_W, h = low ? low.height : AMB_H;
  if (MIX.width !== w || MIX.height !== h) { MIX.width = w; MIX.height = h; }
  const m = MIX.getContext('2d')!; m.setTransform(1, 0, 0, 1, 0, 0); m.globalAlpha = 1; m.globalCompositeOperation = 'source-over'; m.imageSmoothingEnabled = true; (m as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
  m.drawImage(fld, 6, 4, AMB_W - 12, AMB_H - 8, 0, 0, w, h);
  m.fillStyle = 'rgba(0,0,0,0.22)'; m.fillRect(0, 0, w, h);                         // (the ambient field's own veil)
  if (low) { m.globalAlpha = 0.78 * k; m.drawImage(low, 0, 0, w, h); m.globalAlpha = 1; }
  if (veil > 0) { m.fillStyle = `rgba(0,0,0,${veil})`; m.fillRect(0, 0, w, h); }
  g.save(); g.imageSmoothingEnabled = true; (g as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
  g.drawImage(MIX, 0, 0, w, h, -Ev, -Ev, f.W + 2 * Ev, f.H + 2 * Ev); g.restore();
}
const MIX = makeCanvas(16, 16) as HTMLCanvasElement;
