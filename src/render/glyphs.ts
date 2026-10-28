/* Blurred glyphs, as a mip ladder. Each glyph (in a face and colour) is kept as a few pre-blurred bitmaps at power-of-two
   working sizes, every level with the same small gaussian at its own resolution: scaled up to the glyph's size, level k
   shows a blur of B0·G/size(k). Any blur is drawn from the two nearest levels, blended. So the bitmaps a glyph needs do
   not depend on how blurred it is nor on how close the camera is: a focus pull, a zoom and a shadow all reuse the same
   handful, made once (and baked ahead by prewarmGlyphs when a song is planned) — never one per frame. */
import { clamp } from '../core/math';
import { makeCanvas } from './palette';
import type { Ctx } from './effects/registry';
import { EM } from '../text/metrics';

const HAS_FILTER = (() => { try { const g = (makeCanvas(2, 2) as HTMLCanvasElement).getContext('2d')!; g.filter = 'blur(2px)'; return g.filter === 'blur(2px)'; } catch { return false; } })();
const sg = (makeCanvas(4, 4) as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;     // for measuring
type Bm = { bm: ImageBitmap | HTMLCanvasElement | OffscreenCanvas; w: number; h: number; s: number };
const CACHE = new Map<string, Bm>(); let PIX = 0; const MAX = 48e6;
export const filterSupported = HAS_FILTER;
/** bitmaps made (for profiling) */
export const STATS: { miss: number; keys?: string[] } = { miss: 0 };
const TOP = 256, LEVELS = 6, B0 = 1.1;          // level k: working size TOP / 2^k (256 … 8), blur B0 px at that size

/** A fill lit from above (top, middle and bottom colours across the em), as the lyric pass draws its sharp glyphs. */
export type InkGrad = [string, string, string];
function level(font: string, col: string, txt: string, k: number, grad?: InkGrad | null): Bm {
  const key = font + '|' + (grad ? grad.join('>') : col) + '|' + k + '|' + txt; let e = CACHE.get(key);
  if (e) { CACHE.delete(key); CACHE.set(key, e); return e; }
  STATS.miss++; STATS.keys?.push(col + '|' + k + '|' + txt);
  const S = TOP >> k, q = S / EM; if (sg.font !== font) sg.font = font;
  const tw = Math.max(S, sg.measureText(txt).width * q), pad = Math.ceil(B0 * 3 + S * 0.12 + 2), w = Math.ceil(tw + pad * 2), h = Math.ceil(S * 1.35 + pad * 2);
  // drawn straight into a canvas of exactly its size (a filter costs as much as the canvas it draws on)
  const oc: any = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : makeCanvas(w, h), c = oc.getContext('2d') as CanvasRenderingContext2D;
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.setTransform(q, 0, 0, q, w / 2, h / 2);
  if (grad) { const gr = c.createLinearGradient(0, -EM * 0.55, 0, EM * 0.6); gr.addColorStop(0, grad[0]); gr.addColorStop(0.55, grad[1]); gr.addColorStop(1, grad[2]); c.fillStyle = gr; } else c.fillStyle = col;
  if (HAS_FILTER) { c.filter = `blur(${B0}px)`; c.fillText(txt, 0, 0); c.filter = 'none'; }
  else { const D = (w + h) * 1.5 / q; c.shadowColor = grad ? grad[1] : col; c.shadowBlur = B0 * 2; c.shadowOffsetX = q * D; c.shadowOffsetY = 0; c.fillText(txt, -D, 0); }
  const bm: any = oc.transferToImageBitmap ? oc.transferToImageBitmap() : oc;
  e = { bm, w, h, s: EM / S }; CACHE.set(key, e); PIX += w * h;
  while (PIX > MAX && CACHE.size > 1) { const [k0, o] = CACHE.entries().next().value!; CACHE.delete(k0); PIX -= o.w * o.h; (o.bm as ImageBitmap).close?.(); }
  return e;
}
const put = (g: Ctx, e: Bm) => g.drawImage(e.bm, 0, 0, e.w, e.h, -e.w / 2 * e.s, -e.h / 2 * e.s, e.w * e.s, e.h * e.s);

/** Draw `txt` blurred by bpx device pixels at glyph em size G device pixels, centred at the context's origin (whose
 *  transform scales EM units to the glyph's size), at the context's current alpha. */
export function blurGlyph(g: Ctx, txt: string, bpx: number, G: number, grad?: InkGrad | null) {
  const font = g.font, col = g.fillStyle as string, A = g.globalAlpha;
  const L = clamp(Math.log2(Math.max(1e-3, bpx) * TOP / (B0 * Math.max(1, G))), 0, LEVELS - 1), k0 = Math.floor(L), f = L - k0;
  if (f < 0.02 || k0 >= LEVELS - 1) { put(g, level(font, col, txt, k0, grad)); return; }
  // between two levels: the blurrier under the sharper, so that together they keep the glyph's body at exactly A
  const sA = A * (1 - f), bA = sA >= 0.999 ? 0 : Math.max(0, (A - sA) / (1 - sA));
  if (bA > 0.003) { g.globalAlpha = bA; put(g, level(font, col, txt, k0 + 1, grad)); }
  g.globalAlpha = sA; put(g, level(font, col, txt, k0, grad)); g.globalAlpha = A;
}
/** Bake the levels a song will use for these glyphs ahead of time, a slice at a time (the strong blurs and shadows use
 *  the small levels; the large ones are made as glyphs come close). Returns a function that does the next slice and
 *  says whether there is more. */
export function prewarmGlyphs(font: string, cols: string[], chars: string[], levels = [3, 4, 5, 6], grad?: InkGrad | null) {
  // (keys use the face and colour as a canvas reports them back, which is how the lyric pass reads them)
  const ng = (makeCanvas(1, 1) as HTMLCanvasElement).getContext('2d')!; ng.font = font; font = ng.font;
  const ncols: (string | InkGrad)[] = cols.map(c => { ng.fillStyle = c; return ng.fillStyle as string; }); if (grad) ncols.push(grad);
  const todo: [string | InkGrad, string, number][] = []; for (const c of chars) for (const col of ncols) for (const k of levels) todo.push([col, c, k]);
  let i = 0; return (budgetMs = 4) => { const t0 = performance.now(); while (i < todo.length && performance.now() - t0 < budgetMs) { const [col, c, k] = todo[i++]; typeof col === 'string' ? level(font, col, c, k) : level(font, '', c, k, col); } return i < todo.length; };
}
export function clearGlyphCache() { for (const o of CACHE.values()) (o.bm as ImageBitmap).close?.(); CACHE.clear(); PIX = 0; }

/** The last 1.6 px of a focus pull: the sharp glyph takes over from the blurred one without the word ever dimming. Both
 *  are drawn straight onto the frame (no scratch canvas: at close-up sizes a per-glyph scratch cost more than the rest of
 *  the frame): the sharp glyph at its share of the opacity, and the blurred one under it at whatever keeps the glyph's
 *  body at exactly the word's opacity (source-over: a + b·(1 − a) = A). */
/* Large sharp glyphs. Past a size the browser keeps no glyph cache and draws every glyph from its outline, on the CPU,
   for every layer (the face, its edge copies, its gradient) and every frame — a close-up of a short word (a number, a
   single word) made the whole picture fall behind. So past LARGE device pixels a glyph is drawn from a bitmap of
   itself made once at a size on a 1/8-octave ladder (sharp at that size, scaled by at most 4 % to the size asked),
   which costs a texture copy instead. */
const LARGE = 150;
type Paint = string | InkGrad | { stroke: string; w: number };
const paintKey = (f: Paint) => (typeof f === 'string' ? f : Array.isArray(f) ? f.join('>') : 'K' + f.stroke + '/' + f.w);
function sharpBm(font: string, txt: string, G: number, fill: Paint): Bm {
  const S = Math.min(1400, Math.round(2 ** (Math.round(Math.log2(G) * 8) / 8))), key = 'S|' + font + '|' + paintKey(fill) + '|' + S + '|' + txt;
  let e = CACHE.get(key); if (e) { CACHE.delete(key); CACHE.set(key, e); return e; }
  STATS.miss++; STATS.keys?.push('sharp|' + S + '|' + txt);
  const q = S / EM; if (sg.font !== font) sg.font = font;
  const tw = Math.max(S, sg.measureText(txt).width * q), pad = Math.ceil(S * 0.14 + 2), w = Math.ceil(tw + pad * 2), h = Math.ceil(S * 1.4 + pad * 2);
  const oc: any = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : makeCanvas(w, h), c = oc.getContext('2d') as CanvasRenderingContext2D;
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.setTransform(q, 0, 0, q, w / 2, h / 2);
  if (typeof fill === 'string') { c.fillStyle = fill; c.fillText(txt, 0, 0); }
  else if (Array.isArray(fill)) { const gr = c.createLinearGradient(0, -EM * 0.55, 0, EM * 0.6); gr.addColorStop(0, fill[0]); gr.addColorStop(0.55, fill[1]); gr.addColorStop(1, fill[2]); c.fillStyle = gr; c.fillText(txt, 0, 0); }
  else { c.strokeStyle = fill.stroke; c.lineWidth = fill.w; c.lineJoin = 'round'; c.strokeText(txt, 0, 0); }
  const bm: any = oc.transferToImageBitmap ? oc.transferToImageBitmap() : oc;
  e = { bm, w, h, s: EM / S }; CACHE.set(key, e); PIX += w * h;
  while (PIX > MAX && CACHE.size > 1) { const [k0, o] = CACHE.entries().next().value!; CACHE.delete(k0); PIX -= o.w * o.h; (o.bm as ImageBitmap).close?.(); }
  return e;
}
/** The outline of `txt` (line width w in EM units), the same way: from a bitmap past LARGE. */
export function strokeGlyph(g: Ctx, txt: string, G: number, w: number, x = 0, y = 0) {
  if (G < LARGE) { g.lineWidth = w; g.strokeText(txt, x, y); return; }
  const e = sharpBm(g.font, txt, G, { stroke: g.strokeStyle as string, w });
  g.drawImage(e.bm, 0, 0, e.w, e.h, x - e.w / 2 * e.s, y - e.h / 2 * e.s, e.w * e.s, e.h * e.s);
}
/** Draw `txt` sharp at em size G device px, at (x, y) in the context's EM units: from the text below LARGE, from its
 *  bitmap above. fill: a colour, or the lit gradient (null: the context's fill colour). */
export function sharpGlyph(g: Ctx, txt: string, G: number, fill?: InkGrad | null, x = 0, y = 0) {
  if (G < LARGE) { if (fill) { const c = g.fillStyle, gr = g.createLinearGradient(x, y - EM * 0.55, x, y + EM * 0.6); gr.addColorStop(0, fill[0]); gr.addColorStop(0.55, fill[1]); gr.addColorStop(1, fill[2]); g.fillStyle = gr; g.fillText(txt, x, y); g.fillStyle = c; } else g.fillText(txt, x, y); return; }
  const e = sharpBm(g.font, txt, G, fill || (g.fillStyle as string));
  g.drawImage(e.bm, 0, 0, e.w, e.h, x - e.w / 2 * e.s, y - e.h / 2 * e.s, e.w * e.s, e.h * e.s);
}

/** (the hand-over spans from the finest level's own blur — a close-up glyph's finest level is softer than 1.6 px)  */
export const focusW = (bpx: number, G = 0) => { const top = Math.max(1.6, B0 * G / TOP * 1.15); return bpx > 0.4 ? clamp((top - bpx) / (top - 0.4)) : 1; };
export function drawFocus(g: Ctx, ch: string, bpx: number, G: number, A: number, sharp?: CanvasGradient | null, grad?: InkGrad | null) {
  const w = focusW(bpx, G), sharpFill = () => { if (G >= LARGE) { sharpGlyph(g, ch, G, grad); return; } if (!sharp) { g.fillText(ch, 0, 0); return; } const c = g.fillStyle; g.fillStyle = sharp; g.fillText(ch, 0, 0); g.fillStyle = c; };
  if (w >= 1) { g.globalAlpha = A; sharpFill(); return; }
  if (w <= 0) { g.globalAlpha = A; blurGlyph(g, ch, bpx, G, grad); return; }
  const sA = A * w, bA = sA >= 0.999 ? 0 : Math.max(0, (A - sA) / (1 - sA));
  if (bA > 0.003) { g.globalAlpha = bA; blurGlyph(g, ch, bpx, G, grad); }
  g.globalAlpha = sA; sharpFill();
}
