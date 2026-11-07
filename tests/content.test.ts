import { describe, expect, it } from 'vitest';
import { botLoadout } from '../src/ai/bot';
import { isValidCommand } from '../src/sim/commands';
import { ABILITIES, ABILITY_TYPES, EMP_STUN, UNITS, UPGRADES, cleanLoadout } from '../src/sim/data/defs';
import { fx } from '../src/sim/fixed';
import { MAP_H, MAP_IDS, MAP_W, generateMap, mirrorX, mirrorY } from '../src/sim/map';
import { hasUpgrade } from '../src/sim/systems/research';
import { createEntity, placeBuilding } from '../src/sim/systems/production';
import { Order, Terrain, type World } from '../src/sim/types';
import { createWorld, hashState, step } from '../src/sim/world';
import { aiMatch, runTicks } from './helpers';

/** Cells reachable on foot from a start cell. */
function reachable(w: World, start: number): Uint8Array {
  const seen = new Uint8Array(w.width * w.height);
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const c = queue.pop()!;
    const x = c % w.width;
    const y = (c - x) / w.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.width || ny >= w.height) continue;
      const n = ny * w.width + nx;
      if (seen[n] || w.blocked[n]) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

const cellOf = (w: World, x: number, y: number) => (y >> 10) * w.width + (x >> 10);

const ready = (w: World) => {
  for (const p of w.players) for (const k of ABILITY_TYPES) p.cooldowns[k] = 0;
};

describe('maps', () => {
  for (const id of MAP_IDS) {
    it(`${id} is the same for both sides`, () => {
      const layout = generateMap(id);
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          expect(layout.terrain[y * MAP_W + x]).toBe(layout.terrain[mirrorY(y) * MAP_W + mirrorX(x)]);
        }
      }
      const keys = layout.points.map((p) => `${p.x},${p.y}`).sort();
      const mirrored = layout.points.map((p) => `${fx(MAP_W) - p.x},${fx(MAP_H) - p.y}`).sort();
      expect(keys).toEqual(mirrored);
      expect(layout.points).toHaveLength(3);
    });

    it(`${id} lets ground units reach every point, deposit and the enemy HQ`, () => {
      const w = createWorld({ seed: 1, map: id });
      const hq = w.entities.find((e) => e.type === 'hq' && e.owner === 0)!;
      const seen = reachable(w, (hq.cy + 1) * w.width + hq.cx + 5);
      for (const p of w.points) {
        expect(seen[cellOf(w, p.x, p.y)], `point ${p.id}`).toBe(1);
      }
      for (const d of w.deposits) {
        for (let y = d.cy; y < d.cy + 2; y++) {
          for (let x = d.cx; x < d.cx + 2; x++) {
            expect(w.terrain[y * w.width + x], `deposit ${d.cx},${d.cy}`).toBe(Terrain.Grass);
            expect(seen[y * w.width + x], `deposit ${d.cx},${d.cy}`).toBe(1);
          }
        }
      }
      const enemy = w.entities.find((e) => e.type === 'hq' && e.owner === 1)!;
      expect(seen[(enemy.cy + 1) * w.width + enemy.cx - 2]).toBe(1);
    });

    it(`${id} plays out between bots`, () => {
      for (let seed = 1; seed <= 4; seed++) {
        const { world } = aiMatch(seed, 'normal', 'normal', 15 * 60 * 8, { map: id });
        expect(world.winner).not.toBe(-1);
        expect(world.tick).toBeLessThan(15 * 60 * 7);
      }
    });
  }
});

describe('loadouts', () => {
  it('only allows the abilities a player brought', () => {
    const w = createWorld({ seed: 1, loadouts: [['emp', 'repair', 'armor'], []] });
    ready(w);
    step(w, [{ t: 'ability', p: 0, a: 'airstrike', x: fx(30), y: fx(20) }]);
    expect(w.strikes).toHaveLength(0);
    step(w, [{ t: 'ability', p: 0, a: 'emp', x: fx(30), y: fx(20) }]);
    expect(w.strikes).toHaveLength(1);
    expect(w.players[1].loadout).toEqual(['airstrike', 'artillery', 'paradrop']);
  });

  it('cleans bad loadouts from the network', () => {
    expect(cleanLoadout(['emp', 'emp', 'nuke', 'repair'])).toEqual(['emp', 'repair', 'airstrike']);
    expect(cleanLoadout('x')).toHaveLength(3);
    expect(new Set(botLoadout(5)).size).toBe(3);
  });

  it('bots with any loadout still keep both sides fair', () => {
    let wins = 0;
    let decided = 0;
    for (let seed = 300; seed < 340; seed++) {
      const loadout = botLoadout(seed);
      const { world } = aiMatch(seed, 'normal', 'normal', 15 * 60 * 8, { loadouts: [loadout, loadout] });
      if (world.winner === 2) continue;
      decided++;
      if (world.winner === 0) wins++;
    }
    expect(wins / decided).toBeGreaterThan(0.3);
    expect(wins / decided).toBeLessThan(0.7);
  });
});

describe('new abilities', () => {
  it('EMP freezes enemies in place and stops their fire', () => {
    const w = createWorld({ seed: 1, loadouts: [['emp', 'repair', 'armor'], []] });
    ready(w);
    const foe = createEntity(w, 'tank', 1, fx(30), fx(16), UNITS.tank.hp);
    foe.order = Order.Move;
    foe.destX = fx(10);
    foe.destY = fx(16);
    const victim = createEntity(w, 'infantry', 0, fx(24), fx(16), UNITS.infantry.hp);
    victim.hp = 5000;
    victim.maxHp = 5000;
    step(w, [{ t: 'ability', p: 0, a: 'emp', x: fx(30), y: fx(16) }]);
    runTicks(w, ABILITIES.emp.delay);
    expect(foe.stun).toBeGreaterThan(0);
    const x = foe.x;
    const hp = victim.hp;
    runTicks(w, EMP_STUN - 2);
    expect(foe.x).toBe(x);
    expect(victim.hp).toBe(hp);
    runTicks(w, 20);
    expect(victim.hp).toBeLessThan(hp);
  });

  it('repair heals the caster and never the enemy', () => {
    const w = createWorld({ seed: 1, loadouts: [['emp', 'repair', 'armor'], []] });
    ready(w);
    const mine = createEntity(w, 'tank', 0, fx(16), fx(8), UNITS.tank.hp);
    const theirs = createEntity(w, 'antitank', 1, fx(17), fx(30), UNITS.antitank.hp);
    mine.hp = theirs.hp = 100;
    step(w, [{ t: 'ability', p: 0, a: 'repair', x: fx(16), y: fx(8) }]);
    runTicks(w, ABILITIES.repair.delay);
    expect(mine.hp).toBeGreaterThan(250);
    expect(theirs.hp).toBe(100);
  });

  it('armor drops a tank squad', () => {
    const w = createWorld({ seed: 1, loadouts: [['emp', 'repair', 'armor'], []] });
    ready(w);
    step(w, [{ t: 'ability', p: 0, a: 'armor', x: fx(20), y: fx(10) }]);
    runTicks(w, ABILITIES.armor.delay);
    expect(w.entities.filter((e) => e.type === 'tank' && e.owner === 0)).toHaveLength(1);
  });
});

describe('upgrades', () => {
  it('need their building and money, then take time', () => {
    const w = createWorld({ seed: 1 });
    step(w, [{ t: 'upgrade', p: 0, u: 'grenades' }]);
    expect(w.players[0].research.grenades).toBe(0);
    placeBuilding(w, 'barracks', 0, 14, 18, true);
    const before = w.players[0].supplies;
    step(w, [{ t: 'upgrade', p: 0, u: 'grenades' }]);
    expect(w.players[0].supplies).toBeLessThan(before);
    expect(hasUpgrade(w, 0, 'grenades')).toBe(false);
    runTicks(w, UPGRADES.grenades.ticks);
    expect(hasUpgrade(w, 0, 'grenades')).toBe(true);
    step(w, [{ t: 'upgrade', p: 0, u: 'grenades' }]);
    expect(w.players[0].research.grenades).toBe(-1);
  });

  it('make infantry hit harder', () => {
    const duel = (upgraded: boolean) => {
      const w = createWorld({ seed: 3 });
      if (upgraded) w.players[0].research.grenades = -1;
      createEntity(w, 'infantry', 0, fx(20), fx(8), UNITS.infantry.hp);
      const target = createEntity(w, 'tank', 1, fx(23), fx(8), 5000);
      runTicks(w, 60);
      return 5000 - target.hp;
    };
    expect(duel(true)).toBeGreaterThan(duel(false) * 1.15);
  });

  it('are part of the shared state and validated from the network', () => {
    const a = createWorld({ seed: 1 });
    const b = createWorld({ seed: 1 });
    b.players[0].research.plating = -1;
    expect(hashState(a)).not.toBe(hashState(b));
    expect(isValidCommand({ t: 'upgrade', p: 0, u: 'plating' })).toBe(true);
    expect(isValidCommand({ t: 'upgrade', p: 0, u: 'toString' })).toBe(false);
  });
});
