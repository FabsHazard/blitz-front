import { canPlace, trainBuilding, type Command } from '../sim/commands';
import {
  ABILITY_TYPES, BALANCE, BUILDINGS, LOADOUT_SIZE, UNITS, UPGRADES, UPGRADE_TYPES,
  type AbilityType, type BuildingType, type UnitType,
} from '../sim/data/defs';
import { fx, secs, toCell } from '../sim/fixed';
import { randInt } from '../sim/rng';
import { findHq } from '../sim/systems/economy';
import { canResearchAt } from '../sim/systems/research';
import { squadCount } from '../sim/systems/production';
import { Order, type ControlPoint, type Entity, type World } from '../sim/types';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Profile {
  thinkTicks: number;
  waveSize: number;
  waveTicks: number;
  incomeMult: number;
  counters: boolean;
  abilities: boolean;
  upgrades: boolean;
}

export const PROFILES: Record<Difficulty, Profile> = {
  easy: { thinkTicks: secs(3), waveSize: 5, waveTicks: secs(75), incomeMult: 80, counters: false, abilities: false, upgrades: false },
  normal: { thinkTicks: secs(1.5), waveSize: 6, waveTicks: secs(55), incomeMult: 100, counters: true, abilities: true, upgrades: true },
  hard: { thinkTicks: secs(0.8), waveSize: 7, waveTicks: secs(40), incomeMult: 125, counters: true, abilities: true, upgrades: true },
};

const BUILD_ORDER: BuildingType[] = [
  'barracks', 'refinery', 'factory', 'refinery', 'turret', 'helipad',
  'refinery', 'barracks', 'factory', 'turret',
];

/** A random loadout for a bot, drawn from its own seeded stream. */
export function botLoadout(seed: number): AbilityType[] {
  const r = { rng: seed | 0 };
  const pool = [...ABILITY_TYPES];
  const picked: AbilityType[] = [];
  while (picked.length < LOADOUT_SIZE) picked.push(pool.splice(randInt(r, 0, pool.length - 1), 1)[0]);
  return picked;
}

const distSq = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

/**
 * The bot only reads the world and returns ordinary commands, so it has no
 * advantage beyond its income multiplier and needs no special case in the sim.
 */
export class Bot {
  rng: number;
  private buildStep = 0;
  private lastWave = 0;
  private readonly profile: Profile;

  constructor(readonly player: number, difficulty: Difficulty, seed: number) {
    this.profile = PROFILES[difficulty];
    this.rng = seed | 0;
  }

  think(w: World): Command[] {
    if ((w.tick + this.player * 3) % this.profile.thinkTicks !== 0) return [];
    const commands: Command[] = [];
    const hq = findHq(w, this.player);
    if (!hq) return commands;
    const budget = { left: w.players[this.player].supplies };
    this.planBuilding(w, hq, budget, commands);
    if (this.profile.upgrades) this.planResearch(w, budget, commands);
    this.planTraining(w, budget, commands);
    this.planArmy(w, hq, commands);
    if (this.profile.abilities) this.planAbilities(w, commands);
    return commands;
  }

  private planBuilding(w: World, hq: Entity, budget: { left: number }, out: Command[]): void {
    if (this.buildStep >= BUILD_ORDER.length) return;
    const type = BUILD_ORDER[this.buildStep];
    const cost = BUILDINGS[type].cost;
    if (budget.left < cost) {
      // Save for the next building unless there is almost no army to defend with.
      if (this.army(w).length >= 2) budget.left = 0;
      return;
    }
    const spot = type === 'refinery' ? this.findDeposit(w, hq) : this.findSpot(w, hq, type);
    this.buildStep++;
    if (!spot) return;
    out.push({ t: 'build', p: this.player, b: type, cx: spot[0], cy: spot[1] });
    budget.left -= cost;
  }

  private findDeposit(w: World, hq: Entity): [number, number] | null {
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    for (const d of w.deposits) {
      if (!canPlace(w, this.player, 'refinery', d.cx, d.cy)) continue;
      const score = distSq({ x: fx(d.cx + 1), y: fx(d.cy + 1) }, hq);
      if (score < bestScore) {
        bestScore = score;
        best = [d.cx, d.cy];
      }
    }
    return best;
  }

  private findSpot(w: World, hq: Entity, type: BuildingType): [number, number] | null {
    const def = BUILDINGS[type];
    // Plans as if it were side 0, then rotates the spot, so both sides build alike.
    const mirrored = this.player === 1;
    const homeCx = mirrored ? w.width - toCell(hq.x) : toCell(hq.x);
    const homeCy = mirrored ? w.height - toCell(hq.y) : toCell(hq.y);
    const baseX = homeCx + (type === 'turret' ? 8 : 6) - (def.w >> 1);
    const baseY = homeCy - (def.h >> 1);
    for (let tries = 0; tries < 40; tries++) {
      const spread = 2 + (tries >> 2);
      const sx = baseX + randInt(this, -spread, spread);
      const sy = baseY + randInt(this, -spread - 3, spread + 3);
      const cx = mirrored ? w.width - sx - def.w : sx;
      const cy = mirrored ? w.height - sy - def.h : sy;
      if (canPlace(w, this.player, type, cx, cy)) return [cx, cy];
    }
    return null;
  }

  private chooseUnit(w: World): UnitType | null {
    const enemy = w.entities.filter((e) => e.owner !== this.player && !e.isBuilding);
    const count = (t: UnitType) => enemy.filter((e) => e.type === t).length;
    const options: [UnitType, number][] = [
      ['infantry', 4], ['antitank', 3], ['tank', 4], ['heli', 2],
    ];
    if (this.profile.counters) {
      options[1][1] += count('tank') * 2;
      options[0][1] += count('antitank') * 2 + count('heli') * 3;
      options[2][1] += count('infantry') * 2;
    }
    const available = options.filter(([t]) => trainBuilding(w, this.player, t) !== undefined);
    const total = available.reduce((sum, [, weight]) => sum + weight, 0);
    if (total === 0) return null;
    let roll = randInt(this, 0, total - 1);
    for (const [t, weight] of available) {
      roll -= weight;
      if (roll < 0) return t;
    }
    return null;
  }

  private planTraining(w: World, budget: { left: number }, out: Command[]): void {
    for (let i = 0; i < 3; i++) {
      if (squadCount(w, this.player) + i >= BALANCE.maxSquads) return;
      const unit = this.chooseUnit(w);
      if (!unit || budget.left < UNITS[unit].cost) return;
      out.push({ t: 'train', p: this.player, unit });
      budget.left -= UNITS[unit].cost;
    }
  }

  private army(w: World): Entity[] {
    return w.entities.filter((e) => e.owner === this.player && !e.isBuilding && e.type !== 'truck');
  }

  private closestOpenPoint(w: World, from: Entity): ControlPoint | undefined {
    const open = w.points.filter((p) => p.owner !== this.player);
    const tieBreak = this.player === 0 ? 1 : -1;
    return open.sort((a, b) => distSq(a, from) - distSq(b, from) || (a.id - b.id) * tieBreak)[0];
  }

  /** The enemy squad with the most other squads packed around it. */
  private densestEnemy(w: World): { target: Entity; count: number } | null {
    const enemies = w.entities.filter((e) =>
      e.owner !== this.player && !e.isBuilding && e.type !== 'truck');
    let best: { target: Entity; count: number } | null = null;
    const reach = fx(3.5) * fx(3.5);
    for (const target of enemies) {
      const count = enemies.filter((o) => distSq(o, target) <= reach).length;
      if (!best || count > best.count) best = { target, count };
    }
    return best;
  }

  /** Researches once the build order is done and there is money to spare. */
  private planResearch(w: World, budget: { left: number }, out: Command[]): void {
    if (this.buildStep < 4 || this.army(w).length < 4) return;
    const research = w.players[this.player].research;
    for (const u of UPGRADE_TYPES) {
      const cost = UPGRADES[u].cost;
      if (research[u] !== 0 || budget.left < cost + 150 || !canResearchAt(w, this.player, u)) continue;
      out.push({ t: 'upgrade', p: this.player, u });
      budget.left -= cost;
      return;
    }
  }

  /** Own squads near the most damaged one, if they are worth healing. */
  private woundedGroup(w: World): Entity | null {
    const army = this.army(w);
    let best: Entity | null = null;
    let bestScore = 0;
    const reach = fx(4) * fx(4);
    for (const e of army) {
      let missing = 0;
      for (const o of army) if (distSq(o, e) <= reach) missing += o.maxHp - o.hp;
      if (missing > bestScore) {
        bestScore = missing;
        best = e;
      }
    }
    return bestScore >= 500 ? best : null;
  }

  private planAbilities(w: World, out: Command[]): void {
    const player = w.players[this.player];
    const ready = (a: AbilityType) => player.loadout.includes(a) && player.cooldowns[a] === 0;
    const p = this.player;
    const dense = this.densestEnemy(w);
    if (dense && dense.count >= 3 && ready('airstrike')) {
      out.push({ t: 'ability', p, a: 'airstrike', x: dense.target.x, y: dense.target.y });
    } else if (dense && dense.count >= 3 && ready('emp')) {
      out.push({ t: 'ability', p, a: 'emp', x: dense.target.x, y: dense.target.y });
    } else if (dense && dense.count >= 2 && ready('artillery')) {
      out.push({ t: 'ability', p, a: 'artillery', x: dense.target.x, y: dense.target.y });
    }
    const wounded = ready('repair') ? this.woundedGroup(w) : null;
    if (wounded) out.push({ t: 'ability', p, a: 'repair', x: wounded.x, y: wounded.y });
    const open = w.points.find((c) => c.owner !== p && !c.contested);
    if (open && ready('paradrop')) {
      out.push({ t: 'ability', p, a: 'paradrop', x: open.x, y: open.y });
    } else if (open && ready('armor')) {
      out.push({ t: 'ability', p, a: 'armor', x: open.x, y: open.y });
    }
  }

  private planArmy(w: World, hq: Entity, out: Command[]): void {
    const army = this.army(w);
    if (army.length === 0) return;
    const ids = army.map((e) => e.id);
    const enemy = 1 - this.player;
    const enemyHq = findHq(w, enemy);

    const intruder = w.entities.find((e) =>
      e.owner === enemy && !e.isBuilding && e.type !== 'truck' && distSq(e, hq) < fx(14) * fx(14));
    if (intruder) {
      out.push({ t: 'move', p: this.player, ids, x: intruder.x, y: intruder.y, mode: 'amove' });
      return;
    }

    // Losing the map is the fastest way to lose the game, so answer it at once.
    if (w.holdOwner === enemy) {
      const point = this.closestOpenPoint(w, army[0]);
      if (point) out.push({ t: 'move', p: this.player, ids, x: point.x, y: point.y, mode: 'amove' });
      return;
    }

    const waveReady = army.length >= this.profile.waveSize
      || w.tick - this.lastWave >= this.profile.waveTicks;
    if (waveReady && army.length >= 3 && enemyHq) {
      this.lastWave = w.tick;
      // Early waves fight for the map; later ones go straight for the HQ.
      const point = w.tick < secs(150) ? this.closestOpenPoint(w, army[0]) : undefined;
      const target = point ?? enemyHq;
      out.push({ t: 'move', p: this.player, ids, x: target.x, y: target.y, mode: 'amove' });
      return;
    }

    const idle = army.filter((e) => e.order === Order.Idle);
    const point = this.closestOpenPoint(w, hq);
    if (idle.length > 0 && point) {
      out.push({
        t: 'move', p: this.player, ids: idle.map((e) => e.id), x: point.x, y: point.y, mode: 'amove',
      });
    }
  }
}
