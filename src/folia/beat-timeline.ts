import {
  BEAT_FX_BEAT_DECAY_MS,
  BEAT_FX_DOWNBEAT_DECAY_MS,
  findNextBeatFxEvent,
  resolveBeatFxAccentGain,
  type BeatFxClockState,
} from './vendor/services/beatFx/clock';

/** The tail outside this range is below the upstream clock's envelope cutoff. */
const HISTORY = 1;

export function positionBeatFx(state: BeatFxClockState, time: number) {
  const next = findNextBeatFxEvent(state.events, time);
  state.cursor = next;
  state.lastTime = time;
  state.lastBeat = state.lastDownbeat = null;
  state.beatImpact = state.downbeatImpact = 0;
  state.rotationSign = next % 2 ? -1 : 1;
  for (let i = next - 1; i >= 0; i--) {
    const event = state.events[i];
    const age = time - event.t;
    if (age > HISTORY) break;
    const gain = resolveBeatFxAccentGain(event, state.trackScale);
    const elapsed = 2300 * age;
    state.beatImpact = Math.max(state.beatImpact, gain * Math.exp(-elapsed / BEAT_FX_BEAT_DECAY_MS));
    if (event.kind === 'downbeat') {
      state.lastDownbeat ??= event;
      state.downbeatImpact = Math.max(state.downbeatImpact, gain * Math.exp(-elapsed / BEAT_FX_DOWNBEAT_DECAY_MS));
    } else state.lastBeat ??= event;
  }
  if (state.beatImpact < 1e-4) state.beatImpact = 0;
  if (state.downbeatImpact < 1e-4) state.downbeatImpact = 0;
}
