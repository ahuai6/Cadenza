// Small drawing helpers the effects share: a 2D context of any canvas, and a soft round dot sprite per colour.
import { rgba, type RGB } from '../../core/color';
import { makeCanvas } from '../palette';

export const C2 = (c: HTMLCanvasElement | OffscreenCanvas) => (c as HTMLCanvasElement).getContext('2d')!;
let DOT: { key: string; c: HTMLCanvasElement } | null = null;
export const dot = (col: RGB) => { const key = col.join(); if (DOT && DOT.key === key) return DOT.c; const c = makeCanvas(64, 64) as HTMLCanvasElement, g = C2(c), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, rgba(col, 1)); r.addColorStop(0.3, rgba(col, 0.55)); r.addColorStop(1, rgba(col, 0)); g.fillStyle = r; g.fillRect(0, 0, 64, 64); DOT = { key, c }; return c; };
