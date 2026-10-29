import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { analyze, RhythmMap, Signals } from '../../src/rhythm';
import { render } from '../unit/synth';
it('kick', () => {
  const b = 60 / 124, t0 = 0.5, hits: any[] = [];
  for (let k = 0; k < 48; k++) { const t = t0 + k * b; hits.push({ t, kind: 'kick', gain: 1 }); if (k % 2) hits.push({ t, kind: 'snare', gain: 0.8 }); hits.push({ t, kind: 'hat', gain: 0.5 }, { t: t + b / 2, kind: 'hat', gain: 0.35 }); }
  const A = analyze([render({ sr: 44100, dur: t0 + 48 * b + 1, hits })], 44100), m = new RhythmMap(A, 0), s = new Signals(m);
  const o = ['bpm ' + m.bpm + ' beats ' + m.beats.length + ' first ' + m.beats.slice(0, 4).map(x => x.toFixed(3))];
  for (const e of m.events.filter(e => e.t > 3 && e.t < 7)) o.push(`${e.t.toFixed(3)} s${e.s.toFixed(2)} tier${e.tier} ${e.band} pos${e.pos.toFixed(2)} off${e.off}`);
  o.push('hits ' + s.grooveHits().filter(h => h.t > 3 && h.t < 7).map(h => h.t.toFixed(2) + ':' + h.a.toFixed(2)).join(' '));
  writeFileSync(require('node:os').tmpdir() + '/kick.txt', o.join('\n'));
});
