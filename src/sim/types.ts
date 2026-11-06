import type { AbilityType, EntityType, UnitType } from './data/defs';

export const enum Order {
  Idle = 0,
  /** Goes to the destination without stopping; still fires at what is in range. */
  Move = 1,
  /** Goes to the destination, stopping to fight whatever it meets. */
  AttackMove = 2,
  Attack = 3,
}

export const enum Terrain {
  Grass = 0,
  Water = 1,
  Rock = 2,
  Bridge = 3,
  Tree = 4,
}

export interface Entity {
  id: number;
  type: EntityType;
  owner: number;
  isBuilding: boolean;
  /** Center position, fixed point. */
  x: number;
  y: number;
  /** Position at the previous tick, used only by the renderer to interpolate. */
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  targetId: number;
  cooldown: number;
  order: Order;
  destX: number;
  destY: number;
  orderTarget: number;
  /** Building footprint origin (cells). */
  cx: number;
  cy: number;
  /** Construction ticks remaining; 0 once finished. */
  building: number;
  queue: UnitType[];
  queueProgress: number;
  /** Refinery: its truck id, or 0. Truck: its refinery id. */
  linkId: number;
  /** Refinery: respawn countdown. Truck: loading countdown. */
  timer: number;
  /** Truck: 0 loading, 1 going to HQ, 2 going back. */
  phase: number;
  cargo: number;
}

export interface PlayerStats {
  unitsMade: number;
  unitsLost: number;
  kills: number;
  buildingsBuilt: number;
  suppliesEarned: number;
}

export interface Player {
  supplies: number;
  incomeMult: number;
  rallyX: number;
  rallyY: number;
  stats: PlayerStats;
  cooldowns: Record<AbilityType, number>;
  /** Far behind on the board: earns more and recharges abilities faster. */
  underdog: boolean;
}

export interface Strike {
  kind: AbilityType;
  owner: number;
  x: number;
  y: number;
  timer: number;
  shells: number;
}

export interface ControlPoint {
  id: number;
  x: number;
  y: number;
  owner: number;
  /** Positive leans to player 0, negative to player 1. */
  value: number;
  contested: boolean;
}

export interface Deposit {
  cx: number;
  cy: number;
}

export type GameEvent =
  | { k: 'shot'; from: number; to: number; type: EntityType; x: number; y: number }
  | { k: 'hit'; id: number; x: number; y: number }
  | { k: 'death'; id: number; type: EntityType; owner: number; x: number; y: number }
  | { k: 'built'; id: number; owner: number }
  | { k: 'spawn'; id: number; owner: number }
  | { k: 'capture'; point: number; owner: number }
  | { k: 'deliver'; owner: number; amount: number; x: number; y: number }
  | { k: 'suddenDeath' }
  | { k: 'strike'; kind: AbilityType; owner: number; x: number; y: number; delay: number }
  | { k: 'blast'; kind: AbilityType; x: number; y: number; radius: number };

export interface World {
  tick: number;
  rng: number;
  width: number;
  height: number;
  terrain: Uint8Array;
  /** Cells that ground units cannot enter: terrain plus building footprints. */
  blocked: Uint8Array;
  navVersion: number;
  players: Player[];
  entities: Entity[];
  byId: Map<number, Entity>;
  nextId: number;
  points: ControlPoint[];
  deposits: Deposit[];
  strikes: Strike[];
  holdOwner: number;
  holdTicks: number;
  suddenDeath: boolean;
  /** -1 while playing; otherwise 0 or 1, or 2 for a draw. */
  winner: number;
  /** Cleared at the start of every tick. Not part of the hashed state. */
  events: GameEvent[];
}

export interface GameConfig {
  seed: number;
  incomeMult?: [number, number];
}
