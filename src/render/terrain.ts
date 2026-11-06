import * as THREE from 'three';
import { Terrain, type World } from '../sim/types';
import { pumpModel, rockModel, treeModel } from './models/catalog';
import { ModelBuilder } from './models/parts';

const GRASS = [new THREE.Color('#8fcf6d'), new THREE.Color('#8acb69'), new THREE.Color('#94d372')];
const ROAD = new THREE.Color('#c9c98a');
const SAND = new THREE.Color('#e7d9a4');
const BANK = new THREE.Color('#c7b98a');

const hash = (x: number, y: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function isWater(w: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= w.width || y >= w.height) return false;
  return w.terrain[y * w.width + x] === Terrain.Water;
}

function vertexHeight(w: World, x: number, y: number): number {
  const touchesWater = isWater(w, x - 1, y - 1) || isWater(w, x, y - 1)
    || isWater(w, x - 1, y) || isWater(w, x, y);
  const allWater = isWater(w, x - 1, y - 1) && isWater(w, x, y - 1)
    && isWater(w, x - 1, y) && isWater(w, x, y);
  if (allWater) return -0.7;
  if (touchesWater) return -0.34;
  return hash(x, y) * 0.07;
}

/** Distance from a cell to the road segment between two cell positions. */
function nearSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function isRoad(x: number, y: number): boolean {
  const roads: [number, number, number, number][] = [
    [10, 22, 36, 22], [12, 22, 36, 10], [12, 22, 36, 34],
    [62, 22, 36, 22], [60, 22, 36, 10], [60, 22, 36, 34],
  ];
  return roads.some(([ax, ay, bx, by]) => nearSegment(x + 0.5, y + 0.5, ax, ay, bx, by) < 1.15);
}

function cellColor(w: World, x: number, y: number): THREE.Color {
  const near = isWater(w, x - 1, y) || isWater(w, x + 1, y) || isWater(w, x, y - 1) || isWater(w, x, y + 1);
  if (w.terrain[y * w.width + x] === Terrain.Water) return BANK;
  if (near) return SAND;
  if (isRoad(x, y)) return ROAD;
  return GRASS[Math.floor(hash(x + 3, y + 7) * GRASS.length)];
}

function terrainGeometry(w: World): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const vert = (x: number, y: number, c: THREE.Color, shade: number) => {
    positions.push(x, vertexHeight(w, x, y), y);
    colors.push(c.r * shade, c.g * shade, c.b * shade);
  };
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      const c = cellColor(w, x, y);
      const shade = 0.97 + hash(x, y + 11) * 0.06;
      vert(x, y, c, shade);
      vert(x, y + 1, c, shade);
      vert(x + 1, y, c, shade);
      vert(x + 1, y, c, shade);
      vert(x, y + 1, c, shade);
      vert(x + 1, y + 1, c, shade);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/** The tray under the map: a floor below the riverbed and a rim around the edge. */
function plinth(w: World): THREE.Mesh {
  const b = new ModelBuilder();
  const rim = 0.7;
  const W = w.width + rim * 2;
  const H = w.height + rim * 2;
  b.box(W, 3, H, '#6c5a45', w.width / 2, -4, w.height / 2)
    .box(W, 3, rim, '#7c6850', w.width / 2, -2.97, -rim / 2)
    .box(W, 3, rim, '#7c6850', w.width / 2, -2.97, w.height + rim / 2)
    .box(rim, 3, H, '#7c6850', -rim / 2, -2.97, w.height / 2)
    .box(rim, 3, H, '#7c6850', w.width + rim / 2, -2.97, w.height / 2);
  return new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
}

function bridges(w: World): THREE.Mesh {
  const b = new ModelBuilder();
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      if (w.terrain[y * w.width + x] !== Terrain.Bridge) continue;
      const tone = (x + y) % 2 === 0 ? '#a98a63' : '#9a7c58';
      b.box(1, 0.09, 1, tone, x + 0.5, 0.0, y + 0.5);
      if (w.terrain[(y - 1) * w.width + x] !== Terrain.Bridge) b.box(1, 0.18, 0.1, '#6f5a42', x + 0.5, 0.06, y + 0.05);
      if (w.terrain[(y + 1) * w.width + x] !== Terrain.Bridge) b.box(1, 0.18, 0.1, '#6f5a42', x + 0.5, 0.06, y + 0.95);
    }
  }
  const mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function scatter(w: World, kind: Terrain, geometry: THREE.BufferGeometry): THREE.InstancedMesh {
  const cells: [number, number][] = [];
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      if (w.terrain[y * w.width + x] === kind) cells.push([x, y]);
    }
  }
  const mesh = new THREE.InstancedMesh(
    geometry, new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, cells.length),
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  cells.forEach(([x, y], i) => {
    const s = 0.85 + hash(x, y) * 0.5;
    q.setFromAxisAngle(up, hash(y, x) * 6.28);
    m.compose(
      new THREE.Vector3(x + 0.3 + hash(x, y + 2) * 0.4, 0.03, y + 0.3 + hash(x + 2, y) * 0.4),
      q, new THREE.Vector3(s, s, s),
    );
    mesh.setMatrixAt(i, m);
  });
  mesh.count = cells.length;
  mesh.castShadow = true;
  return mesh;
}

export interface TerrainView {
  group: THREE.Group;
  animate(time: number): void;
}

export function buildTerrain(w: World): TerrainView {
  const group = new THREE.Group();

  const ground = new THREE.Mesh(
    terrainGeometry(w),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  ground.receiveShadow = true;

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(w.width, w.height).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: '#4fbfe0', transparent: true, opacity: 0.86 }),
  );
  water.position.set(w.width / 2, -0.16, w.height / 2);

  const pumps = new THREE.InstancedMesh(
    pumpModel(), new THREE.MeshLambertMaterial({ vertexColors: true }), w.deposits.length,
  );
  const m = new THREE.Matrix4();
  w.deposits.forEach((d, i) => {
    m.makeTranslation(d.cx + 1, 0.05, d.cy + 1);
    pumps.setMatrixAt(i, m);
  });

  group.add(plinth(w), ground, water, bridges(w), pumps);
  group.add(scatter(w, Terrain.Tree, treeModel()), scatter(w, Terrain.Rock, rockModel()));

  return {
    group,
    animate(time) {
      water.position.y = -0.16 + Math.sin(time * 0.9) * 0.015;
    },
  };
}
