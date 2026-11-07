import {
  ABILITIES, ABILITY_TYPES, BALANCE, BUILDINGS, EMP_STUN, UNITS, UPGRADE_TYPES,
  type AbilityType, type BuildingType, type UnitType, type UpgradeType,
} from '../data/defs';
import { ONE, dist, idiv } from '../fixed';
import { cellCenterX, cellCenterY, freeCellNear } from '../pathfinding';
import { randInt } from '../rng';
import type { Player, Strike, World } from '../types';
import { applyDamage } from './combat';
import { createEntity, squadCount } from './production';

export const newCooldowns = (): Record<AbilityType, number> => {
  const cooldowns = {} as Record<AbilityType, number>;
  for (const kind of ABILITY_TYPES) cooldowns[kind] = ABILITIES[kind].startCooldown;
  return cooldowns;
};

export const newResearch = (): Record<UpgradeType, number> => {
  const research = {} as Record<UpgradeType, number>;
  for (const u of UPGRADE_TYPES) research[u] = 0;
  return research;
};

export function useAbility(w: World, p: number, kind: AbilityType, x: number, y: number): boolean {
  const player = w.players[p];
  const def = ABILITIES[kind];
  if (!def || !player.loadout.includes(kind) || player.cooldowns[kind] > 0) return false;
  if (x < 0 || y < 0 || x >= w.width * ONE || y >= w.height * ONE) return false;
  player.cooldowns[kind] = def.cooldown;
  w.strikes.push({ kind, owner: p, x, y, timer: def.delay, shells: def.shells });
  w.events.push({ k: 'strike', kind, owner: p, x, y, delay: def.delay });
  return true;
}

/** Abilities only hurt the enemy, and hit buildings far less than units. */
function blast(w: World, s: Strike, x: number, y: number): void {
  const def = ABILITIES[s.kind];
  for (const e of w.entities) {
    if (e.owner === s.owner) continue;
    const reach = def.radius + (e.isBuilding ? ONE : 0);
    if (dist(e.x, e.y, x, y) > reach) continue;
    const pct = e.type === 'hq' ? BALANCE.abilityHqPct : e.isBuilding ? BALANCE.abilityBuildingPct : 100;
    const dealt = idiv(def.damage * pct, 100);
    const killer = w.entities.find((o) => o.owner === s.owner && o.type === 'hq');
    applyDamage(w, e, dealt, killer);
    w.events.push({ k: 'hit', id: e.id, x: e.x, y: e.y });
  }
  w.events.push({ k: 'blast', kind: s.kind, x, y, radius: def.radius });
}

function drop(w: World, s: Strike, type: UnitType, count: number): void {
  for (let i = 0; i < count; i++) {
    if (squadCount(w, s.owner) >= BALANCE.maxSquads) return;
    const offset = count === 1 ? 0 : (i === 0 ? -1 : 1) * ONE;
    const cell = freeCellNear(w, s.x + offset, s.y, s.x, s.y);
    const e = createEntity(w, type, s.owner, cellCenterX(w, cell), cellCenterY(w, cell), UNITS[type].hp);
    w.players[s.owner].stats.unitsMade++;
    w.events.push({ k: 'spawn', id: e.id, owner: e.owner });
  }
}

/** Freezes enemy units and turrets in the area. */
function pulse(w: World, s: Strike): void {
  const def = ABILITIES.emp;
  for (const e of w.entities) {
    if (e.owner === s.owner || (e.isBuilding && e.type !== 'turret')) continue;
    if (dist(e.x, e.y, s.x, s.y) > def.radius + (e.isBuilding ? ONE : 0)) continue;
    e.stun = EMP_STUN;
    e.targetId = 0;
  }
  w.events.push({ k: 'blast', kind: 'emp', x: s.x, y: s.y, radius: def.radius });
}

/** Heals the caster's units, and its buildings by less. Never the HQ. */
function repair(w: World, s: Strike): void {
  const def = ABILITIES.repair;
  for (const e of w.entities) {
    if (e.owner !== s.owner || e.type === 'hq' || e.building > 0) continue;
    const reach = def.radius + (e.isBuilding ? ONE : 0);
    if (dist(e.x, e.y, s.x, s.y) > reach) continue;
    const pct = e.isBuilding ? 15 : def.damage;
    e.hp = Math.min(e.maxHp, e.hp + idiv(e.maxHp * pct, 100));
  }
  w.events.push({ k: 'blast', kind: 'repair', x: s.x, y: s.y, radius: def.radius });
}

function detonate(w: World, s: Strike): void {
  switch (s.kind) {
    case 'paradrop': drop(w, s, 'infantry', 2); break;
    case 'armor': drop(w, s, 'tank', 1); break;
    case 'airstrike': blast(w, s, s.x, s.y); break;
    case 'emp': pulse(w, s); break;
    case 'repair': repair(w, s); break;
    case 'artillery': {
      const spread = ONE * 3;
      blast(w, s, s.x + randInt(w, -spread, spread), s.y + randInt(w, -spread, spread));
      break;
    }
  }
}

function coolDown(w: World, player: Player): void {
  // Underdogs recharge at 1.5x: an extra step every other tick.
  const steps = player.underdog && w.tick % 2 === 0 ? 2 : 1;
  for (const kind of Object.keys(player.cooldowns) as AbilityType[]) {
    player.cooldowns[kind] = Math.max(0, player.cooldowns[kind] - steps);
  }
}

export function abilitySystem(w: World): void {
  for (const player of w.players) coolDown(w, player);
  for (const s of w.strikes) {
    if (--s.timer > 0) continue;
    detonate(w, s);
    s.shells--;
    s.timer = ABILITIES[s.kind].shellGap;
  }
  w.strikes = w.strikes.filter((s) => s.shells > 0);
}


/** Rough worth of everything a player holds, used to spot a lopsided game. */
export function strength(w: World, owner: number): number {
  let total = w.points.filter((p) => p.owner === owner).length * BALANCE.pointValue;
  for (const e of w.entities) {
    if (e.owner !== owner) continue;
    if (e.isBuilding) total += BUILDINGS[e.type as BuildingType].cost;
    else if (e.type !== 'truck') total += idiv(UNITS[e.type as 'tank'].cost * e.hp, e.maxHp);
  }
  return total;
}

/** A player far behind earns more and recharges faster, so games stay winnable. */
export function updateUnderdogs(w: World): void {
  const a = strength(w, 0);
  const b = strength(w, 1);
  const behind = (mine: number, theirs: number) =>
    theirs >= BALANCE.underdogMinStrength && mine * 100 < theirs * BALANCE.underdogPct;
  w.players[0].underdog = behind(a, b);
  w.players[1].underdog = behind(b, a);
}
