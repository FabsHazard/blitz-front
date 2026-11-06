import {
  ABILITIES, BALANCE, BUILDINGS, UNITS,
  type AbilityType, type BuildingType, type UnitType,
} from './data/defs';
import { ONE, dist, fx, toCell } from './fixed';
import { cellCenterX, cellCenterY, freeCellNear } from './pathfinding';
import { useAbility } from './systems/abilities';
import { canHit } from './systems/combat';
import { placeBuilding, squadCount } from './systems/production';
import { Order, type Entity, type World } from './types';

/**
 * The only way to change the world from outside. Coordinates are already
 * integers, so a command can be sent over the network as it is. `p` is the
 * issuing player and every command is validated against it.
 */
export type Command =
  | { t: 'move'; p: number; ids: number[]; x: number; y: number; mode: 'move' | 'amove' }
  | { t: 'attack'; p: number; ids: number[]; target: number }
  | { t: 'train'; p: number; unit: UnitType }
  | { t: 'build'; p: number; b: BuildingType; cx: number; cy: number }
  | { t: 'rally'; p: number; x: number; y: number }
  | { t: 'ability'; p: number; a: AbilityType; x: number; y: number };

const hasOwn = (o: object, key: unknown): boolean =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(o, key);

/** Checks data from the network, which cannot be trusted to match the types. */
export function isValidCommand(value: unknown): value is Command {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  const ints = (...keys: string[]) => keys.every((k) => Number.isSafeInteger(c[k]));
  if (!ints('p')) return false;
  const idList = Array.isArray(c.ids) && c.ids.length <= 64 && c.ids.every(Number.isSafeInteger);
  switch (c.t) {
    case 'move': return idList && ints('x', 'y') && (c.mode === 'move' || c.mode === 'amove');
    case 'attack': return idList && ints('target');
    case 'train': return hasOwn(UNITS, c.unit) && c.unit !== 'truck';
    case 'build': return hasOwn(BUILDINGS, c.b) && c.b !== 'hq' && ints('cx', 'cy');
    case 'rally': return ints('x', 'y');
    case 'ability': return hasOwn(ABILITIES, c.a) && ints('x', 'y');
    default: return false;
  }
}

function ownSquads(w: World, p: number, ids: number[]): Entity[] {
  const list: Entity[] = [];
  for (const id of ids) {
    const e = w.byId.get(id);
    if (e && e.owner === p && !e.isBuilding && e.type !== 'truck') list.push(e);
  }
  return list;
}

/** Spiral offsets so a group spreads around the target instead of fighting over it. */
function formationSlot(index: number): [number, number] {
  if (index === 0) return [0, 0];
  let n = 1;
  for (let ring = 1; ; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        if (n++ === index) return [dx, dy];
      }
    }
  }
}

function orderMove(w: World, squads: Entity[], x: number, y: number, mode: Order): void {
  const spacing = fx(1.5);
  squads.forEach((e, i) => {
    const [ox, oy] = formationSlot(i);
    // The slot table is rotated for side 1 so groups spread the same way.
    const flip = e.owner === 0 ? 1 : -1;
    const tx = Math.max(0, Math.min(w.width * ONE - 1, x + flip * ox * spacing));
    const ty = Math.max(0, Math.min(w.height * ONE - 1, y + flip * oy * spacing));
    e.order = mode;
    e.orderTarget = 0;
    const cell = toCell(ty) * w.width + toCell(tx);
    if (UNITS[e.type as UnitType].air || !w.blocked[cell]) {
      e.destX = tx;
      e.destY = ty;
    } else {
      const free = freeCellNear(w, tx, ty, e.x, e.y);
      e.destX = cellCenterX(w, free);
      e.destY = cellCenterY(w, free);
    }
  });
}

/** A free deposit whose origin is exactly (cx, cy), or undefined. */
export function depositAt(w: World, cx: number, cy: number) {
  return w.deposits.find((d) => d.cx === cx && d.cy === cy);
}

/** True when a building footprint fits and is inside this player's territory. */
export function canPlace(
  w: World, owner: number, type: BuildingType, cx: number, cy: number,
): boolean {
  const def = BUILDINGS[type];
  if (type === 'hq') return false;
  if (cx < 0 || cy < 0 || cx + def.w > w.width || cy + def.h > w.height) return false;
  for (let y = cy; y < cy + def.h; y++) {
    for (let x = cx; x < cx + def.w; x++) {
      const cell = y * w.width + x;
      if (w.blocked[cell] || w.terrain[cell] !== 0) return false;
    }
  }
  const onDeposit = depositAt(w, cx, cy) !== undefined;
  if (type === 'refinery') return onDeposit;
  if (w.deposits.some((d) =>
    cx < d.cx + 2 && cx + def.w > d.cx && cy < d.cy + 2 && cy + def.h > d.cy)) return false;

  const x = cx * ONE + (def.w * ONE >> 1);
  const y = cy * ONE + (def.h * ONE >> 1);
  return w.entities.some((e) =>
    e.isBuilding && e.owner === owner && e.building === 0 && e.type !== 'refinery'
    && dist(e.x, e.y, x, y) <= BALANCE.buildRadius);
}

export function trainBuilding(w: World, p: number, unit: UnitType): Entity | undefined {
  const producer = UNITS[unit].producer;
  let best: Entity | undefined;
  for (const e of w.entities) {
    if (e.owner !== p || e.type !== producer || e.building > 0) continue;
    if (e.queue.length >= BALANCE.maxQueue) continue;
    if (!best || e.queue.length < best.queue.length) best = e;
  }
  return best;
}

export function applyCommand(w: World, c: Command): void {
  const player = w.players[c.p];
  if (!player) return;
  switch (c.t) {
    case 'move': {
      const squads = ownSquads(w, c.p, c.ids);
      orderMove(w, squads, c.x, c.y, c.mode === 'move' ? Order.Move : Order.AttackMove);
      break;
    }
    case 'attack': {
      const target = w.byId.get(c.target);
      if (!target || target.owner === c.p) return;
      for (const e of ownSquads(w, c.p, c.ids)) {
        if (!canHit(e.type, target.type)) continue;
        e.order = Order.Attack;
        e.orderTarget = target.id;
      }
      break;
    }
    case 'train': {
      const def = UNITS[c.unit];
      if (!def || !def.producer || player.supplies < def.cost) return;
      if (squadCount(w, c.p) >= BALANCE.maxSquads) return;
      const building = trainBuilding(w, c.p, c.unit);
      if (!building) return;
      player.supplies -= def.cost;
      building.queue.push(c.unit);
      break;
    }
    case 'build': {
      const def = BUILDINGS[c.b];
      if (!def || player.supplies < def.cost || !canPlace(w, c.p, c.b, c.cx, c.cy)) return;
      player.supplies -= def.cost;
      placeBuilding(w, c.b, c.p, c.cx, c.cy);
      break;
    }
    case 'rally':
      player.rallyX = c.x;
      player.rallyY = c.y;
      break;
    case 'ability':
      useAbility(w, c.p, c.a, c.x, c.y);
      break;
  }
}
