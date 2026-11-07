import { fx, secs } from '../fixed';

export type UnitType = 'infantry' | 'antitank' | 'tank' | 'heli' | 'truck';
export type BuildingType = 'hq' | 'barracks' | 'factory' | 'helipad' | 'refinery' | 'turret';
export type EntityType = UnitType | BuildingType;
export type AbilityType = 'airstrike' | 'artillery' | 'paradrop' | 'emp' | 'repair' | 'armor';
export type UpgradeType = 'grenades' | 'plating' | 'missiles' | 'haulers' | 'twinGuns';

export interface UnitDef {
  name: string;
  cost: number;
  hp: number;
  dmg: number;
  cooldown: number;
  range: number;
  aggro: number;
  speed: number;
  buildTicks: number;
  members: number;
  air: boolean;
  producer: BuildingType | null;
}

export interface BuildingDef {
  name: string;
  cost: number;
  hp: number;
  w: number;
  h: number;
  buildTicks: number;
  dmg: number;
  cooldown: number;
  range: number;
}

const unit = (
  name: string, cost: number, hp: number, dmg: number, cooldown: number, range: number,
  speed: number, buildSeconds: number, members: number, air: boolean, producer: BuildingType | null,
): UnitDef => ({
  name, cost, hp, dmg,
  cooldown: secs(cooldown),
  range: fx(range),
  aggro: fx(range + 3),
  speed: fx(speed) / 15 | 0,
  buildTicks: secs(buildSeconds),
  members, air, producer,
});

export const UNITS: Record<UnitType, UnitDef> = {
  infantry: unit('Infantería', 60, 170, 15, 1, 4, 2.4, 3.5, 5, false, 'barracks'),
  antitank: unit('Antitanque', 90, 120, 26, 1.5, 5.5, 2.2, 4.5, 3, false, 'barracks'),
  tank: unit('Tanques', 190, 420, 40, 1.5, 5, 3.2, 7, 2, false, 'factory'),
  heli: unit('Helicóptero', 240, 260, 28, 1.1, 4.5, 5, 8, 1, true, 'helipad'),
  truck: unit('Camión', 0, 90, 0, 1, 0, 3.4, 0, 1, false, null),
};

const building = (
  name: string, cost: number, hp: number, w: number, h: number, buildSeconds: number,
  dmg = 0, cooldown = 1, range = 0,
): BuildingDef => ({
  name, cost, hp, w, h,
  buildTicks: secs(buildSeconds),
  dmg,
  cooldown: secs(cooldown),
  range: fx(range),
});

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  hq: building('Cuartel General', 0, 8000, 4, 4, 0),
  barracks: building('Barracas', 140, 650, 3, 2, 4),
  factory: building('Fábrica', 240, 850, 3, 3, 6),
  helipad: building('Helipuerto', 280, 550, 3, 3, 6),
  refinery: building('Refinería', 160, 550, 2, 2, 4),
  turret: building('Torreta', 130, 480, 1, 1, 4, 30, 1.1, 7),
};

export const isBuildingType = (t: EntityType): t is BuildingType => t in BUILDINGS;

/** Damage percentage dealt by each attacker to each target type. 0 means it cannot hit it. */
const buildingsPct = (pct: number): Record<BuildingType, number> => ({
  hq: Math.round(pct * 0.35), barracks: pct, factory: pct, helipad: pct, refinery: pct, turret: pct,
});

export const DAMAGE: Partial<Record<EntityType, Record<EntityType, number>>> = {
  infantry: { infantry: 100, antitank: 170, tank: 40, heli: 140, truck: 160, ...buildingsPct(55) },
  antitank: { infantry: 45, antitank: 80, tank: 240, heli: 0, truck: 150, ...buildingsPct(120) },
  tank: { infantry: 190, antitank: 110, tank: 90, heli: 0, truck: 200, ...buildingsPct(130) },
  heli: { infantry: 60, antitank: 130, tank: 210, heli: 100, truck: 180, ...buildingsPct(90) },
  turret: { infantry: 130, antitank: 130, tank: 75, heli: 110, truck: 150, ...buildingsPct(0) },
};

export interface AbilityDef {
  name: string;
  /** One line for the loadout picker. */
  blurb: string;
  cooldown: number;
  startCooldown: number;
  /** Warning time before the first hit; the enemy can see it coming. */
  delay: number;
  radius: number;
  /** Area shown while aiming and to the enemy; wider than `radius` for scattered shells. */
  area: number;
  damage: number;
  shells: number;
  shellGap: number;
  /** Helps the caster's side instead of hurting the enemy. */
  friendly: boolean;
}

const ability = (
  name: string, blurb: string, cooldown: number, start: number, delay: number,
  radius: number, damage: number, options: { shells?: number; gap?: number; area?: number; friendly?: boolean } = {},
): AbilityDef => ({
  name, blurb, radius: fx(radius), damage,
  area: fx(options.area ?? radius),
  shells: options.shells ?? 1,
  cooldown: secs(cooldown),
  startCooldown: secs(start),
  delay: secs(delay),
  shellGap: secs(options.gap ?? 0),
  friendly: options.friendly ?? false,
});

export const ABILITIES: Record<AbilityType, AbilityDef> = {
  airstrike: ability('Ataque aéreo', 'Un bombardeo enorme en una zona.', 75, 45, 2, 3.5, 300),
  artillery: ability('Artillería', '6 proyectiles repartidos por el área.', 50, 30, 1, 1.8, 130, { shells: 6, gap: 0.4, area: 4.5 }),
  paradrop: ability('Paracaidistas', '2 escuadrones de infantería donde quieras.', 90, 60, 2, 1.5, 0),
  emp: ability('Pulso EMP', 'Paraliza al enemigo 4 s: ni se mueve ni dispara.', 60, 40, 1, 4, 0),
  repair: ability('Reparación', 'Cura 45% a tus unidades y 15% a edificios.', 55, 35, 1, 4.5, 45, { friendly: true }),
  armor: ability('Blindados', 'Lanza un escuadrón de tanques desde el aire.', 110, 75, 3, 1.5, 0),
};

export const ABILITY_TYPES = Object.keys(ABILITIES) as AbilityType[];
export const LOADOUT_SIZE = 3;
export const DEFAULT_LOADOUT: AbilityType[] = ['airstrike', 'artillery', 'paradrop'];
export const EMP_STUN = secs(4);

/** Keeps a loadout from the network or storage to 3 distinct known abilities. */
export function cleanLoadout(value: unknown): AbilityType[] {
  if (!Array.isArray(value)) return [...DEFAULT_LOADOUT];
  const picked: AbilityType[] = [];
  for (const kind of value) {
    if (typeof kind === 'string' && kind in ABILITIES && !picked.includes(kind as AbilityType)) {
      picked.push(kind as AbilityType);
    }
  }
  for (const kind of DEFAULT_LOADOUT) {
    if (picked.length >= LOADOUT_SIZE) break;
    if (!picked.includes(kind)) picked.push(kind);
  }
  return picked.slice(0, LOADOUT_SIZE);
}

export interface UpgradeDef {
  name: string;
  blurb: string;
  building: BuildingType;
  cost: number;
  ticks: number;
}

const upgrade = (name: string, blurb: string, building: BuildingType, cost: number, seconds: number): UpgradeDef =>
  ({ name, blurb, building, cost, ticks: secs(seconds) });

export const UPGRADES: Record<UpgradeType, UpgradeDef> = {
  grenades: upgrade('Lanzagranadas', 'Infantería: +30% de daño.', 'barracks', 150, 25),
  plating: upgrade('Blindaje reactivo', 'Tanques: -25% de daño recibido.', 'factory', 200, 30),
  missiles: upgrade('Misiles guiados', 'Helicópteros: +30% de daño.', 'helipad', 200, 30),
  haulers: upgrade('Camiones grandes', 'Refinerías: +50% de carga.', 'refinery', 150, 25),
  twinGuns: upgrade('Cañón doble', 'Torretas: +50% de daño.', 'turret', 120, 20),
};

export const UPGRADE_TYPES = Object.keys(UPGRADES) as UpgradeType[];

/** The upgrade researched at a building type, if any. */
export const upgradeFor = (building: BuildingType): UpgradeType | undefined =>
  UPGRADE_TYPES.find((u) => UPGRADES[u].building === building);

export const BALANCE = {
  startSupplies: 400,
  hqIncome: 12,
  pointIncome: 7,
  buildRadius: fx(10),
  maxSquads: 24,
  maxQueue: 5,
  capturePerUnit: 1,
  captureMax: secs(8),
  captureRadius: fx(3.5),
  captureMaxRate: 3,
  holdToWinTicks: secs(120),
  suddenDeathTick: secs(300),
  suddenDeathDamagePerSecond: 130,
  truckLoadTicks: secs(2),
  truckRespawnTicks: secs(6),
  truckBaseCargo: 40,
  truckCargoPerCell: 2,
  separation: fx(1.25),
  abilityBuildingPct: 35,
  abilityHqPct: 8,
  pointValue: 150,
  underdogPct: 60,
  underdogMinStrength: 700,
  underdogIncomePct: 140,
} as const;
