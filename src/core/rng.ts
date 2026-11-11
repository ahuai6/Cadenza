// Deterministic randomness: the same song and settings always give the same video.

/** A stable pseudo-random value in [0,1) for any number (a hash, not a sequence). */
export function rnd(n: number): number {
  // integer hash of the number's bits (better spread than sin-fract, and identical on every engine)
  let h = Math.floor(n * 1e4) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return ((h >>> 0) % 1000003) / 1000003;
}
/** A seeded generator (mulberry32). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Hash a string to a 32-bit seed. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
