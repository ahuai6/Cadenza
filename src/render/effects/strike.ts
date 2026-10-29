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
/** A hit: it snaps apart within a frame or two and snaps most of the way back at once, then the rest settles quickly,
 *  with a small second kick (a lens rattled by the blow) — nothing drags behind the beat. */
const snapEnv = (dt: number) => (dt < 0 ? 0 : dt < 0.012 ? dt / 0.012 : Math.exp(-(dt - 0.012) / 0.06) * 0.8 + 0.2 * Math.exp(-(dt - 0.012) / 0.2) * Math.abs(Math.cos((dt - 0.012) * 26)));

/* ---------- colour split: the channels pulled apart along a slant, then back together ---------- */
register({ id: 'chroma', label: 'fx.chroma', layer: 'screen', kind: 'effect', z: 40, params: [COLOR], draw(g, f, a) {
  let k = 0; for (const e of f.plan.cues.chroma) { const dt = f.t - e.t; if (dt < -0.05) break; if (dt > 0.6) continue; k = Math.max(k, snapEnv(dt) * e.k); }
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

/* ---------- glitch: in the scene itself — the words being sung torn into bands and thrown sideways (a channel split
   in some), a few torn pieces of the picture round them, small blocks of the theme's colour on the words; it stutters
   in steps (a new pattern every 1/30 s), a few bursts within the hit. Never the whole screen in stripes. ---------- */
register({ id: 'glitch', label: 'fx.glitch', layer: 'screen', kind: 'effect', z: 41, params: [COLOR], draw(g, f, a) {
  const ev = f.plan.cues.glitch.find(e => f.t >= e.t && f.t - e.t < 0.5); if (!ev) return;
  const dt = f.t - ev.t, q = Math.floor(dt * 30), live = q < 3 || rnd(ev.seed + q * 1.7) < 0.7 - dt; if (!live) return;
  const k = ev.k * f.view.effect * f.cam.calm * (1 - dt / 0.5); if (k < 0.02) return;
  const cv = snapshot(g), W = cv.width, H = cv.height, px = f.px, theme = a.params.color === 'theme', R = (s: number) => rnd(ev.seed * 3.1 + q * 13.7 + s);
  const cols: string[] = theme ? [rgba(f.pal.accent, 1), rgba(f.pal.flash, 1), rgba(mix(f.pal.accent, f.pal.bg2, 0.5) as RGB, 1)] : ['#ff0040', '#00ffd0', '#4060ff'];
  // where: the words being sung (their boxes on screen), else the middle of the picture
  const boxes: [number, number, number, number][] = [];
  for (const v of f.vis || []) { if (!v.ws.live || v.o < 0.3) continue; const S = v.S, k2 = S.s * v.ws.sc * v.p.k, w = (S.lw / S.s) * k2 * px, h = (S.lh / S.s) * k2 * px;
    boxes.push([(f.W / 2 + v.p.sx) * px - w / 2, (f.H / 2 + v.p.sy) * px - h / 2, w, h]); if (boxes.length >= 3) break; }
  if (!boxes.length) boxes.push([W * 0.3, H * 0.4, W * 0.4, H * 0.2]);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
  boxes.forEach(([bx, by, bw, bh], j) => {
    const mx = bw * 0.25, x0 = Math.max(0, bx - mx), x1 = Math.min(W, bx + bw + mx), n = 3 + Math.floor(R(j * 5) * 4);
    for (let i = 0; i < n; i++) { const s0 = j * 31 + i;
      const y = Math.floor(by + R(s0) * bh), h = Math.max(2, Math.floor((0.08 + R(s0 + 0.5) * 0.22) * bh)), dx = (R(s0 + 0.3) - 0.5) * 2 * bw * 0.18 * k, sw = x1 - x0;
      if (sw < 2 || y < 0 || y + h > H) continue;
      g.globalCompositeOperation = 'source-over'; g.drawImage(SNAP, x0, y, sw, h, x0 + dx, y, sw, h);
      if (R(s0 + 0.7) < 0.45) { g.globalCompositeOperation = f.pal.dark ? 'screen' : 'multiply'; g.globalAlpha = 0.7; g.drawImage(tinted(cols[i % 2]), x0, y, sw, h, x0 + dx + bw * 0.03 * k * (i % 2 ? 1 : -1), y, sw, h); g.globalAlpha = 1; } }
    // a block or two of flat colour caught on the words
    for (let i = 0; i < 2; i++) if (R(j * 7 + i + 9) < 0.5) { g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.45 * k + 0.15; g.fillStyle = cols[(i + j) % cols.length];
      const w2 = bw * (0.1 + R(j * 7 + i + 10) * 0.35), h2 = bh * (0.05 + R(j * 7 + i + 11) * 0.12); g.fillRect(bx + R(j * 7 + i + 12) * (bw - w2), by + R(j * 7 + i + 13) * bh, w2, h2); g.globalAlpha = 1; } });
  // a few torn pieces of the picture near the words (not full-width bands): a patch shifted sideways
  for (let i = 0; i < 3; i++) if (R(40 + i) < 0.6) { const [bx, by, bw, bh] = boxes[i % boxes.length], pw = W * (0.06 + R(41 + i) * 0.14), ph = H * (0.015 + R(42 + i) * 0.04);
    const x = Math.max(0, Math.min(W - pw, bx + (R(43 + i) - 0.3) * bw * 1.6)), y = Math.max(0, Math.min(H - ph, by + (R(44 + i) - 0.5) * bh * 3)), dx = (R(45 + i) - 0.5) * W * 0.04 * k;
    g.globalCompositeOperation = 'source-over'; g.drawImage(SNAP, x, y, pw, ph, x + dx, y, pw, ph); }
  g.restore(); } });
