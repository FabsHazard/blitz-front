import { BALANCE } from '../data/defs';
import { TICK_RATE } from '../fixed';
import type { World } from '../types';
import { findHq } from './economy';

function suddenDeath(w: World): void {
  if (!w.suddenDeath && w.tick >= BALANCE.suddenDeathTick) {
    w.suddenDeath = true;
    w.events.push({ k: 'suddenDeath' });
  }
  if (!w.suddenDeath || w.tick % TICK_RATE !== 0) return;
  for (const e of w.entities) {
    if (e.type === 'hq') e.hp -= BALANCE.suddenDeathDamagePerSecond;
  }
}

export function preVictorySystem(w: World): void {
  suddenDeath(w);
}

/** Runs after dead entities were removed, so a missing HQ means it was destroyed. */
export function victorySystem(w: World): void {
  if (w.winner !== -1) return;
  const alive0 = findHq(w, 0) !== undefined;
  const alive1 = findHq(w, 1) !== undefined;
  if (!alive0 && !alive1) w.winner = 2;
  else if (!alive0) w.winner = 1;
  else if (!alive1) w.winner = 0;
  else if (w.holdTicks >= BALANCE.holdToWinTicks) w.winner = w.holdOwner;
}
