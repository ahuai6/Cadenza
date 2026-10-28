// Invariants of the director's plan, for every camera style: what the camera must never do.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { Signals } from '../../src/rhythm/signals';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan, cameraAt, basePose, project, corners, NO_FX, transK, type ScenePlan } from '../../src/director';
import { rawPose } from '../../src/director/camera';
import { sectionEntries } from '../../src/director/cues';

const LRC = readFileSync(new URL('../fixtures/long.lrc', import.meta.url), 'utf8');
function make(cut: 'punch' | 'glide' | 'waltz', src = LRC, opts: { frame?: boolean } = {}) {
  const map = RhythmMap.grid(112, 0.3, 160);
  const p = parse(src), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6;
  const doc = buildLyrics(p, map, musicEnd);
  const st = normalizeStyle({ ...presetStyle(cut === 'punch' ? 'liquid' : 'cover'), preset: 'custom', cut, fx: { ...presetStyle('cover').fx, frame: opts.frame ?? true } });
  return plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
}
const styles = ['punch', 'glide', 'waltz'] as const;

describe.each(styles)('director (%s)', cut => {
  const P = make(cut), sig = new Signals(P.map);
  it('keeps every word that is being sung inside the frame', () => {
    let n = 0, bad = 0; const worst: string[] = [];
    for (let t = P.words[0].show; t < P.musicEnd; t += 0.05) {
      if (transK(P.passages, t) > 0.02) continue;
      const f = cameraAt(P, sig, t, 0);                       // without the handheld layer: the plan itself
      for (const S of P.words) {
        if (t < S.w.t + 0.05 || t > S.end - (cut === 'punch' ? 0.25 : 0.1)) continue; n++;   // a word's last moment is its sustain
        const out = corners(S).some(([x, y]) => { const q = project(x, y, S.d, f.cam, NO_FX, P.W, P.H); return Math.abs(q.sx) > P.W / 2 || Math.abs(q.sy) > P.H / 2; });
        if (out) { bad++; if (worst.length < 5) worst.push(`${t.toFixed(2)} "${S.w.text}"`); }
      }
    }
    expect(bad / n, worst.join(', ')).toBeLessThan(0.02);
  });
  it('never moves backwards along a move, and never pans further than the limit in one move', () => {
    for (const m of P.camera.moves) {
      if (m.ease === 'cut' || m.a - m.s < 0.05) continue;
      const L = Math.hypot(m.dx, m.dy); if (L < 5) continue;
      const ux = m.dx / L, uy = m.dy / L; let prev = -Infinity;
      for (let t = m.s; t <= m.a; t += (m.a - m.s) / 40) { const b = rawPose(P.camera, t), v = b.x * ux + b.y * uy; expect(v).toBeGreaterThanOrEqual(prev - 0.5); prev = v; }   // the plan; the smoothed path only rounds its junctions
      // how far the picture actually slides on screen during the move
      let D = 0, p0 = basePose(P.camera, m.s); for (let k = 1; k <= 40; k++) { const p1 = basePose(P.camera, m.s + (m.a - m.s) * k / 40); D += Math.hypot(p1.x - p0.x, p1.y - p0.y) * Math.sqrt(p0.z * p1.z) / P.W; p0 = p1; }
      const st = P.camera.stops.find(x => Math.abs(x.arrive - m.a) < 1e-6), i = st ? P.camera.stops.indexOf(st) : -1, A = i > 0 ? P.camera.stops[i - 1] : null;
      const canCut = !!st && !!A && st.words[0]?.k === 0 && st.words[0].show - A.sungEnd >= 0.55;
      expect(D).toBeLessThan(canCut ? 1.4 : 2.8);      // beyond about a screen, a transition where one fits; a longer move only where none does
    }
  });
  it('drifts along the singing direction while it holds (not locked dead centre)', () => {
    // each stop either leaves room ahead in the reading direction or drifts that way while it holds
    const stops = P.camera.stops.filter(s => !s.over && !s.words.some(w => w.frame));
    const composed = stops.filter(s => { const lead = (s.x - s.box.x) * s.dir[0] + (s.y - s.box.y) * s.dir[1]; return lead > 0.5 || P.camera.drifts.some(([a]) => Math.abs(a - s.arrive) < 1e-6); });
    expect(composed.length / stops.length).toBeGreaterThan(0.6);
    for (const [, , dx, dy] of P.camera.drifts) expect(Math.hypot(dx, dy)).toBeGreaterThan(0);
  });
  it('cuts on the beat during a transition, and is clear again before the next line shows', () => {
    for (const p of P.passages) {
      const first = P.lines[p.line].words[0];
      expect(p.t + p.out).toBeLessThanOrEqual(first.show + 0.001);
      const pos = P.map.beatAt(p.t); expect(Math.min(pos.phase, 1 - pos.phase, Math.abs(pos.phase - 0.5))).toBeLessThan(0.02);
    }
  });
});

describe.each(styles)('transitions (%s)', cut => {
  const P = make(cut), sig = new Signals(P.map);
  it('the backdrop\'s camera never jumps where the camera cuts', () => {
    for (const k of P.camera.cuts) { const a = cameraAt(P, sig, k.t - 1e-4, 1).cont, b = cameraAt(P, sig, k.t + 1e-4, 1).cont;
      expect(Math.hypot(b.x - a.x, b.y - a.y) * b.z, `cut at ${k.t.toFixed(2)}`).toBeLessThan(2); expect(Math.abs(Math.log(b.z / a.z))).toBeLessThan(0.005); expect(Math.abs(b.r - a.r)).toBeLessThan(0.1); }
  });
  it('a transition never hides words still being sung', () => {
    for (const q of P.passages) for (const S of P.lines[q.line - 1].words) expect(S.end - 0.12, `${q.reason} at ${q.t.toFixed(2)}: "${S.w.text}"`).toBeLessThanOrEqual(q.t - q.inn * 0.5 + 1e-6);
  });
  it('a lyric frame always has its full time on screen', () => {
    for (const P1 of P.lines) for (const S of P1.words) { const F = S.frame; if (!F || F.words[F.words.length - 1] !== S) continue;
      const end = Math.min(P1.L.end, isFinite(P1.secEnd) ? P1.secEnd - P1.secIn : Infinity); expect(end - 0.8 - F.ts, `frame on line ${P1.i}`).toBeGreaterThanOrEqual(1.3 - 0.41); }
  });
});

describe.each(styles)('entrances (%s)', cut => {
  const P = make(cut);
  it('a word never appears cut off on an edge the camera is not heading for', () => {
    let bad = 0, n = 0; const worst: string[] = [];
    for (const S of P.words) { const t = S.show + 0.03; if (transK(P.passages, t) > 0.02) continue; n++;
      const b = basePose(P.camera, t), cam = { x: b.x, y: b.y, z: b.z, r: b.r, d: b.d, yaw: 0, pitch: 0 }, b2 = basePose(P.camera, t + 0.25), cam2 = { ...cam, x: b2.x, y: b2.y, z: b2.z, r: b2.r };
      const ek = S.entry && t > S.entry.t0 ? 1 - ((u: number) => u * u * (3 - 2 * u))(Math.min(1, (t - S.entry.t0) / (S.entry.t1 - S.entry.t0))) : S.entry ? 1 : 0;
      const X = S.x + (S.entry ? S.entry.dx * ek : 0), Y = S.y + (S.entry ? S.entry.dy * ek : 0), sh = { ...S, x: X, y: Y };
      const pts = corners(sh).map(([x, y]) => project(x, y, S.d, cam, NO_FX, P.W, P.H)), c0 = project(S.x, S.y, S.d, cam, NO_FX, P.W, P.H), c1 = project(S.x, S.y, S.d, cam2, NO_FX, P.W, P.H);
      const vx = c1.sx - c0.sx, vy = c1.sy - c0.sy, lim = 0.5 * 1.02;
      const out = pts.some(q => (q.sx > P.W * lim && !(vx < -0.015 * P.W)) || (q.sx < -P.W * lim && !(vx > 0.015 * P.W)) || (q.sy > P.H * lim && !(vy < -0.015 * P.W)) || (q.sy < -P.H * lim && !(vy > 0.015 * P.W)));
      if (out) { bad++; if (worst.length < 4) worst.push(`${S.show.toFixed(2)} "${S.w.text}"`); } }
    expect(bad / n, worst.join(', ')).toBeLessThan(0.02);
  });
});

describe('director: specific cases', () => {
  it('a fast run of word timings starts one camera move, not one per word', () => {
    const src = '[00:02.00]起點\n[00:05.57]<00:05.570>１ <00:05.600>２ <00:05.630>３<00:05.660>\n[00:09.00]下一句 歌詞';
    for (const cut of styles) { const P = make(cut, src); const starts = P.camera.moves.map(m => m.s).filter(s => s > 4.5 && s < 6.5).sort((a, b) => a - b);
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThan(0.12); }
  });
  it('the hard-cut camera lands on each word as it is sung', () => {
    const P = make('punch');
    for (const s of P.camera.stops) { if (s.over || s.cut || s.rest > 1) continue; expect(Math.abs(s.arrive - s.t)).toBeLessThan(0.13); }
  });
  it('a lyric frame is framed as a whole from when it is traced', () => {
    const P = make('glide'), sig = new Signals(P.map); let n = 0, bad = 0;
    for (const S of P.words) { const F = S.frame; if (!F || F.words[F.words.length - 1] !== S) continue;
      for (let t = F.ts + 0.6; t < Math.min(S.end - 0.1, F.ts + 1.2); t += 0.05) { if (transK(P.passages, t) > 0.02) continue; n++;
        const f = cameraAt(P, sig, t, 0); const out = F.words.some(W => corners(W, F.pad * 0.5).some(([x, y]) => { const q = project(x, y, W.d, f.cam, NO_FX, P.W, P.H); return Math.abs(q.sx) > P.W / 2 || Math.abs(q.sy) > P.H / 2; }));
        if (out) bad++; } }
    expect(n).toBeGreaterThan(0); expect(bad / n).toBeLessThan(0.05);
  });
  it('projection stays bounded at the frame edge (a tilted view scales an edge word by at most ~12 %)', () => {
    const cam = { x: 0, y: 0, z: 0.4, r: 0, d: 0, yaw: 4, pitch: 4 }, flat = { ...cam, yaw: 0, pitch: 0 };
    for (const x of [-2000, -900, 0, 900, 2000, 6000]) { const a = project(x, 600, 0, cam, NO_FX, 1280, 720), b = project(x, 600, 0, flat, NO_FX, 1280, 720);
      expect(a.k / b.k).toBeGreaterThan(0.85); expect(a.k / b.k).toBeLessThan(1.15); }
  });
  it('an intro long enough for a title card gets one; a short intro gets the small title at the top', () => {
    const P1 = make('glide', '[00:12.00]late start\n[00:15.00]more'), P2 = make('glide', '[00:01.00]early start\n[00:04.00]more');
    expect(P1.titles.intro?.kind).toBe('card'); expect(P1.titles.intro!.t1).toBeLessThan(12);
    expect(P2.titles.intro?.kind).toBe('top');
    expect(P1.camera.stops[0].arrive).toBeGreaterThanOrEqual(P1.titles.intro!.t1 - 0.01);
  });
});
export type { ScenePlan };

describe('word poses', () => {
  it('a unit settles exactly where its ghost and outline were drawn (no twitch when it is sung)', async () => {
    const { wordState, unitPose } = await import('../../src/director/words');
    const P = make('glide', '[00:01.00]<00:01.00>一<00:01.40>二<00:01.80>三<00:02.60>\n[00:05.00]next');
    const S = P.words[0], c = { enter: 0.35, tempo: 1, float: 0.6, future: 'dim' as const, smooth: true, punch: 0.3, motion: 1, drift: false };
    for (let ui = 0; ui < S.units.length; ui++) {
      const u = S.units[ui];
      const tGhost = u.t! - 0.02, ws0 = wordState(S, tGhost, 0, false, c)!, g = unitPose(S, ui, tGhost, ws0, 0, c)!;
      const tSung = u.t! + 0.001, ws1 = wordState(S, tSung, 0, false, c)!, o = unitPose(S, ui, tSung, ws1, 0, c)!;
      const tDone = u.t! + 3, ws2 = wordState(S, tDone, 0, false, c)!, d = unitPose(S, ui, tDone, ws2, 0, c)!;
      if (ui > 0) expect(g.ghost).toBe(true);
      // the rest pose moves only with the slow float: 20 ms apart it is (almost) the same point
      expect(Math.hypot(o.rx - g.rx, o.ry - g.ry)).toBeLessThan(0.5);
      expect(o.outline).toBeGreaterThan(0);
      // settled: the glyph sits on its rest pose (no leftover entrance offset)
      expect(Math.hypot(d.dx, d.dy)).toBeLessThan(0.01); expect(d.um).toBeCloseTo(1, 3);
    }
  });
});

describe('quick runs', () => {
  it('words sung as one quick run share one size, one entrance and one appearance (no stutter)', () => {
    const P = make('waltz', '[00:20.00] 前面的一句歌詞\n[00:25.57]<00:25.570>１ <00:25.600>２ <00:25.630>３<00:25.660>\n[00:27.50] 下一句 慢慢唱\n');
    const ws = P.lines[1].words;
    expect(ws.length).toBe(3);
    expect(new Set(ws.map(w => w.s.toFixed(4))).size).toBe(1);
    expect(new Set(ws.map(w => w.tin)).size).toBe(1);
    expect(new Set(ws.map(w => w.show.toFixed(4))).size).toBe(1);
    // the camera frames the run as one stop
    expect(P.camera.stops.filter(s => s.words.some(w => ws.includes(w))).length).toBe(1);
  });
  it('a smooth camera never makes a snap move (every move takes its time)', () => {
    for (const cut of ['glide', 'waltz'] as const) { const P = make(cut);
      P.camera.moves.forEach((m, i) => { const B = P.camera.stops[i], A = P.camera.stops[i - 1]; if (!A || !B || m.ease === 'cut' || B.over || Math.hypot(m.dx, m.dy) * 1.5 / P.W < 0.08) return;
        expect(m.a - m.s).toBeGreaterThan(Math.min(0.29, 0.85 * (B.t - A.t) - 0.01)); }); }
  });
});

describe('chorus entries', () => {
  // a flat grid (no section boundaries, no level change): only the lyrics can tell where the chorus comes in
  const ts = (s: number) => `[${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}]`;
  const b = 60 / 112, bar = 4 * b, at = (k: number) => 0.3 + k * bar;
  const V1 = ['街の灯りが遠くなる', 'ひとりきりの帰り道', '言えなかった言葉たち', 'ポケットの中で眠る'], V2 = ['窓の外は雨模様', '時計の針が止まる', '昨日の夢を数えて', '静かに朝を待つ'];
  const C = ['夜を駆けていく', '二人だけの空へ', '手を伸ばしたその先に', '光が見えるから'];
  const rows: [number, string][] = [];
  V1.forEach((l, i) => rows.push([at(2 + i * 2) + b * 0.5, l])); C.forEach((l, i) => rows.push([at(10 + i * 2) - b * 0.5, l]));
  V2.forEach((l, i) => rows.push([at(20 + i * 2) + b * 0.5, l])); C.forEach((l, i) => rows.push([at(28 + i * 2) - b * 0.5, l]));
  const P = make('glide', rows.map(([t, l]) => ts(t) + l).join('\n'));
  it('finds the downbeat each lyric chorus comes in on (under its pickup), and no other', () => {
    const es = sectionEntries(P.map, P.lines, t => t > 0.5 && t < P.musicEnd - 0.5).map(e => e.t);
    expect(es.length, es.join(', ')).toBe(2);
    for (const k of [10, 28]) expect(es.some(t => Math.abs(t - at(k)) < 0.06), `bar ${k}: ${es.join(', ')}`).toBe(true);
    for (const k of [10, 28]) expect(P.cues.flash.some(q => Math.abs(q.t - at(k)) < 0.06), `flash at bar ${k}`).toBe(true);
  });
});
