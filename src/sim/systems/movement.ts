import { BALANCE, UNITS, type UnitType } from '../data/defs';
import { ONE, dist, fx, idiv, isqrt, toCell } from '../fixed';
import {
  approachCell, cellCenterX, cellCenterY, cellIndex, getField, isBlockedAt, nearestFreeCell, nextCell,
} from '../pathfinding';
import { Order, type Entity, type World } from '../types';
import { inRange } from './combat';

const ARRIVE = fx(0.35);

function tryMove(w: World, e: Entity, nx: number, ny: number): void {
  if (UNITS[e.type as UnitType].air) {
    e.x = Math.max(0, Math.min(w.width * ONE - 1, nx));
    e.y = Math.max(0, Math.min(w.height * ONE - 1, ny));
    return;
  }
  // A unit caught inside a new building may walk out over blocked cells.
  const stuck = isBlockedAt(w, e.x, e.y);
  if (stuck || !isBlockedAt(w, nx, ny)) {
    e.x = nx;
    e.y = ny;
  } else if (!isBlockedAt(w, nx, e.y)) {
    e.x = nx;
  } else if (!isBlockedAt(w, e.x, ny)) {
    e.y = ny;
  }
}

function stepToward(w: World, e: Entity, tx: number, ty: number, speed: number): void {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = isqrt(dx * dx + dy * dy);
  if (d === 0) return;
  if (d <= speed) tryMove(w, e, tx, ty);
  else tryMove(w, e, e.x + idiv(dx * speed, d), e.y + idiv(dy * speed, d));
}

function walk(w: World, e: Entity, destCell: number, tx: number, ty: number, speed: number): void {
  const cell = cellIndex(w, e.x, e.y);
  if (cell === destCell) {
    stepToward(w, e, tx, ty, speed);
    return;
  }
  const next = nextCell(w, getField(w, destCell), cell);
  if (next >= 0) {
    stepToward(w, e, cellCenterX(w, next), cellCenterY(w, next), speed);
  } else if (w.blocked[cell]) {
    const free = nearestFreeCell(w, toCell(e.x), toCell(e.y));
    stepToward(w, e, cellCenterX(w, free), cellCenterY(w, free), speed);
  }
}

function goToPoint(w: World, e: Entity, tx: number, ty: number, speed: number): void {
  if (UNITS[e.type as UnitType].air) {
    stepToward(w, e, tx, ty, speed);
    return;
  }
  const destCell = nearestFreeCell(w, toCell(tx), toCell(ty));
  const sameCell = destCell === cellIndex(w, tx, ty);
  walk(
    w, e, destCell,
    sameCell ? tx : cellCenterX(w, destCell),
    sameCell ? ty : cellCenterY(w, destCell),
    speed,
  );
}

function goToEntity(w: World, e: Entity, target: Entity, speed: number): void {
  if (UNITS[e.type as UnitType].air) {
    stepToward(w, e, target.x, target.y, speed);
    return;
  }
  const cell = approachCell(w, target, e.x, e.y);
  walk(w, e, cell, cellCenterX(w, cell), cellCenterY(w, cell), speed);
}

function moveUnit(w: World, e: Entity): void {
  const speed = UNITS[e.type as UnitType].speed;
  const aggro = UNITS[e.type as UnitType].aggro;
  const target = e.targetId ? w.byId.get(e.targetId) : undefined;

  switch (e.order) {
    case Order.Idle:
      if (target && !inRange(e, target) && dist(e.x, e.y, target.x, target.y) <= aggro) {
        goToEntity(w, e, target, speed);
      }
      return;
    case Order.AttackMove:
      if (target) {
        if (inRange(e, target)) return;
        if (dist(e.x, e.y, target.x, target.y) <= aggro) {
          goToEntity(w, e, target, speed);
          return;
        }
      }
      break;
    case Order.Attack: {
      const ordered = w.byId.get(e.orderTarget);
      if (!ordered) {
        e.order = Order.Idle;
        return;
      }
      if (!inRange(e, ordered)) goToEntity(w, e, ordered, speed);
      return;
    }
    case Order.Move:
      break;
  }

  if (dist(e.x, e.y, e.destX, e.destY) <= ARRIVE) {
    e.order = Order.Idle;
    return;
  }
  goToPoint(w, e, e.destX, e.destY, speed);
}

/** Keeps squads from stacking. Trucks are excluded so they never block a lane. */
function separate(w: World): void {
  const list = w.entities;
  const radius = BALANCE.separation;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.isBuilding || a.type === 'truck') continue;
    const airA = UNITS[a.type as UnitType].air;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.isBuilding || b.type === 'truck' || UNITS[b.type as UnitType].air !== airA) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.abs(dx) >= radius || Math.abs(dy) >= radius) continue;
      const d = isqrt(dx * dx + dy * dy);
      if (d >= radius) continue;
      if (d === 0) {
        tryMove(w, b, b.x + ((b.id & 1) ? 40 : -40), b.y + ((b.id & 2) ? 40 : -40));
        continue;
      }
      const push = (radius - d) >> 2;
      const px = idiv(dx * push, d);
      const py = idiv(dy * push, d);
      tryMove(w, a, a.x - px, a.y - py);
      tryMove(w, b, b.x + px, b.y + py);
    }
  }
}

export function movementSystem(w: World): void {
  for (const e of w.entities) {
    if (e.isBuilding) continue;
    e.px = e.x;
    e.py = e.y;
    moveUnit(w, e);
  }
  separate(w);
}
