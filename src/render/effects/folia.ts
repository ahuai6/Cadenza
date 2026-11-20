// Folia's parts that stand on their own, as effects any style can use (the director's too): the finishing passes
// (Sonnet's lens, grain, contrast, colour fringe, halftone and vignette — the same GLSL programs, run over the whole
// picture) and Sonnet's layout marks (the corner rules and registration marks round the frame).
import { register, type Ctx } from './registry';
import type { RenderFrame } from '../frame';
import * as pixi from '../../folia/pixi';
import { glRunner } from '../../folia/pixi';
import { createSonnetPostProcessFilters } from '../../folia/vendor/components/visualizer/sonnet/sonnetPostProcess';
import { drawSonnetFrameOverlay } from '../../folia/vendor/components/visualizer/sonnet/sonnetFrameOverlay';
import { DEFAULT_SONNET_TUNING } from '../../folia/vendor/types';
import { foliaTheme, rgbHex } from '../../folia/adapt';

/* ---------- 畫面處理: the finishing chain over the whole picture ---------- */
let chain: { key: string; filters: pixi.Filter[] } | null = null;
let copy: HTMLCanvasElement | OffscreenCanvas | null = null;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

register({
  id: 'finish',
  label: 'fx.finish',
  layer: 'screen',
  kind: 'effect',
  // last: it reads the picture as it is, the screen's other effects included
  z: 9,
  params: [
    { key: 'grain', label: 'eng.grain', kind: 'range', min: 0, max: 1, def: 0.2 },
    { key: 'contrast', label: 'eng.contrast', kind: 'range', min: 0, max: 1, def: 0 },
    { key: 'rgbShift', label: 'eng.rgbShift', kind: 'range', min: 0, max: 1, def: 0.3 },
    { key: 'halftone', label: 'eng.halftone', kind: 'range', min: 0, max: 1, def: 0 },
    { key: 'vignette', label: 'eng.vignette', kind: 'range', min: 0, max: 2, def: 0.85 },
    { key: 'lens', label: 'eng.lens', kind: 'range', min: 0, max: 2, def: 0.3 },
    { key: 'dispersion', label: 'eng.dispersion', kind: 'range', min: 0, max: 1, def: 0.6 },
  ],
  draw(g: Ctx, f: RenderFrame, { params: p }) {
    const k = f.view.effect;
    if (k < 0.01) return;
    const runner = glRunner();
    if (!runner.ok) return;
    const amounts = {
      noise: num(p.grain, 0.2) * 0.35,
      contrast: num(p.contrast, 0) * 0.5,
      lensDistortion: num(p.lens, 0.3),
      lensDispersion: num(p.dispersion, 0.6),
      printEffects: { rgbShift: num(p.rgbShift, 0.3), halftone: num(p.halftone, 0), vignette: num(p.vignette, 0.85) },
    };
    const key = JSON.stringify(amounts);
    if (!chain || chain.key !== key) {
      chain?.filters.forEach((x) => x.destroy());
      // (seeded by nothing that moves: the grain is the same grain every frame, as Sonnet's is per scene)
      chain = { key, filters: createSonnetPostProcessFilters(pixi, amounts, 7) };
    }
    if (!chain.filters.length) return;
    const cv = g.canvas as HTMLCanvasElement;
    const W = cv.width,
      H = cv.height,
      res = f.px;
    if (!copy || copy.width !== W || copy.height !== H) copy = pixi.makeCanvas(W, H);
    const cg = copy.getContext('2d') as CanvasRenderingContext2D;
    cg.globalCompositeOperation = 'copy';
    cg.drawImage(cv, 0, 0);
    const out = runner.run(copy, W / res, H / res, res, chain.filters, { x: 0, y: 0 });
    if (!out) return;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    // (fading with the effect view: the finished picture over the plain one)
    g.globalAlpha = k;
    g.globalCompositeOperation = k > 0.999 ? 'copy' : 'source-over';
    g.drawImage(out as CanvasImageSource, 0, 0, W, H);
    g.restore();
  },
});

/* ---------- 版面標記: Sonnet's frame marks round the picture ---------- */
const marks = { key: '', root: new pixi.Container(), renderer: new pixi.StageRenderer() };

register({
  id: 'sheet',
  label: 'fx.sheet',
  layer: 'screen',
  kind: 'effect',
  z: 8,
  params: [
    {
      key: 'mode',
      label: 'eng.frame',
      kind: 'select',
      options: [
        ['frame', 'eng.frame.frame'],
        ['full', 'eng.frame.full'],
      ],
      def: 'frame',
    },
  ],
  draw(g: Ctx, f: RenderFrame, { params: p }) {
    const k = f.view.effect;
    if (k < 0.01) return;
    const mode = p.mode === 'full' ? 'full' : 'frame';
    const theme = foliaTheme({
      name: f.style.name || '',
      bg: rgbHex(f.pal.bg),
      text: rgbHex(f.ink),
      accent: rgbHex(f.pal.accent),
      secondary: rgbHex(f.pal.flash),
      font: 'sans-serif',
      motion: 0.5,
    });
    const key = `${f.W}|${f.H}|${mode}|${theme.primaryColor}|${theme.accentColor}`;
    if (marks.key !== key) {
      marks.key = key;
      drawSonnetFrameOverlay(pixi, marks.root, f.W, f.H, { ...DEFAULT_SONNET_TUNING, outerFrameMode: mode }, theme);
    }
    marks.root.alpha = k;
    g.save();
    marks.renderer.render(marks.root, g as CanvasRenderingContext2D, {
      width: f.W,
      height: f.H,
      resolution: f.px,
      clear: false,
    });
    g.restore();
  },
});
