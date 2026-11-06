import { BALANCE } from '../data/defs';
import { TICK_RATE, dist, fx, idiv } from '../fixed';
import { approachCell, cellCenterX, cellCenterY } from '../pathfinding';
import { Order, type Entity, type World } from '../types';
import { updateUnderdogs } from './abilities';
import { spawnUnit } from './production';

export function earn(w: World, owner: number, amount: number): number {
  const p = w.players[owner];
  const gained = idiv(amount * p.incomeMult, 100);
  p.supplies += gained;
  p.stats.suppliesEarned += gained;
  return gained;
}

export const findHq = (w: World, owner: number): Entity | undefined =>
  w.entities.find((e) => e.type === 'hq' && e.owner === owner);

export function incomePerSecond(w: World, owner: number): number {
  const points = w.points.filter((p) => p.owner === owner).length;
  const income = BALANCE.hqIncome + points * BALANCE.pointIncome;
  return w.players[owner].underdog ? idiv(income * BALANCE.underdogIncomePct, 100) : income;
}

function sendTruck(w: World, truck: Entity, target: Entity): void {
  const cell = approachCell(w, target, truck.x, truck.y);
  truck.order = Order.Move;
  truck.destX = cellCenterX(w, cell);
  truck.destY = cellCenterY(w, cell);
}

function updateTruck(w: World, truck: Entity): void {
  const refinery = w.byId.get(truck.linkId);
  if (!refinery) {
    truck.hp = 0;
    return;
  }
  const hq = findHq(w, truck.owner);
  if (!hq) return;

  if (truck.phase === 0) {
    if (--truck.timer > 0) return;
    const cells = idiv(dist(refinery.x, refinery.y, hq.x, hq.y), fx(1));
    truck.cargo = BALANCE.truckBaseCargo + cells * BALANCE.truckCargoPerCell;
    truck.phase = 1;
    sendTruck(w, truck, hq);
  } else if (truck.phase === 1) {
    // Trucks are never pushed by other units, so arriving means docking.
    if (truck.order === Order.Idle) {
      const gained = earn(w, truck.owner, truck.cargo);
      w.events.push({ k: 'deliver', owner: truck.owner, amount: gained, x: truck.x, y: truck.y });
      truck.cargo = 0;
      truck.phase = 2;
      sendTruck(w, truck, refinery);
    }
  } else if (truck.order === Order.Idle) {
    truck.phase = 0;
    truck.timer = BALANCE.truckLoadTicks;
  }
}

function updateRefinery(w: World, refinery: Entity): void {
  if (refinery.building > 0 || w.byId.has(refinery.linkId)) return;
  refinery.linkId = 0;
  if (--refinery.timer > 0) return;
  const truck = spawnUnit(w, refinery, 'truck');
  truck.linkId = refinery.id;
  truck.phase = 0;
  truck.timer = BALANCE.truckLoadTicks;
  refinery.linkId = truck.id;
  refinery.timer = BALANCE.truckRespawnTicks;
}

export function economySystem(w: World): void {
  if (w.tick % TICK_RATE === 0) {
    updateUnderdogs(w);
    for (let owner = 0; owner < w.players.length; owner++) {
      if (findHq(w, owner)) earn(w, owner, incomePerSecond(w, owner));
    }
  }
  // Index loop: refineries append trucks to this list while it runs.
  const count = w.entities.length;
  for (let i = 0; i < count; i++) {
    const e = w.entities[i];
    if (e.type === 'truck') updateTruck(w, e);
    else if (e.type === 'refinery') updateRefinery(w, e);
  }
}
