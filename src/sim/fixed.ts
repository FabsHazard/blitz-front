/**
 * Fixed-point helpers. Every position and distance in the simulation is an
 * integer where ONE equals one map cell, so two machines given the same
 * commands always compute the same world. Only + - * / and Math.sqrt are used
 * on integers because IEEE-754 defines them exactly; trig functions are not
 * portable across engines and must never appear in src/sim.
 */
export const ONE = 1024;
export const TICK_RATE = 15;

/** Converts a cell-unit constant to fixed point. For data tables and input. */
export const fx = (cells: number): number => Math.round(cells * ONE);
export const secs = (seconds: number): number => Math.round(seconds * TICK_RATE);
export const toCell = (v: number): number => Math.floor(v / ONE);
export const idiv = (a: number, b: number): number => Math.trunc(a / b);
export const isqrt = (n: number): number => Math.floor(Math.sqrt(n));

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return isqrt(dx * dx + dy * dy);
}
