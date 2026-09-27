import { randomInt } from 'node:crypto';

export interface Rng {
  int(maxExclusive: number): number;
  float(): number;
}

export const cryptoRng: Rng = {
  int: (maxExclusive) => randomInt(maxExclusive),
  float: () => randomInt(2 ** 30) / 2 ** 30,
};

/** Deterministic PRNG (mulberry32) — tests and fixtures only, never live hands. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    float: next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
  };
}
