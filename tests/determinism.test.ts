import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aiMatch } from './helpers';

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

describe('determinism', () => {
  it('produces identical hashes for the same seed and commands', () => {
    const a = aiMatch(12345, 'hard', 'normal');
    const b = aiMatch(12345, 'hard', 'normal');
    expect(a.world.tick).toBeGreaterThan(1000);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.world.winner).toBe(b.world.winner);
  });

  it('diverges with a different seed', () => {
    expect(aiMatch(1, 'normal', 'normal').hashes).not.toEqual(aiMatch(2, 'normal', 'normal').hashes);
  });

  it('keeps unsafe APIs out of the simulation and the bot', () => {
    for (const file of [...walk('src/sim'), ...walk('src/ai')]) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(
        /Math\.(random|sin|cos|tan|atan|pow|exp|log)|Date\.now|performance\.now|from 'three'/,
      );
    }
  });
});
