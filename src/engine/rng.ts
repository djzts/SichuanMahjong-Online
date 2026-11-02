/** Small seedable PRNG (mulberry32). The state is a plain number so it can live in game state. */
export function nextRandom(state: number): [value: number, nextState: number] {
  let t = (state + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  t = t >>> 0;
  return [value, t];
}

/** Fisher–Yates shuffle driven by the seeded PRNG. Returns [shuffled, nextState]. */
export function shuffle<T>(items: readonly T[], state: number): [T[], number] {
  const a = [...items];
  let s = state;
  for (let i = a.length - 1; i > 0; i--) {
    const [r, ns] = nextRandom(s);
    s = ns;
    const j = Math.floor(r * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return [a, s];
}

export function randomInt(state: number, n: number): [number, number] {
  const [r, s] = nextRandom(state);
  return [Math.floor(r * n), s];
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
