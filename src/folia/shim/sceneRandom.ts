import { hashStr, mulberry32 } from '../../core/rng';

let random = Math.random;

export const sceneRandom = () => random();

export function withSceneRandom<T>(seed: string, build: () => T) {
  const previous = random;
  random = mulberry32(hashStr(seed));
  try {
    return build();
  } finally {
    random = previous;
  }
}
