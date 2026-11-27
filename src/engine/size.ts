// An export's size: the frame shape (director ASPECTS) at a resolution — the short side is the resolution, both even.
import { ASPECTS } from '../director';
import { DEFAULT_LYRIC_ASPECT } from '../theme/style';
export function exportSize(aspect: string, res: number, viewAspect: number): [number, number] {
  const p = +res || 1080,
    a =
      ASPECTS[aspect] ||
      (aspect === 'fill' ? ASPECTS[DEFAULT_LYRIC_ASPECT] : viewAspect) ||
      ASPECTS[DEFAULT_LYRIC_ASPECT];
  let w: number, h: number;
  if (a >= 1) {
    h = p;
    w = Math.round(p * a);
  } else {
    w = p;
    h = Math.round(p / a);
  }
  return [w + (w % 2), h + (h % 2)];
}
