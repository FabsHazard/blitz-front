import { describe, expect, it } from 'vitest';
import { canPlace } from '../src/sim/commands';
import { BALANCE, UNITS, type UnitType } from '../src/sim/data/defs';
import { ONE, fx } from '../src/sim/fixed';
import { MAP_H, MAP_W, generateMap } from '../src/sim/map';
import { getField } from '../src/sim/pathfinding';
import { findHq } from '../src/sim/systems/economy';
import { createEntity, placeBuilding } from '../src/sim/systems/production';
import { Order, type World } from '../src/sim/types';
import { createWorld, step } from '../src/sim/world';
import { runTicks } from './helpers';

const spawn = (w: World, type: UnitType, owner: number, x: number, y: number) =>
  createEntity(w, type, owner, fx(x), fx(y), UNITS[type].hp);

/** Roughly equal spending on each side; returns the winning side. */
function duel(a: UnitType, countA: number, b: UnitType, countB: number): number {
  const w = createWorld({ seed: 9 });
  for (let i = 0; i < countA; i++) spawn(w, a, 0, 20, 15 + i * 2);
  for (let i = 0; i < countB; i++) spawn(w, b, 1, 23, 15 + i * 2);
  const alive = (owner: number) => w.entities.some((e) => e.owner === owner && !e.isBuilding);
  for (let i = 0; i < 15 * 60 && alive(0) && alive(1); i++) step(w, []);
  return alive(0) ? 0 : 1;
}

describe('map', () => {
  it('is point symmetric', () => {
    const { terrain } = generateMap();
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        expect(terrain[y * MAP_W + x]).toBe(terrain[(MAP_H - 1 - y) * MAP_W + MAP_W - 1 - x]);
      }
    }
  });

  it('connects both bases and every control point', () => {
    const w = createWorld({ seed: 1 });
    const field = getField(w, 21 * MAP_W + 60);
    for (const p of w.points) {
      const cell = Math.floor(p.y / ONE) * MAP_W + Math.floor(p.x / ONE);
      expect(field[cell]).toBeLessThan(200);
    }
    expect(field[21 * MAP_W + 11]).toBeLessThan(200);
    for (const d of w.deposits) expect(canPlace(w, 0, 'refinery', d.cx, d.cy)).toBe(true);
  });
});

describe('combat table', () => {
  it('follows the counter triangle', () => {
    expect(duel('tank', 1, 'infantry', 3)).toBe(0);
    expect(duel('antitank', 2, 'tank', 1)).toBe(0);
    expect(duel('infantry', 3, 'antitank', 2)).toBe(0);
    expect(duel('heli', 1, 'tank', 1)).toBe(0);
  });

  it('ground vehicles cannot hit helicopters', () => {
    const w = createWorld({ seed: 3 });
    const heli = spawn(w, 'heli', 0, 20, 16);
    spawn(w, 'tank', 1, 22, 16);
    runTicks(w, 60);
    expect(heli.hp).toBe(UNITS.heli.hp);
  });
});

describe('economy', () => {
  it('rejects spending what the player does not have', () => {
    const w = createWorld({ seed: 3 });
    w.players[0].supplies = 10;
    step(w, [{ t: 'build', p: 0, b: 'barracks', cx: 14, cy: 20 }]);
    expect(w.entities.filter((e) => e.type === 'barracks')).toHaveLength(0);
  });

  it('a refinery truck delivers supplies to the HQ', () => {
    const w = createWorld({ seed: 3 });
    const d = w.deposits[0];
    step(w, [{ t: 'build', p: 0, b: 'refinery', cx: d.cx, cy: d.cy }]);
    let delivered = 0;
    for (let i = 0; i < 15 * 40; i++) {
      step(w, []);
      for (const ev of w.events) if (ev.k === 'deliver') delivered += ev.amount;
    }
    expect(delivered).toBeGreaterThan(0);
  });

  it('players cannot order enemy squads', () => {
    const w = createWorld({ seed: 3 });
    const enemy = spawn(w, 'tank', 1, 60, 10);
    step(w, [{ t: 'move', p: 0, ids: [enemy.id], x: fx(10), y: fx(10), mode: 'move' }]);
    expect(enemy.order).toBe(Order.Idle);
  });

  it('only allows building inside territory', () => {
    const w = createWorld({ seed: 3 });
    expect(canPlace(w, 0, 'barracks', 14, 20)).toBe(true);
    expect(canPlace(w, 0, 'barracks', 28, 20)).toBe(false);
    placeBuilding(w, 'barracks', 0, 14, 20, true);
    expect(canPlace(w, 0, 'barracks', 22, 20)).toBe(true);
  });
});

describe('win conditions', () => {
  it('holding all three points for a minute wins', () => {
    const w = createWorld({ seed: 3 });
    for (const p of w.points) {
      p.owner = 0;
      p.value = BALANCE.captureMax;
      spawn(w, 'infantry', 0, p.x / ONE, p.y / ONE);
    }
    runTicks(w, BALANCE.holdToWinTicks + 3);
    expect(w.winner).toBe(0);
  });

  it('sudden death ends a passive game', () => {
    const w = createWorld({ seed: 3 });
    while (w.winner === -1 && w.tick < 15 * 60 * 7) step(w, []);
    expect(w.winner).toBe(2);
  });

  it('destroying the HQ wins', () => {
    const w = createWorld({ seed: 3 });
    findHq(w, 1)!.hp = 0;
    step(w, []);
    expect(w.winner).toBe(0);
  });
});
