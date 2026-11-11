/* Ambient: the song's own colours, alive (the now-playing page's backdrop, and the base of the cover theme). The
   cover's main colours drift as large soft fields of light over the cover itself turning slowly underneath, drawn small
   and blurred (smooth at any size for the cost of a thumbnail), breathing with the shared rhythm pulse. One renderer
   for both screens, so leaving one for the other never changes the backdrop. */
import { register, type Ctx } from './registry';
import type { RenderFrame } from '../frame';
import { makeCanvas } from '../palette';
import { gfx } from '../gfx';

const SW = 128,
  SH = 80;
/** the ambient field's size (its edges, 6 and 4 px, are left out where it is drawn: the blur fades them) */
export const AMB_W = SW,
  AMB_H = SH;
const small = makeCanvas(SW, SH) as HTMLCanvasElement,
  sx = small.getContext('2d')!;
const soft = makeCanvas(SW, SH) as HTMLCanvasElement,
  so = soft.getContext('2d')!;
let lastKey = '';
/** Paint the ambient field for time t into the small canvas (blurred) and return it. */
export function ambientField(f: RenderFrame): HTMLCanvasElement {
  const t = f.t,
    pal = f.ambient,
    img = f.media.cover,
    pulse = f.rs.pulse * 0.07;
  const key = `${t.toFixed(3)}|${pulse.toFixed(3)}|${f.media.coverKey}|${pal.base.join()}`;
  if (key === lastKey) return soft;
  lastKey = key;
  sx.globalCompositeOperation = 'source-over';
  sx.globalAlpha = 1;
  sx.filter = 'none';
  sx.fillStyle = `rgb(${pal.base.map(Math.round)})`;
  sx.fillRect(0, 0, SW, SH);
  if (img)
    for (const [k, sp, sc, x0, y0] of [
      [0, 0.05, 1.5, 0.3, 0.35],
      [1, -0.035, 1.25, 0.72, 0.7],
    ]) {
      sx.save();
      sx.globalAlpha = 0.55 - k * 0.15;
      sx.translate(SW * x0, SH * y0);
      sx.rotate(t * sp + k * 2);
      const s = SW * sc * (1 + pulse);
      sx.drawImage(img, -s / 2, -s / 2, s, s);
      sx.restore();
    }
  sx.globalCompositeOperation = 'screen';
  pal.cols.forEach((col, i) => {
    const a = t * (0.07 + i * 0.023) + i * 1.7,
      x = SW * (0.5 + 0.38 * Math.cos(a) * Math.cos(a * 0.6 + i)),
      y = SH * (0.5 + 0.42 * Math.sin(a * 1.3 + i * 0.8));
    const r = SW * (0.42 + 0.1 * Math.sin(t * 0.21 + i)) * (1 + pulse * (i === 0 ? 1.5 : 0.6));
    const gr = sx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${col.map(Math.round)},${0.75 - i * 0.08})`);
    gr.addColorStop(1, `rgba(${col.map(Math.round)},0)`);
    sx.fillStyle = gr;
    sx.fillRect(0, 0, SW, SH);
  });
  sx.globalCompositeOperation = 'source-over';
  // (lite: no blur — the colours are soft gradients already, drawn up from a small picture)
  so.globalCompositeOperation = 'copy';
  if (gfx() !== 'lite') so.filter = 'blur(5px)';
  so.drawImage(small, 0, 0);
  so.filter = 'none';
  so.globalCompositeOperation = 'source-over';
  return soft;
}
/** Draw the ambient field over the whole frame (plus bleed), with a veil that keeps white text readable. */
export function drawAmbient(g: Ctx, f: RenderFrame, Ev: number, veil = 0.22) {
  const fld = ambientField(f);
  g.save();
  g.imageSmoothingEnabled = true;
  (g as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
  g.drawImage(fld, 6, 4, SW - 12, SH - 8, -Ev, -Ev, f.W + 2 * Ev, f.H + 2 * Ev);
  if (veil > 0) {
    g.fillStyle = `rgba(0,0,0,${veil})`;
    g.fillRect(-Ev, -Ev, f.W + 2 * Ev, f.H + 2 * Ev);
  }
  g.restore();
}
register({
  id: 'ambient',
  label: 'bg.ambient',
  layer: 'backdrop',
  kind: 'backdrop',
  draw(g, f, a) {
    drawAmbient(g, f, a.bd.Ev);
  },
});
