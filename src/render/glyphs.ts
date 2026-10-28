/* Blurred glyphs. A word focusing in asks for a new blur radius nearly every frame; drawing each fresh is what made lines
   with many characters (or digits) hitch. So blurred glyphs are drawn small (a blurred glyph holds no fine detail: never
   more than ~3 px of blur at its working size), with a real gaussian (canvas filter; a shadow where filters are missing),
   kept as bitmaps keyed by glyph, face, colour, working size and blur (sizes in 1/24-octave steps, blur in quarter
   pixels), and scaled into place. The end of a focus pull cross-fades into the sharp glyph without dimming it. */
import { clamp } from '../core/math';
import { makeCanvas } from './palette';
import type { Ctx } from './effects/registry';
import { EM } from '../text/metrics';

const HAS_FILTER = (() => { try { const g = (makeCanvas(2, 2) as HTMLCanvasElement).getContext('2d')!; g.filter = 'blur(2px)'; return g.filter === 'blur(2px)'; } catch { return false; } })();
const scratch = makeCanvas(64, 64) as HTMLCanvasElement, sg = scratch.getContext('2d', { willReadFrequently: false }) as CanvasRenderingContext2D;
const CACHE = new Map<string, { bm: ImageBitmap | HTMLCanvasElement | OffscreenCanvas; w: number; h: number }>(); let PIX = 0; const MAX = 40e6;
const oct = (x: number, n: number) => 2 ** (Math.round(Math.log2(Math.max(1e-3, x)) * n) / n);
export const filterSupported = HAS_FILTER;

/** Draw `txt` blurred by bpx device pixels at glyph em size G device pixels, centred at the context's origin (whose
 *  transform scales EM units to the glyph's size). */
export function blurGlyph(g: Ctx, txt: string, bpx: number, G: number) {
  const hs = clamp(Math.round(oct(G, 12)), 24, 256), bw = Math.max(0.5, bpx * hs / G);
  const hq = bw > 3 ? Math.max(8, Math.round(oct(hs * 3 / bw, 24))) : hs, b = bw > 3 ? Math.max(0.5, Math.round(bw * hq / hs * 4) / 4) : Math.round(bw * 4) / 4;
  const font = g.font, col = g.fillStyle as string, key = font + '|' + col + '|' + hq + '|' + b + '|' + txt;
  let e = CACHE.get(key);
  if (e) { CACHE.delete(key); CACHE.set(key, e); }
  else {
    const q = hq / EM; if (sg.font !== font) sg.font = font;
    const tw = Math.max(hq, sg.measureText(txt).width * q), pad = Math.ceil(b * 3 + hq * 0.12), w = Math.ceil(tw + pad * 2), h = Math.ceil(hq * 1.35 + pad * 2);
    if (scratch.width < w || scratch.height < h) { scratch.width = Math.max(w, scratch.width); scratch.height = Math.max(h, scratch.height); }
    sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, w, h); sg.globalAlpha = 1; sg.font = font; sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.fillStyle = col;
    sg.setTransform(q, 0, 0, q, w / 2, h / 2);
    if (HAS_FILTER) { sg.filter = `blur(${b}px)`; sg.fillText(txt, 0, 0); sg.filter = 'none'; }
    else { const D = (w + h) * 1.5 / q; sg.shadowColor = col; sg.shadowBlur = b * 2; sg.shadowOffsetX = q * D; sg.shadowOffsetY = 0; sg.fillText(txt, -D, 0); sg.shadowBlur = 0; sg.shadowOffsetX = 0; }
    sg.setTransform(1, 0, 0, 1, 0, 0);
    let bm: any; if (typeof OffscreenCanvas !== 'undefined') { const oc = new OffscreenCanvas(w, h); oc.getContext('2d')!.drawImage(scratch, 0, 0, w, h, 0, 0, w, h); bm = oc.transferToImageBitmap(); }
    else { bm = makeCanvas(w, h); bm.getContext('2d').drawImage(scratch, 0, 0, w, h, 0, 0, w, h); }
    e = { bm, w, h }; CACHE.set(key, e); PIX += w * h;
    while (PIX > MAX && CACHE.size > 1) { const [k0, o] = CACHE.entries().next().value!; CACHE.delete(k0); PIX -= o.w * o.h; (o.bm as ImageBitmap).close?.(); }
  }
  const s = EM / hq; g.drawImage(e.bm, 0, 0, e.w, e.h, -e.w / 2 * s, -e.h / 2 * s, e.w * s, e.h * s);
}
export function clearGlyphCache() { for (const o of CACHE.values()) (o.bm as ImageBitmap).close?.(); CACHE.clear(); PIX = 0; }

/** The last 1.6 px of a focus pull: sharp at full strength with the blurred glyph fading over it (never dimmer than
 *  either); a word still fading in mixes the two additively on a scratch canvas first. */
export const focusW = (bpx: number) => (bpx > 0.4 ? clamp((1.6 - bpx) / 1.2) : 1);
const POOL = new Map<number, HTMLCanvasElement | OffscreenCanvas>();
export function drawFocus(g: Ctx, ch: string, bpx: number, G: number, A: number) {
  const w = focusW(bpx);
  if (w >= 1) { g.globalAlpha = A; g.fillText(ch, 0, 0); return; }
  if (w <= 0) { g.globalAlpha = A; blurGlyph(g, ch, bpx, G); return; }
  if (A >= 0.995) { g.globalAlpha = A; g.fillText(ch, 0, 0); g.globalAlpha = A * (1 - w); blurGlyph(g, ch, bpx, G); return; }
  const k = Math.max(0.05, G / EM), need = Math.ceil(EM * 1.8 * k + bpx * 8), N = Math.max(64, 1 << Math.ceil(Math.log2(need)));
  let cv = POOL.get(N); if (!cv) { cv = makeCanvas(N, N); POOL.set(N, cv); }
  const c = (cv as HTMLCanvasElement).getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.clearRect(0, 0, N, N);
  c.setTransform(k, 0, 0, k, N / 2, N / 2); c.font = g.font; c.fillStyle = g.fillStyle; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.globalAlpha = 1 - w; blurGlyph(c, ch, bpx, G);
  c.globalCompositeOperation = 'lighter'; c.globalAlpha = w; c.fillText(ch, 0, 0); c.globalCompositeOperation = 'source-over';
  g.globalAlpha = A; g.drawImage(cv, 0, 0, N, N, -N / 2 / k, -N / 2 / k, N / k, N / k);
}
