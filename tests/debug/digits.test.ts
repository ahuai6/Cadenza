import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { Signals } from '../../src/rhythm/signals';
import { presetStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan, cameraAt } from '../../src/director';
import { rawPose, basePose } from '../../src/director/camera';
it('digits', () => { const src = readFileSync('/tmp/claude-0/-home-user/45816cbe-fa7b-572a-b0bc-13a36817579d/scratchpad/digits.lrc', 'utf8');
  const map = RhythmMap.grid(120, 0, 60), p = parse(src), doc = buildLyrics(p, map, 31);
  const P = plan({ doc, map, style: presetStyle('liquid'), measure: approxMeasurer(), aspect: 16 / 9, musicEnd: 31, endLen: 3.5, song: { on: true, title: 'T' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } }), sig = new Signals(map);
  console.log('passages', JSON.stringify(P.passages), 'cuts', JSON.stringify(P.camera.cuts));
  console.log('stops', JSON.stringify(P.camera.stops.map(s => ({ t: s.t, a: +s.arrive.toFixed(2), x: Math.round(s.x), y: Math.round(s.y), z: +s.z.toFixed(2), w: s.words.map(w => w.w.text).join('|'), cut: s.cut }))));
  console.log('moves', JSON.stringify(P.camera.moves.map(m => ({ s: +m.s.toFixed(2), a: +m.a.toFixed(2), dx: Math.round(m.dx), dy: Math.round(m.dy), e: m.ease }))));
  for (let t = 25.4; t < 26.2; t += 1 / 30) { const r = rawPose(P.camera, t), b = basePose(P.camera, t), c = cameraAt(P, sig, t, 1);
    console.log(t.toFixed(3), 'raw', Math.round(r.x), Math.round(r.y), r.z.toFixed(2), 'base', Math.round(b.x), Math.round(b.y), b.z.toFixed(2), 'cam', Math.round(c.cam.x), Math.round(c.cam.y), c.cam.z.toFixed(2), 'fx', c.fx.x.toFixed(1), c.fx.y.toFixed(1), c.fx.z.toFixed(3), 'tr', c.trans.toFixed(2)); }
});
