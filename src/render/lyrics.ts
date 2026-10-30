/* The lyrics. Every word is drawn in the plan's fixed order (back to front, set when the song was planned: overlapping
   words can never swap places from one frame to the next), placed by the one projection, culled by its full projected
   bounds, and every layer of a unit (ghost, outline, halo, shadow, colour split, glyph) is drawn from the unit's single
   rest pose. */
import { clamp, D2R } from '../core/math';
import { mix, rgba } from '../core/color';
import { rnd } from '../core/rng';
import { project, onScreen, type Projected } from '../director/project';
import { entryK } from '../director/entry';
import { carryCam } from '../director/evaluate';
import { wordState, unitPose, TIN_SPEC, type WordCtx, type WordState } from '../director/words';
import type { PWord } from '../director/types';
import { fontStack } from '../text/fonts';
import { EM } from '../text/metrics';
import { blurGlyph, drawFocus, focusW, sharpGlyph, strokeGlyph, type InkGrad } from './glyphs';
import type { RenderFrame } from './frame';
import type { Ctx } from './effects/registry';
import { gfx } from './gfx';

/** Culling can be switched off to prove it never removes anything visible (render tests). */
let CULL = true; export const setCulling = (on: boolean) => { CULL = on; };
export interface VisWord { S: PWord; ws: WordState; p: Projected; o: number; glyphPx: number }
export function wordCtx(f: RenderFrame): WordCtx {
  const M = f.style.m, bl = f.plan.map.beatLen(f.t);
  return { enter: Math.max(0.05, M.enter), tempo: Math.sqrt(clamp(bl / 0.5, 0.5, 2)), float: (M.float ?? 0) * f.motion, future: f.style.future, smooth: f.style.cut !== 'punch', punch: M.punch, motion: f.motion, drift: f.style.tout === 'drift', solo: f.style.cut === 'center' };
}
/** Which words are on screen this frame, and how. Read by the lyric pass and by world effects (frames, stars, glyphs). */
export function visibleWords(f: RenderFrame, card: boolean): VisWord[] {
  const out: VisWord[] = [], c = wordCtx(f), { cam, fx, ov } = f.cam, W = f.W, H = f.H, dmin = f.plan.dmin;
  for (const S of f.plan.drawOrder) {
    if (f.t < S.show && ov <= 0) continue;
    const ws = wordState(S, f.t, ov, card, c); if (!ws) continue;
    const ek = entryK(S, f.t), p = project(S.x + (ek ? S.entry!.dx * ek : 0), S.y + (ek ? S.entry!.dy * ek : 0), S.d, S.carry ? carryCam(f.plan, S, f.t, cam) : cam, fx, W, H), half = Math.hypot(S.lw, S.lh) * 0.5 * p.k * ws.sc + (Math.abs(ws.ox) + Math.abs(ws.oy)) * S.s * p.k + 60;
    if (CULL && !onScreen(p, half, W, H)) continue;
    const fog = clamp(1 - (S.d - dmin) / (1300 * 4), 0.55, 1), wa = f.wordAlpha ? f.wordAlpha(S.line.i, S.k) : 1;
    out.push({ S, ws, p, o: ws.o * fog * wa, glyphPx: EM * S.s * ws.sc * p.k });
  }
  return out;
}

/** What the lyric pass blurs (face, colours, glyphs), so the glyph ladder can be baked before the song needs it. */
export function lyricBake(f: Pick<RenderFrame, 'plan' | 'style' | 'pal'>) {
  const st = f.style, fc = fontStack(st.font, f.plan.doc.lines.map(L => L.text).join('').slice(0, 400)), pal = f.pal;
  const chars = [...new Set(f.plan.words.flatMap(S => S.units.map(u => u.c)))];
  const emChars = [...new Set(f.plan.words.filter(S => S.emph).flatMap(S => S.units.slice(S.emph![0], S.emph![1]).map(u => u.c)))];
  return { font: `${fc.w} ${EM}px ${fc.stack}`, cols: [shadowOf(pal), glowOf(st, pal), rgba(pal.flash, 1)], grad: inkGrad(pal.text, pal), chars, edge: rgba(mix(pal.bg, pal.text, 0.25), 1), ink: rgba(pal.text, 1),
    emph: { grad: emphGrad(pal), chars: emChars } };
}
/** The lit fill of the sharp glyphs (top, middle, bottom), shared with their blurred versions. */
export const inkGrad = (ink: RenderFrame['pal']['text'], pal: RenderFrame['pal']): InkGrad => [rgba(mix(ink, [255, 255, 255], 0.35), 1), rgba(ink, 1), rgba(mix(ink, pal.accent, 0.22), 0.92)];
/** The emphasised word's fill: the flash's colour, lit brighter at the top (a soft highlight across it). */
export const emphGrad = (pal: RenderFrame['pal']): InkGrad => [rgba(mix(pal.flash, [255, 255, 255], 0.55), 1), rgba(pal.flash, 1), rgba(mix(pal.flash, pal.accent, 0.3), 0.95)];
const shadowOf = (pal: RenderFrame['pal']) => rgba(mix(pal.bg, [0, 0, 0], 0.75), 1);
const glowOf = (st: RenderFrame['style'], pal: RenderFrame['pal']) => (st.bgStyle === 'cover' ? rgba(pal.bg, 0.9) : rgba(pal.accent, 0.85));
/** Draw the lyrics. trail: a faint copy offset along the camera's travel (motion trail). */
export function drawLyrics(g: Ctx, f: RenderFrame, vis: VisWord[], o: { ink: number[]; split: number; trail?: { k: number; dx: number; dy: number } }) {
  const st = f.style, M = st.m, pal = f.pal, c = wordCtx(f), ov = f.cam.ov, trail = o.trail, AK = trail ? trail.k : 1, view = f.view.effect;
  const fc = fontStack(st.font, f.plan.doc.lines.map(L => L.text).join('').slice(0, 400));
  const font = `${fc.w} ${EM}px ${fc.stack}`;
  const g1 = rgba(pal.accent, 1), g2 = rgba(pal.flash, 1), inkC = rgba(o.ink as any, 1);
  const glowC = glowOf(st, pal), glowB = M.glow * 26 * f.px;
  const lean = clamp((M.depth ?? 1) * 0.6, 0, 1.4) * f.motion;
  const sk = f.cam.fx.sk && (Math.abs(f.cam.fx.sk[0]) + Math.abs(f.cam.fx.sk[1]) > 1e-4) ? f.cam.fx.sk : null, JT = (M.jitter ?? 0) * f.motion * (f.cam.hold ?? 1), pulse = f.rs.pulse, fr = Math.floor(f.t * 12), lite = gfx() === 'lite', blurOn = ov <= 0 && f.motion > 0.5 && !lite;
  // the finish of a sharp glyph: lit from above (a soft gradient from the ink to a touch of the theme's light below, so the
  // type reads as translucent light rather than flat paint), a thin edge of thickness that leans against the camera's turn
  // (the plane of the words has depth), and a soft two-layer shadow (a contact shadow and a wide ambient one)
  const grad = inkGrad(o.ink as any, pal), inkG = g.createLinearGradient(0, -EM * 0.55, 0, EM * 0.6);
  inkG.addColorStop(0, grad[0]); inkG.addColorStop(0.55, grad[1]); inkG.addColorStop(1, grad[2]);
  const edgeC = rgba(mix(pal.bg, o.ink as any, 0.25), 1), yaw = f.cam.cam.yaw ?? 0, pitch = f.cam.cam.pitch ?? 0;
  const ex = clamp(0.35 - yaw * 0.12, -0.6, 0.9), ey = clamp(1 - pitch * 0.12, 0.4, 1.4);
  const shadowC = shadowOf(pal);
  // the emphasised words: the flash's colour with its own lit fill, and a faint glow of it round them (on a dark scene)
  const eGrad = emphGrad(pal), eG = g.createLinearGradient(0, -EM * 0.55, 0, EM * 0.6), eC = rgba(pal.flash, 1), eGlow = rgba(mix(pal.flash, [255, 255, 255], 0.2), 1);
  eG.addColorStop(0, eGrad[0]); eG.addColorStop(0.5, eGrad[1]); eG.addColorStop(1, eGrad[2]);
  g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = font;
  for (const v of vis) {
    const { S, ws, p } = v, n = S.units.length, spec = TIN_SPEC[ws.tin] || TIN_SPEC.blur, blurMax = Math.min(32, v.glyphPx * spec.blur);
    const A = v.o * AK * view; if (A < 0.003) continue;
    const k = S.s * ws.sc * p.k;
    g.setTransform(f.px, 0, 0, f.px, 0, 0); g.translate(f.W / 2 + p.sx + (trail?.dx ?? 0), f.H / 2 + p.sy + (trail?.dy ?? 0)); if (sk) g.transform(1, sk[0], sk[1], 1, 0, 0);
    g.rotate((S.tilt + p.rot + ws.frot) * D2R);
    // the line's plane leans in depth: turned a little about its upright (the far end foreshortened and drawn in) and
    // tipped back or forward, as much as the depth setting asks, with a slow breath — the words sit in space, not on glass
    if (lean > 0.01) { const sd = S.line.i * 7.31 + 1.7, yaw = ((rnd(sd) - 0.5) * 2 * 20 + Math.sin(f.t * 0.37 + sd) * 3) * lean * D2R, pitch = ((rnd(sd + 3.1) - 0.5) * 2 * 14 + Math.cos(f.t * 0.29 + sd) * 2.5) * lean * D2R;
      g.transform(Math.cos(yaw), Math.sin(yaw) * 0.22, Math.sin(pitch) * 0.22, Math.cos(pitch), 0, 0); }
    g.scale(k, k); g.translate(ws.ox, ws.oy);
    const sp0 = !trail ? o.split * ws.gk / Math.max(1e-3, k) : 0;
    for (let ui = 0; ui < n; ui++) {
      const u = S.units[ui], up = unitPose(S, ui, f.t, ws, ov, c, !!trail); if (!up) continue;
      let jx = 0, jy = 0; if (JT > 0 && ws.live) { jx = (rnd(fr * 13 + ui * 7 + S.k) - 0.5) * JT * pulse * 22; jy = (rnd(fr * 7 + ui * 3 + S.k) - 0.5) * JT * pulse * 14; }
      // ghost of an unsung unit, and the outline that marks a unit just sung: both at the unit's rest pose
      // (an unsung ghost comes in with the word's own entrance — it rises, focuses or drifts in with it — never pops up)
      if (up.ghost || up.outline > 0) {
        g.save(); g.translate(up.rx + (up.ghost ? up.dx : 0), up.ry + (up.ghost ? up.dy : 0)); if (up.ghost && up.ur) g.rotate(up.ur * D2R); if (up.ghost && up.um !== 1) g.scale(up.um, up.um); if (u.rot) g.rotate(Math.PI / 2);
        g.globalAlpha = A * (up.ghost ? 0.4 * up.ua : up.outline); g.strokeStyle = inkC; strokeGlyph(g, u.c, v.glyphPx * f.px * (up.ghost ? up.um : 1), 2.4); g.restore();
        if (up.ghost) continue;
      }
      const bpx = blurOn ? blurMax * up.uq * f.px : 0, blurred = bpx > 0.4;
      if (trail && blurred) continue;
      g.save(); g.translate(up.rx + up.dx + jx, up.ry + up.dy + jy); if (up.ur) g.rotate(up.ur * D2R); if (up.um !== 1) g.scale(up.um, up.um); if (u.rot) g.rotate(Math.PI / 2);
      const sp = sp0 * focusW(bpx);
      const Gpx = v.glyphPx * f.px * up.um;
      if (sp > 0.4) { g.fillStyle = g1; g.globalAlpha = A * up.ua * 0.35; sharpGlyph(g, u.c, Gpx, null, sp, 0); g.fillStyle = g2; g.globalAlpha = A * up.ua * 0.25; sharpGlyph(g, u.c, Gpx, null, -sp, 0); }
      const gk2 = M.glow > 0 && !trail && !lite ? (1 - up.uq) ** 2 * ws.gk : 0;
      if (gk2 > 0.01) { g.fillStyle = glowC; g.globalAlpha = A * up.ua * gk2; blurGlyph(g, u.c, glowB * 0.5, Gpx); }
      const shK = trail || lite ? 0 : Math.max(0.35, M.shadow ?? 0), mt = g.getTransform(), det = mt.a * mt.d - mt.b * mt.c || 1;
      const toLocal = (sx: number, sy: number): [number, number] => [(mt.d * sx - mt.c * sy) / det, (-mt.b * sx + mt.a * sy) / det];   // a device-px offset in glyph space
      if (shK > 0.01) { const near = clamp(p.kp, 0.6, 1.6), sa = A * up.ua * (1 - up.uq * 0.35);
        // the wide ambient shadow (further down, very soft), then the contact shadow close under the glyph
        { const off = Gpx * 0.07 * near * shK, [lx, ly] = toLocal(off * 0.3, off); g.save(); g.translate(lx, ly); g.fillStyle = shadowC;
          g.globalAlpha = sa * Math.min(0.5, 0.3 * shK); blurGlyph(g, u.c, Math.max(2, Gpx * 0.11 * near + bpx * 0.8), Gpx); g.restore(); }
        { const off = Gpx * 0.025 * near * shK, [lx, ly] = toLocal(off * 0.35, off); g.save(); g.translate(lx, ly); g.fillStyle = shadowC;
          g.globalAlpha = sa * Math.min(0.85, 0.5 * shK); blurGlyph(g, u.c, Math.max(1, Gpx * 0.03 * near + bpx * 0.6), Gpx); g.restore(); } }
      // the edge of thickness: a few close copies stepping back from the face, only while the glyph is sharp
      // (it is there from the first frame of the entrance, growing as the glyph comes into focus, never popping in after)
      const eK = trail ? 0 : clamp(1 - bpx / 6) * clamp(Gpx / 14 - 0.5) * view;
      if (eK > 0.02) { const step = Math.min(1.1, Gpx * 0.011), nE = Gpx > 40 ? 3 : 2; g.fillStyle = edgeC;
        for (let e = nE; e >= 1; e--) { const [lx, ly] = toLocal(ex * step * e, ey * step * e); g.globalAlpha = A * up.ua * 0.55 * eK * (1 - (e - 1) / (nE + 1)); sharpGlyph(g, u.c, Gpx, null, lx, ly); } }
      const em = !!S.emph && ui >= S.emph[0] && ui < S.emph[1];
      if (em && !trail && pal.dark && !lite) { g.save(); g.fillStyle = eGlow; g.globalAlpha = A * up.ua * 0.22 * (1 - up.uq * 0.6); blurGlyph(g, u.c, Math.max(3, Gpx * 0.09), Gpx); g.restore(); }
      g.fillStyle = em ? eC : inkC; drawFocus(g, u.c, bpx, Gpx, A * up.ua, trail ? null : em ? eG : inkG, trail ? null : em ? eGrad : grad);   // (blurred, the same light: no change on focusing)
      g.restore();
    }
    if (S.harm && !trail) drawHarmony(g, S, f.t, A, fc, inkC, shadowC, c.future);
  }
  g.restore();
}
const HARM = 0.52;   // a harmony's size against its word
/** A harmony: small, at the word's lower right (the word upper left, the harmony lower right, sung together), in the
 *  word's own frame — it turns, leans and enters with it. It comes in at its own moment (a faint ghost before, as the
 *  words do), lifting a little into place. One line of text: cheap. */
function drawHarmony(g: Ctx, S: PWord, t: number, A: number, fc: { w: number | string; stack: string }, ink: string, shadow: string, future: 'dim' | 'hide') {
  const H = S.harm!, u = (t - H.t) / 0.35, on = u >= 0, k = on ? 1 - (1 - Math.min(1, u)) ** 3 : 0;
  const al = A * (on ? 0.35 + 0.55 * k : future === 'hide' ? 0 : 0.28); if (al < 0.01) return;
  const hw = H.w0 * HARM, hh = H.h0 * HARM, x = S.w0 / 2 * 0.55 + hw / 2, y = S.h0 / 2 + hh * 0.3 + (1 - k) * hh * 0.35;
  g.save(); g.font = `${fc.w} ${EM * HARM}px ${fc.stack}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.globalAlpha = al * 0.45; g.fillStyle = shadow; g.fillText(H.text, x + hh * 0.04, y + hh * 0.08);
  g.globalAlpha = al; g.fillStyle = ink; g.fillText(H.text, x, y); g.restore();
}
