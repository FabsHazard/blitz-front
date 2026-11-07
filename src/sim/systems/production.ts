import { BUILDINGS, UNITS, type BuildingType, type UnitType } from '../data/defs';
import { ONE, fx, idiv } from '../fixed';
import { cellCenterX, cellCenterY, freeCellNear } from '../pathfinding';
import { Order, type Entity, type World } from '../types';

export function createEntity(
  w: World, type: Entity['type'], owner: number, x: number, y: number, maxHp: number,
): Entity {
  const e: Entity = {
    id: w.nextId++, type, owner,
    isBuilding: type in BUILDINGS,
    x, y, px: x, py: y,
    hp: maxHp, maxHp,
    targetId: 0, cooldown: 0,
    order: Order.Idle, destX: x, destY: y, orderTarget: 0,
    cx: 0, cy: 0, building: 0,
    queue: [], queueProgress: 0,
    linkId: 0, timer: 0, phase: 0, cargo: 0, stun: 0,
  };
  w.entities.push(e);
  w.byId.set(e.id, e);
  return e;
}

export function setFootprint(w: World, e: Entity, blocked: number): void {
  const def = BUILDINGS[e.type as BuildingType];
  for (let y = e.cy; y < e.cy + def.h; y++) {
    for (let x = e.cx; x < e.cx + def.w; x++) {
      const cell = y * w.width + x;
      w.blocked[cell] = blocked || (w.terrain[cell] !== 0 && w.terrain[cell] !== 3 ? 1 : 0);
    }
  }
  w.navVersion++;
}

export function placeBuilding(
  w: World, type: BuildingType, owner: number, cx: number, cy: number, instant = false,
): Entity {
  const def = BUILDINGS[type];
  const x = cx * ONE + idiv(def.w * ONE, 2);
  const y = cy * ONE + idiv(def.h * ONE, 2);
  const e = createEntity(w, type, owner, x, y, def.hp);
  e.cx = cx;
  e.cy = cy;
  if (!instant) {
    e.building = def.buildTicks;
    e.hp = idiv(def.hp, 5);
  }
  setFootprint(w, e, 1);
  return e;
}

/** Creates a unit next to a building, on the side facing the enemy. */
export function spawnUnit(w: World, from: Entity, type: UnitType): Entity {
  const def = BUILDINGS[from.type as BuildingType];
  const side = from.owner === 0 ? 1 : -1;
  const edgeX = from.x + side * (idiv(def.w * ONE, 2) + fx(0.7));
  const cell = freeCellNear(w, edgeX, from.y, w.width * ONE - from.x, w.height * ONE - from.y);
  const unit = UNITS[type];
  const e = createEntity(w, type, from.owner, cellCenterX(w, cell), cellCenterY(w, cell), unit.hp);
  w.events.push({ k: 'spawn', id: e.id, owner: e.owner });
  return e;
}

function buildingSystem(w: World, e: Entity): void {
  const def = BUILDINGS[e.type as BuildingType];
  e.building--;
  e.hp = Math.min(def.hp, e.hp + idiv(def.hp * 4, 5 * def.buildTicks) + 1);
  if (e.building === 0) {
    w.players[e.owner].stats.buildingsBuilt++;
    if (e.type === 'refinery') e.timer = 1;
    w.events.push({ k: 'built', id: e.id, owner: e.owner });
  }
}

export function productionSystem(w: World): void {
  const count = w.entities.length;
  for (let i = 0; i < count; i++) {
    const e = w.entities[i];
    if (!e.isBuilding) continue;
    if (e.building > 0) {
      buildingSystem(w, e);
      continue;
    }
    if (e.queue.length === 0) continue;
    const type = e.queue[0];
    if (++e.queueProgress < UNITS[type].buildTicks) continue;
    e.queue.shift();
    e.queueProgress = 0;
    const unit = spawnUnit(w, e, type);
    const player = w.players[e.owner];
    player.stats.unitsMade++;
    unit.order = Order.AttackMove;
    unit.destX = player.rallyX;
    unit.destY = player.rallyY;
  }
}

/** Squads alive plus squads queued, used to enforce the unit cap. */
export function squadCount(w: World, owner: number): number {
  let n = 0;
  for (const e of w.entities) {
    if (e.owner !== owner) continue;
    if (e.isBuilding) n += e.queue.length;
    else if (e.type !== 'truck') n++;
  }
  return n;
}
