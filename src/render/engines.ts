/* Lyric engines: who lays out, moves and draws the words. The director (the default) is drawn by the layers in
   renderer.ts; a Folia style (style.engine) is a runtime of its own over the same backdrop, fed the same lyric model,
   look and rhythm. One runtime per song plan, made on first use and rebuilt only when what it was built from changes
   (the look's colours or font, the engine's settings); dropped with its plan. */
import type { RenderFrame } from './frame';
import type { ScenePlan } from '../director/types';
import { SonnetEngine, SONNET_PARAMS } from '../folia/engines/sonnet';
import { TemperaEngine, TEMPERA_PARAMS } from '../folia/engines/tempera';
import type { EngineParam, FoliaEngine } from '../folia/engines/types';
import { foliaLines, foliaTheme, rgbHex } from '../folia/adapt';
import { FoliaFrameMusic, sonnetLineLift } from '../folia/live';
import { fontStack } from '../text/fonts';
import { setStageQuadRenderer } from '../folia/pixi/render';
import { gpuQuads } from './gpu';
import { gpuLyrics } from './gfx';

setStageQuadRenderer((width, height, quads, target, x = 0, y = 0) => {
  const gpu = gpuLyrics() && gpuQuads();
  if (!gpu) return null;
  gpu.begin(width, height, false, target);
  let complete = true;
  try {
    for (const q of quads) {
      const [a, b, c, d, tx, ty] = q.transform;
      const pose: typeof q.transform = x || y ? [a, b, c, d, tx - x, ty - y] : q.transform;
      if (
        q.alpha > 0.002 &&
        !gpu.quad(q.source as Parameters<typeof gpu.quad>[0], ...q.crop, ...q.rect, pose, q.alpha, q.tint)
      )
        complete = false;
    }
  } finally {
    gpu.end();
  }
  return complete ? gpu.canvas : null;
});

interface Held {
  key: string;
  palette: RenderFrame['pal'];
  ambient: RenderFrame['ambient'];
  /** the style object it was last checked against (styles are replaced, never changed in place) */
  style: RenderFrame['style'];
  engine: FoliaEngine;
}
const held = new WeakMap<ScenePlan, Held>();

/** The engines a style can name (the director is none of them). */
type WorldInput = ConstructorParameters<typeof SonnetEngine>[0] & { coverColors: string[] };
interface World {
  create: (input: WorldInput) => FoliaEngine;
  params: EngineParam[];
  usesCover: boolean;
  beatEffects?: (tuning: NonNullable<RenderFrame['style']['engp']>[string]) => Record<string, number>;
}
const worlds = {
  sonnet: { create: (input) => new SonnetEngine(input), params: SONNET_PARAMS, usesCover: false },
  tempera: {
    create: (input) => new TemperaEngine(input),
    params: TEMPERA_PARAMS,
    usesCover: true,
    beatEffects: (tuning) => ({ 'tempera.inkFlash': +(tuning.inkFlash ?? 1) }),
  },
} satisfies Record<string, World>;
export type EngineId = keyof typeof worlds;
export const ENGINES = Object.keys(worlds) as EngineId[];
export const isFoliaEngine = (id: string | undefined): id is EngineId => !!id && Object.hasOwn(worlds, id);

/** Each engine's own settings (the style pages draw their controls from these). */
/** What every Folia style has besides its own: whose word split its layout reads — Cadenza's (the listener's own, where
 *  they made one) or Folia's own automatic split, as upstream does it. */
const SHARED_PARAMS: EngineParam[] = [
  { key: 'foliaSeg', label: 'eng.foliaSeg', kind: 'toggle', def: false, group: 'style' },
];
export const ENGINE_PARAMS = Object.fromEntries(
  ENGINES.map((id) => [id, [...worlds[id].params, ...SHARED_PARAMS]]),
) as Record<EngineId, EngineParam[]>;
export type { EngineParam };

/** Whether the frame's lyrics are an engine's (the director's word layers, transitions and dots are then left out). */
export const engineOf = (f: RenderFrame) => (isFoliaEngine(f.style.engine) ? f.style.engine : null);
export const cameraOwner = (style: RenderFrame['style']) => (isFoliaEngine(style.engine) ? 'world' : 'director');

function seedOf(plan: ScenePlan) {
  const d = plan.doc;
  return `${plan.titles.title}|${plan.titles.artist}|${d.lines.length}|${d.words[0]?.t ?? 0}|${d.lines.at(-1)?.text ?? ''}`;
}

/** What an engine for this frame is built from, and the key that says when that changed. */
function specOf(f: RenderFrame, id: EngineId) {
  const plan = f.plan,
    st = f.style,
    pal = f.pal;
  const sample = plan.doc.lines
    .slice(0, 8)
    .map((L) => L.text)
    .join('');
  const font = fontStack(st.font, sample);
  const theme = foliaTheme({
    name: st.name || '',
    bg: rgbHex(pal.bg),
    text: rgbHex(pal.text),
    accent: rgbHex(pal.accent),
    secondary: rgbHex(pal.flash),
    font: font.stack,
    weight: font.w,
    motion: Math.min(1, Math.max(0, (st.k.energy ?? 1) * 0.5)),
  });
  const tuning = (st.engp?.[id] ?? {}) as Record<string, unknown>;
  // (the tuning is applied to a live engine in place: only what it was built from rebuilds it)
  const key = JSON.stringify([
    id,
    theme,
    st.k.size ?? 1,
    f.motion < 1,
    tuning.beatFx,
    tuning.credits,
    tuning.foliaSeg,
    worlds[id].usesCover ? f.ambient.cols : null,
  ]);
  return { key, theme, tuning };
}

function build(f: RenderFrame, id: EngineId, theme: ReturnType<typeof foliaTheme>, tuning: Record<string, unknown>) {
  const plan = f.plan,
    st = f.style;
  const common = {
    seed: seedOf(plan),
    lines: foliaLines(plan.doc, { foliaSeg: tuning.foliaSeg === true }),
    theme,
    duration: plan.dur,
    instrumental: plan.doc.words.length === 0,
    title: plan.titles.title,
    artist: plan.titles.artist,
    album: plan.doc.meta.album || plan.doc.meta.al || '',
    fontScale: st.k.size ?? 1,
    still: f.motion < 1,
    transparent: true,
    beatFx: tuning.beatFx !== false,
    credits: tuning.credits !== false,
    tuning,
  };
  const pal = f.pal;
  const coverColors = worlds[id].usesCover
    ? (f.ambient.cols.length ? f.ambient.cols : [pal.accent, pal.bg2, pal.text, pal.flash, pal.bg]).map(rgbHex)
    : [];
  return worlds[id].create({ ...common, coverColors });
}

/** The frame's engine runtime (made or rebuilt as needed), or null for the director. */
export function engineFor(f: RenderFrame): FoliaEngine | null {
  const id = engineOf(f);
  if (!id) {
    releaseWorld(f.plan);
    return null;
  }
  // (the key is cheap; it is built once per style change, not per frame)
  const h = held.get(f.plan);
  if (h && h.style === f.style && h.palette === f.pal && h.ambient === f.ambient) return h.engine;
  const { key, theme, tuning } = specOf(f, id);
  if (h && h.key === key) {
    h.style = f.style;
    h.palette = f.pal;
    h.ambient = f.ambient;
    h.engine.setTuning(tuning);
    return h.engine;
  }
  h?.engine.destroy();
  const next: Held = { key, style: f.style, palette: f.pal, ambient: f.ambient, engine: build(f, id, theme, tuning) };
  held.set(f.plan, next);
  return next.engine;
}

export function releaseWorld(plan: ScenePlan) {
  held.get(plan)?.engine.destroy();
  held.delete(plan);
}

/** A new music reading can share the existing stage when the Folia director's own inputs match. */
export function retainWorld(previous: ScenePlan, next: ScenePlan, style: RenderFrame['style']) {
  const value = held.get(previous);
  const id = style.engine;
  if (!value || !isFoliaEngine(id) || value.engine.id !== id || previous.dur !== next.dur) return false;
  const options = { foliaSeg: style.engp?.[id]?.foliaSeg === true };
  if (
    seedOf(previous) !== seedOf(next) ||
    previous.doc.meta.album !== next.doc.meta.album ||
    previous.doc.meta.al !== next.doc.meta.al ||
    JSON.stringify(foliaLines(previous.doc, options)) !== JSON.stringify(foliaLines(next.doc, options))
  )
    return false;
  held.delete(previous);
  held.set(next, value);
  return true;
}

/** An engine still loading its assets (the engine keeps drawing frames until it is in, even paused). */
export const ENGINE_WAIT = { on: false };
const musicByEngine = new WeakMap<FoliaEngine, FoliaFrameMusic>();

/** Draws the frame's lyrics with its engine: the live inputs first (beats, bands), then the engine's own picture. */
export function drawEngine(g: CanvasRenderingContext2D, f: RenderFrame, engine: FoliaEngine) {
  // (the beat effects a style asks for by id, at the strength its settings give)
  const tuning = f.style.engp?.[engine.id] ?? {};
  const world: World | undefined = isFoliaEngine(engine.id) ? worlds[engine.id] : undefined;
  let music = musicByEngine.get(engine);
  if (!music) musicByEngine.set(engine, (music = new FoliaFrameMusic()));
  const playing = f.playing !== false;
  const lineLift =
    engine.id === 'sonnet' && !f.spectrum && f.plan.map.hasAudio ? sonnetLineLift(f.plan.map, f.t, playing) : undefined;
  ENGINE_WAIT.on = !engine.ready;
  music.frame(seedOf(f.plan), f.plan.map, world?.beatEffects?.(tuning) ?? {}, f.t, playing, f.spectrum, () => {
    engine.draw(g, { t: f.t, W: f.W, H: f.H, px: f.px, alpha: f.view.effect, playing, lineLift });
  });
}
