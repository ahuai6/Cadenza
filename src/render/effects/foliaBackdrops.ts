// Folia's five backgrounds as Cadenza backdrops (外觀 → 背景): any of them under any style, Cadenza's own or Folia's.
// Their colours are the look's own (its background, text, accent and flash) and the cover's (the ambient field's);
// their bands come from the rhythm analysis. The drawing lives in folia/backgrounds.ts.
import { register, type Ctx, type DrawArgs, type Param } from './registry';
import type { RenderFrame } from '../frame';
import { bandsAt } from '../../folia/live';
import { rgbHex } from '../../folia/adapt';
import { drawCommon, drawLatent, drawSora, drawMonet, drawNomand, type BgFrame } from '../../folia/backgrounds';

/** A number per song (its title, artist and length): the shapes are laid out from it, as upstream does per song. */
const seeds = new Map<string, number>();
function songSeed(f: RenderFrame) {
  const k = `${f.plan.titles.title}|${f.plan.titles.artist}|${f.plan.dur.toFixed(1)}`;
  let h = seeds.get(k);
  if (h === undefined) {
    h = 2166136261;
    for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619) >>> 0;
    if (seeds.size > 64) seeds.clear();
    seeds.set(k, h);
  }
  return h;
}
function frameOf(f: RenderFrame, a: DrawArgs): BgFrame {
  const E = a.bd.E;
  const dt = Number.isFinite(f.dt) && f.dt > 0 ? Math.min(f.dt, 0.1) : 1 / 60;
  const playing = f.offline || f.playing !== false;
  return {
    t: f.t,
    dt,
    x: -E,
    y: -E,
    w: f.W + 2 * E,
    h: f.H + 2 * E,
    px: f.px,
    playing,
    still: f.motion < 0.5,
    theme: {
      backgroundColor: rgbHex(f.pal.bg),
      primaryColor: rgbHex(f.ink),
      accentColor: rgbHex(f.pal.accent),
      secondaryColor: rgbHex(f.pal.flash),
    },
    daylight: !f.pal.dark,
    cover: f.media.cover,
    coverKey: f.media.coverKey,
    coverColors: (f.ambient.cols.length ? f.ambient.cols : [f.ambient.base]).map((c) => rgbHex(c)),
    bands: bandsAt(f.plan.map, f.t, playing),
    seed: songSeed(f),
  };
}
const R = (key: string, min: number, max: number, def: number, when?: Param['showIf'], step?: number): Param => ({
  key,
  label: 'fbg.' + key,
  kind: 'range',
  min,
  max,
  def,
  ...(step ? { step } : {}),
  ...(when ? { showIf: when } : {}),
});
const T = (key: string, def: boolean, when?: Param['showIf']): Param => ({
  key,
  label: 'fbg.' + key,
  kind: 'toggle',
  def,
  ...(when ? { showIf: when } : {}),
});
const S = (key: string, opts: string[], def: string, when?: Param['showIf']): Param => ({
  key,
  label: 'fbg.' + key,
  kind: 'select',
  options: opts.map((o) => [o, `fbg.${key}.${o}`]),
  def,
  ...(when ? { showIf: when } : {}),
});
const backdrop = (id: string, params: Param[], draw: (g: Ctx, f: BgFrame, p: DrawArgs['params']) => void) =>
  register({
    id,
    label: 'bg.' + id,
    layer: 'backdrop',
    kind: 'backdrop',
    params,
    draw(g, f, a) {
      g.save();
      draw(g, frameOf(f, a), a.params);
      g.restore();
      a.under?.();
    },
  });

backdrop(
  'f-common',
  [T('cover', false), R('opacity', 0, 1, 0.75, ['cover', true]), T('shapes', true), T('vignette', true)],
  drawCommon,
);
backdrop(
  'f-latent',
  [
    S('display', ['both', 'mesh', 'dithering'], 'both'),
    S('colors', ['cover-theme', 'cover-only'], 'cover-theme'),
    T('beat', true),
    R('meshSpeed', 0, 2, 0.3),
    R('meshDistortion', 0, 2, 0.8),
    R('meshSwirl', 0, 1, 0.1),
    R('ditheringSize', 0.5, 8, 2.5),
    R('ditheringOpacity', 0, 1, 0.55),
    T('overlay', true),
    R('overlayOpacity', 0, 1, 0.35, ['overlay', true]),
  ],
  drawLatent,
);
backdrop('f-sora', [T('blank', false)], drawSora);
backdrop(
  'f-monet',
  [
    S('layout', ['full-overlay', 'half-pane-gradient'], 'full-overlay'),
    R('blur', 0, 60, 6, undefined, 1),
    R('overlay', 0, 1, 0.74),
    R('saturation', 0, 2, 1.05),
    R('grayscale', 0, 1, 0),
    R('wash', 0, 1, 0.34),
    T('streaks', true),
    T('drift', true),
    R('driftStrength', 0, 1, 0.5, ['drift', true]),
  ],
  drawMonet,
);
const NE = (e: string): Param['showIf'] => ['effect', e];
backdrop(
  'f-nomand',
  [
    S('effect', ['dithering', 'fluted-glass', 'paper-texture', 'halftone-dots', 'lens-distortion'], 'dithering'),
    S('ditheringType', ['2x2', '4x4', '8x8'], '8x8', NE('dithering')),
    R('size', 0.5, 20, 3, NE('dithering')),
    R('colorSteps', 1, 7, 4, NE('dithering'), 1),
    T('originalColors', false, NE('dithering')),
    T('inverted', false, NE('dithering')),
    R('flutedGlassSize', 0.1, 1, 0.5, NE('fluted-glass')),
    R('flutedGlassDistortion', 0, 1, 0.5, NE('fluted-glass')),
    R('flutedGlassBlur', 0, 1, 0.08, NE('fluted-glass')),
    R('paperTextureContrast', 0, 1, 0.32, NE('paper-texture')),
    R('paperTextureRoughness', 0, 1, 0.42, NE('paper-texture')),
    R('paperTextureFiber', 0, 1, 0.3, NE('paper-texture')),
    R('halftoneDotsSize', 0.1, 1, 0.5, NE('halftone-dots')),
    R('halftoneDotsRadius', 0, 2, 1.25, NE('halftone-dots')),
    R('halftoneDotsContrast', 0, 1, 0.4, NE('halftone-dots')),
    T('halftoneDotsOriginalColors', false, NE('halftone-dots')),
    T('halftoneDotsInverted', false, NE('halftone-dots')),
    R('lensDistortionSpread', 0, 1, 0.45, NE('lens-distortion')),
    R('lensDistortionBulge', -1, 1, 0.3, NE('lens-distortion')),
    R('lensDistortionDispersion', 0, 1, 0.65, NE('lens-distortion')),
    T('overlayEnabled', true),
    R('overlayOpacity', 0, 1, 0.35, ['overlayEnabled', true]),
  ],
  drawNomand,
);
