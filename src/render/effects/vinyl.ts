// The record theme's stage and the effects made with it (each one can be switched on in any theme): the record itself
// (a backdrop), floating wireframe solids, line fragments bobbing on the beat, a horizon of door frames coming forward,
// plain decorative lines on the background, and inverted plane shapes over everything.
import { clamp, sstep } from '../../core/math';
import { eOut, eIO } from '../../core/ease';
import { rnd } from '../../core/rng';
import { mix, rgba, hexOf, K3, W3 } from '../../core/color';
import { register, midShift, atMid, type BackdropView } from './registry';
import type { RenderFrame } from '../frame';
import { makeVinyl, coverSquare } from './cover';
import { geoPattern, geoShapes } from './backdrops';
import { accentClock } from '../../rhythm/accentclock';
import { band } from './drift';

/* ---------- the record: the whole disc in the middle of the frame, turning, with the cover as its label ---------- */
let REC: { key: string; c: HTMLCanvasElement } | null = null;
const record = (f: RenderFrame) => {
  const key = `${f.media.coverKey}|${f.media.cover ? '' : f.style.accent + f.style.bg2}`;
  if (!REC || REC.key !== key) REC = { key, c: makeVinyl(coverSquare(f, 1024), 1024) };
  return REC.c;
};
/** Where the record sits and how big it is (the centre of the frame; most of its height). */
export const recordAt = (f: RenderFrame, bd: Pick<BackdropView, 'ox' | 'oy'>) => {
  const [sx, sy] = midShift(bd);
  return { x: f.W / 2 + sx, y: f.H / 2 + sy, R: f.H * 0.43 };
};
register({
  id: 'vinyl',
  label: 'bg.vinyl',
  layer: 'backdrop',
  kind: 'backdrop',
  draw(g, f, a) {
    const { W: w, H: h } = f,
      E = a.bd.E,
      B = f.pal.bg,
      B2 = f.pal.bg2,
      { x, y, R } = recordAt(f, a.bd),
      M = Math.max(w, h);
    // the ground: the cover's colour, lit from behind the record, a little more on the beat
    const gr = g.createRadialGradient(x, y, R * 0.6, x, y, M * 0.85);
    gr.addColorStop(0, hexOf(mix(B, B2, 0.55 + 0.15 * f.I)));
    gr.addColorStop(1, hexOf(mix(B, K3, 0.25)));
    g.fillStyle = gr;
    g.fillRect(-E, -E, w + 2 * E, h + 2 * E);
  },
  // the disc stands in front of the horizon and the lines, behind the solids and fragments floating round it
  frontZ: 19,
  front(g, f, a) {
    const { x, y, R } = recordAt(f, a.bd);
    // a halo of the accent round the disc that swells with the pulse, and a soft contact shadow under it
    const hk = 0.14 + 0.1 * f.I + 0.12 * f.P,
      halo = g.createRadialGradient(x, y, R * 0.92, x, y, R * 1.55);
    halo.addColorStop(0, rgba(f.pal.accent, hk));
    halo.addColorStop(1, rgba(f.pal.accent, 0));
    g.fillStyle = halo;
    g.beginPath();
    g.arc(x, y, R * 1.55, 0, 6.283);
    g.fill();
    const sh = g.createRadialGradient(x, y + R * 0.05, R * 0.9, x, y + R * 0.05, R * 1.12);
    sh.addColorStop(0, 'rgba(0,0,0,.45)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh;
    g.beginPath();
    g.arc(x, y + R * 0.05, R * 1.12, 0, 6.283);
    g.fill();
    // the disc, turning (about 33 rpm), the faintest breath with the pulse
    const s = R * (1 + 0.004 * f.P);
    g.save();
    g.translate(x, y);
    g.rotate(f.t * 0.9);
    g.drawImage(record(f), -s, -s, 2 * s, 2 * s);
    g.restore();
    // the light on the grooves stays where the lamp is: two opposite sheens that do not turn with the disc
    if ('createConicGradient' in g) {
      const cg = (g as CanvasRenderingContext2D).createConicGradient(-0.6, x, y);
      for (const [u, al] of [
        [0, 0],
        [0.06, 0.13],
        [0.12, 0],
        [0.5, 0],
        [0.56, 0.09],
        [0.62, 0],
        [1, 0],
      ] as const)
        cg.addColorStop(u, `rgba(255,255,255,${al})`);
      g.save();
      g.globalCompositeOperation = 'screen';
      g.fillStyle = cg;
      g.beginPath();
      g.arc(x, y, s * 0.97, 0, 6.283);
      g.arc(x, y, s * 0.35, 0, 6.283, true);
      g.fill('evenodd');
      g.restore();
    }
  },
});

/* ---------- wireframe solids drifting in depth, each turning slowly about its own axes ---------- */
type V3 = [number, number, number];
const PHI = (1 + Math.sqrt(5)) / 2;
const SOLIDS: { v: V3[]; e: [number, number][] }[] = (() => {
  const cube: V3[] = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  const edgesBy = (v: V3[], len: number) => {
    const e: [number, number][] = [];
    for (let i = 0; i < v.length; i++)
      for (let j = i + 1; j < v.length; j++) {
        const d = Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2]);
        if (Math.abs(d - len) < 1e-3) e.push([i, j]);
      }
    return e;
  };
  const oct: V3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const tet: V3[] = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ];
  const ico: V3[] = [];
  for (const a of [-1, 1])
    for (const b of [-PHI, PHI]) {
      ico.push([0, a, b], [a, b, 0], [b, 0, a]);
    }
  const prism: V3[] = [0, 1, 2].flatMap((k) => {
    const an = k * 2.094;
    return [
      [Math.cos(an), Math.sin(an), -1.2],
      [Math.cos(an), Math.sin(an), 1.2],
    ] as V3[];
  });
  const pe: [number, number][] = [
    [0, 2],
    [2, 4],
    [4, 0],
    [1, 3],
    [3, 5],
    [5, 1],
    [0, 1],
    [2, 3],
    [4, 5],
  ];
  return [
    { v: cube, e: edgesBy(cube, 2) },
    { v: oct, e: edgesBy(oct, Math.SQRT2) },
    { v: tet, e: edgesBy(tet, 2 * Math.SQRT2) },
    { v: ico, e: edgesBy(ico, 2) },
    { v: prism, e: pe },
  ];
})();
const WIRES = Array.from({ length: 8 }, (_, i) => ({
  k: i % SOLIDS.length,
  z: 0.25 + rnd(i * 5.9) * 0.75,
  s: 0.05 + rnd(i * 2.7) * 0.06,
  w: [0.15 + rnd(i * 1.3) * 0.35, 0.1 + rnd(i * 4.4) * 0.3, 0.05 + rnd(i * 6.2) * 0.2] as V3,
  p: rnd(i * 8.1) * 6.28,
  f: 0.05 + rnd(i * 9.9) * 0.08,
  life: 11 + rnd(i * 3.7) * 7,
  ph: rnd(i * 6.6),
}));
/** where a solid is during one of its lives (each life somewhere else) */
// (each solid in its own column and its own row of the frame, a new spot within them each life — drift.ts — so two
// never meet in one place)
const wirePlace = (i: number, n: number) => ({
  x: band(i, WIRES.length, n, 0.08, 0.92),
  y: band((i * 3 + 1) % WIRES.length, WIRES.length, n + 0.5, 0.12, 0.88),
});
/* Wireframe solids in the background: each turns in steps on the beat (a quick, eased turn on every beat, then still),
   drifts on the shared accent clock (so it hangs on a hit), and every so often fades away to reappear somewhere else. */
register({
  id: 'wires',
  label: 'fx.wires',
  layer: 'backdrop',
  kind: 'effect',
  z: 7,
  draw(g, f, a) {
    const w = f.W,
      h = f.H,
      m = Math.min(w, h),
      t = f.t,
      tau = accentClock(f.plan.map, f.t),
      col = mix(f.pal.accent, f.pal.text, 0.25),
      P = f.P,
      bt = f.rs.bt ?? t * 2;
    // the turn: steady on the accent clock (so it hangs on a hit with everything else that drifts), with a small step on
    // each beat — quick on the beat, then still — only while the music is playing (a quiet passage turns smoothly, never
    // ticking on through it); the step is a wobble about the steady turn, so it never piles up
    const fr = bt - Math.floor(bt),
      beatK = f.plan.map.sounding(f.t) * clamp(0.3 + 0.7 * f.rs.level),
      step = (eOut(clamp(fr / 0.4)) - fr) * beatK;
    g.save();
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const [i, q] of WIRES.entries()) {
      const u = t / q.life + q.ph,
        n = Math.floor(u),
        lu = u - n,
        life = sstep(clamp(lu / 0.14)) * (1 - sstep(clamp((lu - 0.84) / 0.16)));
      if (life < 0.01) continue;
      const S = SOLIDS[q.k],
        pl = wirePlace(i, n),
        turn = 0.67 * tau + 0.22 * step,
        ax = turn * q.w[0] + q.p,
        ay = turn * q.w[1] + q.p * 1.7,
        az = turn * q.w[2];
      const cx = (pl.x + Math.sin(tau * q.f + q.p) * 0.04) * w + a.bd.ox * q.z * 1.6,
        cy = (pl.y + Math.cos(tau * q.f * 0.8 + q.p) * 0.03) * h + a.bd.oy * q.z * 1.6;
      const R = q.s * m * (0.6 + 0.9 * q.z) * (1 + 0.04 * P * q.z),
        ca = Math.cos(ax),
        sa = Math.sin(ax),
        cb = Math.cos(ay),
        sb = Math.sin(ay),
        cc = Math.cos(az),
        sc = Math.sin(az);
      const pts = S.v.map(([x, y, z]) => {
        let y1 = y * ca - z * sa,
          z1 = y * sa + z * ca;
        const x2 = x * cb + z1 * sb;
        z1 = -x * sb + z1 * cb;
        const x3 = x2 * cc - y1 * sc;
        y1 = x2 * sc + y1 * cc;
        const k = 4 / (4 + z1);
        return [cx + x3 * R * k, cy + y1 * R * k, z1] as V3;
      });
      for (const [i0, j0] of S.e) {
        const zz = (pts[i0][2] + pts[j0][2]) / 2,
          back = zz > 0; // the far edges fainter: the solid reads in depth
        g.strokeStyle = rgba(col, (0.1 + 0.28 * q.z) * (back ? 0.45 : 1) * life);
        g.lineWidth = (0.8 + 1.3 * q.z) * (m / 720) * (back ? 0.8 : 1);
        g.beginPath();
        g.moveTo(pts[i0][0], pts[i0][1]);
        g.lineTo(pts[j0][0], pts[j0][1]);
        g.stroke();
      }
    }
    g.restore();
  },
});

/* ---------- line fragments wandering in space: on the shared accent clock (slowed on a hit, like the feathers), each
   drifting on its own slow path through depth, turning gently, coming back as a new one when it has wandered off ---------- */
const SHARDS = Array.from({ length: 30 }, (_, i) => ({
  z: 0.2 + rnd(i * 4.9) * 0.8,
  kind: Math.floor(rnd(i * 3.3) * 5),
  L: 0.012 + rnd(i * 8.7) * 0.026,
  r0: rnd(i * 5.1) * 6.28,
  vr: (rnd(i * 1.9) - 0.5) * 0.35,
  ph: rnd(i * 9.3) * 6.28,
  fx: 0.03 + rnd(i * 2.2) * 0.05,
  fy: 0.025 + rnd(i * 7.1) * 0.04,
  vy: 0.008 + rnd(i * 6.4) * 0.012,
  life: 0,
}));
register({
  id: 'shards',
  label: 'fx.shards',
  layer: 'backdrop',
  kind: 'effect',
  z: 8,
  draw(g, f, a) {
    const w = f.W,
      h = f.H,
      m = Math.min(w, h),
      t = accentClock(f.plan.map, f.t),
      col = f.pal.accent,
      col2 = mix(f.pal.flash, W3, 0.2),
      glint = 0.85 + 0.15 * Math.exp(-f.rs.phase * 4) * (0.4 + 0.6 * f.I);
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [i, q] of SHARDS.entries()) {
      // its path: a slow rise through the frame (a new one when it leaves), wandering both ways, its depth breathing
      const u = rnd(i * 6.1 + 3) + t * q.vy * (0.4 + q.z),
        n = Math.floor(u),
        y0 = (1 - (u - n)) * 1.3 - 0.15,
        x0 = rnd(i * 2.3 + n * 4.77 + 7);
      const z = clamp(q.z + Math.sin(t * 0.11 + q.ph) * 0.12, 0.15, 1),
        L = q.L * m * (0.7 + 0.9 * z);
      const x =
          (x0 + Math.sin(t * q.fx + q.ph) * 0.06 + Math.sin(t * q.fx * 2.3 + q.ph * 1.7) * 0.02) * w + a.bd.ox * z * 2,
        y = (y0 + Math.sin(t * q.fy + q.ph * 0.6) * 0.04) * h + a.bd.oy * z * 2;
      const rot = q.r0 + rnd(i * 1.3 + n) * 6.28 + t * q.vr,
        edge = sstep(clamp(Math.min(y0 + 0.1, 1.15 - y0) / 0.15));
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.strokeStyle = rgba(q.kind % 2 ? col2 : col, (0.18 + 0.4 * z) * glint * edge);
      g.lineWidth = (0.9 + 1.5 * z) * (m / 720);
      g.beginPath();
      if (q.kind === 0) {
        g.moveTo(-L / 2, 0);
        g.lineTo(L / 2, 0);
      } else if (q.kind === 1) {
        g.moveTo(-L / 2, -L * 0.3);
        g.lineTo(0, L * 0.2);
        g.lineTo(L / 2, -L * 0.3);
      } else if (q.kind === 2) {
        g.moveTo(0, -L * 0.45);
        g.lineTo(L * 0.4, L * 0.3);
        g.lineTo(-L * 0.4, L * 0.3);
        g.closePath();
      } else if (q.kind === 3) {
        g.moveTo(-L / 2, 0);
        g.lineTo(-L / 6, -L * 0.25);
        g.lineTo(L / 6, L * 0.25);
        g.lineTo(L / 2, 0);
      } else {
        g.moveTo(-L * 0.35, L * 0.1);
        g.lineTo(-L * 0.35, -L * 0.35);
        g.lineTo(L * 0.35, -L * 0.35);
      }
      g.stroke();
      g.restore();
    }
    g.restore();
  },
});

/* ---------- a horizon of door frames: a ground, its horizon, and line-drawn frames receding to it, still (a backdrop:
   it gives depth, it does not dance; it moves only with the backdrop's own camera) ---------- */
register({
  id: 'doors',
  label: 'fx.doors',
  layer: 'backdrop',
  kind: 'effect',
  z: 4,
  draw: atMid((g, f, a) => {
    const E = a.bd.E,
      w = f.W,
      h = f.H,
      hy = h * 0.62,
      mx = w / 2,
      A = f.pal.accent,
      I = 0.5,
      t = accentClock(f.plan.map, f.t);
    // the ground, a shade lifted towards the horizon
    const gg = g.createLinearGradient(0, hy, 0, h + E);
    gg.addColorStop(0, rgba(mix(f.pal.bg2, A, 0.15), 0.22));
    gg.addColorStop(0.35, rgba(mix(f.pal.bg2, A, 0.08), 0.12));
    gg.addColorStop(1, rgba(f.pal.bg, 0));
    g.fillStyle = gg;
    g.fillRect(-E, hy, w + 2 * E, h - hy + E);
    // the ground's lines running to the vanishing point
    g.strokeStyle = rgba(A, 0.05 + 0.07 * I);
    g.lineWidth = 1;
    g.beginPath();
    for (let k = -14; k <= 14; k++) {
      g.moveTo(mx + k * w * 0.01, hy);
      g.lineTo(mx + k * w * 0.16, h + E);
    }
    g.stroke();
    // the frames: one starts at the horizon on every beat and comes forward, growing and brightening, and fades as it passes
    const N = 9,
      off = 0.5 + 0.04 * Math.sin(t * 0.05),
      dw = w * 0.36,
      dh = h * 0.62;
    for (let j = N - 1; j >= 0; j--) {
      const z = (j + off) / N,
        s = z ** 2.4,
        yb = hy + (h + E * 0.4 - hy) * s,
        half = (dw * (0.04 + 2.6 * s)) / 2,
        top = yb - dh * (0.04 + 2.6 * s);
      const al = sstep(clamp(z / 0.15)) * (1 - sstep(clamp((z - 0.82) / 0.18))) * (0.16 + 0.3 * I) * 0.85;
      if (al < 0.004) continue;
      g.strokeStyle = rgba(A, al);
      g.lineWidth = (0.6 + 3.2 * s) * (h / 720);
      g.beginPath();
      g.moveTo(mx - half, yb);
      g.lineTo(mx - half, top);
      g.lineTo(mx + half, top);
      g.lineTo(mx + half, yb);
      g.stroke();
      // the inner jamb, a step in: the frame has thickness
      const d = half * 0.06;
      g.lineWidth *= 0.5;
      g.strokeStyle = rgba(A, al * 0.5);
      g.beginPath();
      g.moveTo(mx - half + d, yb);
      g.lineTo(mx - half + d, top + d);
      g.lineTo(mx + half - d, top + d);
      g.lineTo(mx + half - d, yb);
      g.stroke();
    }
    // the horizon itself, bright on the beat
    g.fillStyle = rgba(A, 0.42);
    g.fillRect(-E, hy - 1, w + 2 * E, 2);
  }),
});

/* ---------- plain lines on the background: a few compositions of solid strokes, drifting very slowly ---------- */
const LINESETS = Array.from({ length: 5 }, (_, i) => ({
  kind: i,
  x: [0.18, 0.82, 0.5, 0.12, 0.88][i],
  y: [0.2, 0.75, 0.12, 0.82, 0.3][i],
  a: (rnd(i * 4.7) - 0.5) * 1.2,
  ph: rnd(i * 2.9) * 6.28,
}));
register({
  id: 'lines',
  label: 'fx.lines',
  layer: 'backdrop',
  kind: 'effect',
  z: 2,
  draw(g, f, a) {
    const w = f.W,
      h = f.H,
      m = Math.min(w, h),
      t = accentClock(f.plan.map, f.t),
      c1 = mix(f.pal.bg2, f.pal.accent, 0.45),
      c2 = mix(f.pal.bg2, W3, 0.25);
    g.save();
    g.lineCap = 'butt';
    for (const q of LINESETS) {
      const x = q.x * w + Math.sin(t * 0.05 + q.ph) * w * 0.015 + a.bd.ox * 0.3,
        y = q.y * h + Math.cos(t * 0.04 + q.ph) * h * 0.015 + a.bd.oy * 0.3,
        al = 0.16 + 0.08 * f.I;
      g.save();
      g.translate(x, y);
      g.rotate(q.a + Math.sin(t * 0.03 + q.ph) * 0.04);
      // each with a small motion of its own: the stripes slide along themselves, the arcs turn, the ruler runs, the corners
      // breathe apart, the dashes march
      if (q.kind === 0) {
        for (let k = 0; k < 5; k++) {
          const sl = Math.sin(t * 0.21 + k * 0.9 + q.ph) * m * 0.03;
          g.strokeStyle = rgba(k % 2 ? c2 : c1, al);
          g.lineWidth = (k === 2 ? 3 : 1.2) * (m / 720);
          g.beginPath();
          g.moveTo(-m * 0.5 + sl, k * m * 0.022);
          g.lineTo(m * 0.5 + sl, k * m * 0.022);
          g.stroke();
        }
      } else if (q.kind === 1) {
        for (let k = 0; k < 3; k++) {
          const tu = t * (0.05 + k * 0.03) * (k % 2 ? -1 : 1);
          g.strokeStyle = rgba(c1, al * (1 - k * 0.25));
          g.lineWidth = 1.4 * (m / 720);
          g.beginPath();
          g.arc(0, 0, m * (0.16 + k * 0.05), -0.4 + k * 0.3 + tu, 1.9 + k * 0.4 + tu);
          g.stroke();
        }
      } else if (q.kind === 2) {
        const run = ((t * 0.012) % 0.05) * m;
        g.strokeStyle = rgba(c2, al);
        g.lineWidth = 1.2 * (m / 720);
        g.beginPath();
        g.moveTo(-m * 0.6, 0);
        g.lineTo(m * 0.6, 0);
        for (let k = -12; k <= 12; k++) {
          const x = k * m * 0.05 + run;
          g.moveTo(x, 0);
          g.lineTo(x, (k + 100) % 4 ? m * 0.01 : m * 0.025);
        }
        g.stroke();
      } else if (q.kind === 3) {
        const L = m * 0.09,
          br = 1 + 0.06 * Math.sin(t * 0.33 + q.ph);
        g.strokeStyle = rgba(c1, al * 1.2);
        g.lineWidth = 2.2 * (m / 720);
        g.beginPath();
        g.moveTo(0, L);
        g.lineTo(0, 0);
        g.lineTo(L, 0);
        g.moveTo(L * 2.4 * br, L * 1.6 * br);
        g.lineTo(L * 2.4 * br, L * 2.6 * br);
        g.lineTo(L * 1.4 * br, L * 2.6 * br);
        g.stroke();
      } else {
        g.strokeStyle = rgba(c2, al);
        g.lineWidth = 1 * (m / 720);
        g.setLineDash([m * 0.012, m * 0.01]);
        g.lineDashOffset = -t * m * 0.006;
        g.beginPath();
        g.moveTo(-m * 0.45, -m * 0.2);
        g.lineTo(m * 0.45, m * 0.2);
        g.stroke();
        g.setLineDash([]);
        g.lineDashOffset = 0;
      }
      g.restore();
    }
    g.restore();
  },
});

/* ---------- inverted plane shapes: now and then a bar brings a flat shape that inverts everything under it ----------
   Over the lyric world, lyrics included (the last of the foreground) — under the captions, titles, end card and curtain. Fewer bars than the geometric theme's own, and each
   leaves before the next bar comes. It comes in sliding (growing in from its edge), or flashing (there whole at once,
   flickering on like a struck light and off the same way), or either, bar by bar. */
const BLINK = (u: number) => (u < 0.05 ? 1 : u < 0.09 ? 0 : u < 0.14 ? 1 : u < 0.17 ? 0.35 : 1);
register({
  id: 'invgeo',
  label: 'fx.invgeo',
  layer: 'foreground',
  kind: 'effect',
  z: 50,
  params: [
    {
      key: 'entry',
      label: 'p.entry',
      kind: 'select',
      options: [
        ['slide', 'p.entry.slide'],
        ['flash', 'p.entry.flash'],
        ['mix', 'p.entry.mix'],
      ],
      def: 'slide',
    },
  ],
  draw(g, f, a) {
    const calm = f.cam.calm * f.view.effect;
    if (calm <= 0.01) return;
    const G = geoPattern(f),
      map = f.plan.map,
      p = map.beatAt(f.t);
    if (!G.on || rnd(G.seed + 9) > 0.32) return;
    const mode = String(a.params.entry || 'slide'),
      flash = mode === 'flash' || (mode === 'mix' && rnd(G.seed + 13) < 0.5);
    const inBar = (p.inBar + p.phase) * p.len,
      left = (map.meter - (p.inBar + p.phase)) * p.len;
    let e: number,
      vis = 1;
    if (flash) {
      e = 1;
      vis = inBar < 0.2 ? BLINK(inBar) : left < 0.17 ? BLINK(left) : 1;
    } else e = G.e * (1 - eIO(clamp((p.inBar + p.phase - (map.meter - 1)) / 1)));
    e *= calm;
    if (e <= 0.002 || vis <= 0.01) return;
    const w = f.W,
      h = f.H;
    g.save();
    g.globalCompositeOperation = 'difference';
    g.fillStyle = '#ffffff';
    g.globalAlpha = vis;
    g.translate(w / 2, h / 2);
    g.rotate((G.ang * Math.PI) / 180);
    g.scale(0.82 + 0.02 * f.P, 0.82 + 0.02 * f.P);
    geoShapes(g, G, e, w, h);
    g.restore();
  },
});
