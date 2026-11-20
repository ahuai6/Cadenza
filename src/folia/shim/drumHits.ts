// Folia's drum hits (kick, snare, hats) for the playing track. Upstream separates the drum stem in
// the browser; Cadenza's rhythm analysis already has the same hits (its neural engine runs htdemucs
// too), and src/folia/live.ts installs them here in song time.
export type DrumHitKind = 0 | 1 | 2;
export const DRUM_KICK: DrumHitKind = 0;
export const DRUM_SNARE: DrumHitKind = 1;
export const DRUM_HAT: DrumHitKind = 2;
export interface DrumHits {
  times: Float64Array;
  strengths: Float32Array;
  kinds: Uint8Array;
  /** While the track is still separating: the time (s) the hits reach. */
  until?: number;
}

const lists = new Map<string, DrumHits>();

/** Installs (or clears, with null) a track's hits. */
export function setDrumHits(key: string, hits: DrumHits | null) {
  if (hits) lists.set(key, hits);
  else lists.delete(key);
  // (one track's at a time is all a picture reads)
  for (const k of lists.keys()) if (k !== key) lists.delete(k);
}

export const getDrumHits = (key: string | null): DrumHits | null => (key ? (lists.get(key) ?? null) : null);
