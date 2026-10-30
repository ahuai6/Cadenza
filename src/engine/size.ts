// An export's size: the frame shape (director ASPECTS) at a resolution — the short side is the resolution, both even.
import { ASPECTS } from '../director';
export function exportSize(aspect: string, res: number, viewAspect: number): [number, number] {
  const p = +res || 1080, a = ASPECTS[aspect] || (aspect === 'fill' ? 16 / 9 : viewAspect) || 16 / 9; let w: number, h: number;   // a picture that fills the window exports as 16:9
  if (a >= 1) { h = p; w = Math.round(p * a); } else { w = p; h = Math.round(p / a); } return [w + (w % 2), h + (h % 2)];
}
