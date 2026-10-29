import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { presetStyle, normalizeStyle } from '../../src/theme/style';
import { approxMeasurer } from '../../src/text/metrics';
import { plan } from '../../src/director';
import { rawPose } from '../../src/director/camera';
it('back', () => {
  const LRC = readFileSync('tests/fixtures/long.lrc', 'utf8'), o: string[] = [];
  for (const cut of ['glide', 'waltz', 'close'] as const) {
    const map = RhythmMap.grid(112, 0.3, 160), p = parse(LRC), musicEnd = Math.max(...p.lines.map(l => l.t)) + 6, doc = buildLyrics(p, map, musicEnd);
    const st = normalizeStyle({ ...presetStyle('cover'), preset: 'custom', cut, fx: { ...presetStyle('cover').fx, frame: true } });
    const P = plan({ doc, map, style: st, measure: approxMeasurer(), aspect: 16 / 9, musicEnd, endLen: 3.5, song: { on: true, title: 'T', artist: 'A' }, labels: { composer: 'c', lyricist: 'l', artist: 'a' } });
    for (const m of P.camera.moves) { if (m.ease === 'cut' || m.ease === 'roll' || m.a - m.s < 0.05) continue; const L = Math.hypot(m.dx, m.dy); if (L < 5) continue;
      const ux = m.dx / L, uy = m.dy / L; let prev = -Infinity, worst = 0, wt = 0;
      for (let t = m.s; t <= m.a; t += (m.a - m.s) / 40) { const b = rawPose(P.camera, t), v = b.x * ux + b.y * uy; if (prev - v > worst) { worst = prev - v; wt = t; } prev = Math.max(prev, v); }
      if (worst > 0.5) { o.push(`${cut} move ${m.s.toFixed(2)}-${m.a.toFixed(2)} L ${L.toFixed(0)} ease ${m.ease} back ${worst.toFixed(1)} at ${wt.toFixed(2)}`);
        for (const d of P.camera.drifts) if (d[1] > m.s && d[0] < m.a) o.push(`   drift ${d[0].toFixed(2)}-${d[1].toFixed(2)} ${d[2].toFixed(0)},${d[3].toFixed(0)} ${d[4]}`);
        for (const n of P.camera.moves) if (n !== m && n.a > m.s && n.s < m.a) o.push(`   move ${n.s.toFixed(2)}-${n.a.toFixed(2)} ${n.dx.toFixed(0)},${n.dy.toFixed(0)} ${n.ease}`); } } }
  writeFileSync(require('node:os').tmpdir() + '/back.txt', o.join('\n'));
});
