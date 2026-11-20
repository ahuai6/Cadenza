// Folia's shared motion signals, the ones its vendored modules read. Cadenza writes them from its
// rhythm signals each frame (src/folia/engines/signals.ts); nothing here keeps time of its own.
import { motionValue } from './framerMotion';

export const currentTime = motionValue(0);
export const lyricCurrentTime = motionValue(0);
export const audioPower = motionValue(0);
export const bass = motionValue(0);
export const lowMid = motionValue(0);
export const mid = motionValue(0);
export const vocal = motionValue(0);
export const treble = motionValue(0);
export const spectrum = motionValue(new Uint8Array(0));
/** The beat clock's envelopes (vendored beatFxLive writes them as beats fire). */
export const beatImpact = motionValue(0);
export const downbeatImpact = motionValue(0);
export const audioBands = { bass, lowMid, mid, vocal, treble, spectrum };
