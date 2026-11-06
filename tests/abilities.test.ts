import { describe, expect, it } from 'vitest';
import { ABILITIES, UNITS } from '../src/sim/data/defs';
import { fx } from '../src/sim/fixed';
import { updateUnderdogs } from '../src/sim/systems/abilities';
import { incomePerSecond } from '../src/sim/systems/economy';
import { createEntity } from '../src/sim/systems/production';
import type { World } from '../src/sim/types';
import { createWorld, step } from '../src/sim/world';
import { runTicks } from './helpers';

const ready = (w: World) => {
  for (const p of w.players) {
    p.cooldowns.airstrike = p.cooldowns.artillery = p.cooldowns.paradrop = 0;
  }
};

describe('abilities', () => {
  it('start on cooldown so nobody can bomb the opening', () => {
    const w = createWorld({ seed: 1 });
    step(w, [{ t: 'ability', p: 0, a: 'airstrike', x: fx(30), y: fx(20) }]);
    expect(w.strikes).toHaveLength(0);
  });

  it('an airstrike warns first, then hits only the enemy', () => {
    const w = createWorld({ seed: 1 });
    ready(w);
    const foe = createEntity(w, 'infantry', 1, fx(30), fx(16), UNITS.infantry.hp);
    const friend = createEntity(w, 'infantry', 0, fx(31), fx(16), UNITS.infantry.hp);
    foe.hp = friend.hp = 100;
    step(w, [{ t: 'ability', p: 0, a: 'airstrike', x: fx(30), y: fx(16) }]);
    expect(w.byId.has(foe.id)).toBe(true);
    expect(w.strikes).toHaveLength(1);
    runTicks(w, ABILITIES.airstrike.delay);
    expect(w.byId.has(foe.id)).toBe(false);
    expect(w.byId.has(friend.id)).toBe(true);
    expect(w.strikes).toHaveLength(0);
  });

  it('cannot be reused until the cooldown ends', () => {
    const w = createWorld({ seed: 1 });
    ready(w);
    step(w, [{ t: 'ability', p: 0, a: 'artillery', x: fx(30), y: fx(16) }]);
    step(w, [{ t: 'ability', p: 0, a: 'artillery', x: fx(20), y: fx(16) }]);
    expect(w.strikes).toHaveLength(1);
    expect(w.players[0].cooldowns.artillery).toBeGreaterThan(0);
  });

  it('a paradrop lands two squads', () => {
    const w = createWorld({ seed: 1 });
    ready(w);
    step(w, [{ t: 'ability', p: 0, a: 'paradrop', x: fx(30), y: fx(16) }]);
    runTicks(w, ABILITIES.paradrop.delay);
    expect(w.entities.filter((e) => e.type === 'infantry' && e.owner === 0)).toHaveLength(2);
  });

  it('does not wreck a Cuartel General on its own', () => {
    const w = createWorld({ seed: 1 });
    ready(w);
    const hq = w.entities.find((e) => e.type === 'hq' && e.owner === 1)!;
    step(w, [{ t: 'ability', p: 0, a: 'airstrike', x: hq.x, y: hq.y }]);
    runTicks(w, ABILITIES.airstrike.delay);
    expect(hq.hp).toBeGreaterThan(hq.maxHp * 0.95);
  });
});

describe('comeback', () => {
  it('helps only a player who is far behind', () => {
    const w = createWorld({ seed: 1 });
    updateUnderdogs(w);
    expect(w.players[0].underdog).toBe(false);
    const base = incomePerSecond(w, 0);
    for (let i = 0; i < 6; i++) createEntity(w, 'tank', 1, fx(50), fx(10 + i * 2), UNITS.tank.hp);
    updateUnderdogs(w);
    expect(w.players[0].underdog).toBe(true);
    expect(w.players[1].underdog).toBe(false);
    expect(incomePerSecond(w, 0)).toBeGreaterThan(base);
  });
});
