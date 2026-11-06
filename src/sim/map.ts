import { fx } from './fixed';
import { randInt } from './rng';
import { Terrain, type ControlPoint, type Deposit } from './types';

export const MAP_W = 72;
export const MAP_H = 44;
const MAP_SEED = 7331;

export interface MapLayout {
  terrain: Uint8Array;
  points: ControlPoint[];
  deposits: Deposit[];
  hqCells: [number, number][];
}

/** Rotating a cell 180 degrees gives the opposite player the same map. */
const mirrorX = (x: number) => MAP_W - 1 - x;
const mirrorY = (y: number) => MAP_H - 1 - y;
const idx = (x: number, y: number) => y * MAP_W + x;

const BRIDGES: [number, number][] = [[8, 11], [20, 23], [32, 35]];
const DEPOSITS_P0: [number, number][] = [[13, 11], [13, 31], [26, 3], [26, 39]];
const HQ_P0: [number, number] = [6, 20];

function riverWiggle(y: number): number {
  const phase = (y + 3) % 16;
  const wave = phase < 8 ? phase : 16 - phase;
  return (wave >> 2) - 1;
}

function setBoth(terrain: Uint8Array, x: number, y: number, value: Terrain): void {
  terrain[idx(x, y)] = value;
  terrain[idx(mirrorX(x), mirrorY(y))] = value;
}

function isProtected(x: number, y: number): boolean {
  const near = (cx: number, cy: number, r: number) =>
    (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
  if (near(8, 22, 12)) return true;
  if (DEPOSITS_P0.some(([cx, cy]) => near(cx + 1, cy + 1, 4))) return true;
  if (BRIDGES.some(([a, b]) => near(32, (a + b) >> 1, 7))) return true;
  return false;
}

export function generateMap(): MapLayout {
  const terrain = new Uint8Array(MAP_W * MAP_H);
  const r = { rng: MAP_SEED };

  for (let y = 0; y < MAP_H; y++) {
    const center = MAP_W / 2 + riverWiggle(y) - riverWiggle(mirrorY(y));
    const left = Math.trunc(center - 2);
    const onBridge = BRIDGES.some(([a, b]) => y >= a && y <= b);
    for (let x = left; x < left + 4; x++) {
      terrain[idx(x, y)] = onBridge ? Terrain.Bridge : Terrain.Water;
    }
  }

  for (let i = 0; i < 26; i++) {
    const cx = randInt(r, 1, 30);
    const cy = randInt(r, 1, MAP_H - 2);
    const kind = randInt(r, 0, 3) === 0 ? Terrain.Rock : Terrain.Tree;
    const radius = randInt(r, 1, 2);
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || y < 0 || x > 30 || y >= MAP_H) continue;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > radius * radius) continue;
        if (isProtected(x, y) || randInt(r, 0, 4) === 0) continue;
        setBoth(terrain, x, y, kind);
      }
    }
  }

  const point = (id: number, x: number, y: number): ControlPoint => ({
    id, x: fx(x), y: fx(y), owner: -1, value: 0, contested: false,
  });

  const deposits: Deposit[] = [];
  for (const [cx, cy] of DEPOSITS_P0) {
    deposits.push({ cx, cy }, { cx: MAP_W - cx - 2, cy: MAP_H - cy - 2 });
  }

  return {
    terrain,
    points: [point(0, 36, 10), point(1, 36, 22), point(2, 36, 34)],
    deposits,
    hqCells: [HQ_P0, [MAP_W - HQ_P0[0] - 4, MAP_H - HQ_P0[1] - 4]],
  };
}
