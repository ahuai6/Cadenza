import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { Signals } from '../../src/rhythm/signals';
import { presetStyle, PRESETS } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan, cameraAt, project, corners, transK } from '../../src/director';
import { wordState } from '../../src/director/words';
import { entryK } from '../../src/director/entry';
import { D2R, clamp } from '../../src/core/math';
it('entry', () => {
  const src = readFileSync(process.env.LRC || 'tests/fixtures/long.lrc', 'utf8'), map = RhythmMap.grid(+(process.env.BPM || 120), 0, 300), p = parse(src);
  for (const th of Object.keys(PRESETS)) { const doc = buildLyrics(p, map, 280);
    const P = plan({ doc, map, style: presetStyle(th), measure: approxMeasurer(), aspect: 16 / 9, musicEnd: 280, endLen: 3.5, song: { on: true, title: 'T' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } }), sig = new Signals(map), M = P.style.m;
    const ctx = (t: number) => ({ enter: Math.max(0.05, M.enter), tempo: Math.sqrt(clamp(map.beatLen(t) / 0.5, 0.5, 2)), float: M.float ?? 0, future: P.style.future, smooth: P.style.cut !== 'punch', punch: M.punch, motion: 1, drift: P.style.tout === 'drift' });
    const count = (use: boolean) => { let bad = 0, n = 0; for (const S of P.words) { const t0 = S.show + 0.03; if (transK(P.passages, t0) > 0.02) continue; n++;
      const c0 = cameraAt(P, sig, t0, 1), c1 = cameraAt(P, sig, t0 + 0.25, 1), a = project(S.x, S.y, S.d, c0.cam, c0.fx, P.W, P.H), b = project(S.x, S.y, S.d, c1.cam, c1.fx, P.W, P.H), vx = b.sx - a.sx, vy = b.sy - a.sy;
      let out = false;
      for (const dt of [0, 0.12, 0.24]) { const t = t0 + dt, c = cameraAt(P, sig, t, 1), ws = wordState(S, t, 0, false, ctx(t))!, ek = use ? entryK(S, t) : 0, cs = Math.cos(S.tilt * D2R), sn = Math.sin(S.tilt * D2R);
        const X = S.x + (ek ? S.entry!.dx * ek : 0) + (ws.ox * cs - ws.oy * sn) * S.s, Y = S.y + (ek ? S.entry!.dy * ek : 0) + (ws.ox * sn + ws.oy * cs) * S.s;
        const pts = corners({ ...S, x: X, y: Y, lw: S.lw * ws.sc, lh: S.lh * ws.sc }).map(([x, y]) => project(x, y, S.d, c.cam, c.fx, P.W, P.H)), lim = 0.51;
        if (pts.some(q => (q.sx > P.W * lim && !(vx < -0.015 * P.W)) || (q.sx < -P.W * lim && !(vx > 0.015 * P.W)) || (q.sy > P.H * lim && !(vy < -0.015 * P.W)) || (q.sy < -P.H * lim && !(vy > 0.015 * P.W)))) out = true; }
      if (out) bad++; } return `${bad}/${n}`; };
    console.log(th, 'without', count(false), 'with', count(true), 'nudged', P.words.filter(S => S.entry).length); }
});
