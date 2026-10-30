// Shattered glass: cracks on the backdrop, shards carrying the finished frame.
import { clamp, sstep } from '../../core/math';
import { rnd } from '../../core/rng';
import { mix, rgba, K3 } from '../../core/color';
import { register, type Ctx } from './registry';
import type { RenderFrame } from '../frame';
import { makeCanvas } from '../palette';
import { gfx } from '../gfx';
import { C2 } from './sprite';

/* ---------- shattered glass: cracks on the backdrop, shards carrying the finished frame ---------- */
type Glass = RenderFrame['plan']['cues']['glass'][number];
const GEO = new Map<number, any>();
function glassGeom(ev: Glass) {
  let geo = GEO.get(ev.seed); if (geo) return geo;
  let sd = ev.seed; const R = () => rnd(sd += 1.37);
  const n = 5 + Math.floor(R() * 3), angs: number[] = []; let a = R() * 6.283;
  for (let i = 0; i < n; i++) { angs.push(a); a += 6.283 / n * (0.45 + R() * 1.1); }
  const sc = 6.283 / (a - angs[0]); for (let i = 0; i < n; i++) angs[i] = angs[0] + (angs[i] - angs[0]) * sc;
  const rays = angs.map(a0 => { const len = 0.75 + R() * 0.45, pts: number[][] = []; let aa = a0; for (let r = 0; r <= len + 1e-6; r += 0.045 + R() * 0.05) { aa += (R() - 0.5) * 0.16 * (0.4 + r); pts.push([Math.cos(aa) * r, Math.sin(aa) * r, r]); } return { len, pts }; });
  const at = (ray: any, r: number) => { const p = ray.pts; if (r >= p[p.length - 1][2]) return p[p.length - 1]; for (let k = 1; k < p.length; k++) if (p[k][2] >= r) { const fr = (r - p[k - 1][2]) / ((p[k][2] - p[k - 1][2]) || 1); return [p[k - 1][0] + (p[k][0] - p[k - 1][0]) * fr, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * fr, r]; } return p[p.length - 1]; };
  const segs: any[] = [], shards: any[] = [], branches: any[] = [];
  for (let i = 0; i < n; i++) { const A = rays[i], B = rays[(i + 1) % n], top = Math.min(A.len, B.len) * 0.97, rings: number[][] = [];
    // (rings across each segment: most segments break into pieces that fly; the outermost ring keeps them inside the cracks)
    for (const b of [0.14, 0.3, 0.6]) { if (b > top - 0.05) break; if (b > 0.2 && R() < 0.25) continue; rings.push([b * (0.8 + R() * 0.4), b * (0.8 + R() * 0.4)]); }
    if (!rings.length && top > 0.25) rings.push([top * (0.7 + R() * 0.15), top * (0.7 + R() * 0.15)]);
    const bow: number[][] = []; for (const rr of rings) { const pA = at(A, rr[0]), pB = at(B, rr[1]), m = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2], rad = Math.hypot(m[0], m[1]) || 1, k = (R() - 0.35) * 0.12 * rad;
      const mid = [m[0] + m[0] / rad * k + (R() - 0.5) * 0.02, m[1] + m[1] / rad * k + (R() - 0.5) * 0.02]; bow.push(mid); segs.push([pA, mid, pB]); }
    // (from the very point of impact: the centre is glass too, its pieces the first to fly)
    const rs = [[0, 0], ...rings], mids = [null, ...bow];
    for (let q = 0; q < rs.length; q++) { const r0 = rs[q], r1 = q + 1 < rs.length ? rs[q + 1] : null; if (!r1) break; if (R() < 0.05) continue;
      const poly: number[][] = []; for (const p of A.pts) if (p[2] >= r0[0] && p[2] <= r1[0]) poly.push(p); poly.unshift(at(A, r0[0])); poly.push(at(A, r1[0])); if (mids[q + 1]) poly.push(mids[q + 1]!);
      const sideB: number[][] = []; for (const p of B.pts) if (p[2] >= r0[1] && p[2] <= r1[1]) sideB.push(p); sideB.unshift(at(B, r0[1])); sideB.push(at(B, r1[1])); for (let k = sideB.length - 1; k >= 0; k--) poly.push(sideB[k]); if (mids[q]) poly.push(mids[q]!);
      const cx = poly.reduce((u, p) => u + p[0], 0) / poly.length, cy = poly.reduce((u, p) => u + p[1], 0) / poly.length; const rr0 = Math.min(r0[0], r0[1]);
      // (only part of the pane breaks out: most pieces at the point of impact, fewer further out; the rest stay, cracked)
      shards.push({ poly, c: [cx, cy], r0: rr0, vr: (R() - 0.5) * 3, delay: R() * 0.3, fly: rr0 < 0.25 && R() < (rr0 < 0.05 ? 0.8 : 0.45) }); }
    if (R() >= 0.6) { const r = 0.15 + R() * (A.len - 0.2), p = at(A, r), dir = Math.atan2(p[1], p[0]) + (R() < 0.5 ? 1 : -1) * (0.4 + R() * 0.6), L = 0.05 + R() * 0.12; const pts = [[p[0], p[1]]]; let d = dir, x = p[0], y = p[1]; for (let k = 0; k < 3; k++) { d += (R() - 0.5) * 0.5; x += Math.cos(d) * L / 3; y += Math.sin(d) * L / 3; pts.push([x, y]); } branches.push({ r, pts }); } }
  const crush: number[][][] = []; for (let k = 0; k < 8; k++) { const a0 = R() * 6.283, r0 = R() * 0.05, L = 0.02 + R() * 0.05; crush.push([[Math.cos(a0) * r0, Math.sin(a0) * r0], [Math.cos(a0 + (R() - 0.5)) * (r0 + L), Math.sin(a0 + (R() - 0.5)) * (r0 + L)]]); }
  geo = { rays, segs, shards, branches, crush }; GEO.set(ev.seed, geo); if (GEO.size > 64) GEO.delete(GEO.keys().next().value!); return geo;
}
function crackPaths(g: Ctx, G: any, Rr: number, reach: number, fade: number, pass: number) {
  const LW = pass === 2 ? [5, 4, 3] : pass ? [0.8, 0.7, 0.5] : [1.6, 1.3, 1];
  for (const ray of G.rays) { g.globalAlpha = (pass ? 0.42 : 0.5) * fade; g.lineWidth = LW[0]; g.beginPath(); let st = false; for (const p of ray.pts) { if (p[2] > reach) break; st ? g.lineTo(p[0] * Rr, p[1] * Rr) : g.moveTo(p[0] * Rr, p[1] * Rr); st = true; } g.stroke(); }
  for (const sg of G.segs) { const r = Math.hypot(sg[0][0], sg[0][1]); if (r > reach * 0.95) continue; g.globalAlpha = (pass ? 0.35 : 0.42) * fade * clamp((reach * 0.95 - r) / 0.15); g.lineWidth = LW[1]; g.beginPath(); g.moveTo(sg[0][0] * Rr, sg[0][1] * Rr); g.quadraticCurveTo(sg[1][0] * Rr, sg[1][1] * Rr, sg[2][0] * Rr, sg[2][1] * Rr); g.stroke(); }
  g.globalAlpha = (pass ? 0.25 : 0.32) * fade; g.lineWidth = LW[2];
  for (const br of G.branches) { if (br.r > reach) continue; g.beginPath(); br.pts.forEach((p: number[], k: number) => (k ? g.lineTo(p[0] * Rr, p[1] * Rr) : g.moveTo(p[0] * Rr, p[1] * Rr))); g.stroke(); }
  g.beginPath(); for (const [p, q] of G.crush) { g.moveTo(p[0] * Rr, p[1] * Rr); g.lineTo(q[0] * Rr, q[1] * Rr); } g.stroke();
}
/** when a piece leaves: a few hundredths of a second after the blow, the ones nearest it first */
const burstAt = (sh: { r0: number; delay: number }) => 0.03 + sh.r0 * 0.07 + sh.delay * 0.12;
/** How far a piece that breaks out has gone (0 still there .. 1 gone), as the shards' own pass times it. Once gone it
 *  stays gone: the opening fades with the rest of the pane, it never closes up again (glass does not heal). */
const goneK = (sh: { r0: number; delay: number; fly: boolean }, dt: number, reach: number, fade: number) => { if (!sh.fly || sh.r0 > reach) return 0; const st = Math.max(0, dt - burstAt(sh)); return sstep(clamp(st / 0.25)) * fade; };
register({ id: 'glass', label: 'fx.glass', layer: 'backdrop', kind: 'effect', z: 40, draw(g, f) {
  const w = f.W, h = f.H, t = f.t, dark = f.pal.dark;
  for (const ev of f.plan.cues.glass) { const dt = t - ev.t; if (dt < 0 || dt > 2.2) continue;
    const G = glassGeom(ev), Rr = Math.hypot(w, h) * 0.5 * ev.size, cx = ev.x * w, cy = ev.y * h, grow = sstep(clamp(dt / 0.07)), fade = 1 - clamp((dt - 0.9) / 1.2), reach = grow * 1.2, hot = mix(mix(f.pal.text, f.pal.accent, 0.3), [255, 255, 255], 0.55), glow = mix(f.pal.accent, [255, 255, 255], 0.35);
    g.save(); g.translate(cx, cy); g.lineJoin = 'round'; g.lineCap = 'round';
    // the openings (pieces that have broken out): their cracks went with them — the cracks are drawn round them only,
    // so between two neighbours that both fell out no line is left, and at the edge of a piece that stays half the
    // crack remains on its side (its broken edge)
    const holes = new Path2D(); let nh = 0;
    for (const sh of G.shards) if (goneK(sh, dt, reach, 1) > 0.3) { nh++; sh.poly.forEach((p: number[], i: number) => (i ? holes.lineTo(p[0] * Rr, p[1] * Rr) : holes.moveTo(p[0] * Rr, p[1] * Rr))); holes.closePath(); }
    // (the clip only round the cracks, not four frames' worth)
    g.save(); if (nh) { const out = new Path2D(), E = Rr * 1.3; out.rect(-E, -E, E * 2, E * 2); out.addPath(holes); g.clip(out, 'evenodd'); }
    // (plain and additive blends only — no multiply or soft-light: on the GPU those read the picture back for every
    // stroke, which is what made the shatter drop frames)
    // the cracks as light, not as etched dark lines: a faint shade under each, a hairline of the theme's light on it and
    // a wide soft glow along it — fine, a little luminous, never heavy
    g.globalCompositeOperation = 'source-over'; g.strokeStyle = rgba(mix(f.pal.bg, K3, 0.75), 1); crackPaths(g, G, Rr, reach, fade * 0.3 * (ev.k ?? 1), 0);
    g.globalCompositeOperation = dark ? 'screen' : 'source-over'; g.strokeStyle = rgba(glow, 1); g.save(); g.lineWidth = 1; crackPaths(g, G, Rr, reach, Math.min(1, fade * (dark ? 0.35 : 0.18)), 2); g.restore();
    g.strokeStyle = rgba(hot, 1); g.save(); g.translate(-0.6, -0.6); crackPaths(g, G, Rr, reach, Math.min(1, fade * 1.1), 1); g.restore();
    g.restore();
    // the openings themselves, a shade darker (what was behind the glass)
    g.globalCompositeOperation = 'source-over'; g.fillStyle = g.strokeStyle = rgba(mix(f.pal.bg, K3, dark ? 0.35 : 0.22), 1); g.lineWidth = 1.6; g.lineJoin = 'round';
    // (one shape for all the openings, filled once: two neighbours' shared edge is never painted twice)
    { let kk = 0, n = 0; g.beginPath(); for (const sh of G.shards) { const k = goneK(sh, dt, reach, 1); if (k < 0.01) continue; kk += k; n++;
        sh.poly.forEach((p: number[], i: number) => (i ? g.lineTo(p[0] * Rr, p[1] * Rr) : g.moveTo(p[0] * Rr, p[1] * Rr))); g.closePath(); }
      if (n) { g.globalAlpha = kk / n * 0.5 * fade; g.fill('nonzero'); } }
    g.globalAlpha = 1;
    if (dt < 0.5) { const k = 1 - sstep(dt / 0.5), rr = Rr * 0.22, gr = g.createRadialGradient(0, 0, 0, 0, 0, rr); gr.addColorStop(0, rgba(hot, 0.55 * k)); gr.addColorStop(1, rgba(hot, 0));
      g.globalCompositeOperation = dark ? 'lighter' : 'source-over'; g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rr, 0, 6.283); g.fill();
      g.strokeStyle = rgba(hot, 0.85 * k); g.lineWidth = 1.4; g.beginPath(); const L = Rr * 0.3 * (0.6 + 0.4 * k); for (const a of [0.35, 0.35 + Math.PI / 2, 0.35 + Math.PI, 0.35 + Math.PI * 1.5]) { g.moveTo(0, 0); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); } g.stroke(); }
    if (dt < 0.7) { g.globalCompositeOperation = dark ? 'lighter' : 'source-over'; g.lineWidth = 2.2; const run = clamp(dt / 0.55) * 1.25, k = 1 - clamp((dt - 0.4) / 0.3);
      for (const ray of G.rays) { g.beginPath(); let st = false; for (const p of ray.pts) { if (p[2] < run - 0.14 || p[2] > run) continue; st ? g.lineTo(p[0] * Rr, p[1] * Rr) : g.moveTo(p[0] * Rr, p[1] * Rr); st = true; } g.strokeStyle = rgba(hot, 0.8 * k); g.stroke(); } }
    g.restore(); } } });
const GSNAP = makeCanvas(16, 16) as HTMLCanvasElement;

register({ id: 'glass-shards', label: 'fx.glass', layer: 'foreground', kind: 'effect', z: 0, draw(g, f) {
  if (!f.style.fx.glass) return; const t = f.t, act = f.plan.cues.glass.filter(ev => t >= ev.t && t - ev.t <= 2.2); if (!act.length) return;
  const w = f.W, h = f.H, cv = g.canvas as HTMLCanvasElement;
  const roll = f.cam.fx.r - f.cam.cont.r, zoom = f.cam.fx.z, Mbg = new DOMMatrix().translate(w / 2, h / 2).rotate(roll).scale(zoom).translate(-w / 2, -h / 2), inv = Mbg.inverse(), dark = f.pal.dark;
  // what each flying piece carries is only the picture where it was: the frame is copied for those places alone, and
  // each piece draws only its own part of it (a piece no longer reads the whole frame — the cost of the shatter)
  // (a large frame is copied at a little under its full size: the pieces are in flight, a hair of softness is not seen)
  const sk = Math.min(cv.width > 1600 ? 1600 / cv.width : 1, gfx() === 'optimized' ? 0.5 : 1), SW = Math.round(cv.width * sk), SH = Math.round(cv.height * sk); if (GSNAP.width !== SW || GSNAP.height !== SH) { GSNAP.width = SW; GSNAP.height = SH; }
  const kx = SW / w, ky = SH / h, BOX = new Map<any, number[]>(); let U = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ev of act) { const dt = t - ev.t, G = glassGeom(ev), Rr = Math.hypot(w, h) * 0.5 * ev.size, cx = ev.x * w, cy = ev.y * h, reach = sstep(clamp(dt / 0.07)) * 1.2;
    for (const sh of G.shards) { if (sh.r0 > reach || !sh.fly) continue; const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of sh.poly) { const q = Mbg.transformPoint({ x: cx + p[0] * Rr, y: cy + p[1] * Rr }); b[0] = Math.min(b[0], q.x); b[1] = Math.min(b[1], q.y); b[2] = Math.max(b[2], q.x); b[3] = Math.max(b[3], q.y); }
      b[0] = Math.max(0, Math.floor(b[0] - 2)); b[1] = Math.max(0, Math.floor(b[1] - 2)); b[2] = Math.min(w, Math.ceil(b[2] + 2)); b[3] = Math.min(h, Math.ceil(b[3] + 2));
      if (b[2] - b[0] < 1 || b[3] - b[1] < 1) continue; BOX.set(sh, b); U = [Math.min(U[0], b[0]), Math.min(U[1], b[1]), Math.max(U[2], b[2]), Math.max(U[3], b[3])]; } }
  if (U[2] > U[0]) { const sg = C2(GSNAP), x0 = Math.floor(U[0] * kx), y0 = Math.floor(U[1] * ky), x1 = Math.min(SW, Math.ceil(U[2] * kx)), y1 = Math.min(SH, Math.ceil(U[3] * ky));
    sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(x0, y0, x1 - x0, y1 - y0); sg.drawImage(cv, x0 / sk, y0 / sk, (x1 - x0) / sk, (y1 - y0) / sk, x0, y0, x1 - x0, y1 - y0); }
  // (the copy as a pattern laid where the picture was: a piece filled with it carries its part of the frame wherever it flies)
  const pat = U[2] > U[0] ? g.createPattern(GSNAP, 'no-repeat') : null; pat?.setTransform(inv.multiply(new DOMMatrix().scale(1 / kx, 1 / ky)));
  const light = dark ? mix(f.pal.text, [255, 255, 255], 0.2) : mix(f.pal.text, f.pal.bg, 0.35);
  for (const ev of act) { const dt = t - ev.t, G = glassGeom(ev), Rr = Math.hypot(w, h) * 0.5 * ev.size, cx = ev.x * w, cy = ev.y * h, reach = sstep(clamp(dt / 0.07)) * 1.2, fade = 1 - clamp((dt - 0.9) / 1.2), split = sstep(clamp(dt / 0.08)) * 0.035;
    g.save(); g.transform(Mbg.a, Mbg.b, Mbg.c, Mbg.d, Mbg.e, Mbg.f); g.globalCompositeOperation = 'source-over';
    { let kk = 0, n = 0; g.beginPath(); for (const sh of G.shards) { const gone = goneK(sh, dt, reach, fade); if (gone < 0.01) continue; kk += gone; n++;
        sh.poly.forEach((p: number[], k: number) => { const x = cx + p[0] * Rr, y = cy + p[1] * Rr; k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); }
      if (n) { g.globalAlpha = (dark ? 0.16 : 0.08) * kk / n; g.fillStyle = rgba(mix(f.pal.bg, K3, dark ? 0.5 : 0.35), 1); g.fill('nonzero'); } }
    g.restore();
    // a blow, not a peel: every piece is struck out from the point of impact at once (the inner ones a hair first), flies
    // outward fast and slows (air), drops a little, tumbles, and the pieces near the blow come toward the camera
    for (const sh of G.shards) { if (sh.r0 > reach || !sh.fly) continue; const st = Math.max(0, dt - burstAt(sh)), op = fade * (1 - clamp(st / 1.1)) * clamp((reach - sh.r0) / 0.2); if (op <= 0.01) continue;
      const cl = Math.hypot(sh.c[0], sh.c[1]) || 1, ux = sh.c[0] / cl, uy = sh.c[1] / cl, v0 = (1.1 + 1.4 * (1 - clamp(sh.r0 / 0.8))) * Rr, run = v0 * (1 - Math.exp(-st * 5)) / 5;
      const ox = cx + sh.c[0] * Rr, oy = cy + sh.c[1] * Rr, dx = sh.c[0] * Rr * split + ux * run, dy = sh.c[1] * Rr * split + uy * run + st * st * h * 0.5, near = 1 + st * 1.3 * (1 - clamp(sh.r0 / 0.6));
      const M = Mbg.multiply(new DOMMatrix().translate(ox + dx, oy + dy).rotate(sh.vr * st * 57.3 * 2.4).scale(near).translate(-ox, -oy));
      g.save(); g.transform(M.a, M.b, M.c, M.d, M.e, M.f); g.beginPath(); sh.poly.forEach((p: number[], k: number) => { const x = cx + p[0] * Rr, y = cy + p[1] * Rr; k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
      // (the piece filled with the picture it carries, and its glint filled into the same shape: no clip per piece)
      if (pat && BOX.has(sh)) { g.globalAlpha = 0.8 * op; g.fillStyle = pat; g.fill(); }
      const ex = sh.poly.reduce((m: number, p: number[]) => Math.max(m, Math.hypot(p[0] - sh.c[0], p[1] - sh.c[1])), 0) * Rr, band = -0.6 + ((st * 0.9 + rnd(sh.c[0] * 31 + sh.c[1] * 17) * 0.6) % 1.6);
      const sgd = g.createLinearGradient(ox - ex, oy - ex, ox + ex, oy + ex), b0 = clamp(band + 0.5);
      sgd.addColorStop(0, 'rgba(255,255,255,0)'); sgd.addColorStop(clamp(b0 - 0.08), 'rgba(255,255,255,0)'); sgd.addColorStop(b0, `rgba(255,255,255,${(dark ? 0.32 : 0.45) * op})`); sgd.addColorStop(clamp(b0 + 0.08), 'rgba(255,255,255,0)'); sgd.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalCompositeOperation = dark ? 'screen' : 'source-over'; g.globalAlpha = 1; g.fillStyle = sgd; g.fill();
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.1 * op; g.strokeStyle = rgba(mix(f.pal.bg, K3, 0.8), 1); g.lineWidth = 1.4; g.stroke();
      g.globalCompositeOperation = dark ? 'screen' : 'source-over'; g.globalAlpha = (dark ? 0.5 : 0.28) * op; g.strokeStyle = rgba(mix(mix(light, f.pal.accent, 0.25), [255, 255, 255], 0.45), 1); g.lineWidth = 0.8; g.stroke(); g.restore(); } } } });
