// Colours for a frame: the theme's five colours as RGB, whether the scene is dark, the palette a cover suggests, and
// the ambient palette (the now-playing backdrop's colours from the cover).
import { hex2rgb, hexOf, lum, mix, contrast, toHsl, hsl, paleOf, W3, K3, type RGB } from '../core/color';
import { hashStr } from '../core/rng';
import type { Style } from '../theme/style';

export interface Palette { bg: RGB; bg2: RGB; text: RGB; accent: RGB; flash: RGB; dark: boolean; invertOnFlash: boolean }
export function paletteOf(st: Style): Palette {
  const P = { bg: hex2rgb(st.bg), bg2: hex2rgb(st.bg2), text: hex2rgb(st.text), accent: hex2rgb(st.accent), flash: hex2rgb(st.flash) };
  return { ...P, dark: lum(P.bg) < 0.3, invertOnFlash: Math.abs(lum(P.flash) - lum(P.text)) < 0.35 };
}
type Img = CanvasImageSource & { width: number; height: number };
/** A theme's colours from a cover: background from its dominant colour, accent from its most vivid, text with contrast. */
export function paletteFromImage(img: Img): Pick<Style, 'bg' | 'bg2' | 'text' | 'accent' | 'flash'> {
  const { dom, acc, avg } = coverColours(img);
  const dark = lum(avg) < 0.5, bg = dark ? mix(dom, K3, 0.8) : mix(dom, W3, 0.84), bg2 = dark ? mix(dom, K3, 0.45) : mix(dom, W3, 0.55);
  let text = dark ? mix(W3, acc, 0.06) : mix([12, 12, 14], dom, 0.15); for (let k = 0; k < 10 && contrast(text, bg) < 7; k++) text = mix(text, dark ? W3 : K3, 0.35);
  let accent = acc; for (let k = 0; k < 10 && contrast(accent, bg) < 3; k++) accent = mix(accent, dark ? W3 : K3, 0.2);
  const flash = dark ? paleOf(accent) : text;
  return { bg: hexOf(bg), bg2: hexOf(bg2), text: hexOf(text), accent: hexOf(accent), flash: hexOf(flash) };
}
/** The record theme's colours from a cover: the ground is the cover's own dominant colour, deepened (the record and white
 *  lyrics sit on it); what is drawn on it — the second tone, the accent, the flash — takes the cover's own vivid colour
 *  (or, of a one-colour cover, a neighbouring hue), lightened until it stands clear of the ground: the stage reads as
 *  the cover's, not as its opposite. */
export function paletteVinyl(img: Img): Pick<Style, 'bg' | 'bg2' | 'text' | 'accent' | 'flash'> {
  const { dom, acc } = coverColours(img), [h, s] = toHsl(dom), [ha, sa] = toHsl(acc), hue = sa > 0.2 && Math.abs(((ha - h + 540) % 360) - 180) < 150 ? ha : (h + 32) % 360,   /* (the cover's own second colour; a cover of one colour: its neighbour) */ sat = Math.max(0.5, Math.min(0.85, Math.max(s, sa)));
  const bg = mix(dom, K3, 0.74), bg2 = mix(bg, hsl(hue, sat * 0.7, 0.32), 0.42);
  let accent = hsl(hue, sat, 0.62); for (let k = 0; k < 8 && contrast(accent, bg) < 3.2; k++) accent = mix(accent, W3, 0.18);
  let text = mix(W3, accent, 0.05); for (let k = 0; k < 8 && contrast(text, bg) < 7; k++) text = mix(text, W3, 0.35);
  return { bg: hexOf(bg), bg2: hexOf(bg2), text: hexOf(text), accent: hexOf(accent), flash: hexOf(hsl(hue, sat * 0.6, 0.84)) };
}
/** The colours a theme takes from the cover (null: the theme keeps its own). */
/* (every look takes the cover's colours — the record its own reading of them; only the video keeps its own, over a film) */
export const paletteForPreset = (id: string, img: Img) => (id === 'vinyl' ? paletteVinyl(img) : id === 'video' ? null : paletteFromImage(img));
/** A cover's dominant colour (its largest area), its most vivid usable colour and its average. */
function coverColours(img: Img) {
  const c = makeCanvas(40, 40), g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D; g.drawImage(img, 0, 0, 40, 40);
  const d = g.getImageData(0, 0, 40, 40).data, B = new Map<number, { r: number; g: number; b: number; n: number }>(); let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], b = d[i + 2], k = ((r >> 5) << 6) | ((gg >> 5) << 3) | (b >> 5);
    const e = B.get(k) || { r: 0, g: 0, b: 0, n: 0 }; e.r += r; e.g += gg; e.b += b; e.n++; B.set(k, e); sr += r; sg += gg; sb += b; n++; }
  const list = [...B.values()].map(e => ({ c: [e.r / e.n, e.g / e.n, e.b / e.n].map(Math.round) as RGB, n: e.n }));
  const avg: RGB = [sr / n, sg / n, sb / n], sat = (c: RGB) => (Math.max(...c) - Math.min(...c)) / 255, dom = list.sort((a, b) => b.n - a.n)[0].c;
  let acc = dom, best = -1; for (const e of list) { const L = lum(e.c); if (L < 0.04 || L > 0.75) continue; const v = sat(e.c) * e.n ** 0.35; if (v > best) { best = v; acc = e.c; } }
  return { dom, acc, avg };
}
export interface Ambient { base: RGB; cols: RGB[] }
/** The ambient backdrop's colours: the cover's main colours, weighted toward the vivid ones, lifted or deepened into a
 *  range that glows behind white text without washing it out. */
export function ambientFromImage(img: Img): Ambient {
  const c = makeCanvas(28, 28), g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D; g.drawImage(img, 0, 0, 28, 28);
  const d = g.getImageData(0, 0, 28, 28).data, bins = new Map<string, { n: number; r: number; g: number; b: number; s: number }>();
  for (let i = 0; i < d.length; i += 4) { const [h, s, l] = toHsl([d[i], d[i + 1], d[i + 2]]); const k = s < 0.12 ? 'n' + Math.round(l * 4) : Math.round(h / 24) + ':' + Math.round(l * 3);
    const b = bins.get(k) || { n: 0, r: 0, g: 0, b: 0, s: 0 }; b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2]; b.s += s; bins.set(k, b); }
  const cols = [...bins.values()].map(b => ({ rgb: [b.r / b.n, b.g / b.n, b.b / b.n] as RGB, w: b.n * (0.35 + b.s / b.n) })).sort((a, b) => b.w - a.w).slice(0, 5);
  return shapeAmbient(cols.map(x => x.rgb));
}
export function ambientFromName(name: string): Ambient { const h = hashStr(name || '♪') % 360; return shapeAmbient([hsl(h, 0.7, 0.5), hsl((h + 40) % 360, 0.65, 0.45), hsl((h + 300) % 360, 0.6, 0.4), hsl((h + 180) % 360, 0.5, 0.35)]); }
function shapeAmbient(list: RGB[]): Ambient {
  const out = list.map(rgb => { const [h, s, l] = toHsl(rgb); return hsl(h, Math.min(0.85, Math.max(0.35, s * 1.25)), Math.min(0.58, Math.max(0.22, l))); });
  while (out.length < 4) out.push(out[out.length % Math.max(1, out.length)] || [70, 60, 140]);
  const [h0, s0] = toHsl(out[0]); return { base: hsl(h0, Math.min(0.6, s0), 0.1), cols: out };
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}
