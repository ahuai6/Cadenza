/* The renderer: draws one RenderFrame in a fixed order of layers —
     backdrop → (backdrop-space effects) → flash → world-back → lyrics → world-front → foreground → screen → invert →
     transition blur → idle dots, captions, titles → handoff overlay
   The view mix runs from the now-playing backdrop alone (ambient, 0) to the full effect-lyrics picture (1): the theme's
   backdrop fades in over the ambient field (the cover theme *is* the ambient field, so nothing changes there), and
   words, decor and screen effects fade with it — nothing pops in when the view changes. */
import { clamp, D2R } from '../core/math';
import { sstep } from '../core/math';
import { rgba } from '../core/color';
import { effects, effect, paramsFor, type Ctx, type BackdropView, type Effect } from './effects/registry';
import './effects/ambient'; import './effects/cover'; import './effects/backdrops'; import './effects/overlays';
import type { RenderFrame } from './frame';
import { visibleWords, drawLyrics } from './lyrics';
import { drawTransition, drawCaptions, drawIntro, drawEndCard, drawIdleDots } from './post';
import { makeCanvas } from './palette';
import { cameraAt } from '../director/evaluate';
import type { Signals } from '../rhythm/signals';

const byZ = (a: Effect, b: Effect) => (a.z ?? 0) - (b.z ?? 0);
const LAYER = makeCanvas(16, 16) as HTMLCanvasElement;

export interface DrawOptions { captions?: boolean; captionBottom?: number; overlay?: (g: Ctx, f: RenderFrame) => void; /** drawn on the backdrop, under the words */ under?: (g: Ctx, f: RenderFrame) => void; sig: Signals }

export function drawFrame(g: Ctx, f: RenderFrame, o: DrawOptions) {
  const st = f.style, M = st.m, W = f.W, H = f.H, view = f.view.effect, cf = f.cam;
  g.setTransform(f.px, 0, 0, f.px, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  // the camera's speed on screen (for the motion trail and the backdrop's slight lean-in when moving fast)
  const prev = cameraAt(f.plan, o.sig, Math.max(0, f.t - 1 / 60), f.motion).cam, cam = cf.cam;
  const vx = (cam.x - prev.x) * cam.z, vy = (cam.y - prev.y) * cam.z, vel = Math.hypot(vx, vy) + Math.abs(Math.log(cam.z / prev.z)) * W * 0.5 + Math.abs(cam.r - prev.r) * W / 90;
  const mb = Math.min(12 * W / 1280, vel * 0.025) * f.motion;
  /* ---- backdrop ---- */
  const roll = cf.fx.r - cf.cont.r, zoom = cf.fx.z * (1 + Math.min(0.15, mb * 0.01)), ra = Math.abs(roll * D2R), zz = Math.max(0.05, zoom), E = Math.max(W, H) * 0.7;
  const Ev = Math.min(E, Math.ceil(Math.max(0, (W / 2 * Math.abs(Math.cos(ra)) + H / 2 * Math.abs(Math.sin(ra))) / zz - W / 2, (W / 2 * Math.abs(Math.sin(ra)) + H / 2 * Math.abs(Math.cos(ra))) / zz - H / 2)) + 4);
  const bd: BackdropView = { roll, zoom, ox: cf.fx.x * 0.5 - cf.hand[0] * 0.35, oy: cf.fx.y * 0.5 - cf.hand[1] * 0.35, E, Ev };
  const bgFx = effect(st.bgStyle) || effect('minimal')!, sameAsAmbient = st.bgStyle === 'cover';
  const bdEffects = effects('effect').filter(e => e.layer === 'backdrop' && (st.fx[e.id] || e.id === 'mv')).sort(byZ);
  const inBackdrop = (c: Ctx) => { c.save(); c.translate(W / 2, H / 2); c.rotate(roll * D2R); c.scale(zoom, zoom); c.translate(-W / 2, -H / 2); };
  const drawTheme = (c: Ctx) => { inBackdrop(c); bgFx.draw(c, f, { bd, params: paramsFor(bgFx, st.fxp?.[bgFx.id]) }); for (const e of bdEffects) e.draw(c, f, { bd, params: paramsFor(e, st.fxp?.[e.id]) }); c.restore(); };
  if (view >= 0.999) drawTheme(g);
  else {
    inBackdrop(g); effect('ambient')!.draw(g, f, { bd, params: {} }); g.restore();
    if (view > 0.001) {
      const cv = g.canvas as HTMLCanvasElement; if (LAYER.width !== cv.width || LAYER.height !== cv.height) { LAYER.width = cv.width; LAYER.height = cv.height; }
      const lg = LAYER.getContext('2d')!; lg.setTransform(1, 0, 0, 1, 0, 0); lg.clearRect(0, 0, LAYER.width, LAYER.height); lg.setTransform(f.px, 0, 0, f.px, 0, 0);
      if (sameAsAmbient) { inBackdrop(lg); for (const e of bdEffects) e.draw(lg, f, { bd, params: paramsFor(e, st.fxp?.[e.id]) }); if (f.coverOwner === 'backdrop') bgFx.draw(lg, f, { bd, params: {} }); lg.restore(); }
      else drawTheme(lg);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = sstep(view); g.drawImage(LAYER, 0, 0); g.restore();
    }
  }
  o.under?.(g, f); g.setTransform(f.px, 0, 0, f.px, 0, 0);
  /* ---- flashes ---- */
  const bl = f.plan.map.beatLen(f.t), tempo = Math.sqrt(clamp(bl / 0.5, 0.5, 2)), calm = cf.calm;
  let flash = 0; { const env = (x: number, decay: number, atk: number) => (x < atk ? sstep(x / atk) : Math.exp(-(x - atk) * decay));
    flash = env(f.rs.phase, 9, 0.05) * (f.rs.inBar === 0 ? 0.12 : 0.05) * f.I;
    const fa = st.cut === 'glide' ? 0.12 : st.cut === 'waltz' ? 0.16 : 0.05, fpk = st.cut === 'waltz' ? 0.5 : 0.6, fd = 6 / tempo;
    for (const q of f.plan.cues.flash) { const dt = f.t - q.t; if (dt >= 0 && dt < 1.4) flash = Math.max(flash, (dt < fa ? sstep(dt / fa) : Math.exp(-(dt - fa) * fd)) * fpk * (0.5 + 0.5 * q.k)); }
    flash *= calm * (M.flash > 0.02 ? M.flashk ?? 0.6 : 0) * view * (f.motion < 1 ? 0.3 : 1); }
  const invert = st.flashMode === 'invert';
  let inv = false; if (invert && M.flash > 0.02 && calm > 0.5 && f.motion >= 1 && view > 0.5) { const wnd = 0.1 * tempo; for (const q of f.plan.cues.flash) { const dt = f.t - q.t; if (dt >= 0 && dt < wnd) { inv = true; break; } } }
  if (!invert && flash > 0.005) { g.fillStyle = rgba(f.pal.flash, Math.min(0.75, flash)); g.fillRect(0, 0, W, H); }
  f.ink = !invert && flash > 0.32 && f.pal.invertOnFlash ? f.pal.bg : f.pal.text;
  /* ---- the lyric world ---- */
  const card = !!f.plan.titles.end;
  f.vis = visibleWords(f, card);
  const world = (layer: 'world-back' | 'world-front' | 'foreground' | 'screen') => { for (const e of effects('effect').filter(x => x.layer === layer && (st.fx[x.id] || alwaysOn(x))).sort(byZ)) e.draw(g, f, { bd, params: paramsFor(e, st.fxp?.[e.id]) }); };
  if (view > 0.001) {
    world('world-back');
    const split = (cf.split * 10 + f.rs.pulse * 1.5 * f.I) * f.motion * M.split;
    const tk = clamp((mb - 0.3) / 2.5);
    if (tk > 0.02) { const len = mb * 1.6, d = Math.hypot(vx, vy) || 1, c = Math.cos(-cam.r * D2R), s = Math.sin(-cam.r * D2R), mdx = (vx * c - vy * s) / d, mdy = (vx * s + vy * c) / d;
      drawLyrics(g, f, f.vis, { ink: f.ink, split, trail: { k: 0.22 * tk, dx: mdx * len * 0.7, dy: mdy * len * 0.7 } }); }
    drawLyrics(g, f, f.vis, { ink: f.ink, split });
    world('world-front'); world('foreground'); world('screen');
  }
  g.setTransform(f.px, 0, 0, f.px, 0, 0);
  if (inv) { g.save(); g.globalCompositeOperation = 'difference'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H); g.restore(); }
  const trk = cf.trans * view; if (trk > 0.005) drawTransition(g, f, trk);
  g.setTransform(f.px, 0, 0, f.px, 0, 0);
  drawIdleDots(g, f);
  if (o.captions !== false) drawCaptions(g, f, o.captionBottom ?? H * 0.9);
  drawIntro(g, f);
  drawEndCard(g, f);
  const fo = clamp((f.t - (f.plan.dur - 0.6)) / 0.6); if (fo > 0) { g.fillStyle = rgba(f.pal.bg, fo); g.fillRect(0, 0, W, H); }
  o.overlay?.(g, f);
}
/** Effects that belong to a backdrop and follow it rather than a switch (they check the backdrop themselves). */
const alwaysOn = (e: Effect) => e.id === 'gothic-chains' || e.id === 'geo-front' || e.id === 'glass-shards' || e.id === 'feathers-fg';
