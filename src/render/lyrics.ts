/* The lyrics. Every word is drawn in the plan's fixed order (back to front, set when the song was planned: overlapping
   words can never swap places from one frame to the next), placed by the one projection, culled by its full projected
   bounds, and every layer of a unit (ghost, outline, halo, shadow, colour split, glyph) is drawn from the unit's single
   rest pose. */
import { clamp, D2R } from '../core/math';
import { mix, rgba } from '../core/color';
import { rnd } from '../core/rng';
import { project, onScreen, type Projected } from '../director/project';
import { wordState, unitPose, TIN_SPEC, type WordCtx, type WordState } from '../director/words';
import type { PWord } from '../director/types';
import { fontStack } from '../text/fonts';
import { EM } from '../text/metrics';
import { blurGlyph, drawFocus, focusW } from './glyphs';
import type { RenderFrame } from './frame';
import type { Ctx } from './effects/registry';

/** Culling can be switched off to prove it never removes anything visible (render tests). */
let CULL = true; export const setCulling = (on: boolean) => { CULL = on; };
export interface VisWord { S: PWord; ws: WordState; p: Projected; o: number; glyphPx: number }
export function wordCtx(f: RenderFrame): WordCtx {
  const M = f.style.m, bl = f.plan.map.beatLen(f.t);
  return { enter: Math.max(0.05, M.enter), tempo: Math.sqrt(clamp(bl / 0.5, 0.5, 2)), float: (M.float ?? 0) * f.motion, future: f.style.future, smooth: f.style.cut !== 'punch', punch: M.punch, motion: f.motion, drift: f.style.tout === 'drift' };
}
/** Which words are on screen this frame, and how. Read by the lyric pass and by world effects (frames, stars, glyphs). */
export function visibleWords(f: RenderFrame, card: boolean): VisWord[] {
  const out: VisWord[] = [], c = wordCtx(f), { cam, fx, ov } = f.cam, W = f.W, H = f.H, dmin = f.plan.dmin;
  for (const S of f.plan.drawOrder) {
    if (f.t < S.show && ov <= 0) continue;
    const ws = wordState(S, f.t, ov, card, c); if (!ws) continue;
    const p = project(S.x, S.y, S.d, cam, fx, W, H), half = Math.hypot(S.lw, S.lh) * 0.5 * p.k * ws.sc + (Math.abs(ws.ox) + Math.abs(ws.oy)) * S.s * p.k + 60;
    if (CULL && !onScreen(p, half, W, H)) continue;
    const fog = clamp(1 - (S.d - dmin) / (1300 * 4), 0.55, 1), wa = f.wordAlpha ? f.wordAlpha(S.line.i) : 1;
    out.push({ S, ws, p, o: ws.o * fog * wa, glyphPx: EM * S.s * ws.sc * p.k });
  }
  return out;
}

/** Draw the lyrics. trail: a faint copy offset along the camera's travel (motion trail). */
export function drawLyrics(g: Ctx, f: RenderFrame, vis: VisWord[], o: { ink: number[]; split: number; trail?: { k: number; dx: number; dy: number } }) {
  const st = f.style, M = st.m, pal = f.pal, c = wordCtx(f), ov = f.cam.ov, trail = o.trail, AK = trail ? trail.k : 1, view = f.view.effect;
  const fc = fontStack(st.font, f.plan.doc.lines.map(L => L.text).join('').slice(0, 400));
  const font = `${fc.w} ${EM}px ${fc.stack}`;
  const g1 = rgba(pal.accent, 1), g2 = rgba(pal.flash, 1), inkC = rgba(o.ink as any, 1);
  const glowC = st.bgStyle === 'cover' ? rgba(pal.bg, 0.9) : rgba(pal.accent, 0.85), glowB = M.glow * 26 * f.px;
  const sk = f.cam.fx.sk && (Math.abs(f.cam.fx.sk[0]) + Math.abs(f.cam.fx.sk[1]) > 1e-4) ? f.cam.fx.sk : null, JT = (M.jitter ?? 0) * f.motion, pulse = f.rs.pulse, fr = Math.floor(f.t * 12), blurOn = ov <= 0 && f.motion > 0.5;
  g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = font;
  for (const v of vis) {
    const { S, ws, p } = v, n = S.units.length, spec = TIN_SPEC[ws.tin] || TIN_SPEC.blur, blurMax = Math.min(32, v.glyphPx * spec.blur);
    const A = v.o * AK * view; if (A < 0.003) continue;
    const k = S.s * ws.sc * p.k;
    g.setTransform(f.px, 0, 0, f.px, 0, 0); g.translate(f.W / 2 + p.sx + (trail?.dx ?? 0), f.H / 2 + p.sy + (trail?.dy ?? 0)); if (sk) g.transform(1, sk[0], sk[1], 1, 0, 0);
    g.rotate((S.tilt + p.rot + ws.frot) * D2R); g.scale(k, k); g.translate(ws.ox, ws.oy);
    const sp0 = !trail ? o.split * ws.gk / Math.max(1e-3, k) : 0;
    for (let ui = 0; ui < n; ui++) {
      const u = S.units[ui], up = unitPose(S, ui, f.t, ws, ov, c, !!trail); if (!up) continue;
      let jx = 0, jy = 0; if (JT > 0 && ws.live) { jx = (rnd(fr * 13 + ui * 7 + S.k) - 0.5) * JT * pulse * 22; jy = (rnd(fr * 7 + ui * 3 + S.k) - 0.5) * JT * pulse * 14; }
      // ghost of an unsung unit, and the outline that marks a unit just sung: both at the unit's rest pose
      if (up.ghost || up.outline > 0) {
        g.save(); g.translate(up.rx, up.ry); if (u.rot) g.rotate(Math.PI / 2);
        g.globalAlpha = A * (up.ghost ? 0.4 : up.outline); g.strokeStyle = inkC; g.lineWidth = 2.4; g.strokeText(u.c, 0, 0); g.restore();
        if (up.ghost) continue;
      }
      const bpx = blurOn ? blurMax * up.uq * f.px : 0, blurred = bpx > 0.4;
      if (trail && blurred) continue;
      g.save(); g.translate(up.rx + up.dx + jx, up.ry + up.dy + jy); if (up.ur) g.rotate(up.ur * D2R); if (up.um !== 1) g.scale(up.um, up.um); if (u.rot) g.rotate(Math.PI / 2);
      const sp = sp0 * focusW(bpx);
      if (sp > 0.4) { g.fillStyle = g1; g.globalAlpha = A * up.ua * 0.35; g.fillText(u.c, sp, 0); g.fillStyle = g2; g.globalAlpha = A * up.ua * 0.25; g.fillText(u.c, -sp, 0); }
      const Gpx = v.glyphPx * f.px * up.um;
      const gk2 = M.glow > 0 && !trail ? (1 - up.uq) ** 2 * ws.gk : 0;
      if (gk2 > 0.01) { g.fillStyle = glowC; g.globalAlpha = A * up.ua * gk2; blurGlyph(g, u.c, glowB * 0.5, Gpx); }
      const shK = trail ? 0 : (M.shadow ?? 0);
      if (shK > 0.01) { const mt = g.getTransform(), det = mt.a * mt.d - mt.b * mt.c || 1, near = clamp(p.kp, 0.6, 1.6), off = Gpx * 0.045 * near * shK, sx = off * 0.35, sy = off;
        g.save(); g.translate((mt.d * sx - mt.c * sy) / det, (-mt.b * sx + mt.a * sy) / det);
        g.fillStyle = rgba(mix(pal.bg, [0, 0, 0], 0.75), 1); g.globalAlpha = A * up.ua * Math.min(0.85, 0.55 * shK) * (1 - up.uq * 0.6); blurGlyph(g, u.c, Math.max(1, Gpx * 0.05 * near * (0.6 + shK * 0.4) + bpx * 0.6), Gpx); g.restore(); }
      g.fillStyle = inkC; drawFocus(g, u.c, bpx, Gpx, A * up.ua);
      g.restore();
    }
  }
  g.restore();
}
