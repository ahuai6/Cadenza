// Triggered on the strongest accents, like the shattered glass (director/cues.ts plans when): a colour split, and a
// glitch. Both work on the finished frame, only while one is running (a few tenths of a second), and each can show in
// true RGB or in the theme's own colours (its accent and flash).
import { rnd } from '../../core/rng';
import { rgba, mix, type RGB } from '../../core/color';
import { register, type Ctx, type Param } from './registry';
import type { RenderFrame } from '../frame';
import { makeCanvas } from '../palette';

const COLOR: Param = { key: 'color', label: 'p.color', kind: 'select', options: [['rgb', 'p.color.rgb'], ['theme', 'p.color.theme']], def: 'rgb' };
const C2 = (c: HTMLCanvasElement) => c.getContext('2d')!;
const SNAP = makeCanvas(8, 8) as HTMLCanvasElement, TINT = makeCanvas(8, 8) as HTMLCanvasElement, OUT = makeCanvas(8, 8) as HTMLCanvasElement;
/** The finished frame so far, copied (device pixels). */
function snapshot(g: Ctx) {
  const cv = g.canvas as HTMLCanvasElement; for (const c of [SNAP, TINT, OUT]) if (c.width !== cv.width || c.height !== cv.height) { c.width = cv.width; c.height = cv.height; }
  const s = C2(SNAP); s.setTransform(1, 0, 0, 1, 0, 0); s.globalCompositeOperation = 'copy'; s.globalAlpha = 1; s.drawImage(cv, 0, 0); return cv;
}
/** The snapshot through one colour (multiply), into TINT. */
function tinted(col: string) { const t = C2(TINT); t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'copy'; t.drawImage(SNAP, 0, 0); t.globalCompositeOperation = 'multiply'; t.fillStyle = col; t.fillRect(0, 0, TINT.width, TINT.height); t.globalCompositeOperation = 'destination-in'; t.drawImage(SNAP, 0, 0); return TINT; }
const env = (dt: number, atk: number, len: number) => (dt < 0 ? 0 : dt < atk ? dt / atk : Math.max(0, 1 - (dt - atk) / len) ** 2);

/* ---------- colour split: the channels pulled apart along a slant, then back together ---------- */
register({ id: 'chroma', label: 'fx.chroma', layer: 'screen', kind: 'effect', z: 40, params: [COLOR], draw(g, f, a) {
  let k = 0; for (const e of f.plan.cues.chroma) { const dt = f.t - e.t; if (dt < -0.05) break; if (dt > 0.6) continue; k = Math.max(k, env(dt, 0.03, 0.5) * e.k); }
  k *= f.view.effect * f.cam.calm; if (k < 0.01) return;
  const cv = snapshot(g), W = cv.width, H = cv.height, d = k * W * 0.009, dy = d * 0.35;
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  if (a.params.color === 'theme') {
    // fringes in the theme's colours: its accent one way, its flash the other, lightening the frame where they fall
    g.globalCompositeOperation = f.pal.dark ? 'screen' : 'multiply';
    g.globalAlpha = 0.85 * Math.min(1, k * 1.4); g.drawImage(tinted(rgba(f.pal.accent, 1)), d * 1.5, -dy * 1.5);
    g.drawImage(tinted(rgba(f.pal.flash, 1)), -d * 1.5, dy * 1.5);
  } else {
    // true RGB: the frame rebuilt from its three channels, red and blue shifted apart, mixed in by the strength
    const o = C2(OUT); o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'copy'; o.fillStyle = '#000'; o.fillRect(0, 0, W, H); o.globalCompositeOperation = 'lighter';
    for (const [col, x, y] of [['#ff0000', d, -dy], ['#00ff00', 0, 0], ['#0000ff', -d, dy]] as const) o.drawImage(tinted(col), x, y);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.min(1, k * 1.5); g.drawImage(OUT, 0, 0);
  }
  g.restore(); } });

/* ---------- glitch: slices of the frame thrown sideways, a channel split in some, blocks of flat colour; it stutters
   in steps (a new pattern every 1/30 s), a few bursts within the hit ---------- */
register({ id: 'glitch', label: 'fx.glitch', layer: 'screen', kind: 'effect', z: 41, params: [COLOR], draw(g, f, a) {
  const ev = f.plan.cues.glitch.find(e => f.t >= e.t && f.t - e.t < 0.5); if (!ev) return;
  const dt = f.t - ev.t, q = Math.floor(dt * 30), live = q < 3 || rnd(ev.seed + q * 1.7) < 0.7 - dt; if (!live) return;
  const k = ev.k * f.view.effect * f.cam.calm * (1 - dt / 0.5); if (k < 0.02) return;
  const cv = snapshot(g), W = cv.width, H = cv.height, theme = a.params.color === 'theme', n = 5 + Math.floor(rnd(ev.seed + q) * 7), R = (s: number) => rnd(ev.seed * 3.1 + q * 13.7 + s);
  const cols: string[] = theme ? [rgba(f.pal.accent, 1), rgba(f.pal.flash, 1), rgba(mix(f.pal.accent, f.pal.bg2, 0.5) as RGB, 1)] : ['#ff0040', '#00ffd0', '#4060ff'];
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
  for (let i = 0; i < n; i++) {
    const y = Math.floor(R(i) * H), h = Math.max(2, Math.floor((0.01 + R(i + 0.5) * 0.06) * H)), dx = (R(i + 0.3) - 0.5) * 2 * W * 0.05 * k;
    g.globalCompositeOperation = 'source-over'; g.drawImage(SNAP, 0, y, W, h, dx, y, W, h);
    if (R(i + 0.7) < 0.4) { g.globalCompositeOperation = f.pal.dark ? 'screen' : 'multiply'; g.globalAlpha = 0.7; g.drawImage(tinted(cols[i % 2]), 0, y, W, h, dx + W * 0.006 * k * (i % 2 ? 1 : -1), y, W, h); g.globalAlpha = 1; }
  }
  // a few flat blocks of colour, and a dark slice
  for (let i = 0; i < 3; i++) if (R(i + 9) < 0.55) { g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.5 * k + 0.2; g.fillStyle = cols[i % cols.length];
    const bw = W * (0.04 + R(i + 10) * 0.18), bh = H * (0.006 + R(i + 11) * 0.02); g.fillRect(R(i + 12) * (W - bw), R(i + 13) * H, bw, bh); }
  if (R(20) < 0.5) { g.globalAlpha = 0.35 * k; g.fillStyle = '#000'; g.fillRect(0, R(21) * H, W, H * 0.012); }
  g.restore(); } });

