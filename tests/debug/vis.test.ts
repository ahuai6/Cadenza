import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan, project, corners, NO_FX, transK } from '../../src/director';
import { rawPose, basePose } from '../../src/director/camera';
const LRC = readFileSync(new URL('../fixtures/long.lrc', import.meta.url), 'utf8');
it('vis', () => { for (const cut of ['glide', 'waltz'] as const) {
  const map = RhythmMap.grid(112, 0.3, 160), p = parse(LRC), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6, doc = buildLyrics(p, map, musicEnd);
  const st = normalizeStyle({ ...presetStyle('cover'), preset: 'custom', cut, fx: { ...presetStyle('cover').fx, frame: true } });
  const P = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
  for (const [nm, pose] of [['raw', rawPose], ['smooth', basePose]] as const) { let n = 0, bad = 0;
    for (let t = P.words[0].show; t < P.musicEnd; t += 0.05) { if (transK(P.passages, t) > 0.02) continue; const b = pose(P.camera, t), cam = { ...b, yaw: 0, pitch: 0 };
      for (const S of P.words) { if (t < S.w.t + 0.05 || t > S.end - 0.1) continue; n++;
        if (corners(S).some(([x, y]) => { const q = project(x, y, S.d, cam, NO_FX, P.W, P.H); return Math.abs(q.sx) > P.W / 2 || Math.abs(q.sy) > P.H / 2; })) bad++; } }
    console.log(cut, nm, (bad / n).toFixed(3)); }
  const s = P.camera.stops.find(x => x.words.some(w => w.w.text === '看見' && w.w.t > 16 && w.w.t < 17));
  const i = P.camera.stops.indexOf(s!), A = P.camera.stops[i - 1], m = P.camera.moves.find(m => Math.abs(m.a - s!.arrive) < 1e-6);
  console.log(JSON.stringify({ t: s!.t, arrive: s!.arrive, words: s!.words.map(w => w.w.text), show: s!.words[0].show, A: A.words.map(w => w.w.text + '@' + w.w.t + '-' + w.end.toFixed(2)), Aarr: A.arrive, move: m && [m.s, m.a, Math.round(m.dx), Math.round(m.dy)] }));
} });
