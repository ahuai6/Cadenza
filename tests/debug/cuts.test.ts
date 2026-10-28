import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { Signals } from '../../src/rhythm/signals';
import { presetStyle, PRESETS } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan, cameraAt } from '../../src/director';
// passages per theme on the long fixture, and how the backdrop's camera behaves across each cut
it('cuts', () => {
  const src = readFileSync(process.env.LRC || 'tests/fixtures/long.lrc', 'utf8'), map = RhythmMap.grid(+(process.env.BPM || 120), 0, 300), p = parse(src);
  for (const th of Object.keys(PRESETS)) {
    const doc = buildLyrics(p, map, 280), st = presetStyle(th);
    const P = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd: 280, endLen: 3.5, song: { on: true, title: 'T' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } }), sig = new Signals(map);
    const by: Record<string, number> = {}; for (const q of P.passages) by[q.reason] = (by[q.reason] || 0) + 1;
    const lines = P.lines;
    const info = P.passages.map(q => { const A = lines[q.line - 1], B = lines[q.line]; const sungA = Math.min(A.L.sung, A.L.end), gap = B.words[0].show - sungA;
      const late = A.words.filter(w => w.end > q.t - q.inn * 0.5).length;   // words of the line before still being sung when the blur is past half
      const a = cameraAt(P, sig, q.t - 1 / 120, 1).cont, b = cameraAt(P, sig, q.t + 1 / 120, 1).cont;
      return `${q.reason[0]}@${q.t.toFixed(2)} gap${gap.toFixed(2)} in${q.inn.toFixed(2)} out${q.out.toFixed(2)} late${late} contJump ${Math.round(b.x - a.x)},${Math.round(b.y - a.y)} z${(b.z / a.z).toFixed(3)}`; });
    if (th === "liquid") console.log(P.lines.map(l => l.words.length + ":" + (Math.min(l.L.sung, l.L.end) - l.L.t).toFixed(2) + ":" + l.words.every(S => S.w.latin)).join(" "));
    console.log(th, st.cut, "dash", P.lines.filter(l => l.scene === "dash").length + "/" + P.lines.length, JSON.stringify(by), '\n  ' + info.join('\n  '));
  }
});
