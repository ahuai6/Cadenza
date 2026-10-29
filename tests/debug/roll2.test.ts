import { it } from 'vitest';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan } from '../../src/director';
const ts = (s: number) => `[${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}]`;
const kar = (t0: number, ws: [string, number][]) => ts(t0) + ws.map(([w, t]) => `<${ts(t).slice(1, -1)}>${w} `).join('');
const src = [ts(1) + 'the night is young', kar(4, [['go', 4], ['走吧', 4.6], ['走吧', 6.8], ['走吧', 9]]), ts(11) + 'under the city lights', kar(14, [['再見', 14], ['再見', 14.3], ['朋友', 14.6]]), ts(17) + 'we keep on going home', ts(21) + 'till the morning comes'].join('\n');
for (const cut of ['punch', 'glide', 'waltz'] as const) it(cut, () => {
  const base = presetStyle(cut === 'punch' ? 'liquid' : 'cover'), st = normalizeStyle({ ...base, preset: 'custom', cut });
  const map = RhythmMap.grid(112, 0.3, 160), doc = buildLyrics(parse(src), map, 30), P = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd: 30, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
  for (const S of P.words) if (S.roll) { const st2 = P.camera.stops.find(s => s.words[0] === S)!; console.log(cut, S.w.t.toFixed(2), S.roll, 'show', S.show.toFixed(2), 'move', P.camera.moves.filter(m => m.ease === 'roll' && Math.abs(m.a - st2.arrive) < 1e-6).map(m => [m.s.toFixed(2), m.a.toFixed(2), m.dr.toFixed(0)]), 'carry', S.carry ? [S.carry.t0.toFixed(2), S.carry.t1.toFixed(2)] : '-'); }
});
