/**
 * Small deterministic PRNG for sound variation. Realtime play seeds it from Math.random once,
 * offline QA renders seed it explicitly so a render is reproducible bit for bit.
 */
export type Rng = () => number;

/** mulberry32: fast 32-bit generator, uniform in [0, 1). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform in [lo, hi). */
export const rrange = (rnd: Rng, lo: number, hi: number): number => lo + (hi - lo) * rnd();

/** 1 +- amount, e.g. jitter(rnd, 0.03) in [0.97, 1.03). */
export const jitter = (rnd: Rng, amount: number): number => 1 + (rnd() * 2 - 1) * amount;

export function pick<T>(rnd: Rng, xs: readonly T[]): T {
  return xs[Math.min(xs.length - 1, Math.floor(rnd() * xs.length))];
}

/** Integer in [0, n). */
export const rint = (rnd: Rng, n: number): number => Math.min(n - 1, Math.floor(rnd() * n));

export const chance = (rnd: Rng, p: number): boolean => rnd() < p;
