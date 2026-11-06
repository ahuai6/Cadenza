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
const CACHE = new Map<string, Bm>(); let PIX = 0, MAX = 48e6;
/** Glyph bitmaps are made on the CPU (a canvas the browser keeps in memory, not on the graphics card): taking one into the
 *  GPU lyric layer is then a plain upload — from a canvas held on the graphics card it was a read back from it, which
 *  waits for the card; a frame of many new glyphs stalled for a second and more. */
const CPU = { willReadFrequently: true } as CanvasRenderingContext2DSettings;
/** The cache's size for a picture of w × h device pixels: room for a few dozen of its large glyphs (a bigger picture's
 *  glyphs are bigger; with too small a cache a zooming camera made the same glyphs again and again). */
export function setGlyphCacheFor(w: number, h: number) { MAX = Math.min(160e6, Math.max(48e6, w * h * 30)); }
export const filterSupported = HAS_FILTER;
/** bitmaps made (for profiling) */
export const STATS: { miss: number; keys?: string[] } = { miss: 0 };
const TOP = 256, LEVELS = 6, B0 = 1.1;          // level k: working size TOP / 2^k (256 … 8), blur B0 px at that size

/** A fill lit from above (top, middle and bottom colours across the em), as the lyric pass draws its sharp glyphs. */
export type InkGrad = [string, string, string];
/* Making glyphs ahead (a look ahead, a resolution prepared) within a time budget: past its deadline a glyph not made yet
   is skipped — drawn as nothing, in a pass nobody sees — and made by the next slice. A real frame has no deadline. */
let DEADLINE = Infinity, SKIPPED = 0;
const EMPTY: Bm = { bm: makeCanvas(1, 1) as HTMLCanvasElement, w: 1, h: 1, s: 0 };
const late = () => { if (performance.now() <= DEADLINE) return false; SKIPPED++; return true; };
/** Run fn (drawing a pass ahead) making glyphs for at most ms; true when it needed none it did not make. */
export function withMakeBudget(ms: number, fn: () => void): boolean {
  DEADLINE = performance.now() + ms; SKIPPED = 0;
  try { fn(); } finally { DEADLINE = Infinity; }
  return SKIPPED === 0;
}
function level(font: string, col: string, txt: string, k: number, grad?: InkGrad | null): Bm {
  const key = font + '|' + (grad ? grad.join('>') : col) + '|' + k + '|' + txt; let e = CACHE.get(key);
  if (e) { CACHE.delete(key); CACHE.set(key, e); return e; }
  if (late()) return EMPTY;
  STATS.miss++; STATS.keys?.push(col + '|' + k + '|' + txt);
  const S = TOP >> k, q = S / EM; if (sg.font !== font) sg.font = font;
  const tw = Math.max(S, sg.measureText(txt).width * q), pad = Math.ceil(B0 * 3 + S * 0.12 + 2), w = Math.ceil(tw + pad * 2), h = Math.ceil(S * 1.35 + pad * 2);
  // drawn straight into a canvas of exactly its size (a filter costs as much as the canvas it draws on)
  const oc: any = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : makeCanvas(w, h), c = oc.getContext('2d', CPU) as CanvasRenderingContext2D;
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
/** Two layers of one glyph, one over the other, that together stand for a mix of them at opacity A, `k` of it the top one:
 *  [the bottom one's opacity, the top one's]. The bottom at its share of A; the top at what keeps the glyph's body at A —
 *  but never more than three times its share, so both change smoothly with A and with k, all the way to either layer
 *  alone. (Keeping the body at exactly A asked the impossible of two layers at A = 1: there one of them had to be fully
 *  opaque, and which one switched — the old rule put the bottom one fully under the top from the first sliver of k, and
 *  let it fall to under half as soon as A dipped to 0.93: the glow and the shadow round a word shrank in one frame when
 *  it began to fade, and popped where a blur crossed from one level to the next. Now the body may dip, smoothly, by up
 *  to about 8 % in the middle of such a crossing at full opacity.) */
export function layerPair(A: number, k: number): [number, number] {
  const b = A * (1 - k), t = b >= 0.9999 ? 0 : Math.min(A * k / (1 - b), 3 * A * k);
  return [b, Math.min(1, t)];
}
export function blurGlyph(g: Ctx, txt: string, bpx: number, G: number, grad?: InkGrad | null) {
  const font = g.font, col = g.fillStyle as string, A = g.globalAlpha;
  const L = clamp(Math.log2(Math.max(1e-3, bpx) * TOP / (B0 * Math.max(1, G))), 0, LEVELS - 1), k0 = Math.floor(L), f = L - k0;
  if (f < 0.001 || k0 >= LEVELS - 1) { put(g, level(font, col, txt, k0, grad)); return; }
  // between two levels: the blurrier under the sharper (layerPair: the sharper's share is 1 - f)
  const [bA, sA] = layerPair(A, 1 - f);
  if (bA > 0.003) { g.globalAlpha = bA; put(g, level(font, col, txt, k0 + 1, grad)); }
  if (sA > 0.003) { g.globalAlpha = sA; put(g, level(font, col, txt, k0, grad)); } g.globalAlpha = A;
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
/** Bake ahead the sharp bitmaps large glyphs will be drawn from: each [character, size in device px] in each paint
 *  (the lit fill, the edge colour, the faint outline of an unsung character), a slice at a time. */
export function prewarmSharp(font: string, items: [string, number][], fills: Paint[]) {
  const ng = (makeCanvas(1, 1) as HTMLCanvasElement).getContext('2d')!; ng.font = font; font = ng.font;
  const norm = (c: string) => { ng.fillStyle = c; return ng.fillStyle as string; };
  const ps: Paint[] = fills.map(p => (typeof p === 'string' ? norm(p) : Array.isArray(p) ? p : { stroke: norm(p.stroke), w: p.w }));
  const todo: [string, number, Paint][] = []; for (const [c, G] of items) if (G >= LARGE) for (const p of ps) todo.push([c, G, p]);
  let i = 0; return (budgetMs = 4) => { const t0 = performance.now(); while (i < todo.length && performance.now() - t0 < budgetMs) { const [c, G, p] = todo[i++]; sharpBm(font, c, G, p); } return i < todo.length; };
}
export function clearGlyphCache() { for (const o of CACHE.values()) (o.bm as ImageBitmap).close?.(); CACHE.clear(); PIX = 0; }

/** The last 1.6 px of a focus pull: the sharp glyph takes over from the blurred one smoothly. Both are drawn straight
 *  onto the frame (no scratch canvas: at close-up sizes a per-glyph scratch cost more than the rest of the frame), the
 *  blurred one under the sharp one, their opacities by layerPair (the body kept at the word's opacity, but for a smooth
 *  dip of a few per cent at full opacity — never a layer switched off in one frame). */
/* Large sharp glyphs. Past a size the browser keeps no glyph cache and draws every glyph from its outline, on the CPU,
   for every layer (the face, its edge copies, its gradient) and every frame — a close-up of a short word (a number, a
   single word) made the whole picture fall behind. So past LARGE device pixels a glyph is drawn from a bitmap of
   itself made once at a size on a 1/8-octave ladder (sharp at that size, scaled by at most 4 % to the size asked),
   which costs a texture copy instead. */
const LARGE = 150;
/** Every sharp glyph from a bitmap, whatever its size: set while the lyric pass draws for the GPU (render/gpu.ts),
 *  which draws images only. */
let ALL_BITMAP = false;
export const setAllBitmap = (on: boolean) => { ALL_BITMAP = on; };
export type Paint = string | InkGrad | { stroke: string; w: number };
const paintKey = (f: Paint) => (typeof f === 'string' ? f : Array.isArray(f) ? f.join('>') : 'K' + f.stroke + '/' + f.w);
/** The ladder of sizes a sharp bitmap is made at: an eighth of an octave up to 400 px, a quarter above (a close-up's
 *  glyphs change size all the time — its breathing, the entrances — and each new step was a new bitmap, made in the
 *  frame that first needed it), always the step at or above the size asked (drawn a little smaller: never soft). */
const ladder = (G: number) => { const st = G > 400 || (ALL_BITMAP && G < LARGE) ? 4 : 8; return Math.max(8, Math.min(1200, Math.round(2 ** (Math.ceil(Math.log2(Math.max(1, G)) * st - 1e-6) / st)))); };
/* How much new large bitmap a frame may make (device px²). A close-up zooming along a long word crosses size steps all
   the time, and each step made every character anew in every layer (face, edge, outline) — one frame of 「きゃきゃ…」
   at 4K made and sent to the GPU some 190 million pixels, which stalls a graphics card long enough for the system to
   reset it (the picture stuck, the play page's backdrop black). Past the budget a glyph already made at a nearby size
   stands in (drawn a little larger or smaller), and its own size is made in a later frame. */
const FRAME_PIX = 6e6;
let FRAME_MADE = 0;
/** A new frame: its budget for new large bitmaps starts again (renderer.ts, each frame). */
export function glyphFrame() { FRAME_MADE = 0; }
const stepOf = (S: number) => Math.round(Math.log2(S) * 4);
/* The largest a bitmap is made (device px): for the GPU lyric layer small enough that every glyph lives in its atlas pages
   (no texture of its own: a close-up at 4K made dozens of 1200 × 1700 textures, hundreds of MB of graphics memory —
   enough on some cards for the system to reset the device: the picture stuck, the play page's backdrop black); for the
   2D canvas within what a canvas may be. A glyph seen larger is drawn from it scaled up a little. */
const CAP_GPU: [number, number] = [2000, 1080], CAP_2D: [number, number] = [4096, 2048];
export function sharpBm(font: string, txt: string, G: number, fill: Paint): Bm {
  if (sg.font !== font) sg.font = font;
  const cap = ALL_BITMAP ? CAP_GPU : CAP_2D, wem = Math.max(1, sg.measureText(txt).width / EM), Smax = Math.floor(Math.min((cap[0] - 4) / (wem + 0.28), (cap[1] - 4) / 1.68));
  const S = Math.max(8, Math.min(ladder(G), Smax)), pre = 'S|' + font + '|' + paintKey(fill) + '|', key = pre + S + '|' + txt;
  let e = CACHE.get(key); if (e) { CACHE.delete(key); CACHE.set(key, e); return e; }
  if (late()) return EMPTY;
  const q = S / EM;
  const tw = Math.max(S, wem * EM * q), pad = Math.ceil(S * 0.14 + 2), w = Math.ceil(tw + pad * 2), h = Math.ceil(S * 1.4 + pad * 2);
  // (over this frame's budget: the nearest size already made — larger first, it only sharpens — if there is one)
  if (S > 300 && FRAME_MADE + w * h > FRAME_PIX) {
    const st = stepOf(S); for (const d of [1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8]) { const S2 = Math.round(2 ** ((st + d) / 4)), o = CACHE.get(pre + S2 + '|' + txt) ?? CACHE.get(pre + ladder(S2) + '|' + txt); if (o) return o; } }
  FRAME_MADE += w * h;
  STATS.miss++; STATS.keys?.push('sharp|' + S + '|' + txt);
  const oc: any = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : makeCanvas(w, h), c = oc.getContext('2d', CPU) as CanvasRenderingContext2D;
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.setTransform(q, 0, 0, q, w / 2, h / 2);
  if (typeof fill === 'string') { c.fillStyle = fill; c.fillText(txt, 0, 0); }
  else if (Array.isArray(fill)) { const gr = c.createLinearGradient(0, -EM * 0.55, 0, EM * 0.6); gr.addColorStop(0, fill[0]); gr.addColorStop(0.55, fill[1]); gr.addColorStop(1, fill[2]); c.fillStyle = gr; c.fillText(txt, 0, 0); }
  else {
    // an outline traced round the character's silhouette: the filled shape grown by the line's width, the shape itself
    // taken out — one clean edge of the whole character, never the overlapping contours of its strokes
    const r = Math.max(0.6, fill.w * q * 0.6), n = r > 3 ? 16 : 10; c.fillStyle = '#fff';
    for (let k = 0; k < n; k++) { const a = k / n * 6.283; c.fillText(txt, Math.cos(a) * r / q, Math.sin(a) * r / q); }
    c.globalCompositeOperation = 'destination-out'; c.fillText(txt, 0, 0);
    c.globalCompositeOperation = 'source-in'; c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = fill.stroke; c.fillRect(0, 0, w, h); }
  const bm: any = oc.transferToImageBitmap ? oc.transferToImageBitmap() : oc;
  e = { bm, w, h, s: EM / S }; CACHE.set(key, e); PIX += w * h;
  while (PIX > MAX && CACHE.size > 1) { const [k0, o] = CACHE.entries().next().value!; CACHE.delete(k0); PIX -= o.w * o.h; (o.bm as ImageBitmap).close?.(); }
  return e;
}
/** The outline of `txt` round its silhouette (line width w in EM units), from a bitmap. */
export function strokeGlyph(g: Ctx, txt: string, G: number, w: number, x = 0, y = 0) {
  if (viaSdf(g, txt, G, { stroke: g.strokeStyle as string, w }, x, y)) return;
  // (from a bitmap at every size: the silhouette's outline is made once per size step, see sharpBm)
  const e = sharpBm(g.font, txt, G, { stroke: g.strokeStyle as string, w });
  g.drawImage(e.bm, 0, 0, e.w, e.h, x - e.w / 2 * e.s, y - e.h / 2 * e.s, e.w * e.s, e.h * e.s);
}
/** Draw `txt` sharp at em size G device px, at (x, y) in the context's EM units: from the text below LARGE, from its
 *  bitmap above. fill: a colour, or the lit gradient (null: the context's fill colour). */
/** On the GPU lyric layer, under SDF_MAX: drawn from the character's distance field (true when it was). */
type SdfCtx = { sdf?: (txt: string, G: number, paint: Paint, x: number, y: number) => boolean };
const viaSdf = (g: Ctx, txt: string, G: number, paint: Paint, x: number, y: number) => ALL_BITMAP && G < SDF_MAX && !!(g as unknown as SdfCtx).sdf?.(txt, G, paint, x, y);
export function sharpGlyph(g: Ctx, txt: string, G: number, fill?: InkGrad | null, x = 0, y = 0) {
  if (viaSdf(g, txt, G, fill || (g.fillStyle as string), x, y)) return;
  if (G < LARGE && !ALL_BITMAP) { if (fill) { const c = g.fillStyle, gr = g.createLinearGradient(x, y - EM * 0.55, x, y + EM * 0.6); gr.addColorStop(0, fill[0]); gr.addColorStop(0.55, fill[1]); gr.addColorStop(1, fill[2]); g.fillStyle = gr; g.fillText(txt, x, y); g.fillStyle = c; } else g.fillText(txt, x, y); return; }
  const e = sharpBm(g.font, txt, G, fill || (g.fillStyle as string));
  g.drawImage(e.bm, 0, 0, e.w, e.h, x - e.w / 2 * e.s, y - e.h / 2 * e.s, e.w * e.s, e.h * e.s);
}

/** (the hand-over spans from the finest level's own blur — a close-up glyph's finest level is softer than 1.6 px)  */
export const focusW = (bpx: number, G = 0) => { const top = Math.max(1.6, B0 * G / TOP * 1.15); return bpx > 0.4 ? clamp((top - bpx) / (top - 0.4)) : 1; };
export function drawFocus(g: Ctx, ch: string, bpx: number, G: number, A: number, sharp?: CanvasGradient | null, grad?: InkGrad | null) {
  const w = focusW(bpx, G), sharpFill = () => { if (G >= LARGE || ALL_BITMAP) { sharpGlyph(g, ch, G, grad); return; } if (!sharp) { g.fillText(ch, 0, 0); return; } const c = g.fillStyle; g.fillStyle = sharp; g.fillText(ch, 0, 0); g.fillStyle = c; };
  if (w >= 1) { g.globalAlpha = A; sharpFill(); return; }
  if (w <= 0) { g.globalAlpha = A; blurGlyph(g, ch, bpx, G, grad); return; }
  // (the blurred one under the sharp one, the sharp one's share w: layerPair — continuous to the end of the focus pull)
  const [bA, sA] = layerPair(A, w);
  if (bA > 0.003) { g.globalAlpha = bA; blurGlyph(g, ch, bpx, G, grad); }
  g.globalAlpha = sA; sharpFill();
}

/* ---------- distance-field glyphs (the GPU lyric layer) ----------
   On the GPU a sharp glyph is drawn from a field of distances to its edge, made once per character at one of three
   sizes (an em of 48 px for glyphs seen under 72 px, 128 px under 400 px, 320 px up to SDF_MAX — never read more than
   about 1.5 times smaller than it was made, where a field's corners start to shimmer): its edge, its lit
   gradient and its outline are worked out per pixel at whatever size it is seen. The bitmaps it replaces were made per
   size step (an eighth of an octave), per paint (the face, its edge colour, the unsung outline): a camera moving through
   a page of lyrics made a hundred of them a second — two to three thousand in half a minute at 1080p, many of them
   400–1200 px at 2160p — each drawn on the CPU and uploaded, in the frame that first needed it: the stutter. */
export const SDF_EM = [48, 128, 320] as const, SDF_MAX = 900;
/** the field's reach either side of the edge, in its own pixels (an outline and a pixel of edge fit well inside it) */
export const SDF_SPREAD = 8;
export interface Sdf { sdf: Uint8Array; width: number; height: number; /** EM units per field pixel */ s: number }
const SDFS = new Map<string, Sdf>(); let SDF_PIX = 0; const SDF_CAP = 48e6;
export type SdfTier = 0 | 1 | 2;
export const sdfTier = (G: number): SdfTier => (G < 72 ? 0 : G < 400 ? 1 : 2);
/** The distance field of `txt` in `font` (any size: the face's own; its em is set here) at tier k; null past the budget
 *  of a pass drawn ahead (made by its next slice). */
export function sdfGlyph(font: string, txt: string, k: SdfTier): Sdf | null {
  const key = k + '|' + font + '|' + txt; let e = SDFS.get(key);
  if (e) { SDFS.delete(key); SDFS.set(key, e); return e; }
  if (late()) return null;
  STATS.miss++; STATS.keys?.push('sdf|' + k + '|' + txt);
  const E = SDF_EM[k], q = E / EM; if (sg.font !== font) sg.font = font;
  const wem = Math.max(1, sg.measureText(txt).width / EM), pad = SDF_SPREAD + 2, w = Math.ceil(Math.max(E, wem * E) + pad * 2), h = Math.ceil(E * 1.4 + pad * 2);
  const oc: any = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : makeCanvas(w, h), c = oc.getContext('2d', CPU) as CanvasRenderingContext2D;
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.setTransform(q, 0, 0, q, w / 2, h / 2); c.fillStyle = '#fff'; c.fillText(txt, 0, 0);
  const a = c.getImageData(0, 0, w, h).data;
  e = { sdf: distanceField(a, w, h, SDF_SPREAD), width: w, height: h, s: EM / E };
  SDFS.set(key, e); SDF_PIX += w * h;
  while (SDF_PIX > SDF_CAP && SDFS.size > 1) { const [k0, o] = SDFS.entries().next().value!; SDFS.delete(k0); SDF_PIX -= o.width * o.height; }
  return e;
}
/** Bake the distance fields a song's glyphs will be drawn from: [character, size seen] pairs, a slice at a time. */
export function prewarmSdf(font: string, items: [string, number][]) {
  const ng = (makeCanvas(1, 1) as HTMLCanvasElement).getContext('2d')!; ng.font = font; font = ng.font;
  const seen = new Set<string>(), todo: [string, SdfTier][] = [];
  for (const [c, G] of items) { if (G >= SDF_MAX) continue; const k = sdfTier(G), id = k + c; if (!seen.has(id)) { seen.add(id); todo.push([c, k]); } }
  let i = 0; return (budgetMs = 4) => { const t0 = performance.now(); while (i < todo.length && performance.now() - t0 < budgetMs) { const [c, k] = todo[i++]; sdfGlyph(font, c, k); } return i < todo.length; };
}
/* The distance to the edge for every pixel of an anti-aliased coverage mask (the alpha of RGBA `a`), positive inside,
   as bytes: 128 at the edge, ±127 at ±spread px. Two squared Euclidean distance transforms (to the nearest pixel outside,
   to the nearest inside; Felzenszwalb & Huttenlocher's lower envelope of parabolas, a row then a column at a time), each
   started from the partly covered pixels at their sub-pixel distance from the edge (half a pixel either side of 50 %). */
const INF = 1e20;
function distanceField(a: Uint8ClampedArray, w: number, h: number, spread: number): Uint8Array {
  const n = w * h, inner = new Float64Array(n), outer = new Float64Array(n);
  for (let i = 0; i < n; i++) { const v = a[i * 4 + 3] / 255;
    if (v >= 1) { outer[i] = 0; inner[i] = INF; } else if (v <= 0) { outer[i] = INF; inner[i] = 0; }
    else { const o = Math.max(0, 0.5 - v), d = Math.max(0, v - 0.5); outer[i] = o * o; inner[i] = d * d; } }
  const L = Math.max(w, h), f = new Float64Array(L), d = new Float64Array(L), v = new Int32Array(L), z = new Float64Array(L + 1);
  edt(outer, w, h, f, d, v, z); edt(inner, w, h, f, d, v, z);
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { const s = Math.sqrt(inner[i]) - Math.sqrt(outer[i]), b = Math.max(0, Math.min(255, Math.round(128 + s / spread * 127)));
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = out[i * 4 + 3] = b; }
  return out;
}
function edt(g: Float64Array, w: number, h: number, f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array) {
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) f[x] = g[o + x]; edt1(f, w, d, v, z); for (let x = 0; x < w; x++) g[o + x] = d[x]; }
}
function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const r = q - v[k]; d[q] = r * r + f[v[k]]; }
}
