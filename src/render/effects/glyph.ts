// Glyph contours: one character of the current line, traced as vector outline rings, huge behind it.
import { clamp, sstep, D2R } from '../../core/math';
import { eSine } from '../../core/ease';
import { rnd } from '../../core/rng';
import { mix, rgba } from '../../core/color';
import { register } from './registry';
import type { RenderFrame } from '../frame';
import { makeCanvas } from '../palette';
import { project, NO_FX, FOCAL } from '../../director/project';
import { basePose } from '../../director/camera';
import { fontStack } from '../../text/fonts';
import { graphemes, isLatin } from '../../text/script';
import type { PLine } from '../../director/types';
import { gfx, cheapBlurDraw } from '../gfx';
import { C2 } from './sprite';

/* ---------- glyph contours: one character of the current line, traced as vector outline rings, huge behind it ---------- */
const KEYCH = new WeakMap<PLine, string | null>();
/** Make ahead the panes a song's glyph slots will show (each is costly the first time: its mask, small mask and rim), one
 *  per call; returns whether there is more to do. */
export function glyphPaneWarm(f: Pick<RenderFrame, 'plan' | 'style'>) {
  const fc = fontStack(f.style.font), todo = f.style.fx.glyph ? [...new Set(f.plan.cues.glyphSlots.map(sl => keyChar(sl.line)).filter(Boolean) as string[])] : [];
  let i = 0; return () => { while (i < todo.length) { const ch = todo[i]; if (!glyphPane(ch, fc.w, fc.stack)) return true; i++; return i < todo.length; } return false; };
}
function keyChar(P: PLine) {
  if (KEYCH.has(P)) return KEYCH.get(P)!; let best: any = null; for (const S of P.words) if (!best || S.lw * S.lh > best.lw * best.lh) best = S;
  const cands = best ? graphemes(best.w.text).filter((ch: string) => !/[\p{P}\p{S}\s]/u.test(ch)) : [];
  const c = cands.length ? (isLatin(cands[0]) ? cands[0].toUpperCase() : cands[Math.floor(rnd(P.i * 3.3) * Math.min(cands.length, 3))]) : null; KEYCH.set(P, c); return c;
}
/* The glyph as frosted glass: a pane in the character's shape a good way behind the words (so it slides against both
   the words and the backdrop as the camera moves). Inside it, what is behind is seen blurred and a little lifted, as
   through ground glass; its edge catches the light in a fine rim. The pane is made where it stands each frame (the
   picture under it, a quarter of the size, blurred) — small work, however large the glyph. */
const GLY = new Map<string, { mask: HTMLCanvasElement | OffscreenCanvas; small: HTMLCanvasElement | OffscreenCanvas; rim: HTMLCanvasElement | OffscreenCanvas; S: number }>();
function glyphPane(ch: string, w: number, stack: string) {
  const key = ch + '|' + w + stack; let e = GLY.get(key); if (e) return e;
  const R = 720, font = `${w} ${R}px ${stack}`;
  // (drawn only once the face is really there: a fallback face must not be kept, nor redrawn every frame meanwhile)
  if (typeof document !== 'undefined' && document.fonts && !document.fonts.check(font, ch)) { document.fonts.load(font, ch).catch(() => {}); return null; }
  const S = Math.round(R * 1.6), mk = (draw: (g: CanvasRenderingContext2D) => void) => { const c = makeCanvas(S, S); const g = C2(c) as CanvasRenderingContext2D; g.translate(S / 2, S / 2);
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; draw(g); return c; };
  const mask = mk(g => { g.fillStyle = '#fff'; g.fillText(ch, 0, 0); });
  // its edge traced round the character's silhouette (the filled shape grown by a few pixels, the shape itself taken
  // out): one clean outline of the whole character, never the overlapping contours of its strokes; and a soft glow of
  // the same, wider
  // (made cheaply, once, ahead of time — see glyphPaneWarm: eight offsets for the fine line, and the soft glow as the
  // shape blurred once with the shape taken out, all on one canvas)
  const rim = makeCanvas(S, S); { const g = C2(rim) as CanvasRenderingContext2D, wd = R * 0.005;
    g.globalAlpha = 0.45; g.filter = `blur(${(R * 0.01).toFixed(1)}px)`; g.drawImage(mask as CanvasImageSource, 0, 0); g.filter = 'none'; g.globalAlpha = 1;
    for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; g.drawImage(mask as CanvasImageSource, Math.cos(a) * wd, Math.sin(a) * wd); }
    g.globalCompositeOperation = 'destination-out'; g.drawImage(mask as CanvasImageSource, 0, 0); g.globalCompositeOperation = 'source-over'; }
  // (the mask also small: the pane is worked at a couple of hundred pixels, and cutting it with the full mask read a
  // million pixels a frame)
  const small = makeCanvas(256, 256); { const sg = C2(small); sg.imageSmoothingQuality = 'high'; sg.drawImage(mask as CanvasImageSource, 0, 0, 256, 256); }
  e = { mask, small, rim, S: S / R }; GLY.set(key, e); if (GLY.size > 24) GLY.delete(GLY.keys().next().value!); return e;
}
const PANE = [makeCanvas(8, 8) as HTMLCanvasElement, makeCanvas(8, 8) as HTMLCanvasElement];
/** Where a glyph pane stands: the place among a few (either side, the four corners' insides) that the words of its
 *  passage cross least while it shows — the planned camera sampled over its time, every line seen meanwhile — taken
 *  at its first moment and set there in the scene, far behind the words (so the camera's moves carry it, slower than
 *  the words: it is in the world, not stuck on the lens). */
const SPOT = new WeakMap<object, { X: number; Y: number; D: number; k: number; rot: number }>();
const SPOTS = [[-0.3, 0], [0.3, 0], [-0.26, -0.2], [0.26, -0.2], [-0.26, 0.2], [0.26, 0.2]];
/** How far behind the camera's focus the pane stands (its parallax: about 0.4 of the focus plane's). */
const PANE_DEPTH = FOCAL * 1.5;
function glyphSpot(sl: RenderFrame['plan']['cues']['glyphSlots'][number], f: RenderFrame) {
  let o = SPOT.get(sl); if (o) return o;
  const W = f.W, H = f.H, plan = f.plan, t1 = Math.min(sl.end, sl.t + 8), score = SPOTS.map(() => 0), rad = H * 0.42;
  for (let ts = sl.t; ts <= t1; ts += 0.5) { const b = basePose(plan.camera, ts), cam = { x: b.x, y: b.y, z: b.z, r: b.r, d: b.d, yaw: 0, pitch: 0 };
    for (const P of plan.lines) { if (P.sec !== sl.line.sec || P.L.t > ts + 0.5 || P.L.end < ts) continue;
      for (const S of P.words) { const p = project(S.x, S.y, S.d, cam, NO_FX, W, H), wr = Math.hypot(S.lw, S.lh) * 0.5 * p.k;
        SPOTS.forEach(([sx, sy], i) => { const d = Math.hypot(p.sx - sx * W, p.sy - sy * H); score[i] += Math.max(0, rad + wr - d); }); } } }
  let bi = sl.side ? 1 : 0; score.forEach((v, i) => { if (v < score[bi] - 1e-6) bi = i; });
  // (the screen place, back into the world at the pane's depth, as the backdrop's camera stands now — the camera that
  // skips the cuts, as the rest of the backdrop does: a pane up across a transition never jumps at its blur's peak)
  const b = f.cam.cont, D = b.d + PANE_DEPTH, kp = FOCAL / (FOCAL + PANE_DEPTH), m = kp * b.z;
  const qx = SPOTS[bi][0] * W, qy = SPOTS[bi][1] * H, c = Math.cos(b.r * D2R), sn = Math.sin(b.r * D2R);
  o = { X: b.x + (qx * c - qy * sn) / m, Y: b.y + (qx * sn + qy * c) / m, D, k: m, rot: -b.r }; SPOT.set(sl, o); return o;
}
// (deep in the backdrop: behind its roses, its cover, its record — over a song's video when one is up)
register({ id: 'glyph', label: 'fx.glyph', layer: 'backdrop', kind: 'effect', z: 0, deep: true, params: [{ key: 'contrast', label: 'p.contrast', kind: 'range', min: 0.05, max: 1, step: 0.05, def: 0.2 }, { key: 'freq', label: 'p.freq', kind: 'range', min: 0.25, max: 1.75, step: 0.05, def: 1 }],   // (freq: how often a pane comes — read by the cues, director/cues.ts)
  draw(g, f, a) {
    const t = f.t, ov = f.cam.ov, k0 = +a.params.contrast, fc = fontStack(f.style.font), TR_IN = 0.4, tr = (g as CanvasRenderingContext2D).getTransform(), px = tr.a, cv = g.canvas as HTMLCanvasElement;
    const veil = f.pal.dark ? mix([255, 255, 255], f.pal.accent, 0.25) : mix(f.pal.bg, [255, 255, 255], 0.6);
    for (const sl of f.plan.cues.glyphSlots) {
      if (t < sl.t - 0.2 || t > sl.end + 1.8) continue; const P = sl.line, ch = keyChar(P); if (!ch) continue;
      const fin = eSine(clamp((t - sl.t + 0.2) / 1.8)), fout = sl.cut ? 1 - sstep(clamp((t - (sl.end - TR_IN)) / TR_IN)) : 1 - eSine(clamp((t - sl.end + 0.2) / 1.8));
      const al = Math.min(1, fin * fout * (1 - ov) * f.view.effect * k0); if (al < 0.01) continue;
      // where the words are not (a large shape filling the empty part of the picture, most of a frame high), far back in
      // the scene: the camera's moves, turns and zooms carry it as they do anything that far off (less than the words).
      // There it floats on its own, as a pane of glass adrift in water would: it travels slowly across its place over its
      // whole time (each its own way), bobs and sways on a few slow waves that never line up, breathes, and turns a
      // little in depth (narrowing as it turns) — on the song's own time, not the beat
      const tt = f.t, sp = glyphSpot(sl, f), pj = project(sp.X, sp.Y, sp.D, f.cam.cont, f.cam.fx, f.W, f.H), zk = clamp(pj.k / sp.k, 0.6, 1.8);
      const at = { x: pj.sx, y: pj.sy }, ph = P.i * 1.37, life = Math.max(2, sl.end + 1.8 - (sl.t - 0.2)), u = clamp((t - sl.t + 0.2) / life) - 0.5, da = rnd(P.i * 5.3) * 6.283;
      const br = 1 + 0.03 * Math.sin(tt * 0.47 + ph) + 0.015 * Math.sin(tt * 0.83 + ph * 1.9), size = f.H * 0.95 * (0.96 + 0.04 * fin) * br * zk;
      const ly = glyphPane(ch, fc.w, fc.stack); if (!ly) continue;
      const rot = ((pj.rot - sp.rot) + (rnd(P.i * 2.3) - 0.5) * 12 + u * 7 * (rnd(P.i * 1.1) < 0.5 ? -1 : 1) + Math.sin(tt * 0.37 + ph) * 3.5 + Math.sin(tt * 0.71 + ph * 2.1) * 1.3) * D2R;
      const yaw = 1 - 0.07 * (0.5 + 0.5 * Math.sin(tt * 0.29 + ph * 1.3)), pitch = 1 - 0.035 * (0.5 + 0.5 * Math.sin(tt * 0.41 + ph * 0.7));
      const cx = f.W / 2 + at.x + Math.cos(da) * u * 0.09 * f.W * zk + (Math.sin(tt * 0.43 + ph) * 0.02 + Math.sin(tt * 0.79 + ph * 1.7) * 0.008) * f.W,
        cy = f.H / 2 + at.y + Math.sin(da) * u * 0.07 * f.H * zk + (Math.sin(tt * 0.53 + ph * 0.8) * 0.026 + Math.sin(tt * 0.97 + ph * 2.3) * 0.01) * f.H, w = size * ly.S, half = w * 0.72;
      // the picture under the pane, small, blurred, lifted, cut to the glyph
      // (worked small: a quarter of its size on screen, never over 160 px — it is blurred, so nothing is lost, and a large
      // pane up close no longer costs a large blur)
      const q = 0.25, sw = Math.max(8, Math.min(160, Math.ceil(half * 2 * px * q))), [A, B] = PANE; for (const c of PANE) if (c.width !== sw || c.height !== sw) { c.width = sw; c.height = sw; }
      const ax = C2(A), bx = C2(B), dx = (cx - half) * px + tr.e, dy = (cy - half) * px + tr.f, ds = half * 2 * px;
      ax.setTransform(1, 0, 0, 1, 0, 0); ax.globalCompositeOperation = 'copy'; ax.filter = 'none';
      // (only the part of the picture that is really there: a pane reaching past the frame reads no more than the frame)
      { const x0 = Math.max(0, dx), y0 = Math.max(0, dy), x1 = Math.min(cv.width, dx + ds), y1 = Math.min(cv.height, dy + ds), k = sw / ds;
        if (x1 - x0 < 1 || y1 - y0 < 1) continue; ax.clearRect(0, 0, sw, sw); ax.globalCompositeOperation = 'source-over'; ax.drawImage(cv, x0, y0, x1 - x0, y1 - y0, (x0 - dx) * k, (y0 - dy) * k, (x1 - x0) * k, (y1 - y0) * k); }
      bx.setTransform(1, 0, 0, 1, 0, 0); bx.globalCompositeOperation = 'copy';
      if (gfx() === 'optimized') { bx.clearRect(0, 0, sw, sw); bx.globalCompositeOperation = 'source-over'; cheapBlurDraw(bx, A, sw, sw, Math.max(2, sw * 0.022), 0, 0, sw, sw); bx.globalAlpha = 1; }
      else { bx.filter = `blur(${Math.max(2, sw * 0.022).toFixed(1)}px)`; bx.drawImage(A, 0, 0); bx.filter = 'none'; }
      bx.globalCompositeOperation = 'source-over'; bx.fillStyle = rgba(veil, f.pal.dark ? 0.1 : 0.22); bx.fillRect(0, 0, sw, sw);
      bx.globalCompositeOperation = 'destination-in'; bx.translate(sw / 2, sw / 2); bx.rotate(rot); const mw = w / (half * 2) * sw; bx.drawImage((mw <= 400 ? ly.small : ly.mask) as CanvasImageSource, -mw / 2, -mw / 2, mw, mw);
      g.save(); g.translate(cx, cy); g.scale(yaw, pitch); g.globalAlpha = al * 0.92; g.drawImage(B, -half, -half, half * 2, half * 2);
      // its edge: a fine rim of light (with its own soft glow: the glass has thickness)
      g.rotate(rot); g.globalCompositeOperation = f.pal.dark ? 'screen' : 'source-over';
      g.globalAlpha = al * (f.pal.dark ? 0.3 : 0.22); g.drawImage(ly.rim as CanvasImageSource, -w / 2, -w / 2, w, w);
      g.restore();
    } } });
