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
import { installBeats, tickLive, setBeatEffects } from '../folia/live';
import { fontStack } from '../text/fonts';

interface Held {
  key: string;
  /** the style object it was last checked against (styles are replaced, never changed in place) */
  style: RenderFrame['style'];
  engine: FoliaEngine;
}
const held = new WeakMap<ScenePlan, Held>();
/** the play page's own runtime (its own size and settings: a second engine beside the effect view's) */
const heldNp = new WeakMap<ScenePlan, Held>();

/** The engines a style can name (the director is none of them). */
export const ENGINES = ['sonnet', 'tempera'] as const;
export type EngineId = (typeof ENGINES)[number];
export const isFoliaEngine = (id: string | undefined): id is EngineId =>
  !!id && (ENGINES as readonly string[]).includes(id);

/** Each engine's own settings (the style pages draw their controls from these). */
/** What every Folia style has besides its own: whose word split its layout reads — Cadenza's (the listener's own, where
 *  they made one) or Folia's own automatic split, as upstream does it. */
const SHARED_PARAMS: EngineParam[] = [
  { key: 'foliaSeg', label: 'eng.foliaSeg', kind: 'toggle', def: false, group: 'style' },
];
export const ENGINE_PARAMS: Record<EngineId, EngineParam[]> = {
  sonnet: [...SONNET_PARAMS, ...SHARED_PARAMS],
  tempera: [...TEMPERA_PARAMS, ...SHARED_PARAMS],
};
export type { EngineParam };

/** Whether the frame's lyrics are an engine's (the director's word layers, transitions and dots are then left out). */
export const engineOf = (f: RenderFrame) => (isFoliaEngine(f.style.engine) ? f.style.engine : null);

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
  const key = JSON.stringify([id, theme, st.k.size ?? 1, f.motion < 1, tuning.beatFx, tuning.credits, tuning.foliaSeg]);
  return { key, theme, tuning };
}

function build(
  f: RenderFrame,
  id: EngineId,
  theme: ReturnType<typeof foliaTheme>,
  tuning: Record<string, unknown>,
  page = false,
) {
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
    credits: !page && tuning.credits !== false,
    tuning: page
      ? { ...tuning, outerFrameMode: 'none', showCornerMarks: false, showGiantDecorativeText: false }
      : tuning,
  };
  if (id === 'tempera') {
    const pal = f.pal;
    // the cover's colours (the gradient colour mode reads them), as Cadenza reads them from the cover (the ambient
    // field's); with no cover, the look's own
    const A = f.ambient,
      coverColors = (A.cols.length ? A.cols : [pal.accent, pal.bg2, pal.text, pal.flash, pal.bg]).map(rgbHex);
    return new TemperaEngine({ ...common, coverColors });
  }
  return new SonnetEngine(common);
}

/** The frame's engine runtime (made or rebuilt as needed), or null for the director. */
export function engineFor(f: RenderFrame): FoliaEngine | null {
  const id = engineOf(f);
  if (!id) return null;
  // (the key is cheap; it is built once per style change, not per frame)
  const h = held.get(f.plan);
  if (h && h.style === f.style) return h.engine;
  const { key, theme, tuning } = specOf(f, id);
  if (h && h.key === key) {
    h.style = f.style;
    h.engine.setTuning(tuning);
    return h.engine;
  }
  h?.engine.destroy();
  const next: Held = { key, style: f.style, engine: build(f, id, theme, tuning) };
  held.set(f.plan, next);
  return next.engine;
}

/** An engine still loading its assets (the engine keeps drawing frames until it is in, even paused). */
export const ENGINE_WAIT = { on: false };

/** Draws the frame's lyrics with its engine: the live inputs first (beats, bands), then the engine's own picture. */
export function drawEngine(g: CanvasRenderingContext2D, f: RenderFrame, engine: FoliaEngine) {
  installBeats(seedOf(f.plan), f.plan.map);
  // (the beat effects a style asks for by id, at the strength its settings give)
  const tuning = f.style.engp?.[engine.id] ?? {};
  setBeatEffects(engine.id === 'tempera' ? { 'tempera.inkFlash': +(tuning.inkFlash ?? 1) } : {});
  tickLive(f.t, f.playing !== false, f.plan.map);
  ENGINE_WAIT.on = !engine.ready;
  engine.draw(g, { t: f.t, W: f.W, H: f.H, px: f.px, alpha: f.view.effect, playing: f.playing !== false });
}

/** The play page's lyrics by a lyric engine, in its lyric area: fading out as the effect view comes in. */
export function drawPageEngine(g: CanvasRenderingContext2D, f: RenderFrame, alpha: number) {
  const np = f.np;
  if (!np || !isFoliaEngine(np.id) || alpha < 0.005 || np.w < 40 || np.h < 40) return;
  const id = np.id;
  let h = heldNp.get(f.plan);
  const size = `|${id}|${Math.round(np.w)}x${Math.round(np.h)}`;
  // (the spec is looked at again only when the style or the area changed)
  if (!h || h.style !== f.style || !h.key.endsWith(size)) {
    const { key, theme, tuning } = specOf(f, id);
    const k2 = key + size;
    if (h && h.key === k2) h.style = f.style;
    else {
      h?.engine.destroy();
      h = { key: k2, style: f.style, engine: build(f, id, theme, tuning, true) };
      heldNp.set(f.plan, h);
    }
  }
  ENGINE_WAIT.on ||= !h.engine.ready;
  installBeats(seedOf(f.plan), f.plan.map);
  tickLive(f.t, f.playing !== false, f.plan.map);
  h.engine.draw(g, {
    t: f.t,
    W: np.w,
    H: np.h,
    px: f.px,
    alpha,
    playing: f.playing !== false,
    ox: np.x,
    oy: np.y,
  });
}
