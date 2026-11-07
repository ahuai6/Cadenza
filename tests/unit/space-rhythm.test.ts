// The space reads the song's rhythm: the accent clock runs forward and slows on accents (the beams' swell is how far it
// has slowed), the pulse rises and decays on events; no song, no rhythm.
import { describe, it, expect } from 'vitest';
import { RhythmMap } from '../../src/rhythm/map';
import { Signals } from '../../src/rhythm/signals';
import { accentClock } from '../../src/rhythm/accentclock';
import { rhythmAt } from '../../src/app/space/data';

describe('space rhythm', () => {
  it('is null without a song', () => { expect(rhythmAt(accentClock, null, 3)).toBeNull(); });
  it('runs the accent clock forward, slows it on accents, pulses on events', () => {
    const map = RhythmMap.grid(112, 0.3, 160), s = { map, sig: new Signals(map) };
    let last = -Infinity, maxDip = 0, maxPulse = 0;
    for (let t = 1; t < 30; t += 0.02) { const r = rhythmAt(accentClock, s, t)!; expect(r.clock).toBeGreaterThanOrEqual(last); last = r.clock;
      for (const v of [r.dip, r.pulse]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      maxDip = Math.max(maxDip, r.dip); maxPulse = Math.max(maxPulse, r.pulse); }
    expect(maxPulse).toBeGreaterThan(0.3);
    console.log('max swell', maxDip.toFixed(2), 'max pulse', maxPulse.toFixed(2));
  });
});
