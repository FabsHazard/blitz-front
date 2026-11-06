import { Bot, PROFILES, type Difficulty } from '../src/ai/bot';
import type { Command } from '../src/sim/commands';
import { createWorld, hashState, step } from '../src/sim/world';
import type { World } from '../src/sim/types';

export function aiMatch(seed: number, a: Difficulty, b: Difficulty, maxTicks = 15 * 60 * 8) {
  const world = createWorld({
    seed, incomeMult: [PROFILES[a].incomeMult, PROFILES[b].incomeMult],
  });
  const bots = [new Bot(0, a, seed + 1), new Bot(1, b, seed + 2)];
  const hashes: number[] = [];
  while (world.winner === -1 && world.tick < maxTicks) {
    const commands: Command[] = bots.flatMap((bot) => bot.think(world));
    step(world, commands);
    if (world.tick % 150 === 0) hashes.push(hashState(world));
  }
  return { world, hashes };
}

export function runTicks(w: World, ticks: number, commands: Command[] = []): void {
  step(w, commands);
  for (let i = 1; i < ticks; i++) step(w, []);
}
