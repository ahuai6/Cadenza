// What a Folia style needs from Cadenza for one song, and what it gets each frame. The engine layer
// (src/render/engines.ts) builds these from the session: the same lyrics, look and rhythm every
// other picture reads.
import type { Line, Theme } from '../vendor/types';

export interface FoliaEngineSpec {
  /** the song's identity (Folia seeds its compositions with it) */
  seed: string;
  lines: Line[];
  theme: Theme;
  duration: number;
  instrumental: boolean;
  title?: string;
  artist?: string;
  album?: string;
  /** the lyric size setting (1 = as designed) */
  fontScale: number;
  /** reduced motion: the still composition, no transitions or beat effects */
  still: boolean;
  /** Cadenza draws the backdrop: the style's own wash is left out */
  transparent: boolean;
  /** beat effects (Folia's 智能動感) on */
  beatFx: boolean;
  /** the end credits poster (else Cadenza's own end card shows) */
  credits: boolean;
}

export interface FoliaEngineFrame {
  lineLift?: number;
  /** song time (s) */
  t: number;
  /** the reference frame (CSS px) and device px per CSS px */
  W: number;
  H: number;
  px: number;
  /** how far the effect view is in (0..1) */
  alpha: number;
  /** where its W×H frame sits on the picture (CSS px; 0, 0 for the whole picture), clipped to it */
  ox?: number;
  oy?: number;
  playing: boolean;
}

export interface FoliaEngine {
  readonly id: string;
  readonly hasLyrics: boolean;
  /** its assets are in (until then it draws nothing, and asks for another frame) */
  readonly ready: boolean;
  draw(g: CanvasRenderingContext2D, f: FoliaEngineFrame): void;
  setTuning(tuning: Record<string, unknown>): void;
  destroy(): void;
}

/** One of an engine's own settings, as the style pages show it (the same shape as an effect's parameter). */
export interface EngineParam {
  key: string;
  /** dictionary key of its name */
  label: string;
  kind: 'range' | 'toggle' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: [string, string][];
  def: number | boolean | string;
  /** where it is offered: 'style' under the style's Advanced, 'fx' with the effects */
  group: 'style' | 'fx';
  /** shown only while this other toggle is on */
  when?: string;
}
