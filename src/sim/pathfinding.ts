import { BUILDINGS, type BuildingType } from './data/defs';
import { ONE, fx, toCell } from './fixed';
import type { Entity, World } from './types';

const UNREACHABLE = 0x7fffffff;
const MAX_FIELDS = 64;

interface Cache {
  version: number;
  fields: Map<number, Int32Array>;
}

/**
 * Fields are a pure function of `blocked` and the destination, so the cache
 * never affects results and stays outside the hashed world state.
 */
const caches = new WeakMap<World, Cache>();

function computeField(w: World, destCell: number): Int32Array {
  const size = w.width * w.height;
  const field = new Int32Array(size).fill(UNREACHABLE);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  field[destCell] = 0;
  queue[tail++] = destCell;
  while (head < tail) {
    const cell = queue[head++];
    const d = field[cell] + 1;
    const x = cell % w.width;
    if (x > 0) tail = visit(w, field, queue, tail, cell - 1, d);
    if (x < w.width - 1) tail = visit(w, field, queue, tail, cell + 1, d);
    if (cell >= w.width) tail = visit(w, field, queue, tail, cell - w.width, d);
    if (cell < size - w.width) tail = visit(w, field, queue, tail, cell + w.width, d);
  }
  return field;
}

function visit(
  w: World, field: Int32Array, queue: Int32Array, tail: number, cell: number, d: number,
): number {
  if (w.blocked[cell] || field[cell] !== UNREACHABLE) return tail;
  field[cell] = d;
  queue[tail] = cell;
  return tail + 1;
}

export function getField(w: World, destCell: number): Int32Array {
  let cache = caches.get(w);
  if (!cache || cache.version !== w.navVersion) {
    cache = { version: w.navVersion, fields: new Map() };
    caches.set(w, cache);
  }
  let field = cache.fields.get(destCell);
  if (!field) {
    field = computeField(w, destCell);
    if (cache.fields.size >= MAX_FIELDS) {
      cache.fields.delete(cache.fields.keys().next().value as number);
    }
    cache.fields.set(destCell, field);
  }
  return field;
}

export const cellIndex = (w: World, x: number, y: number): number =>
  toCell(y) * w.width + toCell(x);

export function isBlockedAt(w: World, x: number, y: number): boolean {
  const cx = toCell(x);
  const cy = toCell(y);
  if (cx < 0 || cy < 0 || cx >= w.width || cy >= w.height) return true;
  return w.blocked[cy * w.width + cx] !== 0;
}

/** The closest walkable cell to (cx, cy), scanning rings in a fixed order. */
export function nearestFreeCell(w: World, cx: number, cy: number): number {
  for (let r = 0; r < Math.max(w.width, w.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
        const cell = y * w.width + x;
        if (!w.blocked[cell]) return cell;
      }
    }
  }
  return cy * w.width + cx;
}

/**
 * The walkable cell closest to a point, using real distance. Ties go to the
 * side facing (fromX, fromY), so an order on a building lands in front of it
 * for either player instead of always favoring one corner.
 */
export function freeCellNear(w: World, x: number, y: number, fromX: number, fromY: number): number {
  const reach = 7;
  const cx = toCell(x);
  const cy = toCell(y);
  let best = -1;
  let bestDist = Infinity;
  let bestFrom = Infinity;
  for (let gy = cy - reach; gy <= cy + reach; gy++) {
    for (let gx = cx - reach; gx <= cx + reach; gx++) {
      if (gx < 0 || gy < 0 || gx >= w.width || gy >= w.height) continue;
      const cell = gy * w.width + gx;
      if (w.blocked[cell]) continue;
      const px = gx * ONE + (ONE >> 1);
      const py = gy * ONE + (ONE >> 1);
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      const f = (px - fromX) * (px - fromX) + (py - fromY) * (py - fromY);
      if (d < bestDist || (d === bestDist && f < bestFrom)) {
        best = cell;
        bestDist = d;
        bestFrom = f;
      }
    }
  }
  return best >= 0 ? best : nearestFreeCell(w, cx, cy);
}

export const cellCenterX = (w: World, cell: number): number => (cell % w.width) * ONE + (ONE >> 1);
export const cellCenterY = (w: World, cell: number): number =>
  Math.floor(cell / w.width) * ONE + (ONE >> 1);

/** Walkable cell next to a target, on the side facing (fromX, fromY). */
export function approachCell(w: World, target: Entity, fromX: number, fromY: number): number {
  if (!target.isBuilding) return freeCellNear(w, target.x, target.y, fromX, fromY);
  const def = BUILDINGS[target.type as BuildingType];
  const half = fx(Math.max(def.w, def.h) / 2 + 0.5);
  const clamp = (v: number, c: number) => Math.max(c - half, Math.min(c + half, v));
  return freeCellNear(w, clamp(fromX, target.x), clamp(fromY, target.y), fromX, fromY);
}

const NEIGHBORS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/**
 * The next cell to walk to. Diagonals are only taken when both side cells are
 * open, so units never cut through the corner of an obstacle.
 */
export function nextCell(w: World, field: Int32Array, cell: number): number {
  const x = cell % w.width;
  const y = Math.floor(cell / w.width);
  let best = -1;
  let bestDist = field[cell];
  if (w.blocked[cell]) bestDist = UNREACHABLE;
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w.width || ny >= w.height) continue;
    const n = ny * w.width + nx;
    if (w.blocked[n] || field[n] >= bestDist) continue;
    if (dx !== 0 && dy !== 0) {
      if (w.blocked[y * w.width + nx] || w.blocked[ny * w.width + x]) continue;
    }
    bestDist = field[n];
    best = n;
  }
  return best;
}
