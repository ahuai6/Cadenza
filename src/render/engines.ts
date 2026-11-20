/* Lyric engines: who lays out, moves and draws the words. The director (the default) is drawn by the layers in
   renderer.ts; a Folia style (style.engine) is a runtime of its own over the same backdrop, fed the same lyric model,
   look and rhythm. One runtime per song plan, made on first use and rebuilt only when what it was built from changes
   (the look's colours or font, the engine's settings); dropped with its plan. */
import type { RenderFrame } from './frame';
import type { ScenePlan } from '../director/types';
import { SonnetEngine } from '../folia/engines/sonnet';
import type { FoliaEngine } from '../folia/engines/types';
import { foliaLines, foliaTheme, rgbHex } from '../folia/adapt';
import { installBeats, tickLive } from '../folia/live';
import { fontStack } from '../text/fonts';

interface Held {
  key: string;
  /** the style object it was last checked against (styles are replaced, never changed in place) */
  style: RenderFrame['style'];
  engine: FoliaEngine;
}
const held = new WeakMap<ScenePlan, Held>();

/** The engines a style can name (the director is none of them). */
export const ENGINES = ['sonnet'] as const;
export type EngineId = (typeof ENGINES)[number];
export const isFoliaEngine = (id: string | undefined): id is EngineId =>
  !!id && (ENGINES as readonly string[]).includes(id);

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
  const key = JSON.stringify([id, theme, tuning, st.k.size ?? 1, f.motion < 1]);
  return { key, theme, tuning };
}

function build(f: RenderFrame, id: EngineId, theme: ReturnType<typeof foliaTheme>, tuning: Record<string, unknown>) {
  const plan = f.plan,
    st = f.style;
  return new SonnetEngine({
    seed: seedOf(plan),
    lines: foliaLines(plan.doc),
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
  });
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
  tickLive(f.t, f.playing !== false, f.plan.map);
  ENGINE_WAIT.on = !engine.ready;
  engine.draw(g, { t: f.t, W: f.W, H: f.H, px: f.px, alpha: f.view.effect, playing: f.playing !== false });
}
