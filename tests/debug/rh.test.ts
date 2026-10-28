import { it } from 'vitest';
import { analyze } from '../../src/rhythm/analyze';
import { render, groove } from '../unit/synth';
it('level', () => {
  const g = groove(118, 10); const pcm = render({ sr: 44100, dur: g.end + 1, hits: g.hits }); const q = pcm.map(v => v * 0.1);
  const a = analyze([pcm], 44100), b = analyze([q], 44100);
  const diff = a.events.filter(e => e.tier >= 1 && !b.events.some(x => Math.abs(x.t - e.t) < 0.01 && x.tier >= 1));
  console.log('diff', diff.map(e => { const o = b.events.find(x => Math.abs(x.t - e.t) < 0.01); return `${e.t.toFixed(3)} a:${e.tier}/${e.s} b:${o ? o.tier + '/' + o.s : 'none'}`; }).join(' | '));
  console.log('n', a.events.length, b.events.length);
});
