// Lyric frames: an outline traced round part of a line, with corner ticks, following the words as they are drawn.
import { clamp, D2R, angDiff } from '../../core/math';
import { eOut, eIO } from '../../core/ease';
import { rgba } from '../../core/color';
import { register } from './registry';
import { project } from '../../director/project';
import { boxIn } from '../../director/layout';
import { wordPlacement } from '../../director/words';

/* ---------- lyric frames: an outline traced round part of a line, with corner ticks, following the words' depth ---------- */
register({ id: 'frame', label: 'fx.frame', layer: 'world-back', kind: 'effect', z: 2, draw(g, f) {
  // a frame encloses all its words, on screen or not (its shape must not depend on what the culling keeps)
  const vis = f.vis || [], byS = new Map(vis.map(v => [v.S, v])), t = f.t, ink = f.ink;
  const seen = new Set<any>();
  for (const v0 of vis) { const F = v0.S.frame; if (!F || seen.has(F) || t < F.ts) continue; seen.add(F);
    const o = Math.max(...F.words.map(S => byS.get(S)?.o ?? 0)) * f.view.effect; if (o < 0.02) continue;
    // each word as it is drawn now (its float, its own turn, its size: lyrics.ts), not at its rest pose — a tilted or
    // floating word stays inside; the words' leaning in depth is not followed exactly, a margin holds it
    const boxes = F.words.map(S => { const v = byS.get(S), p = v ? v.p : project(S.x, S.y, S.d, f.cam.cam, f.cam.fx, f.W, f.H), w = wordPlacement(S, p, v?.ws);
      return { x: w.x, y: w.y, lw: S.lw * w.sc * p.k, lh: S.lh * w.sc * p.k, tilt: w.ang }; });
    const vv = [{ S: F.words[0], p: byS.get(F.words[0])?.p ?? project(F.words[0].x, F.words[0].y, F.words[0].d, f.cam.cam, f.cam.fx, f.W, f.H) }], L = vv[0].S.line;
    // its angle: mostly the words' own, leaning a little back to the line's — close to them, never glued to them
    const wa = Math.atan2(boxes.reduce((s, b) => s + Math.sin(b.tilt * D2R), 0), boxes.reduce((s, b) => s + Math.cos(b.tilt * D2R), 0)) / D2R, la = L.prot + vv[0].p.rot;
    const fa = la + angDiff(wa, la) * 0.8, B = boxIn(boxes, fa), cs = Math.min(...boxes.map(b => Math.min(b.lw, b.lh)));
    const padd = cs * 0.15 + Math.max(B.w, B.h) * 0.03, w = B.w + padd * 2, h = B.h + padd * 2, per = 2 * (w + h);
    const dt = t - F.ts, p = eOut(clamp(dt / 0.85)), tEnd = Math.min(L.L.end - 0.8, F.until ?? Infinity), q = 1 - eIO(clamp((t - tEnd) / 0.8)), vis1 = p * q; if (vis1 <= 0.002) continue;
    const fl = Math.sin(t * 0.9 + L.i) * 0.5, s1 = 1 + 0.012 * Math.sin(t * 1.3 + L.i * 2);
    g.save(); g.translate(f.W / 2 + B.x + Math.sin(t * 0.7 + L.i) * padd * 0.08, f.H / 2 + B.y + Math.cos(t * 0.6 + L.i) * padd * 0.08); g.rotate((fa + fl) * D2R); g.scale(s1, s1);
    g.strokeStyle = rgba(ink, 1); g.fillStyle = rgba(ink, 1); g.globalAlpha = o * 0.7; g.lineWidth = 1.6; g.lineJoin = 'miter'; g.lineCap = 'butt';
    const sx = F.corner ? 1 : -1, x0 = -w / 2 * sx, y0 = -h / 2, len = per / 2 * vis1;
    g.setLineDash([len, per]); g.beginPath(); g.moveTo(x0, y0); g.lineTo(-x0, y0); g.lineTo(-x0, -y0); g.lineTo(x0, -y0); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, -y0); g.lineTo(-x0, -y0); g.lineTo(-x0, y0); g.closePath(); g.stroke(); g.setLineDash([]);
    const e = padd * 1.2 * eOut(clamp((dt - 0.6) / 0.5)) * q;
    if (e > 0.5) { g.beginPath(); g.moveTo(x0 - e * sx, y0); g.lineTo(x0, y0); g.lineTo(x0, y0 - e); g.moveTo(-x0 + e * sx, -y0); g.lineTo(-x0, -y0); g.lineTo(-x0, -y0 + e); g.stroke(); }
    const rt = (dt - 0.85) / 1.3;
    if (rt > 0 && rt < 1 && q > 0.99) { const d = eIO(rt) * per, sq = Math.max(3, padd * 0.12), pts = [[x0, y0], [-x0, y0], [-x0, -y0], [x0, -y0], [x0, y0]], segL = [w, h, w, h]; let rem = d, k = 0; while (k < 3 && rem > segL[k]) { rem -= segL[k]; k++; }
      const fr = Math.min(1, rem / segL[k]), x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * fr, y = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * fr; g.globalAlpha = o * 0.9 * Math.sin(Math.PI * rt); g.fillRect(x - sq / 2, y - sq / 2, sq, sq); }
    g.restore(); } } });
