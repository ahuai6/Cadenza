import { expect, it } from 'vitest';
import { positionBeatFx } from '../../src/folia/beat-timeline';
import { createBeatFxClockState, stepBeatFxClock } from '../../src/folia/vendor/services/beatFx/clock';
import {
  DEFAULT_LYRIC_ASPECT,
  normalizeStyle,
  presetStyle,
  readVisualPreset,
  visualPreset,
} from '../../src/theme/style';

it('reconstructs beat envelopes from media time after a backward seek without firing events', () => {
  const events = [
    { t: 0.5, kind: 'beat' as const, impact: 0.5 },
    { t: 1, kind: 'downbeat' as const, impact: 0.8 },
    { t: 1.25, kind: 'beat' as const, rhythmic: false },
  ];
  const live = createBeatFxClockState(events, 0.8);
  stepBeatFxClock(live, 0.4, 0);
  for (const t of [0.5, 0.75, 1, 1.1, 1.25, 1.3]) stepBeatFxClock(live, t, t - live.lastTime!);
  const seek = createBeatFxClockState(events, 0.8);
  positionBeatFx(seek, 1.5);
  positionBeatFx(seek, 1.3);
  expect(seek.beatImpact).toBeCloseTo(live.beatImpact, 10);
  expect(seek.downbeatImpact).toBeCloseTo(live.downbeatImpact, 10);
  expect(seek.rotationSign).toBe(live.rotationSign);
  expect(seek.firedBeats).toBe(0);
  positionBeatFx(seek, 0.1);
  expect(seek.beatImpact).toBe(0);
});

it('captures a complete visual preset without sharing mutable state or changing an explicit legacy aspect', () => {
  const source = normalizeStyle({
    ...presetStyle('cover'),
    engine: 'tempera',
    aspect: '9:16',
    engp: { tempera: { inkFlash: 0.7 } },
  });
  const saved = visualPreset(source);
  source.engp!.tempera.inkFlash = 0.3;
  const read = readVisualPreset(saved)!;
  expect(read).toMatchObject({ engine: 'tempera', aspect: '9:16', engp: { tempera: { inkFlash: 0.7 } } });
  expect(readVisualPreset({ version: 99, style: saved.style })).toBeNull();
  expect(readVisualPreset(saved.style)?.aspect).toBe('9:16');
  expect(DEFAULT_LYRIC_ASPECT).toBe('16:10');
});
