// Measuring words for the layout, with a canvas (no DOM): each word's box and where each of its units sits, at the
// engine's one glyph size (150 px; the transform scales from there). Horizontal words lay units along the line,
// vertical CJK blocks stack them; right-to-left words mirror.
import { ROTATE_IN_VERTICAL } from '../lyrics/script';

export const EM = 150;
export const LINE_H = 1.04, VERT_H = 1.08;
export interface UnitBox { cx: number; cy: number; w: number; h: number; rot: boolean }
export interface WordBox { w0: number; h0: number; units: UnitBox[] }
export interface Measurer { word(units: string[], opts: { vertical: boolean; rtl: boolean }): WordBox }

/** Measures with a 2D context set to the lyric font. */
export function canvasMeasurer(font: string): Measurer {
  const cv: any = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
  const g = cv.getContext('2d') as CanvasRenderingContext2D; g.font = font;
  const cache = new Map<string, number>(), adv = (s: string) => { let v = cache.get(s); if (v == null) { v = g.measureText(s).width; cache.set(s, v); } return v; };
  return {
    word(units, { vertical, rtl }) {
      if (vertical) {
        const lh = EM * VERT_H, h0 = units.length * lh, w0 = Math.max(EM, ...units.map(adv));
        return { w0, h0, units: units.map((c, i) => ({ cx: 0, cy: (i + 0.5) * lh - h0 / 2, w: adv(c), h: lh, rot: ROTATE_IN_VERTICAL.has(c) })) };
      }
      const total = adv(units.join('')), h0 = EM * LINE_H; let pre = '';
      const out = units.map(c => { const x = adv(pre), w = adv(pre + c) - x; pre += c; const cx = x + w / 2 - total / 2; return { cx: rtl ? -cx : cx, cy: 0, w, h: h0, rot: false }; });
      return { w0: total, h0, units: out };
    },
  };
}
/** A measurer without fonts (tests, workers): CJK one em, Latin about half an em. */
export function approxMeasurer(): Measurer {
  const adv = (c: string) => (/[　-鿿가-힯＀-￯]/.test(c) ? EM : /[A-Z]/.test(c) ? EM * 0.66 : EM * 0.55) * [...c].length;
  return {
    word(units, { vertical, rtl }) {
      if (vertical) { const lh = EM * VERT_H, h0 = units.length * lh; return { w0: EM, h0, units: units.map((c, i) => ({ cx: 0, cy: (i + 0.5) * lh - h0 / 2, w: adv(c), h: lh, rot: ROTATE_IN_VERTICAL.has(c) })) }; }
      const total = units.reduce((a, c) => a + adv(c), 0); let x = 0;
      return { w0: total, h0: EM * LINE_H, units: units.map(c => { const w = adv(c), cx = x + w / 2 - total / 2; x += w; return { cx: rtl ? -cx : cx, cy: 0, w, h: EM * LINE_H, rot: false }; }) };
    },
  };
}
