import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { Signals } from '../../src/rhythm/signals';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan, cameraAt, project, NO_FX } from '../../src/director';
const LRC = readFileSync(new URL('../fixtures/long.lrc', import.meta.url), 'utf8');
const out: string[] = []; const log = (...a: unknown[]) => out.push(a.join(' '));
import { writeFileSync } from 'node:fs';
it('dbg', () => {
  const cut = (process.env.CUT || 'punch') as any, T0 = +(process.env.T0 || 1.9), T1 = +(process.env.T1 || 2.3);
  const map = RhythmMap.grid(112, 0.3, 160), p = parse(LRC), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6, doc = buildLyrics(p, map, musicEnd);
  const base = presetStyle(cut === 'punch' ? 'liquid' : 'cover'), st = normalizeStyle({ ...base, preset: 'custom', cut, fx: { ...presetStyle('cover').fx, frame: true } });
  const P = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
  const sig = new Signals(P.map);
  for (const s of P.camera.stops) if (s.t > T0 - 2 && s.t < T1 + 1) log('stop', s.t.toFixed(2), s.arrive.toFixed(2), s.words.map(w => w.w.text).join('|'), 'x', s.x.toFixed(0), s.y.toFixed(0), 'z', s.z.toFixed(3), 'box', JSON.stringify(s.box), s.cut, 'dir', s.dir, 'fax', s.fax, 'ang', s.words.map(w => w.ang.toFixed(0) + '/' + w.tilt.toFixed(0) + '@' + w.x.toFixed(0) + ',' + w.y.toFixed(0)).join(' '));
  for (const m of P.camera.moves) if (m.a > T0 - 1 && m.s < T1) log('move', m.s.toFixed(2), m.a.toFixed(2), m.dx.toFixed(0), m.dy.toFixed(0), m.ease);
  for (const d of P.camera.drifts) if (d[1] > T0 - 1 && d[0] < T1) log('drift', d.map(v => typeof v === 'number' ? v.toFixed(2) : v).join(' '));
  for (let t = T0; t < T1; t += 0.1) { const f = cameraAt(P, sig, t, 0);
    for (const S of P.words) { if (t < S.w.t || t > S.end) continue;
      const out = S.units.map(u => { const c = Math.cos(S.tilt * Math.PI / 180), sn = Math.sin(S.tilt * Math.PI / 180); const q = project(S.x + c * u.ox - sn * u.oy, S.y + sn * u.ox + c * u.oy, S.d, f.cam, NO_FX, P.W, P.H); return `${u.c}@${u.t?.toFixed(2)}:${q.sx.toFixed(0)},${q.sy.toFixed(0)}`; });
      log(t.toFixed(2), S.w.text, 'cam', f.cam.x.toFixed(0), f.cam.z.toFixed(3), out.join(' ')); } }
  writeFileSync(require('node:os').tmpdir() + '/cam.txt', out.join('\n'));
});
it('cuts', () => {
  const cut = 'close' as any;
  const map = RhythmMap.grid(112, 0.3, 160), p = parse(LRC), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6, doc = buildLyrics(p, map, musicEnd);
  const base = presetStyle('cover'), st = normalizeStyle({ ...base, preset: 'custom', cut, fx: { ...presetStyle('cover').fx, frame: true } });
  const P = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
  const sig = new Signals(P.map); const o: string[] = ['musicEnd ' + musicEnd + ' dur ' + P.dur];
  for (const k of P.camera.cuts) if (Math.abs(k.t - 101.55) < 3) o.push('cut ' + JSON.stringify(k));
  for (const s of P.camera.stops) if (Math.abs(s.t - 101.55) < 3) o.push('stop ' + s.t + ' ' + s.arrive + ' over ' + s.over + ' cut ' + s.cut);
  for (let t = 101.5; t < 101.6; t += 0.01) { const c = cameraAt(P, sig, t, 1).cont; o.push(t.toFixed(3) + ' ' + c.x.toFixed(1) + ' ' + c.y.toFixed(1) + ' ' + c.z.toFixed(3)); }
  writeFileSync(require('node:os').tmpdir() + '/cuts.txt', o.join('\n'));
});
