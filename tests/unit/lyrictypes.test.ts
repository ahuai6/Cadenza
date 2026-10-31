// The lyric types' arrangements (流動 more often above and below, 圓心 round the line before), a frame asked for in
// the lyrics ('$1'), and the word rings' place in the effects.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { respace } from '../../src/lyrics/spacing';
import { RhythmMap } from '../../src/rhythm/map';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan } from '../../src/director';

const LRC = readFileSync(new URL('../fixtures/long.lrc', import.meta.url), 'utf8');
function make(ltype: string, cut = 'glide', src = LRC, fx: Record<string, boolean> = {}) {
  const map = RhythmMap.grid(112, 0.3, 160), p = parse(src), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6, doc = buildLyrics(p, map, musicEnd);
  const st = normalizeStyle({ ...presetStyle('cover'), preset: 'custom', cut: cut as 'glide', ltype, fx: { ...presetStyle('cover').fx, ...fx } });
  return plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
}
/** How the lines go on from one to the next within a passage: up or down (more across than along), or along. */
function steps(P: ReturnType<typeof make>) {
  let vert = 0, along = 0;
  for (let k = 1; k < P.lines.length; k++) { const A = P.lines[k - 1], B = P.lines[k]; if (A.sec !== B.sec || !A.words.length || !B.words.length) continue;
    if (Math.abs(B.ay - A.ay) > Math.abs(B.ax - A.ax) * 0.6) vert++; else along++; }
  return { vert, along };
}

describe('lyric types', () => {
  it('流動: the lines go on above or below more often than its odds alone would have them', async () => {
    const { LYRIC_TYPES } = await import('../../src/director/lyrictypes'), flow = LYRIC_TYPES.flow as { stack?: number }, keep = flow.stack;
    for (const cut of ['glide', 'punch']) { const share = () => { const s = steps(make('flow', cut)); return s.vert / (s.vert + s.along); };
      const more = share(); flow.stack = 1; const plain = share(); flow.stack = keep;
      expect(more, cut).toBeGreaterThan(plain); }
  });
  describe('圓心', () => {
    const P = make('orbit'), F = make('flow');
    it('the first line near the middle of the scene, the next ones round the line before on every side', () => {
      expect(Math.hypot(P.lines[0].ax, P.lines[0].ay)).toBeLessThan(P.lines[0].bw);
      let up = 0, down = 0, side = 0;
      for (let k = 1; k < P.lines.length; k++) { const A = P.lines[k - 1], B = P.lines[k]; if (A.sec !== B.sec) continue; const dx = B.ax - A.ax, dy = B.ay - A.ay;
        if (Math.abs(dy) > Math.abs(dx) * 0.6) (dy < 0 ? up++ : down++); else side++; }
      expect(up).toBeGreaterThan(3); expect(down).toBeGreaterThan(3); expect(side).toBeGreaterThan(3);
    });
    it('stays within one circle: every line of a passage near its first, and the passages wander no one way', () => {
      for (const cut of ['glide', 'punch', 'waltz', 'close']) { const Q = cut === 'glide' ? P : make('orbit', cut);
        const zs = Q.camera.stops.map(x => x.z).sort((a, b) => a - b), frame = Q.W / zs[zs.length >> 1];
        const secs = new Map<number, typeof Q.lines>(); for (const L of Q.lines) if (L.words.length) { if (!secs.has(L.sec)) secs.set(L.sec, []); secs.get(L.sec)!.push(L); }
        let right = 0, left = 0;
        for (const ls of secs.values()) { const O = ls[0];
          for (const L of ls) expect(Math.hypot(L.ax - O.ax, L.ay - O.ay), `${cut} line ${L.i}`).toBeLessThan(frame * 2.3);   // (about a frame each way round the centre: close up, the frame is smaller than the words' own reach)
          for (let k = 1; k < ls.length; k++) (ls[k].ax > ls[k - 1].ax ? right++ : left++); }
        // (each step from a line to the next as often leftward as rightward: no way the lines keep going)
        expect(right / (right + left), cut).toBeGreaterThan(0.3); expect(right / (right + left), cut).toBeLessThan(0.7); }
    });
    it('left and right in turn from the first line on (not a run one way, then a run back)', () => {
      for (const cut of ['glide', 'punch']) { const Q = cut === 'glide' ? P : make('orbit', cut);
        let runs = 0, steps = 0;
        for (let k = 2; k < Q.lines.length; k++) { const A = Q.lines[k - 2], B = Q.lines[k - 1], C = Q.lines[k]; if (A.sec !== C.sec) continue;
          steps++; if (Math.sign(B.ax - A.ax) === Math.sign(C.ax - B.ax)) runs++; }
        // (two steps the same way in a row now and then — a line nudged clear of another — but mostly turn and turn about)
        expect(runs / steps, cut).toBeLessThan(0.45); }
    });
    it('a line once sung is gone as soon as the camera no longer sees it', async () => {
      const { basePose } = await import('../../src/director/camera'), { project, NO_FX } = await import('../../src/director/project'), { wordState } = await import('../../src/director/words');
      const c = { enter: 0.35, tempo: 1, float: 0, future: 'dim' as const, smooth: true, punch: 0.3, motion: 1, drift: false };
      let n = 0;
      for (let t = 1; t < P.musicEnd; t += 0.2) { const b = basePose(P.camera, t), cam = { x: b.x, y: b.y, z: b.z, r: b.r, d: b.d, yaw: 0, pitch: 0 };
        for (const L of P.lines) { if (!L.words.length || t < Math.max(L.words[L.words.length - 1].end, Math.min(L.L.sung, L.L.end)) + 0.5) continue;
          // (hidden within a moment of leaving the picture)
          if (!L.words.some(S => (wordState(S, t + 0.06, 0, false, c)?.o ?? 0) > 0.02)) continue;
          const inView = L.words.some(S => { const p = project(S.x, S.y, S.d, cam, NO_FX, P.W, P.H), h = Math.hypot(S.lw, S.lh) * 0.5 * p.k; return Math.abs(p.sx) - h < P.W * 0.56 && Math.abs(p.sy) - h < P.H * 0.56; });
          n++; expect(inView, `line ${L.i} at ${t.toFixed(1)}`).toBe(true); } }
      expect(n).toBeGreaterThan(20);
    });
    it('a turned line has its characters\' tops away from the line before (never towards it, never upside down)', () => {
      let n = 0;
      for (let k = 1; k < P.lines.length; k++) { const A = P.lines[k - 1], B = P.lines[k], a = B.prot;
        if (A.sec !== B.sec || B.scene || B.words.some(S => S.roll || S.vert) || Math.abs(a) < 15) continue;
        n++; expect(Math.abs(a)).toBeLessThanOrEqual(101);
        const up = [Math.sin(a * Math.PI / 180), -Math.cos(a * Math.PI / 180)], out = [B.ax - A.ax, B.ay - A.ay];
        expect(up[0] * out[0] + up[1] * out[1], `line ${B.i} at ${a}°`).toBeGreaterThan(0); }
      expect(n).toBeGreaterThanOrEqual(2);
    });
    it('deeper: the lines further apart in depth than the flowing type\'s', () => {
      const spread = (Q: typeof P) => { const ds = Q.lines.map(L => L.d); const m = ds.reduce((a, b) => a + b, 0) / ds.length; return Math.sqrt(ds.reduce((a, b) => a + (b - m) ** 2, 0) / ds.length); };
      expect(spread(P)).toBeGreaterThan(spread(F) * 1.8);
    });
  });
});

describe('a frame asked for in the lyrics ($1)', () => {
  it('is read off the word it stands before, never shown — plain lines and word-timed ones', () => {
    const a = parse('[00:01.00]我們 $1沿著 街道\n[00:05.00]<00:05.00>穿<00:05.40>$1過 <00:05.90>光<00:06.40>');
    expect(a.lines[0].words.map(w => [w.text, !!w.box])).toEqual([['我們', false], ['沿著', true], ['街道', false]]);
    expect(a.lines[0].text).not.toContain('$');
    const k = a.lines[1].words; expect(k.find(w => w.box)?.text).toBe('穿過'); expect(k.map(w => w.text).join('')).toBe('穿過光');
    // (kept through the word breaking: the word its character goes to keeps it)
    const r = respace(parse('[00:01.00]$1晨光落在窗邊'), undefined); expect(r.lines[0].words[0].box).toBe(true);
  });
  it('puts a frame round that word even with frames off and close up', () => {
    const src = '[00:02.00]清晨的 光 落在\n[00:06.00]我們 沿著 $1街道 慢慢走\n[00:10.00]風 輕輕 吹過\n[00:14.00]時間 一直 往前';
    for (const cut of ['glide', 'close']) { const P = make('flow', cut, src, { frame: false }), S = P.words.find(x => x.w.text === '街道')!;
      expect(S.frame, cut).toBeTruthy(); expect(S.frame!.words).toEqual([S]);
      expect(P.words.filter(x => x.frame).every(x => x.w.box), cut).toBe(true); }
  });
});
