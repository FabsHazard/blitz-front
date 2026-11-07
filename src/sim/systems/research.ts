import { UPGRADES, UPGRADE_TYPES, type UpgradeType } from '../data/defs';
import type { World } from '../types';

export const hasUpgrade = (w: World, owner: number, u: UpgradeType): boolean =>
  w.players[owner].research[u] === -1;

/** True when the player owns a finished building that researches this upgrade. */
export function canResearchAt(w: World, owner: number, u: UpgradeType): boolean {
  const building = UPGRADES[u].building;
  return w.entities.some((e) => e.owner === owner && e.type === building && e.building === 0);
}

export function startResearch(w: World, owner: number, u: UpgradeType): boolean {
  const player = w.players[owner];
  const def = UPGRADES[u];
  if (!def || player.research[u] !== 0 || player.supplies < def.cost) return false;
  if (!canResearchAt(w, owner, u)) return false;
  player.supplies -= def.cost;
  player.research[u] = def.ticks;
  return true;
}

/** Research only advances while its building stands. */
export function researchSystem(w: World): void {
  w.players.forEach((player, owner) => {
    for (const u of UPGRADE_TYPES) {
      if (player.research[u] <= 0 || !canResearchAt(w, owner, u)) continue;
      if (--player.research[u] === 0) {
        player.research[u] = -1;
        w.events.push({ k: 'researched', owner, upgrade: u });
      }
    }
  });
}
