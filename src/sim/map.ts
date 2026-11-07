import { fx } from './fixed';
import { randInt } from './rng';
import { Terrain, type ControlPoint, type Deposit, type MapId } from './types';

export const MAP_W = 72;
export const MAP_H = 44;

export interface MapLayout {
  terrain: Uint8Array;
  points: ControlPoint[];
  deposits: Deposit[];
  hqCells: [number, number][];
  /** Decorative road segments in cell coordinates, already mirrored for both sides. */
  roads: [number, number, number, number][];
}

type Circle = [number, number, number];

/**
 * Every map is drawn for player 0 only and rotated 180 degrees for player 1,
 * so neither side ever has a better map.
 */
interface MapSpec {
  name: string;
  blurb: string;
  seed: number;
  points: [number, number][];
  depositsP0: [number, number][];
  /** Player 0 HQ footprint origin. */
  hq: [number, number];
  /** Places the water and rock that shape the map. */
  carve(set: (x: number, y: number, t: Terrain) => void): void;
  /** Areas kept free of trees and rocks on player 0's side. */
  clear: Circle[];
  clutter: number;
  roadsP0: [number, number, number, number][];
}

export const mirrorX = (x: number) => MAP_W - 1 - x;
export const mirrorY = (y: number) => MAP_H - 1 - y;
const idx = (x: number, y: number) => y * MAP_W + x;
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

function riverWiggle(y: number): number {
  const phase = (y + 3) % 16;
  const wave = phase < 8 ? phase : 16 - phase;
  return (wave >> 2) - 1;
}

const RIVER_BRIDGES: [number, number][] = [[8, 11], [20, 23], [32, 35]];

/** Fills an ellipse; `set` also writes the mirrored cell. */
function ellipse(set: (x: number, y: number, t: Terrain) => void,
  cx: number, cy: number, rx: number, ry: number, t: Terrain): void {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = (x - cx) * ry;
      const dy = (y - cy) * rx;
      if (dx * dx + dy * dy <= rx * rx * ry * ry) set(x, y, t);
    }
  }
}

const COMMON_CLEAR = (spec: { hq: [number, number]; depositsP0: [number, number][] }): Circle[] => [
  [spec.hq[0] + 2, spec.hq[1] + 2, 12],
  ...spec.depositsP0.map(([x, y]): Circle => [x + 1, y + 1, 4]),
];

const RIVER: MapSpec = {
  name: 'Río',
  blurb: 'Un río y 3 puentes: todo se decide en los cruces.',
  seed: 7331,
  points: [[36, 10], [36, 22], [36, 34]],
  depositsP0: [[13, 11], [13, 31], [26, 3], [26, 39]],
  hq: [6, 20],
  carve(set) {
    // The river is symmetric by construction, so it only needs one pass.
    for (let y = 0; y < MAP_H; y++) {
      const center = MAP_W / 2 + riverWiggle(y) - riverWiggle(mirrorY(y));
      const left = Math.trunc(center - 2);
      const onBridge = RIVER_BRIDGES.some(([a, b]) => y >= a && y <= b);
      for (let x = left; x < left + 4; x++) set(x, y, onBridge ? Terrain.Bridge : Terrain.Water);
    }
  },
  clear: RIVER_BRIDGES.map(([a, b]): Circle => [32, (a + b) >> 1, 7]),
  clutter: 26,
  roadsP0: [[10, 22, 36, 22], [12, 22, 36, 10], [12, 22, 36, 34]],
};

/** Gaps in the canyon walls, on both walls thanks to the mirror. */
const CANYON_GAPS = [[21, 24], [47, 50]];

const CANYON: MapSpec = {
  name: 'Cañones',
  blurb: 'Tres carriles entre paredes de roca. Flanquea por los pasos.',
  seed: 4242,
  points: [[36, 6], [36, 22], [36, 38]],
  depositsP0: [[12, 9], [12, 32], [27, 4], [27, 37]],
  hq: [6, 20],
  carve(set) {
    for (let x = 14; x <= 57; x++) {
      if (CANYON_GAPS.some(([a, b]) => x >= a && x <= b)) continue;
      set(x, 13, Terrain.Rock);
      set(x, 14, Terrain.Rock);
    }
    // Cover in the middle lane so it is not a straight shooting gallery.
    ellipse(set, 30, 19, 1, 1, Terrain.Rock);
    ellipse(set, 33, 25, 1, 1, Terrain.Tree);
  },
  clear: [[22, 14, 3], [36, 6, 4], [36, 22, 5], [48, 14, 3], [30, 6, 3]],
  clutter: 18,
  roadsP0: [[10, 22, 36, 22], [12, 22, 22, 14], [22, 14, 36, 6], [12, 22, 22, 30], [22, 30, 36, 38]],
};

const LAKES: MapSpec = {
  name: 'Lagos',
  blurb: 'Dos lagos y un centro abierto. Cada uno tiene un punto cerca de casa.',
  seed: 9001,
  points: [[24, 34], [36, 22], [48, 10]],
  depositsP0: [[11, 9], [11, 32], [19, 39], [29, 25]],
  hq: [6, 20],
  carve(set) {
    ellipse(set, 27, 10, 7, 5, Terrain.Water);
    ellipse(set, 33, 16, 1, 1, Terrain.Rock);
    ellipse(set, 16, 27, 1, 1, Terrain.Rock);
  },
  clear: [[24, 34, 5], [36, 22, 5], [30, 26, 4], [20, 22, 4]],
  clutter: 22,
  roadsP0: [[10, 22, 36, 22], [12, 22, 24, 34], [24, 34, 36, 22]],
};

export const MAPS: Record<MapId, MapSpec> = { river: RIVER, canyon: CANYON, lakes: LAKES };
export const MAP_IDS = Object.keys(MAPS) as MapId[];

export function generateMap(id: MapId = 'river'): MapLayout {
  const spec = MAPS[id] ?? RIVER;
  const terrain = new Uint8Array(MAP_W * MAP_H);
  const set = (x: number, y: number, t: Terrain) => {
    if (!inside(x, y)) return;
    terrain[idx(x, y)] = t;
    terrain[idx(mirrorX(x), mirrorY(y))] = t;
  };
  spec.carve(set);

  const clear = [...COMMON_CLEAR(spec), ...spec.clear];
  const isClear = (x: number, y: number) => clear.some(([cx, cy, r]) => {
    const near = (px: number, py: number) => (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r;
    return near(x, y) || near(mirrorX(x), mirrorY(y));
  });

  const r = { rng: spec.seed };
  for (let i = 0; i < spec.clutter; i++) {
    const cx = randInt(r, 1, 30);
    const cy = randInt(r, 1, MAP_H - 2);
    const kind = randInt(r, 0, 3) === 0 ? Terrain.Rock : Terrain.Tree;
    const radius = randInt(r, 1, 2);
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || y < 0 || x > 30 || y >= MAP_H) continue;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > radius * radius) continue;
        if (terrain[idx(x, y)] !== Terrain.Grass) continue;
        if (isClear(x, y) || randInt(r, 0, 4) === 0) continue;
        set(x, y, kind);
      }
    }
  }

  const point = (pid: number, x: number, y: number): ControlPoint => ({
    id: pid, x: fx(x), y: fx(y), owner: -1, value: 0, contested: false,
  });

  const deposits: Deposit[] = [];
  for (const [cx, cy] of spec.depositsP0) {
    deposits.push({ cx, cy }, { cx: MAP_W - cx - 2, cy: MAP_H - cy - 2 });
  }

  const roads: [number, number, number, number][] = [];
  for (const [ax, ay, bx, by] of spec.roadsP0) {
    roads.push([ax, ay, bx, by], [MAP_W - ax, MAP_H - ay, MAP_W - bx, MAP_H - by]);
  }

  return {
    terrain,
    points: spec.points.map(([x, y], i) => point(i, x, y)),
    deposits,
    hqCells: [spec.hq, [MAP_W - spec.hq[0] - 4, MAP_H - spec.hq[1] - 4]],
    roads,
  };
}
