import { describe, expect, it } from 'vitest';
import { aiMatch } from './helpers';

describe('AI vs AI', () => {
  it('always finishes within seven minutes', () => {
    const results: string[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const { world } = aiMatch(seed, 'normal', 'normal');
      results.push(`${seed}: winner=${world.winner} t=${(world.tick / 15).toFixed(0)}s`);
      expect(world.winner).not.toBe(-1);
      expect(world.tick).toBeLessThan(15 * 60 * 7);
    }
    console.log(results.join('\n'));
  });

  it('a harder bot usually beats an easier one', () => {
    let hardWins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      if (aiMatch(seed, 'hard', 'easy').world.winner === 0) hardWins++;
    }
    expect(hardWins).toBeGreaterThanOrEqual(8);
  });

  it('is fair between sides', () => {
    let wins = 0;
    let decided = 0;
    for (let seed = 100; seed < 200; seed++) {
      const { world } = aiMatch(seed, 'normal', 'normal');
      if (world.winner === 2) continue;
      decided++;
      if (world.winner === 0) wins++;
    }
    console.log(`side 0 won ${wins} of ${decided}`);
    expect(wins / decided).toBeGreaterThan(0.35);
    expect(wins / decided).toBeLessThan(0.65);
  });
});
