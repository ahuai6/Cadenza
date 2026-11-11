import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { Signals } from '../../src/rhythm/signals';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan, cameraAt, project, transK } from '../../src/director';
const LRC = readFileSync(new URL('../fixtures/long.lrc', import.meta.url), 'utf8');
it('t', () => {
  for (const cut of ['glide', 'punch'] as const) {
    const map = RhythmMap.grid(112, 0.3, 160),
      p = parse(LRC),
      musicEnd = Math.max(...p.lines.map((l) => l.t)) + 6,
      doc = buildLyrics(p, map, musicEnd);
    const st = normalizeStyle({ ...presetStyle('cover'), preset: 'custom', cut });
    const P = plan({
      doc,
      map,
      style: st,
      measure: approxMeasurer(),
      aspect: 16 / 9,
      musicEnd,
      endLen: 3.5,
      song: { on: true, title: 'T', artist: 'A' },
      labels: { composer: 'c', lyricist: 'l', artist: 'a' },
    });
    const sig = new Signals(P.map),
      q = P.passages[1],
      S = P.lines[q.line].words[0];
    console.log(cut, 'passage', q.t.toFixed(2), 'inn', q.inn.toFixed(2), 'out', q.out.toFixed(2));
    let prev: any = null,
      pv = 0;
    for (let t = q.t + 0.0001; t < q.t + 1.4; t += 1 / 60) {
      const f = cameraAt(P, sig, t, +(process.env.MOT ?? 0)),
        pr = project(S.x, S.y, S.d, f.cam, f.fx, P.W, P.H);
      if (prev) {
        const v = Math.hypot(pr.sx - prev.sx, pr.sy - prev.sy) * 60,
          sv = (pr.k / prev.k - 1) * 60 * 100;
        if (Math.round((t - q.t) * 60) % 3 === 0)
          console.log(
            ' +' + (t - q.t).toFixed(2),
            'blur',
            transK(P.passages, t).toFixed(2),
            'speed px/s',
            v.toFixed(0),
            'zoom %/s',
            sv.toFixed(1),
            'acc',
            (v - pv).toFixed(0),
          );
        pv = v;
      }
      prev = pr;
    }
  }
});
