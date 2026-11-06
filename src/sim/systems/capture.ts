import { BALANCE } from '../data/defs';
import { dist } from '../fixed';
import type { World } from '../types';

export function captureSystem(w: World): void {
  for (const point of w.points) {
    const present = [0, 0];
    for (const e of w.entities) {
      if (e.isBuilding || e.type === 'truck') continue;
      if (dist(e.x, e.y, point.x, point.y) <= BALANCE.captureRadius) present[e.owner]++;
    }
    point.contested = present[0] > 0 && present[1] > 0;
    if (point.contested || (present[0] === 0 && present[1] === 0)) continue;

    const owner = present[0] > 0 ? 0 : 1;
    const rate = Math.min(present[owner], BALANCE.captureMaxRate) * BALANCE.capturePerUnit;
    const sign = owner === 0 ? 1 : -1;
    const max = BALANCE.captureMax;
    const before = point.value;
    point.value = Math.max(-max, Math.min(max, point.value + sign * rate));

    if (point.owner !== -1 && point.owner !== owner && Math.sign(point.value) !== Math.sign(before)) {
      point.owner = -1;
    }
    if (Math.abs(point.value) === max && point.owner !== owner) {
      point.owner = owner;
      w.events.push({ k: 'capture', point: point.id, owner });
    }
  }

  const first = w.points[0].owner;
  const held = first !== -1 && w.points.every((p) => p.owner === first);
  if (held && w.holdOwner === first) {
    w.holdTicks++;
  } else {
    w.holdOwner = held ? first : -1;
    w.holdTicks = 0;
  }
}
