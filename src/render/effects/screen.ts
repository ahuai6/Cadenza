// Over the screen: paper grain, vignette, scan lines.
import { rnd } from '../../core/rng';
import { register, type Ctx } from './registry';
import { makeCanvas } from '../palette';
import { C2 } from './sprite';

/* ---------- over the screen: paper grain, vignette, scan lines (they fade with the effect view, never pop in) ---------- */
const GRAIN = (() => {
  const c = makeCanvas(160, 160) as HTMLCanvasElement,
    g = C2(c),
    d = g.createImageData(160, 160);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.floor(rnd(i * 0.37 + 1) * 255);
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return c;
})();
const PATS = new WeakMap<object, Map<object, CanvasPattern>>();
const patternOf = (g: Ctx, src: CanvasImageSource) => {
  let m = PATS.get(g);
  if (!m) {
    m = new Map();
    PATS.set(g, m);
  }
  let p = m.get(src as object);
  if (!p) {
    p = g.createPattern(src, 'repeat')!;
    m.set(src as object, p);
  }
  return p;
};
register({
  id: 'grain',
  label: 'fx.grain',
  layer: 'screen',
  kind: 'effect',
  z: 0,
  draw(g, f) {
    g.save();
    g.globalAlpha = (f.pal.dark ? 0.18 : 0.24) * f.view.effect;
    g.globalCompositeOperation = 'soft-light';
    g.fillStyle = patternOf(g, GRAIN);
    g.fillRect(0, 0, f.W, f.H);
    g.restore();
  },
});
let VIG: { key: string; g: CanvasGradient } | null = null;
register({
  id: 'vignette',
  label: 'fx.vignette',
  layer: 'screen',
  kind: 'effect',
  z: 1,
  draw(g, f) {
    const key = `${f.W}|${f.H}|${f.pal.dark}`;
    if (!VIG || VIG.key !== key) {
      const v = g.createRadialGradient(
        f.W / 2,
        f.H * 0.45,
        Math.min(f.W, f.H) * 0.35,
        f.W / 2,
        f.H * 0.45,
        Math.max(f.W, f.H) * 0.75,
      );
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, f.pal.dark ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.14)');
      VIG = { key, g: v as CanvasGradient };
    }
    g.save();
    g.globalAlpha = f.view.effect;
    g.fillStyle = VIG.g;
    g.fillRect(0, 0, f.W, f.H);
    g.restore();
  },
});
let SCAN: { dark: boolean; c: HTMLCanvasElement } | null = null;
register({
  id: 'scan',
  label: 'fx.scan',
  layer: 'screen',
  kind: 'effect',
  z: 2,
  draw(g, f) {
    if (!SCAN || SCAN.dark !== f.pal.dark) {
      const c = makeCanvas(4, 3) as HTMLCanvasElement,
        s = C2(c);
      s.fillStyle = f.pal.dark ? 'rgba(0,0,0,.28)' : 'rgba(0,0,0,.035)';
      s.fillRect(0, 0, 4, 1);
      SCAN = { dark: f.pal.dark, c };
    }
    g.save();
    g.globalAlpha = f.view.effect;
    g.fillStyle = patternOf(g, SCAN.c);
    g.fillRect(0, 0, f.W, f.H);
    g.restore();
  },
});
