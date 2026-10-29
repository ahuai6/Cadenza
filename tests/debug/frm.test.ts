import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { Signals } from '../../src/rhythm/signals';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan, cameraAt, project, corners, NO_FX, transK } from '../../src/director';
it('frm', () => {
  const LRC = readFileSync('tests/fixtures/long.lrc', 'utf8'), o: string[] = [], cut = (process.env.CUT || 'glide') as any;
  const map = RhythmMap.grid(112, 0.3, 160), p = parse(LRC), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6, doc = buildLyrics(p, map, musicEnd);
  const st = normalizeStyle({ ...presetStyle('cover'), preset: 'custom', cut, fx: { ...presetStyle('cover').fx, frame: true } });
  const P = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } }), sig = new Signals(P.map);
  for (const S of P.words) { const F = S.frame; if (!F || F.words[F.words.length - 1] !== S) continue;
    for (let t = F.ts + 0.6; t < Math.min(S.end - 0.1, F.ts + 1.2); t += 0.05) { if (transK(P.passages, t) > 0.02) continue;
      const f = cameraAt(P, sig, t, 0); const qs = F.words.flatMap(W => corners(W, F.pad * 0.5).map(([x, y]) => project(x, y, W.d, f.cam, NO_FX, P.W, P.H)));
      const out = qs.some(q => Math.abs(q.sx) > P.W / 2 || Math.abs(q.sy) > P.H / 2);
      if (out) { const st0 = P.camera.stops.find(s => s.words.includes(S)); o.push(`${t.toFixed(2)} ${F.words.map(w => w.w.text).join('')} q ${qs.map(q => q.sx.toFixed(0) + ',' + q.sy.toFixed(0)).join(' ')} stop arrive ${st0?.arrive.toFixed(2)} t ${st0?.t.toFixed(2)} words ${st0?.words.map(w => w.w.text).join('|')} z ${st0?.z.toFixed(2)} camz ${f.cam.z.toFixed(2)}`); } } }
  writeFileSync(require('node:os').tmpdir() + '/frm.txt', o.join('\n'));
});
