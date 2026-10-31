// Invariants of the director's plan, for every camera style: what the camera must never do.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { Signals } from '../../src/rhythm/signals';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan, cameraAt, basePose, project, corners, NO_FX, transK, wordState, type ScenePlan } from '../../src/director';
import { rawPose } from '../../src/director/camera';
import { markedEntries, entryFloor, MARK_K } from '../../src/director/cues';

const LRC = readFileSync(new URL('../fixtures/long.lrc', import.meta.url), 'utf8');
function make(cut: 'punch' | 'glide' | 'waltz' | 'close' | 'hover', src = LRC, opts: { frame?: boolean; trigger?: number; aspect?: number } = {}) {
  const map = RhythmMap.grid(112, 0.3, 160);
  const p = parse(src), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6;
  const doc = buildLyrics(p, map, musicEnd);
  const base = presetStyle(cut === 'punch' ? 'liquid' : 'cover'), st = normalizeStyle({ ...base, preset: 'custom', cut, fx: { ...presetStyle('cover').fx, frame: opts.frame ?? true }, ...(opts.trigger ? { k: { ...base.k, trigger: opts.trigger } } : {}) });
  return plan({ doc, map, style: st, measure: approxMeasurer(), aspect: opts.aspect ?? 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
}
const styles = ['punch', 'glide', 'waltz', 'close', 'hover'] as const;
/** The corners of the character of S being sung at t (the last one already reached; the first before any). */
function singing(S: ScenePlan['words'][0], t: number, first = false): [number, number][] {
  const n = S.units.length, span = Math.max(0.05, S.end - S.w.t); let k = 0;
  if (!first) S.units.forEach((u, i) => { if ((u.t ?? S.w.t + span * 0.85 * i / n) <= t) k = i; });
  const u = S.units[k], c = Math.cos(S.tilt * Math.PI / 180), sn = Math.sin(S.tilt * Math.PI / 180);
  return corners({ x: S.x + c * u.ox - sn * u.oy, y: S.y + sn * u.ox + c * u.oy, lw: u.w, lh: u.h, tilt: S.tilt });
}

describe.each(styles)('director (%s)', cut => {
  const P = make(cut), P0 = P;
  // (in every frame shape the picture can have: 16:9, 16:10, 1:1, 9:16)
  it.each([16 / 9, 16 / 10, 1, 9 / 16])('keeps the character being sung inside the frame (aspect %f)', aspect => {
    const P = aspect === 16 / 9 ? P0 : make(cut, LRC, { aspect }), sig = new Signals(P.map);
    let n = 0, bad = 0; const worst: string[] = [];
    for (let t = P.words[0].show; t < P.musicEnd; t += 0.05) {
      if (transK(P.passages, t) > 0.02) continue;
      const f = cameraAt(P, sig, t, 0);                       // without the handheld layer: the plan itself
      for (const S of P.words) {
        if (t < S.w.t + 0.05 || t > S.end - (cut === 'punch' || cut === 'close' ? 0.25 : 0.1) || t >= S.line.secEnd) continue; n++;   // a word's last moment is its sustain (close up the camera is on to the next by then)
        const out = singing(S, t).some(([x, y]) => { const q = project(x, y, S.d, f.cam, NO_FX, P.W, P.H); return Math.abs(q.sx) > P.W / 2 || Math.abs(q.sy) > P.H / 2; });
        if (out) { bad++; if (worst.length < 5) worst.push(`${t.toFixed(2)} "${S.w.text}"`); }
      }
    }
    expect(bad / n, worst.join(', ')).toBeLessThan(cut === 'close' ? 0.03 : 0.02);   // (close up the frame is tight: a held last character may leave a moment early)
  });
  it('never moves backwards along a move, and never pans further than the limit in one move', () => {
    for (const m of P.camera.moves) {
      if (m.ease === 'cut' || m.ease === 'roll' || m.a - m.s < 0.05) continue;   // (a roll's spring swings past on purpose)
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
  it('follows the singing along the words, never backwards, a little behind it', () => {
    const stops = P.camera.stops.filter(s => !s.over && !s.hov && !s.words.some(w => w.frame) && s.fax);   // (a line heading back is hovered over: below)
    // the character being sung sits just right of the middle on arrival (the camera follows the voice, never ahead)…
    // (hovering, the words are framed whole instead)
    const lead = stops.filter(s => { const U = singing(s.words[0], s.words[0].w.t, true), cx = (U[0][0] + U[2][0]) / 2, cy = (U[0][1] + U[2][1]) / 2, c = rawPose(P.camera, s.arrive + 1e-3);
      return (c.x - cx) * s.fax![0] + (c.y - cy) * s.fax![1] < 1; });
    if (cut !== 'hover') expect(lead.length / stops.length).toBeGreaterThan(0.6);
    // …and every step of a follow goes forward along the words
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

describe.each(styles)('directions (%s)', cut => {
  const P = make(cut);
  // where each passage's lines go: their centres from the first to the last, along the reading direction
  const secs = [...new Set(P.lines.map(L => L.sec))].map(sec => P.lines.filter(L => L.sec === sec && L.words.length));
  it('the lines go both ways: rightward, and — after transitions — leftward, in more than one passage', () => {
    let right = 0; const leftSecs = new Set<number>();
    for (const ls of secs) for (let k = 1; k < ls.length; k++) { if (ls[k].west && ls[k].ax < ls[k - 1].ax) leftSecs.add(ls[k].sec); else if (ls[k].ax > ls[k - 1].ax) right++; }
    expect(right).toBeGreaterThan(3); expect(leftSecs.size).toBeGreaterThanOrEqual(2);
  });
  it('every transition turns the way the lines set off: rightward, leftward, …', () => {
    if (cut === 'close' || cut === 'hover') return;   // (close up most moves are crossed by quick transitions of the camera's own; hovering, no follow to turn)
    // (how a passage sets off: its first step along among its first lines — steps up or down, or of columns, passed
    // over; a passage with none says no way and is passed over)
    const way = (ls: typeof secs[0]) => { for (let k = 1; k < Math.min(ls.length, 4); k++) { const A = ls[k - 1], B = ls[k];
      if (A.vert || B.vert || Math.abs(B.ay - A.ay) > Math.abs(B.ax - A.ax)) continue; return B.ax > A.ax ? 1 : -1; } return 0; };
    const ways = secs.map(way); let pairs = 0, turns = 0;
    for (let k = 1; k < ways.length; k++) if (ways[k] && ways[k - 1]) { pairs++; if (ways[k] !== ways[k - 1]) turns++; }
    expect(pairs).toBeGreaterThanOrEqual(2); expect(turns / pairs).toBeGreaterThanOrEqual(0.6);
  });
  it('a passage keeps near where it began: no long run one way — it goes on above and below instead', () => {
    if (cut === 'close') return;   // (close up, every line is a long way across the frame)
    let n = 0, near = 0;
    for (const ls of secs) { const O = ls[0]; if (!O) continue;
      // (measured against the passage's first line: a frame at its closeness, or its width if wider)
      const ref = Math.max(P.W / (P.camera.stops.find(s => s.words.includes(O.words[0]))?.z ?? 1), O.bw);
      for (const L of ls.slice(1)) { if (L.scene === 'dash') continue; n++;
        if (Math.abs(L.ax - O.ax) <= 2.4 * Math.max(ref, L.bw * 0.5)) near++; } }
    // (a song sung without a breath leaves no time for a transition: a line or two then go a little further)
    expect(near / n).toBeGreaterThan(0.85);
  });
  it('a line heading leftward is hovered over (as the hover style does), never followed character by character', () => {
    const west = P.lines.filter(L => L.west && !L.vert && !L.scene && L.words.length && !L.words.some(S => S.vert || S.roll || S.frame));
    expect(west.length).toBeGreaterThan(0);
    for (const L of west) { const st = P.camera.stops.filter(s => s.words[0].line === L && !s.over);
      if (cut === 'hover') continue;
      for (const s of st) { expect(s.hov).toBe(true); expect(s.follow ?? []).toEqual([]);
        // (over the middle of its words, leaning and drifting leftward — the way the lines go)
        expect(s.fax![0]).toBeLessThan(0); } }
  });
});

describe.each(styles)('transitions (%s)', cut => {
  const P = make(cut), sig = new Signals(P.map);
  it('the backdrop\'s camera never jumps where the camera cuts', () => {
    for (const k of P.camera.cuts) { const a = cameraAt(P, sig, k.t - 1e-4, 1).cont, b = cameraAt(P, sig, k.t + 1e-4, 1).cont;
      expect(Math.hypot(b.x - a.x, b.y - a.y) * b.z, `cut at ${k.t.toFixed(2)}`).toBeLessThan(2); expect(Math.abs(Math.log(b.z / a.z))).toBeLessThan(0.005); expect(Math.abs(b.r - a.r)).toBeLessThan(0.1); }
  });
  it('the frame keeps its motion through a blur, a little stronger under it', async () => {
    const { holdAt } = await import('../../src/director/evaluate');
    for (const q of P.passages) { expect(holdAt(P, q.t)).toBeGreaterThan(1.3); expect(holdAt(P, q.t - q.inn - 1)).toBe(1); }
  });
  it('after a cut the picture settles in without a lurch: once the blur is nearly gone the settle only slows down', async () => {
    const { settleAt } = await import('../../src/director/evaluate');
    for (const q of P.passages) { let prev = Infinity;
      for (let t = q.t + 0.001; t < q.t + q.out + 1; t += 1 / 60) { const v = Math.abs(Math.log(settleAt(P, t + 1 / 60) / settleAt(P, t))) * 60;
        if (transK(P.passages, t) < 0.1) { expect(v, `${q.reason} at ${(t - q.t).toFixed(2)} after the cut`).toBeLessThanOrEqual(prev + 1e-9); prev = v; } }
      expect(settleAt(P, q.t + q.out + 0.6)).toBe(1); }
  });
  it('a blur begins only once the line before is sung to its end', () => {
    for (const q of P.passages) { const A = P.lines[q.line - 1], end = Math.min(A.L.sung, A.L.end, ...A.words.map(S => S.end));
      expect(end, `${q.reason} at ${q.t.toFixed(2)}: line ${A.i}`).toBeLessThanOrEqual(q.t - q.inn + 0.01); }
  });
  it('a clear without a blur takes away only lines the camera does not see', () => {
    let n = 0;
    for (const L of P.lines) { if (L.secIn !== 0.01) continue; n++; const t = L.secEnd - 0.005, cam = cameraAt(P, sig, t, 0).cam;
      for (const S of L.words) { const p = project(S.x, S.y, S.d, cam, NO_FX, P.W, P.H), half = Math.hypot(S.lw, S.lh) * 0.5 * p.k;
        expect(Math.abs(p.sx) - half > P.W * 0.5 || Math.abs(p.sy) - half > P.H * 0.5, `line ${L.i} at ${t.toFixed(2)}`).toBe(true); } }
    if (cut === 'close') expect(n).toBeGreaterThan(0);
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
    for (const s of P.camera.stops) { if (s.over || s.cut || s.rest > 1 || s.roll) continue; expect(Math.abs(s.arrive - s.t)).toBeLessThan(0.13); }   // (a roll lands when it lands; its word rides along)
  });
  it('a lyric frame is framed as a whole from when it is traced', () => {
    const P = make('glide'), sig = new Signals(P.map); let n = 0, bad = 0;
    for (const S of P.words) { const F = S.frame; if (!F || F.words[F.words.length - 1] !== S) continue;
      for (let t = F.ts + 0.6; t < Math.min(S.end - 0.1, F.ts + 1.2); t += 0.05) { if (transK(P.passages, t) > 0.02) continue; n++;
        const f = cameraAt(P, sig, t, 0); const out = F.words.some(W => corners(W, F.pad * 0.5).some(([x, y]) => { const q = project(x, y, W.d, f.cam, NO_FX, P.W, P.H); return Math.abs(q.sx) > P.W / 2 || Math.abs(q.sy) > P.H / 2; }));
        if (out) bad++; } }
    expect(n).toBeGreaterThan(0); expect(bad / n).toBeLessThan(0.05);
  });
  it('a lyric frame takes a small target (a word or two of one line), now and then', () => {
    const P = make('glide'), Fs = [...new Set(P.words.map(S => S.frame).filter(Boolean))] as NonNullable<(typeof P.words)[0]['frame']>[];
    expect(Fs.length, 'frames in the song: now and then, never most lines').toBeGreaterThanOrEqual(Math.floor(P.lines.length * 0.08)); expect(Fs.length).toBeLessThanOrEqual(Math.ceil(P.lines.length * 0.3));
    for (const F of Fs) { expect(F.words.length).toBeLessThanOrEqual(2); expect(new Set(F.words.map(S => S.line)).size).toBe(1);
      const txt = F.words.map(S => S.w.text.trim()).join(''), cjk = /[\u3000-\u9fff\uac00-\ud7af]/.test(txt);
      if (F.words.length === 2) expect([...txt].length, txt).toBeLessThanOrEqual(cjk ? 4 : 12); }
  });
  it('a lyric frame never pulls the camera closer than its words would be framed without it', () => {
    const on = make('glide'), off = make('glide', LRC, { frame: false });
    const zOff = new Map(off.camera.stops.map(s => [s.words[0].w.id, s.z]));
    for (const s of on.camera.stops) { if (!s.words.some(w => w.frame) || s.cut) continue; const z0 = zOff.get(s.words[0].w.id); if (z0 == null) continue;
      expect(s.z, `stop at ${s.t.toFixed(2)}`).toBeLessThanOrEqual(z0 * 1.6 + 1e-6); }
    const zs = on.camera.stops.filter(s => s.words.some(w => w.frame)).map(s => s.z), zAll = on.camera.stops.map(s => s.z).sort((a, b) => a - b);
    expect(Math.max(...zs)).toBeLessThanOrEqual(zAll[Math.floor(zAll.length * 0.95)] + 1e-6);
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

describe('chorus entries (the lyrics mark them: #1 strongest, #2, #3 lighter)', () => {
  const ts = (s: number) => `[${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}]`;
  const b = 60 / 112, bar = 4 * b, at = (k: number) => 0.3 + k * bar;
  const V1 = ['街の灯りが遠くなる', 'ひとりきりの帰り道', '言えなかった言葉たち', 'ポケットの中で眠る'], V2 = ['窓の外は雨模様', '時計の針が止まる', '昨日の夢を数えて', '静かに朝を待つ'];
  const C = ['夜を駆けていく', '二人だけの空へ', '手を伸ばしたその先に', '光が見えるから'];
  const rows: [number, string][] = [];
  V1.forEach((l, i) => rows.push([at(2 + i * 2) + b * 0.5, l])); C.forEach((l, i) => rows.push([at(10 + i * 2) - b * 0.15, (i ? '' : '#1 ') + l]));
  V2.forEach((l, i) => rows.push([at(20 + i * 2) + b * 0.5, l])); C.forEach((l, i) => rows.push([at(28 + i * 2) - b * 0.15, (i ? '' : '#3 ') + l]));
  const src = rows.map(([t, l]) => ts(t) + l).join('\n'), P = make('glide', src);
  const es = markedEntries(P.map, P.doc.marks, t => t > 0.5 && t < P.musicEnd - 0.5), near = (t: number, k: number) => Math.abs(t - at(k)) < 0.06;
  it('an entry on the downbeat each marked chorus comes in on, and only there (nothing guessed from repeated lines)', () => {
    const leads = es.filter(x => x.lead);
    expect(leads.map(x => x.e.t.toFixed(2))).toHaveLength(2);
    expect(near(leads[0].e.t, 10) && near(leads[1].e.t, 28), leads.map(x => x.e.t).join(', ')).toBe(true);
    expect(leads[0].k).toBe(MARK_K[1]); expect(leads[1].k).toBe(MARK_K[3]);
    for (const k of [10, 28]) expect(P.cues.flash.some(q => near(q.t, k)), `flash at bar ${k}`).toBe(true);
    const plain = make('glide', src.replace(/#[1-3] /g, '')); expect(markedEntries(plain.map, plain.doc.marks, () => true)).toHaveLength(0);
  });
  it('follows each entry with its next two hits, each weaker than the one before', () => {
    for (const k of [10, 28]) {
      const L = es.find(x => x.lead && near(x.e.t, k))!, after = es.filter(x => !x.lead && x.e.t > L.e.t && x.e.t <= at(k + 2) + 0.06);
      expect(after, `after bar ${k}`).toHaveLength(2);
      expect(after[0].k).toBeLessThan(L.k); expect(after[1].k).toBeLessThan(after[0].k);
    }
  });
  it('lets the trigger sensitivity decide how many of them fire (#3 needs more than #1)', () => {
    const n = (s: number) => es.filter(x => x.k >= entryFloor(s)).length;
    expect(n(0.3)).toBe(1); expect(n(0.75)).toBe(3); expect(n(1)).toBe(4); expect(n(2)).toBe(6);
    for (let s = 0; s < 2; s += 0.1) expect(n(s + 0.1)).toBeGreaterThanOrEqual(n(s));
    const lo = make('glide', src, { trigger: 0.3 }), hiP = make('glide', src, { trigger: 1.6 });
    expect(lo.style.m.flash).toBeLessThan(P.style.m.flash); expect(hiP.style.m.impact).toBeGreaterThan(P.style.m.impact);
  });
  it('in word-timed lyrics a mark fires on its own syllable — off the beat, mid-line, inside a merged word — not on a beat near it', () => {
    // (the line's syllables stamped; #1 written before 'た' at 21.93 — between beats — and the segmenter makes one word of 'あなた')
    const kar = '[00:20.00]<00:20.00>ずっと<00:20.80>そばに<00:21.40>あな<00:21.93>#1た<00:22.40>と<00:23.00>\n[00:30.00]<00:30.00>おわり<00:31.00>';
    const Q = make('glide', kar), m = Q.doc.marks[0];
    expect(m.t).toBeCloseTo(21.93, 2); expect(m.exact).toBe(true);
    const lead = markedEntries(Q.map, Q.doc.marks, () => true).find(x => x.lead)!; expect(lead.e.t).toBeCloseTo(21.93, 2);
    const base = presetStyle('cover'), st = normalizeStyle({ ...base, preset: 'custom', fx: { ...base.fx, chroma: true } });
    const R = plan({ doc: Q.doc, map: Q.map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd: Q.musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
    expect(R.cues.flash.some(q => Math.abs(q.t - 21.93) < 0.01), 'the flash on the syllable').toBe(true);
    expect(R.cues.chroma.some(q => Math.abs(q.t - 21.93) < 0.01), 'the colour split on the syllable').toBe(true);
  });
  it('a marked chorus brings the colour split and the glitch on its opening hit, with the glass', () => {
    const map = P.map, p2 = parse(src), musicEnd = P.musicEnd, doc = buildLyrics(p2, map, musicEnd), base = presetStyle('cover');
    const st = normalizeStyle({ ...base, preset: 'custom', fx: { ...base.fx, glass: true, chroma: true, glitch: true } });
    const Q = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
    for (const k of [10, 28]) { expect(Q.cues.chroma.some(q => near(q.t, k)), `colour split at bar ${k}`).toBe(true); expect(Q.cues.glitch.some(q => near(q.t, k)), `glitch at bar ${k}`).toBe(true); }
    expect(Q.cues.glass.some(q => near(q.t, 10)), 'glass at the #1 entry').toBe(true);
  });
});

describe('roller', () => {
  // a word sung three times with room to turn, in an ordinary line, plus a fast repeat that has no room
  const ts = (s: number) => `[${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}]`;
  const kar = (t0: number, ws: [string, number][]) => ts(t0) + ws.map(([w, t]) => `<${ts(t).slice(1, -1)}>${w} `).join('');
  const src = [ts(1) + 'the night is young', kar(4, [['go', 4], ['走吧', 4.6], ['走吧', 6.8], ['走吧', 9]]), ts(11) + 'under the city lights', kar(14, [['再見', 14], ['再見', 14.3], ['朋友', 14.6]]), ts(17) + 'we keep on going home', ts(21) + 'till the morning comes'].join('\n');
  for (const cut of styles) {
    const P = make(cut, src), sig = new Signals(P.map), rolls = P.words.filter(S => S.roll);
    it(`turns the repeated word half round, left then right, only with room to turn (${cut})`, () => {
      expect(rolls.map(S => S.w.text + S.roll)).toEqual(['走吧-1', '走吧1', '走吧-1']);
      for (let i = 1; i < rolls.length; i++) expect(Math.abs(Math.abs(((rolls[i].tilt - rolls[i - 1].tilt) % 360 + 540) % 360 - 180) - 180)).toBeLessThan(1);
    });
    it(`the camera rolls the asked way with a spring, and is never late for the next words (${cut})`, () => {
      for (const S of rolls) {
        const st = P.camera.stops.find(s => s.words[0] === S)!, m = P.camera.moves.find(x => Math.abs(x.a - st.arrive) < 1e-6 && x.ease === 'roll')!;
        expect(m, S.w.text).toBeTruthy(); expect(Math.sign(m.dr)).toBe(S.roll); expect(Math.abs(Math.abs(m.dr) - 180)).toBeLessThan(15);
        const i = P.camera.stops.indexOf(st), nx = P.camera.stops[i + 1]; if (nx && !nx.cut) expect(st.arrive).toBeLessThanOrEqual(nx.t);
      }
    });
    it(`a word that appears before its roll lands is already in its place, turned round, and the camera rolls to it (${cut})`, () => {
      const up = (S: typeof rolls[0], t: number) => { const f = cameraAt(P, sig, t, 0), q = project(S.x, S.y, S.d, f.cam, NO_FX, P.W, P.H); return { q, off: Math.abs(((q.rot + S.tilt) % 360 + 540) % 360 - 180) }; };
      for (const S of rolls) { const st = P.camera.stops.find(x => x.words[0] === S)!; if (!(st.arrive > S.show + 0.05)) continue;
        // (from the moment it shows, the camera turns toward it: the word never turns further away than it appeared, but
        // for the roll's own spring swinging a little past upright and back)
        const first = up(S, S.show).off; for (let t = S.show; t <= st.arrive; t += 0.03) expect(up(S, t).off, `${S.w.text} at ${t.toFixed(2)}`).toBeLessThanOrEqual(first + 22);
        const end = up(S, st.arrive); expect(end.off, 'upright once the roll has landed').toBeLessThan(25);
        expect(Math.abs(end.q.sx)).toBeLessThan(P.W / 2); expect(Math.abs(end.q.sy)).toBeLessThan(P.H / 2); }
    });
  }
  it('pace, energy and turns reach the roll (its length, its spring, its swing)', () => {
    const roll = (k: Record<string, number>) => { const base = presetStyle('cover'), st = normalizeStyle({ ...base, preset: 'custom', cut: 'glide', k: { ...base.k, ...k } });
      const doc = buildLyrics(parse(src), RhythmMap.grid(112, 0.3, 160), 30), P = plan({ doc, map: RhythmMap.grid(112, 0.3, 160), style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd: 30, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
      return P.camera.moves.find(m => m.ease === 'roll')!; };
    const a = roll({}), fast = roll({ pace: 1.5 }), hard = roll({ energy: 2 }), wide = roll({ turns: 2 });
    expect(fast.a - fast.s).toBeLessThan(a.a - a.s); expect(hard.spring![0]).toBeGreaterThan(a.spring![0]); expect(wide.spring![1]).toBeGreaterThan(a.spring![1]); expect(wide.zb!).toBeGreaterThan(a.zb!);
  });
});

describe('centred stage (the record theme)', () => {
  const map = RhythmMap.grid(112, 0.3, 160), p = parse(LRC), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6, doc = buildLyrics(p, map, musicEnd);
  const P = plan({ doc, map, style: presetStyle('vinyl'), measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } }), sig = new Signals(P.map);
  it('never turns, and only leans a little toward a line (back to the middle in a pause)', () => {
    let far = 0; for (let t = 0; t < P.dur; t += 0.1) { const f = cameraAt(P, sig, t, 1); expect(Math.abs(f.cam.r) + Math.abs(f.fx.r), `roll at ${t.toFixed(1)}`).toBeLessThan(1e-9);
      far = Math.max(far, Math.hypot(f.cam.x, f.cam.y) * f.cam.z / P.H); }
    expect(far).toBeLessThan(0.06);
    const gaps = P.lines.slice(1).map((L, i) => [Math.min(P.lines[i].L.sung, P.lines[i].L.end), L.words[0]?.show ?? 0]).filter(([a, b]) => b - a > 4);
    for (const [a] of gaps) { const b = basePose(P.camera, a + 2.5); expect(Math.hypot(b.x, b.y)).toBeLessThan(1); }
  });
  /** The groups the stage shows (a transition before each but the first): the lines of each, in order. */
  const groups = (Q: typeof P) => { const sung = Q.lines.filter(L => L.words.length), gs: (typeof sung)[] = [];
    for (const L of sung) { if (!gs.length || Q.passages.some(x => x.line === L.i)) gs.push([]); gs[gs.length - 1].push(L); } return gs; };
  const rowsOf = (L: typeof P.lines[0]) => new Set(L.words.map(S => Math.round(S.y))).size;
  /** In each group: the middle, above it, below it; three rows at most (or a line of more rows alone), and the next
   *  line would not have fitted in it. */
  const inTurn = (Q: typeof P) => { const gs = groups(Q);
    gs.forEach((g, gi) => { const M = g[0], rows = g.reduce((a, L) => a + rowsOf(L), 0);
      expect(g.length).toBeLessThanOrEqual(3); if (g.length > 1) expect(rows, M.L.text).toBeLessThanOrEqual(3);
      const nx = gs[gi + 1]?.[0]; if (nx && g.length < 3) expect(rows + rowsOf(nx), M.L.text).toBeGreaterThan(3);
      expect(Math.abs(M.ay), M.L.text).toBeLessThan(M.bh * 0.6);                                     // (the middle)
      if (g[1]) expect(g[1].ay).toBeLessThan(M.ay - (M.bh + g[1].bh) / 2 + 1);                        // (above it, clear of it)
      if (g[2]) expect(g[2].ay).toBeGreaterThan(M.ay + (M.bh + g[2].bh) / 2 - 1); });               // (below it)
    return gs; };
  it('sets every line level and inside the frame, as many at a time as fit in three rows: the middle, above it, below it; a transition after each group', () => {
    const sung = P.lines.filter(L => L.words.length);
    sung.forEach(L => { for (const S of L.words) expect(S.tilt).toBe(0);
      const f = cameraAt(P, sig, L.words[0].w.t + 0.3, 0);
      for (const S of L.words) for (const [x, y] of corners(S)) { const q = project(x, y, S.d, f.cam, NO_FX, P.W, P.H); expect(Math.abs(q.sx), `${L.L.text}`).toBeLessThan(P.W / 2); expect(Math.abs(q.sy)).toBeLessThan(P.H / 2); } });
    expect(inTurn(P).length).toBeGreaterThan(3);
  });
  it('counts rows, not lines: a wrapped line takes two of the three', () => {
    const long = '這是一句非常非常長的歌詞 會在畫面裡 換成兩行 才能放得下 一直唱下去', short = '短短一句';
    const src = [long, short, short, short, long, long, short, short].map((x, i) => `[00:${String(4 + i * 6).padStart(2, '0')}.00]${x}`).join('\n');
    const pp = parse(src), doc2 = buildLyrics(pp, map, 70);
    const Q = plan({ doc: doc2, map, style: presetStyle('vinyl'), measure: approxMeasurer(), aspect: 16 / 9, musicEnd: 70, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
    expect(rowsOf(Q.lines[0]), 'the long line wraps').toBeGreaterThan(1);
    const gs = inTurn(Q); expect(gs[0].length).toBeLessThan(3);
  });
  it('a group goes together in the transition before the next — none before, all of it by its height', () => {
    const ctx = { enter: 0.4, tempo: 1, float: 0, future: 'dim' as const, smooth: true, punch: 0.3, motion: 1, drift: false };
    const up = (L: typeof P.lines[0], t: number) => L.words.some(S => wordState(S, t, 0, false, ctx) != null), gs = groups(P);
    for (let g = 0; g + 1 < gs.length; g++) { const q = P.passages.find(x => x.line === gs[g + 1][0].i)!;
      for (const L of gs[g]) { expect(up(L, q.t - q.inn - 0.05), L.L.text).toBe(true); expect(up(L, q.t + 0.01), L.L.text).toBe(false); } }
  });
});

describe('idle in pauses and through the ending', () => {
  const ts = (s: number) => `[${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}]`;
  const src = [ts(2) + 'the night is young', ts(6) + 'under the city lights', ts(10) + 'we keep on going home', ts(16) + '♪～', ts(24) + '(間奏)', ts(32) + '……'].join('\n');
  const map = RhythmMap.grid(112, 0.3, 120), p = parse(src), musicEnd = 60, doc = buildLyrics(p, map, musicEnd);
  const P = plan({ doc, map, style: presetStyle('cover'), measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } }), sig = new Signals(P.map);
  it('a long outro goes idle, whatever marks the lyrics put in it ("♪～", "(間奏)", "……")', () => {
    expect(cameraAt(P, sig, 25, 1).idle).toBeGreaterThan(0.99); expect(cameraAt(P, sig, 50, 1).idle).toBeGreaterThan(0.99);
  });
  it('and stays idle through the ending: the camera does not come back before the card', () => {
    for (let t = musicEnd - 2; t < P.dur; t += 0.1) expect(cameraAt(P, sig, t, 1).idle, `at ${t.toFixed(1)}`).toBeGreaterThan(0.99);
    const a = cameraAt(P, sig, musicEnd - 1.5, 1).cam, b = cameraAt(P, sig, musicEnd + 0.5, 1).cam;
    expect(Math.hypot(a.x - b.x, a.y - b.y) * a.z).toBeLessThan(P.W * 0.06);       // only the idle drift's own slow motion (the old pull-back moved ~130 px in under a second)
  });
});

describe('vertical lines', () => {
  const phrases = ['春风十里', '夜色温柔', '心事如潮', '灯火阑珊', '雨落无声', '远山如黛', '月光倾城', '旧梦难寻'];
  const src = Array.from({ length: 48 }, (_, i) => { const t = 4 + i * 2.6, m = Math.floor(t / 60), sec = (t % 60).toFixed(2).padStart(5, '0');
    return `[${String(m).padStart(2, '0')}:${sec}]${phrases[i % phrases.length]} ${phrases[(i * 3 + 1) % phrases.length]}`; }).join('\n');
  it.each(styles)('sets whole lines vertically, in runs of two to four, and the rows still turn (%s)', cut => {
    const P = make(cut, src, { frame: false });
    const v = P.lines.map(L => !!L.vert);
    expect(v.some(Boolean)).toBe(true);
    for (const L of P.lines) for (const S of L.words) expect(S.vert).toBe(!!L.vert);     // never rows and columns within a line
    for (let i = 0; i < v.length;) { if (!v[i]) { i++; continue; } let j = i; while (j < v.length && v[j]) j++; expect(j - i).toBeGreaterThanOrEqual(2); expect(j - i).toBeLessThanOrEqual(4); i = j; }
    const rows = P.lines.filter(L => !L.vert).flatMap(L => L.words);
    expect(rows.filter(S => Math.abs(S.ang) > 1).length, 'turns among the rows').toBeGreaterThan(0);
  });
  it.each(['punch', 'glide', 'waltz', 'close'] as const)('the camera follows a column down as it is sung, as it follows a row along (%s)', cut => {
    const P = make(cut, src, { frame: false }); let n = 0, moved = 0;
    for (const st of P.camera.stops) { const S = st.words[0]; if (!S.vert || st.words.length > 1 || S.units.length < 4) continue; const us = S.units, t0 = Math.max(st.arrive, us[0].t ?? S.w.t), t1 = us[us.length - 1].t ?? S.end; if (t1 - t0 < 0.3) continue; n++;
      const a = basePose(P.camera, t0 + 0.02), b = basePose(P.camera, t1 + 0.15), down = Math.hypot(us[us.length - 1].ox - us[0].ox, us[us.length - 1].oy - us[0].oy);
      const ax = st.fax || [0, 1]; if ((b.x - a.x) * ax[0] + (b.y - a.y) * ax[1] > down * 0.2) moved++; }   // (along the column, whichever way the page has turned)
    expect(n).toBeGreaterThan(0);
    expect(moved / n, `${moved} of ${n} columns`).toBeGreaterThan(0.6);
  });
  it.each(['glide', 'waltz', 'punch'] as const)('a line of columns after one sits beside it (top level with its fourth character) or below it (%s)', cut => {
    const P = make(cut, src, { frame: false }); let n = 0, ok = 0;
    for (let i = 1; i < P.lines.length; i++) { const A = P.lines[i - 1], B = P.lines[i]; if (!A.vert || !B.vert || A.sec !== B.sec) continue; n++;
      const d = [Math.cos(A.words[0].ang * Math.PI / 180), Math.sin(A.words[0].ang * Math.PI / 180)], nr = [-d[1], d[0]], at = (x: number, y: number) => [x * d[0] + y * d[1], x * nr[0] + y * nr[1]];
      const ext = (L: typeof A) => { let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9; for (const S of L.words) for (const [x, y] of corners(S)) { const [u, v] = at(x, y); a0 = Math.min(a0, u); a1 = Math.max(a1, u); b0 = Math.min(b0, v); b1 = Math.max(b1, v); } return { a0, a1, b0, b1 }; };
      const ea = ext(A), eb = ext(B), us = A.words.flatMap(S => S.units.map(u => ({ y: at(S.x + u.ox * Math.cos(S.tilt * Math.PI / 180) - u.oy * Math.sin(S.tilt * Math.PI / 180), S.y + u.ox * Math.sin(S.tilt * Math.PI / 180) + u.oy * Math.cos(S.tilt * Math.PI / 180))[1], h: u.h })));
      const u4 = us[Math.min(3, us.length - 1)], top4 = u4.y - u4.h / 2, beside = eb.a0 >= ea.a1 - 1 || eb.a1 <= ea.a0 + 1, below = eb.b0 >= ea.b1 - 1;
      if ((beside && Math.abs(eb.b0 - top4) < u4.h * 0.2) || below) ok++; }
    expect(n).toBeGreaterThan(5); expect(ok / n, `${ok} of ${n}`).toBeGreaterThan(0.7);
  });
  it('the centred stage keeps every line level', () => {
    const p = parse(src), map = RhythmMap.grid(112, 0.3, 160), musicEnd = 140, doc = buildLyrics(p, map, musicEnd);
    const st = normalizeStyle({ ...presetStyle('cover'), preset: 'custom', cut: 'center' });
    const P = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
    expect(P.words.some(S => S.vert)).toBe(false);
  });
});

describe('emphasis and lyric frames', () => {
  it('lights a few characters now and then — never a whole unspaced line', () => {
    const P = make('glide'); const em = P.words.filter(S => S.emph);
    expect(em.length).toBeGreaterThanOrEqual(Math.floor(P.lines.length / 5)); expect(em.length).toBeLessThanOrEqual(Math.ceil(P.lines.length / 2.5));
    for (const S of em) { const [a, b] = S.emph!; expect(b - a).toBeGreaterThan(0); if (!S.w.latin) expect(b - a).toBeLessThanOrEqual(4); if (S.line.words.length === 1 && !S.w.latin && S.units.length > 3) expect(b - a).toBeLessThan(S.units.length); }
  });
  it.each(['punch', 'glide', 'waltz', 'hover'] as const)('a lyric frame is in view whole while it is drawn — the camera pulls back over it (%s)', cut => {
    const P = make(cut), sig = new Signals(P.map), Fs = new Set(P.words.map(S => S.frame).filter(Boolean));
    for (const F of Fs) { const fe = Math.min(F!.words[0].line.L.end - 0.8, F!.until ?? Infinity); if (F!.ts + 0.9 > fe) continue; const t = F!.ts + 0.9, cam = cameraAt(P, sig, t, 0).cam;
      for (const S of F!.words) for (const [x, y] of corners(S, F!.pad * 0.5)) { const q = project(x, y, S.d, cam, NO_FX, P.W, P.H); expect(Math.max(Math.abs(q.sx) / (P.W / 2), Math.abs(q.sy) / (P.H / 2)), `${S.w.text} at ${t.toFixed(1)}`).toBeLessThan(1.1); } }
  });
});

describe('album play', () => {
  it('has only the small title at the top and no ending card (nothing that lengthens the song)', async () => {
    const { planTitles } = await import('../../src/director/titles');
    const map = RhythmMap.grid(112, 0.3, 160), labels = { composer: 'c', lyricist: 'l', artist: 'a' };
    const solo = planTitles({ on: true, title: 'T', artist: 'A' }, 20, map, 180, labels), album = planTitles({ on: true, title: 'T', artist: 'A', album: true }, 20, map, 180, labels);
    expect(solo.intro?.kind).toBe('card'); expect(solo.end).not.toBeNull();
    expect(album.intro?.kind).toBe('top'); expect(album.end).toBeNull();
  });
});

describe('crowded pages', () => {
  it('never keeps more than ten lines on the page, even when the lines run straight into each other (cleared unseen, no blur)', () => {
    const src = Array.from({ length: 40 }, (_, i) => `[${String(Math.floor((2 + i * 2.2) / 60)).padStart(2, '0')}:${((2 + i * 2.2) % 60).toFixed(2).padStart(5, '0')}]一句接著一句 不停`).join('\n');
    for (const cut of ['glide', 'punch'] as const) { const P = make(cut, src, { frame: false });
      for (let t = 2; t < P.musicEnd; t += 0.25) expect(P.lines.filter(L => L.words.length && L.words[0].show <= t && t < L.secEnd).length, `${cut} at ${t}`).toBeLessThanOrEqual(10);
      expect(P.passages.length, 'no blur where the line before cannot be sung out').toBe(0); }
  });
});

describe('lyric types', () => {
  it('whole line: every word of a line comes in with its first, all one size; flow: each word just before it is sung', () => {
    const p = parse(LRC), map = RhythmMap.grid(112, 0.3, 160), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6, doc = buildLyrics(p, map, musicEnd);
    const mk = (ltype: string) => plan({ doc, map, style: normalizeStyle({ ...presetStyle('cover'), preset: 'custom', ltype }), measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
    const line = mk('line'), flow = mk('flow');
    for (const L of line.lines) { for (const S of L.words) expect(S.show).toBe(L.words[0].show); expect(new Set(L.words.filter(S => !S.w.latin).map(S => S.s)).size).toBeLessThanOrEqual(1); }
    expect(flow.lines.some(L => L.words.some(S => S.show > L.words[0].show + 0.1))).toBe(true);
  });
});

describe('where a new line goes', () => {
  it('a line that starts back to the left sits above or below the line before: carrying on (its middle never further left than that one\'s), or heading back leftward', () => {
    for (const cut of ['glide', 'punch', 'close'] as const) {
      const P = make(cut, LRC, { frame: false }); let n = 0, ok = 0, nb = 0, okb = 0;
      const unitsAt = (L: typeof P.lines[0]) => L.words.flatMap(S => S.units.map(u => { const c = Math.cos(S.tilt * Math.PI / 180), sn = Math.sin(S.tilt * Math.PI / 180); return [S.x + c * u.ox - sn * u.oy, S.y + sn * u.ox + c * u.oy, u.w] as const; }));
      for (let i = 1; i < P.lines.length; i++) { const A = P.lines[i - 1], B = P.lines[i]; if (A.sec !== B.sec || A.vert || B.vert || !A.words.length || !B.words.length) continue;
        const d = [Math.cos(A.words[A.words.length - 1].ang * Math.PI / 180), Math.sin(A.words[A.words.length - 1].ang * Math.PI / 180)], ua = unitsAt(A), ub = unitsAt(B);
        if (Math.abs(B.words[0].ang - A.words[A.words.length - 1].ang) > 1 || B.words.some(S => S.roll || Math.abs(S.ang - B.words[0].ang) > 1)) continue;
        const along = (p: readonly number[]) => p[0] * d[0] + p[1] * d[1], endA = along(ua[ua.length - 1]), startB = along(ub[0]);
        if (startB >= endA - 1) continue;                                   // (one that runs on to the right)
        // (one laid heading back goes leftward instead: tested below)
        if (B.back) { nb++; const nrm = [-d[1], d[0]], across = (p: readonly number[]) => p[0] * nrm[0] + p[1] * nrm[1];
          if (along(ub[0]) < along(ua[0]) && along([B.ax, B.ay]) < along([A.ax, A.ay]) && ((Math.abs(across([B.ax, B.ay]) - across([A.ax, A.ay])) > (A.bh + B.bh) * 0.4 || along(ub[ub.length - 1]) < along(ua[0])))) okb++; continue; }
        if (B.west) continue;                                                // (one in a passage going leftward: framed whole, going left as it should)
        // (one carrying on in a passage that goes onward: a row above or below, its middle never left of the line before's)
        n++; if (along([B.ax, B.ay]) >= along([A.ax, A.ay]) - Math.max(A.bh, B.bh) * 0.5) ok++; }
      // (a passage gone far from where it began steps a little back towards there on purpose: a few lines do)
      expect(n + nb, cut).toBeGreaterThanOrEqual(3); if (n >= 3) expect(ok / n, `${cut}: ${ok}/${n}`).toBeGreaterThanOrEqual(0.7);
      // a line laid heading back: a row above or below (or wholly to its left), starting before the line before began, its middle left of that one's
      // (most of them: one nudged clear of an earlier word may sit a little off its row)
      expect(nb, cut).toBeGreaterThanOrEqual(1); expect(okb / nb, `${cut}: ${okb}/${nb}`).toBeGreaterThan(0.75); }
  });
});

/* A lyric frame is wholly in the picture while it is up — whatever the camera style, the aspect, rows or columns, long
   lines (fit.ts); and a page never keeps more than PAGE_LINES lines up at once (plan.ts), one more only while it fades. */
describe('framing and the page', async () => {
  const { PAGE_LINES } = await import('../../src/director/layout');
  // (the lyrics as the app has them: broken into words by the segmenter)
  const { loadSegmenter } = await import('../../src/text/segment'), { respace } = await import('../../src/lyrics/spacing'); await loadSegmenter();
  const line = (t: number, s: string) => { const m = Math.floor(t / 60), x = (t % 60).toFixed(2).padStart(5, '0'); return `[0${m}:${x}]${s}`; };
  const WORDS = ['看見遠方的光', '我們一起走 到天亮', 'hold me close tonight', '夜色', '風吹過山丘與海洋之間', '慢慢地醒來吧', 'we are young'];
  const SONGS = [LRC, ...[0, 1, 2].map(k => Array.from({ length: 30 }, (_, i) => line(2 + i * (2.4 + k * 0.4), WORDS[(i * (k + 1) + k) % 7])).join('\n')),
    Array.from({ length: 40 }, (_, i) => line(2 + i * 2.2, `這是第${i + 1}句歌詞`)).join('\n')];
  const build = (src: string, cut: typeof styles[number], aspect: number) => {
    const map = RhythmMap.grid(112, 0.3, 160), p = respace(parse(src)), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6, doc = buildLyrics(p, map, musicEnd);
    const st = normalizeStyle({ ...presetStyle('cover'), preset: 'custom', cut, fx: { ...presetStyle('cover').fx, frame: true } });
    return plan({ doc, map, style: st, measure: approxMeasurer(), aspect, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
  };
  it.each(styles)('every frame stays in the picture while it is up (%s; 16:9, 1:1, 9:16)', cut => {
    const bad: string[] = [];
    for (const src of SONGS) for (const aspect of [16 / 9, 1, 9 / 16]) {
      const P = build(src, cut, aspect), sig = new Signals(P.map), frames = [...new Set(P.words.map(S => S.frame).filter(Boolean))] as NonNullable<ScenePlan['words'][0]['frame']>[];
      for (let t = 1; t < P.musicEnd; t += 0.1) { if (transK(P.passages, t) > 0.02) continue; const f = cameraAt(P, sig, t, 1);
        for (const F of frames) { const L = F.words[0].line; if (t < F.ts + 0.85 || t > Math.min(L.L.end - 0.8, F.until ?? Infinity, L.secEnd - L.secIn)) continue;
          for (const S of F.words) for (const [x, y] of corners({ x: S.x, y: S.y, lw: S.lw + F.pad * 2, lh: S.lh + F.pad * 2, tilt: S.tilt })) { const q = project(x, y, S.d, f.cam, f.fx, P.W, P.H);
            const out = Math.max(Math.abs(q.sx) - P.W / 2, Math.abs(q.sy) - P.H / 2); if (out > 3) bad.push(`${aspect.toFixed(2)} ${t.toFixed(1)} ${F.words.map(w => w.w.text).join('')} +${out.toFixed(0)}`); } } }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
  it.each(styles)('a page keeps at most PAGE_LINES lines up (%s)', cut => {
    for (const src of SONGS) { const P = build(src, cut, 16 / 9); let most = 0;
      for (let t = 1; t < P.musicEnd; t += 0.1) { const up = P.lines.filter(L => L.words.length && L.words[0].show <= t && t < L.secEnd - L.secIn - 0.02).length; most = Math.max(most, up); }
      expect(most).toBeLessThanOrEqual(PAGE_LINES); }
  });
});

describe('depth', () => {
  it('the frame\'s shake, roll and push are felt by depth: near more, far less — never one flat layer', async () => {
    const { project, NO_FX } = await import('../../src/director/project');
    const cam = { x: 0, y: 0, z: 1, r: 0, d: 0, yaw: 0, pitch: 0 }, fx = { x: 12, y: -8, r: 1.5, z: 1.06 };
    const moved = (D: number) => { const a = project(200, 100, D, cam, NO_FX, 1280, 720), b = project(200, 100, D, cam, fx, 1280, 720);
      return { off: Math.hypot(b.sx - a.sx, b.sy - a.sy), rot: b.rot - a.rot, push: b.k / a.k }; };
    const near = moved(-300), mid = moved(0), far = moved(600);
    expect(near.off).toBeGreaterThan(mid.off); expect(mid.off).toBeGreaterThan(far.off);
    expect(near.rot).toBeGreaterThan(mid.rot); expect(mid.rot).toBeGreaterThan(far.rot);
    expect(near.push).toBeGreaterThanOrEqual(mid.push - 1e-9); expect(mid.push).toBeGreaterThan(far.push);
    // (at the camera's own depth, the frame's motion as it is)
    expect(mid.rot).toBeCloseTo(1.5, 6);
  });
});
