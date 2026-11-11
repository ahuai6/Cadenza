// Stars: from far out of frame, curving in to land beside a word just as it appears.
import { clamp, sstep } from '../../core/math';
import { rnd } from '../../core/rng';
import { mix, rgba, type RGB } from '../../core/color';
import { register, type Ctx } from './registry';
import { makeCanvas } from '../palette';
import { project } from '../../director/project';
import { C2 } from './sprite';

/* ---------- stars: from far out of frame, curving in to land beside a word just as it appears ---------- */
/* a star: a soft halo, a four-pointed body with curved sides, two thin flares longer than it, a bright core — drawn
   once per colour into a sprite and placed (a star costs one image, however finely it is made) */
let STAR: { key: string; c: HTMLCanvasElement } | null = null;
function starSprite(col: RGB) {
  const key = col.join();
  if (STAR && STAR.key === key) return STAR.c;
  const S = 192,
    c = makeCanvas(S, S) as HTMLCanvasElement,
    g = C2(c),
    m = S / 2,
    r = S * 0.2;
  g.translate(m, m);
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, m);
  halo.addColorStop(0, rgba(col, 0.42));
  halo.addColorStop(0.18, rgba(col, 0.16));
  halo.addColorStop(0.5, rgba(col, 0.04));
  halo.addColorStop(1, rgba(col, 0));
  g.fillStyle = halo;
  g.fillRect(-m, -m, S, S);
  for (const [len, wd, al] of [
    [m * 0.98, 1.2, 0.35],
    [m * 0.62, 2.2, 0.55],
  ] as const)
    for (const a of [0, Math.PI / 2]) {
      // the flares: long and thin, fading out
      const gr = g.createLinearGradient(-len, 0, len, 0);
      gr.addColorStop(0, rgba(col, 0));
      gr.addColorStop(0.5, rgba(mix(col, [255, 255, 255], 0.5), al));
      gr.addColorStop(1, rgba(col, 0));
      g.save();
      g.rotate(a);
      g.fillStyle = gr;
      g.fillRect(-len, -wd / 2, len * 2, wd);
      g.restore();
    }
  const body = g.createRadialGradient(0, 0, 0, 0, 0, r);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.35, rgba(mix(col, [255, 255, 255], 0.55), 1));
  body.addColorStop(1, rgba(col, 0.9));
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(0, -r);
  g.quadraticCurveTo(r * 0.12, -r * 0.12, r * 0.72, 0);
  g.quadraticCurveTo(r * 0.12, r * 0.12, 0, r);
  g.quadraticCurveTo(-r * 0.12, r * 0.12, -r * 0.72, 0);
  g.quadraticCurveTo(-r * 0.12, -r * 0.12, 0, -r);
  g.fill();
  const core = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.32);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.beginPath();
  g.arc(0, 0, r * 0.32, 0, 6.283);
  g.fill();
  STAR = { key, c };
  return c;
}
const STAR_K = 1.6; // how much larger than the old plain star (the motion is the same)
function sparkle(g: Ctx, x: number, y: number, r: number, rot: number, spr: HTMLCanvasElement) {
  const s = (r * STAR_K) / 0.2;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.drawImage(spr, -s / 2, -s / 2, s, s);
  g.restore();
}
register({
  id: 'stars',
  label: 'fx.stars',
  layer: 'world-front',
  kind: 'effect',
  draw(g, f) {
    const t = f.t,
      tempo = Math.sqrt(clamp(f.plan.map.beatLen(t) / 0.5, 0.5, 2)),
      FLY = 0.75 * tempo,
      POP = 0.22 * tempo,
      far = Math.max(f.W, f.H) * 0.85,
      col = f.pal.dark ? mix(f.pal.flash, [255, 255, 255], 0.35) : f.pal.accent;
    const spr = starSprite(col);
    g.save();
    g.globalCompositeOperation = f.pal.dark ? 'lighter' : 'source-over';
    g.fillStyle = rgba(col, 1);
    for (const P of f.plan.lines) {
      if (P.L.t > t + FLY + 0.05) break;
      if (isFinite(P.secEnd) && t > P.secEnd - 0.4) continue;
      for (const S of P.words) {
        const dt = t - S.show;
        if (dt < -FLY || dt > POP) continue;
        if (rnd(P.i * 3.7 + S.k * 1.9) > 0.6) continue;
        const p = project(S.x, S.y, S.d, f.cam.cam, f.cam.fx, f.W, f.H),
          a0 = rnd(P.i * 9.1 + S.k * 4.3) * 6.283,
          bend = (rnd(P.i * 2.2 + S.k) < 0.5 ? 1 : -1) * (0.25 + rnd(P.i + S.k * 5.5) * 0.35);
        const side = rnd(P.i * 6.1 + S.k * 2.7) * 6.283,
          Rw = Math.hypot(S.lw, S.lh) * 0.5 * p.k * (1.05 + 0.4 * rnd(P.i * 1.3 + S.k * 8.9));
        const tx = f.W / 2 + p.sx + Math.cos(side) * Rw,
          ty = f.H / 2 + p.sy + Math.sin(side) * Rw * 0.7,
          sx = tx + Math.cos(a0) * far,
          sy = ty + Math.sin(a0) * far,
          mx = (sx + tx) / 2 - Math.sin(a0) * far * bend,
          my = (sy + ty) / 2 + Math.cos(a0) * far * bend;
        const r = Math.max(13, S.lh * p.k * 0.12),
          at = (u: number) => {
            const e = u * u * (3 - 2 * u) * 0.4 + u * u * 0.6,
              k = 1 - e;
            return [k * k * sx + 2 * k * e * mx + e * e * tx, k * k * sy + 2 * k * e * my + e * e * ty];
          };
        if (dt < 0) {
          const u = clamp((dt + FLY) / FLY),
            env = sstep(clamp(u / 0.25)) * f.view.effect;
          for (let k = 10; k >= 1; k--) {
            const [x, y] = at(Math.max(0, u - k * 0.018));
            g.globalAlpha = env * 0.4 * (1 - k / 11);
            g.beginPath();
            g.arc(x, y, Math.max(0.5, r * 0.25 * (1 - k / 12)), 0, 6.283);
            g.fill();
          }
          const [x, y] = at(u);
          g.globalAlpha = env;
          sparkle(g, x, y, r * (0.8 + 0.2 * u), t * 6, spr);
        } else {
          const u = dt / POP;
          g.globalAlpha = (1 - u) ** 2 * 0.9 * f.view.effect;
          sparkle(g, tx, ty, r * (1 + 0.35 * Math.sin(u * Math.PI)), t * 6, spr);
        }
      }
    }
    g.restore();
  },
});
