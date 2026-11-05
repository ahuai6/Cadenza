/* The effect system. An effect is a module that registers itself: where it draws (its layer), what it is called, the
   parameters it takes (the interface builds its controls from this schema), and how it draws a frame. A theme is a
   backdrop plus a set of effects with their parameters; adding an effect never touches the renderer or the director.
   Effects read everything from the RenderFrame (time, rhythm sample, camera, palette, plan) and keep their own caches
   (sprites, geometry), keyed by what they depend on. */
import type { RenderFrame } from '../frame';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Layer = 'backdrop' | 'world-back' | 'world-front' | 'foreground' | 'screen';
export interface Param { key: string; label: string; kind: 'range' | 'toggle' | 'select'; min?: number; max?: number; step?: number; options?: [string, string][]; def: number | boolean | string }
/** What the backdrop layer adds to a frame: the backdrop's own camera (it never cuts) and the bleed beyond the frame. */
export interface BackdropView { roll: number; zoom: number; ox: number; oy: number; E: number; Ev: number; /** how far a video is drawn with as little crop as can be (0..1) */ fit?: number; /** a long pause's rest (0..1) */ rest?: number }
/** The backdrop's middle ground — the cover, the record, the horizon of the floor and the doors, the beat rings and the
 *  glass panes — moves with the camera by this share of the backdrop's own pan (the pan's parallax). Elements nearer or
 *  further take their own share (motes, feathers, shards: by their depth); the ground itself covers the bleed. */
export const MID = 0.6;
export const midShift = (bd: Pick<BackdropView, 'ox' | 'oy'>, k = MID): [number, number] => [bd.ox * k, bd.oy * k];
/** A backdrop element of the middle ground drawn shifted with it. */
export const atMid = (draw: Effect['draw']): Effect['draw'] => (g, f, a) => { const [x, y] = midShift(a.bd); g.save(); g.translate(x, y); draw(g, f, a); g.restore(); };
export interface DrawArgs { bd: BackdropView; params: Record<string, number | boolean | string>;
  /** (a backdrop's own draw) call once its ground is painted and before its elements: the deep effects go there */ under?: () => void }

export interface Effect {
  id: string; label: string; layer: Layer;
  /** 'backdrop': chosen by the theme's backdrop style (one at a time); 'effect': switched on and off */
  kind: 'backdrop' | 'effect';
  params?: Param[];
  /** order inside its layer (lower first) */
  z?: number;
  draw(g: Ctx, f: RenderFrame, a: DrawArgs): void;
  /** a backdrop's own front layer, drawn among the backdrop's effects at depth `frontZ` (the record theme's disc stands in
   *  front of its horizon and behind the shapes floating round it) */
  front?(g: Ctx, f: RenderFrame, a: DrawArgs): void; frontZ?: number;
  /** a backdrop effect drawn deep: behind the backdrop's own elements (its roses, its cover), over its ground — and over
   *  a song's video when one is up (the video always lowest), in the frame's own space */
  deep?: boolean;
  /** optional: build what a coming frame will need, in idle time */
  prepare?(f: RenderFrame): void;
}
const REG = new Map<string, Effect>();
export function register(e: Effect) { REG.set(e.id, e); return e; }
export const effect = (id: string) => REG.get(id);
export const effects = (kind?: Effect['kind']) => [...REG.values()].filter(e => !kind || e.kind === kind);
export function paramsFor(e: Effect, stored?: Record<string, number | string | boolean>) {
  const out: Record<string, number | string | boolean> = {}; for (const p of e.params || []) out[p.key] = stored?.[p.key] ?? p.def; return out;
}
