// What every layer and effect draws from: one RenderFrame per frame, built once. Nothing reads a clock of its own.
import type { ScenePlan } from '../director/types';
import type { CamFrame } from '../director/evaluate';
import type { Palette, Ambient } from './palette';
import type { Style } from '../theme/style';
import type { RhythmSample } from '../rhythm/signals';

export interface MediaSources {
  /** the cover image (decoded) */ cover: (CanvasImageSource & { width: number; height: number }) | null;
  coverKey: string;
  /** the video backdrop and the song's MV: something drawable now, or null */
  video: { frame: CanvasImageSource | null; w: number; h: number } | null;
  mv: { frame: CanvasImageSource | null; w: number; h: number; k: number } | null;
  /** how the song's own video (MV mode) is graded and framed */ mvLook?: MvLook;
}
export interface ViewMix {
  /** 0: the now-playing backdrop alone (ambient), 1: the full effect-lyrics picture */
  effect: number;
  /** words and screen effects fade with it; the backdrop crossfades */
}
/** Where the backdrop's camera stands (its roll, push and shift): written by each drawn frame, and, in album play, the
 *  one the song before ended on, eased away from (`k`: 1 at the change, 0 once the new song's own camera has it). */
export interface BackdropPose {
  roll: number;
  zoom: number;
  ox: number;
  oy: number;
}
export interface RenderFrame {
  bdFrom?: BackdropPose & { k: number };
  bdOut?: BackdropPose;
  plan: ScenePlan;
  style: Style;
  pal: Palette;
  ambient: Ambient;
  t: number;
  dt: number;
  /** reference frame size (720 tall) and the device-pixel scale from it */
  W: number;
  H: number;
  px: number;
  cam: CamFrame;
  rs: RhythmSample;
  media: MediaSources;
  view: ViewMix;
  /** reduced motion */ motion: number;
  /** exporting (no live media, deterministic) */ offline: boolean;
  labels: Record<string, string>;
  /** the music's intensity here (0.35..1) and the beat pulse for effects (0..1), from the shared rhythm signals */
  I: number;
  P: number;
  /** the words on screen this frame (filled before the world layers) and the lyric ink colour */
  vis?: import('./lyrics').VisWord[];
  ink: [number, number, number];
  /** who draws the cover: the backdrop where it rests, the handoff while it flies, or nobody (the page shows its own) */
  coverOwner: 'backdrop' | 'handoff' | 'none';
  /** how far the record has slid out from under the sleeve (0..1) */
  vinylOut: number;
  /** words of lines that are being handed over from the page wait for the flight (multiplier per line index) */
  wordAlpha?: (line: number, k: number) => number;
}
export interface MvLook {
  dark: number;
  blur: number;
  desat: number;
  fit: boolean;
}
export const MV_LOOK: MvLook = { dark: 0.34, blur: 0.12, desat: 0, fit: false };
