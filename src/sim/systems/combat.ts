import {
  BUILDINGS, DAMAGE, UNITS, isBuildingType, type EntityType, type UnitType,
} from '../data/defs';
import { dist, fx, idiv } from '../fixed';
import { randInt } from '../rng';
import { Order, type Entity, type World } from '../types';

const RETARGET_TICKS = 5;

export const canHit = (attacker: EntityType, target: EntityType): boolean =>
  (DAMAGE[attacker]?.[target] ?? 0) > 0;

function reach(e: Entity): number {
  return isBuildingType(e.type) ? BUILDINGS[e.type].range : UNITS[e.type].range;
}

function acquireRange(e: Entity): number {
  return isBuildingType(e.type) ? BUILDINGS[e.type].range : UNITS[e.type as UnitType].aggro;
}

/** Distance to the nearest edge of a target, so big buildings are reachable. */
export function edgeDistance(e: Entity, target: Entity): number {
  const d = dist(e.x, e.y, target.x, target.y);
  if (!target.isBuilding) return d;
  const def = BUILDINGS[target.type as keyof typeof BUILDINGS];
  return Math.max(0, d - fx(Math.max(def.w, def.h) / 2));
}

export function inRange(e: Entity, target: Entity): boolean {
  return edgeDistance(e, target) <= reach(e);
}

function isArmed(e: Entity): boolean {
  if (e.isBuilding) return e.type === 'turret' && e.building === 0;
  return e.type !== 'truck';
}

function findTarget(w: World, e: Entity): number {
  const range = acquireRange(e);
  let best = 0;
  let bestScore = Infinity;
  for (const o of w.entities) {
    if (o.owner === e.owner || !canHit(e.type, o.type)) continue;
    const d = edgeDistance(e, o);
    if (d > range) continue;
    // Prefer units over buildings and targets this attacker counters.
    const pct = DAMAGE[e.type]![o.type];
    const score = d + (o.isBuilding ? fx(6) : 0) - (pct >= 150 ? fx(2) : 0);
    if (score < bestScore) {
      bestScore = score;
      best = o.id;
    }
  }
  return best;
}

export function targetingSystem(w: World): void {
  for (const e of w.entities) {
    if (!isArmed(e)) continue;
    if (e.order === Order.Attack) {
      const ordered = w.byId.get(e.orderTarget);
      if (ordered && inRange(e, ordered)) {
        e.targetId = ordered.id;
        continue;
      }
    }
    const current = e.targetId ? w.byId.get(e.targetId) : undefined;
    if (!current) e.targetId = 0;
    if (!current || (w.tick + e.id) % RETARGET_TICKS === 0) e.targetId = findTarget(w, e);
  }
}

function damageOf(e: Entity): number {
  if (isBuildingType(e.type)) return BUILDINGS[e.type].dmg;
  // Worn-down squads have fewer members firing.
  return idiv(UNITS[e.type].dmg * (50 + idiv(50 * e.hp, e.maxHp)), 100);
}

function cooldownOf(e: Entity): number {
  return isBuildingType(e.type) ? BUILDINGS[e.type].cooldown : UNITS[e.type].cooldown;
}

export function applyDamage(w: World, target: Entity, amount: number, attacker?: Entity): void {
  const wasAlive = target.hp > 0;
  target.hp -= amount;
  if (wasAlive && target.hp <= 0 && attacker) {
    w.players[attacker.owner].stats.kills++;
  }
}

export function fireSystem(w: World): void {
  for (const e of w.entities) {
    if (e.cooldown > 0) e.cooldown--;
    if (e.cooldown > 0 || !e.targetId || !isArmed(e)) continue;
    const target = w.byId.get(e.targetId);
    if (!target || target.hp <= 0 || !inRange(e, target)) continue;
    e.cooldown = cooldownOf(e);
    const pct = DAMAGE[e.type]![target.type];
    const variance = randInt(w, 92, 108);
    const amount = Math.max(1, idiv(idiv(damageOf(e) * pct, 100) * variance, 100));
    applyDamage(w, target, amount, e);
    w.events.push({ k: 'shot', from: e.id, to: target.id, type: e.type, x: target.x, y: target.y });
    w.events.push({ k: 'hit', id: target.id, x: target.x, y: target.y });
  }
}
