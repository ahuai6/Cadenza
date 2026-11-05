/* The picture-quality mode, and the cheap blur the optimised mode draws with.
   - 'default': everything as designed (canvas filter blurs, the frosted glyph pane, the shards carrying the frame…).
   - 'optimized': the same picture without the costly kinds of work in the effect lyrics: no canvas filter blur (a
     Gaussian per pixel, a software path on some GPUs) — a dual-filter blur instead, after Dual Kawase (ARM, SIGGRAPH
     2015): the picture halved again and again by bilinear copies (Chromium mipmaps a drawImage scaled down) and brought
     back up the same way, so nearly all the work is done at a few hundred pixels; and the glass that shows what is
     behind it reads that from a picture already drawn, at a reduced size, instead of blurring or copying it whole.
   - 'lite': no blur, no reflection of the picture in the glass, none of the costly effects, in every view — for a
     modest machine.
   Exports always draw in 'default' (engine/export.ts, through withGfx): the mode is for what plays live. */
import { makeCanvas } from './palette';
import type { Ctx } from './effects/registry';

export type GfxMode = 'default' | 'optimized' | 'lite';
let MODE: GfxMode = 'default';
export const gfx = () => MODE;
let LIVE: GfxMode = 'default';
/** The live picture's mode (the setting). */
export function setGfx(m: GfxMode) { LIVE = MODE = m === 'optimized' || m === 'lite' ? m : 'default'; }
/** Draw in another mode for just this (synchronous) call — an export's frames, while the live picture keeps its own:
 *  nothing else can draw in between, and the setting is not touched, so a change of it meanwhile is not undone. */
export function withGfx<T>(m: GfxMode, draw: () => T): T { MODE = m; try { return draw(); } finally { MODE = LIVE; } }
/** The lyric layer on the GPU (render/gpu.ts) where WebGL2 is there: the setting (on unless turned off). Exports draw
 *  the same way as the live picture, so a preview and its export match. */
let GPU = true;
export const gpuLyrics = () => GPU;
export function setGpuLyrics(on: boolean) { GPU = !!on; }
/** Effects the lite mode leaves out (each reads the whole frame again, or blurs, every frame it shows). */
export const LITE_OFF = new Set(['glyph', 'glass-shards', 'chroma', 'glitch']);

const POOL: HTMLCanvasElement[] = [];
const lvl = (i: number, w: number, h: number) => { let c = POOL[i]; if (!c) { c = makeCanvas(2, 2) as HTMLCanvasElement; POOL[i] = c; } if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return c; };
const C = (c: HTMLCanvasElement) => { const x = c.getContext('2d')!; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'low'; x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'copy'; x.filter = 'none'; return x; };
/** The dual-filter chain of a picture from level `from` (the picture scaled straight to 1/2^from — one mipmapped copy,
 *  nothing finer is needed for this radius) to `to`, each level after it a bilinear halving of the one before, then
 *  softened once on the way back up (the "up" pass of the dual filter). Levels are pooled: read them before the next call. */
function chain(src: CanvasImageSource, sw: number, sh: number, from: number, to: number) {
  const out: { c: HTMLCanvasElement; w: number; h: number }[] = [];
  for (let i = from; i <= to; i++) { const p = out[out.length - 1], w = Math.max(2, Math.ceil(sw / 2 ** i)), h = Math.max(2, Math.ceil(sh / 2 ** i)), c = lvl(i, w, h);
    if (p) C(c).drawImage(p.c, 0, 0, p.w, p.h, 0, 0, w, h); else C(c).drawImage(src, 0, 0, sw, sh, 0, 0, w, h); out.push({ c, w, h }); }
  // (the up pass: each level from the one below it, blended back in — the tent the down pass alone lacks)
  for (let i = out.length - 2; i >= 1; i--) { const lo = out[i + 1], hi = out[i], x = hi.c.getContext('2d')!; x.globalCompositeOperation = 'source-over'; x.globalAlpha = 0.5; x.drawImage(lo.c, 0, 0, lo.w, lo.h, 0, 0, hi.w, hi.h); x.globalAlpha = 1; }
  return out;
}
/** `src` shrunk by 2^n, a halving at a time (each step averages the one above: no aliasing, whatever the factor —
 *  one big bilinear step samples a pixel here and there, and a moving picture shimmers through it). */
const DOWN: HTMLCanvasElement[] = [];
export function downsample(src: CanvasImageSource, sw: number, sh: number, n: number): { c: HTMLCanvasElement; w: number; h: number } {
  let c: CanvasImageSource = src, w = sw, h = sh;
  for (let i = 1; i <= n; i++) { const w2 = Math.max(2, Math.ceil(sw / 2 ** i)), h2 = Math.max(2, Math.ceil(sh / 2 ** i));
    let d = DOWN[i]; if (!d) { d = makeCanvas(2, 2) as HTMLCanvasElement; DOWN[i] = d; } if (d.width !== w2 || d.height !== h2) { d.width = w2; d.height = h2; }
    C(d).drawImage(c, 0, 0, w, h, 0, 0, w2, h2); c = d; w = w2; h = h2; }
  return { c: c as HTMLCanvasElement, w, h };
}
const MIX = makeCanvas(2, 2) as HTMLCanvasElement;
/** Draw `src` (sw × sh) into (dx, dy, dw, dh) of g blurred by about `r` pixels of the source, the cheap way: the two
 *  levels either side of the radius crossfaded at the smaller level's size (so the blur grows smoothly as r does, no
 *  stepping), then one draw up to the destination. */
export function cheapBlurDraw(g: Ctx, src: CanvasImageSource, sw: number, sh: number, r: number, dx: number, dy: number, dw: number, dh: number, alpha = 1) {
  if (r < 0.5) { g.globalAlpha = alpha; g.drawImage(src, 0, 0, sw, sh, dx, dy, dw, dh); return; }
  const lf = Math.max(1, Math.log2(r / 0.8)), l0 = Math.min(7, Math.floor(lf)), l1 = Math.min(8, l0 + 1), fr = lf - l0;
  const L = chain(src, sw, sh, Math.max(1, l0 - 1), l1), a = L[L.length - 2], b = L[L.length - 1];
  if (MIX.width !== a.w || MIX.height !== a.h) { MIX.width = a.w; MIX.height = a.h; }
  const m = C(MIX); m.drawImage(a.c, 0, 0); if (fr > 0.01) { m.globalCompositeOperation = 'source-over'; m.globalAlpha = fr; m.drawImage(b.c, 0, 0, b.w, b.h, 0, 0, a.w, a.h); m.globalAlpha = 1; }
  const sm = g.imageSmoothingEnabled, sq = (g as any).imageSmoothingQuality;
  g.imageSmoothingEnabled = true; (g as any).imageSmoothingQuality = 'medium';
  g.globalAlpha = alpha; g.drawImage(MIX, 0, 0, a.w, a.h, dx, dy, dw, dh);
  g.imageSmoothingEnabled = sm; (g as any).imageSmoothingQuality = sq;
}
