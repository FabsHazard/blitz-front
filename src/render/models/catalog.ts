import type * as THREE from 'three';
import type { BuildingType, UnitType } from '../../sim/data/defs';
import { ModelBuilder } from './parts';

export interface TeamPalette {
  main: string;
  dark: string;
  light: string;
}

export const TEAMS: TeamPalette[] = [
  { main: '#3f86e0', dark: '#27549a', light: '#8cc1ff' },
  { main: '#e8603c', dark: '#a53a22', light: '#ffb08f' },
];

const STEEL = '#5b6470';
const DARK = '#333a44';
const CONCRETE = '#d9d3c4';
const CONCRETE_DARK = '#b5ae9e';
const GLASS = '#a6e3f2';
const SKIN = '#e9bd95';

export type PartRole = 'hull' | 'turret' | 'rotor';

export interface UnitModel {
  parts: { role: PartRole; geometry: THREE.BufferGeometry }[];
  /** Local offsets of each squad member around the squad center. */
  formation: [number, number][];
  altitude: number;
}

function soldier(t: TeamPalette, weapon: 'rifle' | 'launcher'): THREE.BufferGeometry {
  const b = new ModelBuilder()
    .box(0.1, 0.16, 0.08, DARK, -0.04, 0, 0.05)
    .box(0.1, 0.16, 0.08, DARK, -0.04, 0, -0.05)
    .box(0.13, 0.2, 0.2, t.main, -0.04, 0.16, 0)
    .box(0.13, 0.1, 0.13, SKIN, -0.03, 0.36, 0)
    .box(0.17, 0.05, 0.16, t.dark, -0.03, 0.44, 0);
  if (weapon === 'rifle') b.box(0.3, 0.04, 0.04, DARK, 0.12, 0.26, 0.11);
  else b.barrel(0.05, 0.44, t.dark, -0.22, 0.38, 0.13);
  return b.build();
}

function tankHull(t: TeamPalette): THREE.BufferGeometry {
  return new ModelBuilder()
    .box(1, 0.16, 0.16, DARK, 0, 0.02, 0.26)
    .box(1, 0.16, 0.16, DARK, 0, 0.02, -0.26)
    .box(1.02, 0.17, 0.52, t.main, 0, 0.16, 0)
    .box(0.2, 0.05, 0.5, t.dark, 0.38, 0.33, 0)
    .build();
}

function tankTurret(t: TeamPalette): THREE.BufferGeometry {
  return new ModelBuilder()
    .box(0.5, 0.17, 0.4, t.dark, -0.04, 0, 0)
    .box(0.2, 0.06, 0.2, t.light, -0.12, 0.17, 0)
    .barrel(0.04, 0.58, STEEL, 0.18, 0.09, 0)
    .build();
}

function heliBody(t: TeamPalette): THREE.BufferGeometry {
  return new ModelBuilder()
    .ball(0.34, t.main, 0.15, 0.1, 0)
    .box(0.46, 0.3, 0.42, t.main, -0.1, -0.05, 0)
    .box(0.24, 0.16, 0.34, GLASS, 0.3, 0.1, 0)
    .box(0.92, 0.1, 0.1, t.dark, -0.72, 0.13, 0)
    .box(0.08, 0.3, 0.05, t.light, -1.14, 0.12, 0)
    .box(0.12, 0.05, 1, t.dark, -0.05, -0.04, 0)
    .box(0.68, 0.04, 0.05, DARK, 0.03, -0.25, 0.25)
    .box(0.68, 0.04, 0.05, DARK, 0.03, -0.25, -0.25)
    .box(0.1, 0.14, 0.1, DARK, 0, 0.27, 0)
    .build();
}

function heliRotor(): THREE.BufferGeometry {
  return new ModelBuilder()
    .box(1.9, 0.02, 0.09, DARK, 0, 0, 0)
    .box(0.09, 0.02, 1.9, DARK, 0, 0, 0)
    .build();
}

function truck(t: TeamPalette): THREE.BufferGeometry {
  return new ModelBuilder()
    .box(0.76, 0.1, 0.38, DARK, 0, 0.08, 0)
    .box(0.28, 0.3, 0.38, t.main, 0.28, 0.16, 0)
    .box(0.05, 0.13, 0.32, GLASS, 0.42, 0.27, 0)
    .cyl(0.16, 0.16, 0.44, 6, CONCRETE_DARK, -0.14, 0.17, 0)
    .box(0.06, 0.22, 0.4, t.dark, -0.1, 0.17, 0)
    .build();
}

export function unitModel(type: UnitType, team: number): UnitModel {
  const t = TEAMS[team];
  switch (type) {
    case 'infantry':
      return {
        parts: [{ role: 'hull', geometry: soldier(t, 'rifle') }],
        formation: [[0.32, 0], [0, 0.36], [0, -0.36], [-0.38, 0.22], [-0.38, -0.22]],
        altitude: 0,
      };
    case 'antitank':
      return {
        parts: [{ role: 'hull', geometry: soldier(t, 'launcher') }],
        formation: [[0.26, 0], [-0.24, 0.3], [-0.24, -0.3]],
        altitude: 0,
      };
    case 'tank':
      return {
        parts: [
          { role: 'hull', geometry: tankHull(t) },
          { role: 'turret', geometry: tankTurret(t) },
        ],
        formation: [[0.32, 0.4], [-0.32, -0.4]],
        altitude: 0,
      };
    case 'heli':
      return {
        parts: [
          { role: 'hull', geometry: heliBody(t) },
          { role: 'rotor', geometry: heliRotor() },
        ],
        formation: [[0, 0]],
        altitude: 2.1,
      };
    case 'truck':
      return { parts: [{ role: 'hull', geometry: truck(t) }], formation: [[0, 0]], altitude: 0 };
  }
}

const windows = (b: ModelBuilder, w: number, y: number, z: number, count: number): void => {
  const step = w / count;
  for (let i = 0; i < count; i++) {
    b.box(step * 0.56, 0.2, 0.02, GLASS, -w / 2 + step * (i + 0.5), y, z);
  }
};

export function buildingModel(type: BuildingType, team: number): THREE.BufferGeometry {
  const t = TEAMS[team];
  const b = new ModelBuilder();
  switch (type) {
    case 'hq':
      b.box(3.7, 0.2, 3.7, CONCRETE_DARK)
        .box(2.9, 0.95, 2.9, CONCRETE, 0, 0.2)
        .box(3, 0.1, 3, t.main, 0, 1.15)
        .box(1.9, 0.75, 1.9, CONCRETE, 0, 1.25)
        .box(2, 0.1, 2, t.dark, 0, 2)
        .cyl(0.08, 0.1, 1, 5, STEEL, 0.6, 2.1, 0.6)
        .cyl(0.42, 0.14, 0.2, 6, CONCRETE, -0.5, 2.1, -0.5)
        .box(0.06, 1.2, 0.06, STEEL, -1.25, 1.25, 1.25)
        .box(0.55, 0.32, 0.02, t.main, -0.96, 2.12, 1.25);
      windows(b, 2.4, 0.62, 1.46, 5);
      windows(b, 1.5, 1.52, 0.96, 3);
      break;
    case 'barracks':
      b.box(2.7, 0.14, 1.7, CONCRETE_DARK)
        .box(2.4, 0.66, 1.4, CONCRETE, 0, 0.14)
        .box(2.56, 0.08, 1.56, t.main, 0, 0.8)
        .box(0.5, 0.42, 0.04, DARK, 0, 0.14, 0.71)
        .box(0.06, 0.5, 0.06, STEEL, 1.05, 0.88, -0.5);
      windows(b, 2, 0.42, 0.71, 4);
      break;
    case 'factory':
      b.box(2.8, 0.14, 2.8, CONCRETE_DARK)
        .box(2.5, 0.9, 2.1, '#b8c0c8', 0, 0.14, -0.1)
        .box(2.6, 0.12, 2.2, t.main, 0, 1.04, -0.1)
        .box(1.3, 0.72, 0.05, DARK, 0, 0.14, 0.96)
        .cyl(0.17, 0.22, 1.3, 7, STEEL, 0.76, 1.1, -0.66)
        .cyl(0.17, 0.22, 1, 7, STEEL, 0.26, 1.1, -0.66)
        .box(0.8, 0.3, 0.8, t.dark, -0.7, 1.16, -0.3);
      break;
    case 'helipad':
      b.box(2.8, 0.14, 2.8, CONCRETE_DARK)
        .cyl(1.1, 1.1, 0.04, 10, t.dark, 0, 0.14, 0)
        .cyl(0.86, 0.86, 0.05, 10, CONCRETE, 0, 0.15, 0)
        .box(0.14, 0.03, 0.82, t.main, -0.24, 0.19, 0)
        .box(0.14, 0.03, 0.82, t.main, 0.24, 0.19, 0)
        .box(0.44, 0.03, 0.14, t.main, 0, 0.19, 0)
        .box(0.46, 0.42, 0.46, CONCRETE, 1.12, 0.14, -1.12)
        .box(0.06, 0.46, 0.06, STEEL, 1.12, 0.56, -1.12)
        .box(0.3, 0.14, 0.03, t.light, 1.26, 0.86, -1.12);
      break;
    case 'refinery':
      b.box(1.86, 0.1, 1.86, CONCRETE_DARK)
        .cyl(0.42, 0.46, 0.75, 8, '#c6ccd3', -0.42, 0.1, -0.36)
        .cyl(0.44, 0.44, 0.06, 8, t.main, -0.42, 0.85, -0.36)
        .cyl(0.09, 0.14, 1.5, 6, STEEL, 0.56, 0.1, -0.56)
        .box(0.15, 0.07, 0.15, '#ff9a3c', 0.56, 1.6, -0.56)
        .box(0.84, 0.32, 0.48, t.dark, 0.26, 0.1, 0.46)
        .box(0.08, 0.08, 1, STEEL, -0.05, 0.56, -0.2, Math.PI / 2);
      break;
    case 'turret':
      b.box(0.88, 0.1, 0.88, CONCRETE_DARK)
        .cyl(0.32, 0.4, 0.5, 8, CONCRETE, 0, 0.1, 0);
      break;
  }
  return b.build();
}

export function turretHead(team: number): THREE.BufferGeometry {
  const t = TEAMS[team];
  return new ModelBuilder()
    .box(0.44, 0.24, 0.36, t.main, -0.03, 0, 0)
    .box(0.18, 0.08, 0.2, t.dark, -0.1, 0.24, 0)
    .barrel(0.035, 0.46, STEEL, 0.16, 0.14, 0.08)
    .barrel(0.035, 0.46, STEEL, 0.16, 0.14, -0.08)
    .build();
}

export function treeModel(): THREE.BufferGeometry {
  return new ModelBuilder()
    .cyl(0.06, 0.09, 0.28, 5, '#7a5230')
    .cone(0.44, 0.62, 6, '#4f9c52', 0, 0.2, 0)
    .cone(0.34, 0.5, 6, '#62b462', 0, 0.56, 0)
    .cone(0.22, 0.4, 6, '#7ccc72', 0, 0.86, 0)
    .build();
}

export function rockModel(): THREE.BufferGeometry {
  return new ModelBuilder()
    .ball(0.5, '#8d939b', 0, 0.28, 0)
    .ball(0.3, '#a6acb3', 0.26, 0.16, 0.18)
    .ball(0.24, '#777d86', -0.26, 0.12, -0.14)
    .build();
}

export function pumpModel(): THREE.BufferGeometry {
  return new ModelBuilder()
    .cyl(0.86, 0.96, 0.03, 8, '#2c2a33', 0, 0, 0)
    .cyl(0.46, 0.56, 0.05, 7, '#17161c', 0.14, 0.01, -0.1)
    .ball(0.1, '#35333f', -0.5, 0.05, 0.38)
    .ball(0.07, '#35333f', 0.54, 0.05, 0.36)
    .build();
}

export function wreckModel(): THREE.BufferGeometry {
  return new ModelBuilder()
    .box(0.92, 0.2, 0.56, '#2d2b2a', 0, 0.02, 0)
    .box(0.42, 0.13, 0.36, '#3a3734', -0.08, 0.22, 0.03, 0.4)
    .barrel(0.035, 0.4, '#232120', 0.05, 0.3, 0.1)
    .build();
}

export function rubbleModel(): THREE.BufferGeometry {
  return new ModelBuilder()
    .ball(0.42, '#8f8a7e', -0.3, 0.14, 0.1)
    .ball(0.3, '#76716a', 0.3, 0.1, -0.22)
    .ball(0.24, '#a39d90', 0.1, 0.1, 0.36)
    .box(0.62, 0.14, 0.2, '#5d5a55', -0.08, 0.24, -0.22, 0.7)
    .box(0.12, 0.46, 0.12, '#4b4a48', 0.34, 0, 0.26)
    .build();
}

export function jetModel(t: TeamPalette): THREE.BufferGeometry {
  return new ModelBuilder()
    .box(1.5, 0.2, 0.24, t.main, 0, 0, 0)
    .cone(0.13, 0.42, 5, t.light, 0.9, 0.0, 0)
    .box(0.5, 0.05, 1.8, t.dark, -0.1, 0.06, 0)
    .box(0.28, 0.05, 0.8, t.dark, -0.66, 0.1, 0)
    .box(0.24, 0.32, 0.05, t.light, -0.66, 0.16, 0)
    .box(0.24, 0.1, 0.16, GLASS, 0.34, 0.2, 0)
    .build();
}

export function chuteModel(): THREE.BufferGeometry {
  return new ModelBuilder()
    .cone(0.56, 0.36, 8, '#f4f1e6', 0, 0.92, 0)
    .box(0.02, 0.56, 0.02, '#d0ccc0', 0.28, 0.42, 0)
    .box(0.02, 0.56, 0.02, '#d0ccc0', -0.28, 0.42, 0)
    .box(0.12, 0.3, 0.14, '#4f6b3a', 0, 0.14, 0)
    .build();
}

export function flagModel(): THREE.BufferGeometry {
  return new ModelBuilder()
    .cyl(0.04, 0.05, 1.9, 5, '#f0efe9')
    .ball(0.08, '#ffd65c', 0, 1.94, 0)
    .build();
}

export function flagClothModel(): THREE.BufferGeometry {
  return new ModelBuilder().box(0.7, 0.42, 0.03, '#ffffff', 0.36, 1.42, 0).build();
}
