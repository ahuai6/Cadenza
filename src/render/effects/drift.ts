// What every drifting thing shares (motes, feathers, petals, bokeh lights, wireframe solids): its life on screen and its
// place. One rule for all of them, so none pops out of existence and none piles up on another.
//   - a life: a loop (fall, rise, wander) whose start and end fade, so a thing that wraps round is never seen to jump;
//   - a place: the thing's own band across the frame (thing i of n keeps to the i-th of n bands, jittered anew each
//     life), and lives staggered by the golden ratio — at any moment they are spread over the frame, never bunched.
import { clamp, sstep } from '../../core/math';
import { rnd } from '../../core/rng';

const PHI = 0.6180339887;
/** Where thing i of n starts its loop (0..1): evenly staggered, so the things are spread along the loop at any time. */
export const stagger = (i: number, n: number) => (i * PHI + 0.5 / n) % 1;
/** Thing i of n in its life `life`: across the frame (0..1) inside its own band, jittered per life. */
export const band = (i: number, n: number, life: number, lo = 0, hi = 1) => lo + (hi - lo) * ((i + 0.15 + 0.7 * rnd(i * 7.31 + life * 3.17 + 0.5)) / n);
/** How visible a thing is at phase u (0..1) of its life: fading in over the first `fin`, out over the last `fout`. */
export const lifeFade = (u: number, fin = 0.12, fout = 0.12) => sstep(clamp(u / fin)) * (1 - sstep(clamp((u - (1 - fout)) / fout)));
/** A loop of length `span` (in loop units) at clock time t: which life, and how far through it (0..1). */
export function loop(t: number, speed: number, start: number, span = 1) {
  const u = start * span + t * speed, life = Math.floor(u / span);
  return { life, u: u / span - life };
}
