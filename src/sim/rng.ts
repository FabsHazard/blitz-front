/** Mulberry32. The state is a single int stored on the world so it gets hashed. */
export function nextRandom(holder: { rng: number }): number {
  holder.rng = (holder.rng + 0x6d2b79f5) | 0;
  let t = holder.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Integer in [min, max]. */
export function randInt(holder: { rng: number }, min: number, max: number): number {
  return min + nextRandom(holder) % (max - min + 1);
}
