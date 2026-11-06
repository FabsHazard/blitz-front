import { applyCommand, type Command } from './commands';
import { BALANCE } from './data/defs';
import { fx } from './fixed';
import { MAP_H, MAP_W, generateMap } from './map';
import { abilitySystem, newCooldowns } from './systems/abilities';
import { captureSystem } from './systems/capture';
import { fireSystem, targetingSystem } from './systems/combat';
import { economySystem } from './systems/economy';
import { movementSystem } from './systems/movement';
import { placeBuilding, productionSystem, setFootprint } from './systems/production';
import { preVictorySystem, victorySystem } from './systems/victory';
import { Terrain, type Entity, type GameConfig, type Player, type World } from './types';

const newPlayer = (incomeMult: number, rallyX: number, rallyY: number): Player => ({
  supplies: BALANCE.startSupplies, incomeMult, rallyX, rallyY,
  stats: { unitsMade: 0, unitsLost: 0, kills: 0, buildingsBuilt: 0, suppliesEarned: 0 },
  cooldowns: newCooldowns(),
  underdog: false,
});

export function createWorld(config: GameConfig): World {
  const layout = generateMap();
  const mult = config.incomeMult ?? [100, 100];
  const blocked = new Uint8Array(layout.terrain.length);
  layout.terrain.forEach((t, i) => {
    blocked[i] = t === Terrain.Grass || t === Terrain.Bridge ? 0 : 1;
  });

  const w: World = {
    tick: 0,
    rng: config.seed | 0,
    width: MAP_W,
    height: MAP_H,
    terrain: layout.terrain,
    blocked,
    navVersion: 0,
    players: [
      newPlayer(mult[0], fx(20), fx(22)),
      newPlayer(mult[1], fx(MAP_W - 20), fx(MAP_H - 22)),
    ],
    entities: [],
    byId: new Map(),
    nextId: 1,
    points: layout.points,
    deposits: layout.deposits,
    strikes: [],
    holdOwner: -1,
    holdTicks: 0,
    suddenDeath: false,
    winner: -1,
    events: [],
  };

  layout.hqCells.forEach(([cx, cy], owner) => placeBuilding(w, 'hq', owner, cx, cy, true));
  return w;
}

function removeDead(w: World): void {
  let anyDead = false;
  for (const e of w.entities) {
    if (e.hp > 0) continue;
    anyDead = true;
    onDeath(w, e);
  }
  if (anyDead) w.entities = w.entities.filter((e) => e.hp > 0);
}

function onDeath(w: World, e: Entity): void {
  w.byId.delete(e.id);
  w.events.push({ k: 'death', id: e.id, type: e.type, owner: e.owner, x: e.x, y: e.y });
  if (e.isBuilding) {
    e.queue.length = 0;
    setFootprint(w, e, 0);
  } else if (e.type !== 'truck') {
    w.players[e.owner].stats.unitsLost++;
  }
}

/** Advances the world one tick. All randomness and order are deterministic. */
export function step(w: World, commands: readonly Command[]): void {
  w.events.length = 0;
  if (w.winner !== -1) return;
  w.tick++;
  for (const c of commands) applyCommand(w, c);
  targetingSystem(w);
  movementSystem(w);
  fireSystem(w);
  abilitySystem(w);
  productionSystem(w);
  economySystem(w);
  captureSystem(w);
  preVictorySystem(w);
  removeDead(w);
  victorySystem(w);
}

const FNV_PRIME = 16777619;

/** Fingerprint of the full gameplay state; two peers must always agree on it. */
export function hashState(w: World): number {
  let h = 0x811c9dc5 | 0;
  const add = (v: number) => {
    h = Math.imul(h ^ (v & 0xffff), FNV_PRIME);
    h = Math.imul(h ^ ((v >>> 16) & 0xffff), FNV_PRIME);
  };
  add(w.tick);
  add(w.rng);
  add(w.nextId);
  add(w.winner);
  add(w.holdOwner);
  add(w.holdTicks);
  for (const p of w.players) {
    add(p.supplies);
    add(p.rallyX);
    add(p.rallyY);
    add(p.cooldowns.airstrike);
    add(p.cooldowns.artillery);
    add(p.cooldowns.paradrop);
    add(p.underdog ? 1 : 0);
  }
  for (const s of w.strikes) {
    add(s.owner);
    add(s.x);
    add(s.y);
    add(s.timer);
    add(s.shells);
  }
  for (const c of w.points) {
    add(c.owner);
    add(c.value);
  }
  for (const e of w.entities) {
    add(e.id);
    add(e.owner);
    add(e.x);
    add(e.y);
    add(e.hp);
    add(e.targetId);
    add(e.cooldown);
    add(e.order);
    add(e.destX);
    add(e.destY);
    add(e.building);
    add(e.queue.length);
    add(e.queueProgress);
    add(e.timer);
    add(e.phase);
    add(e.cargo);
  }
  return h >>> 0;
}
