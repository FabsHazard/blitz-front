import * as THREE from 'three';
import { TEAMS, chuteModel, jetModel, rubbleModel, wreckModel } from './models/catalog';

const CRATERS = 64;
const WRECKS = 24;
const RUBBLE = 16;
const WRECK_LIFE = 14;
const RUBBLE_LIFE = 45;
const JETS = 4;
const CHUTES = 8;
const FLY_HEIGHT = 7;
const FLY_SPEED = 26;

interface Debris {
  life: number;
  x: number;
  z: number;
  angle: number;
  scale: number;
}

function hide(mesh: THREE.InstancedMesh, count: number): void {
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, zero);
  mesh.instanceMatrix.needsUpdate = true;
}

function pool(geometry: THREE.BufferGeometry, material: THREE.Material, count: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  hide(mesh, count);
  return mesh;
}

/** What battles leave behind: craters, burnt vehicles and collapsed buildings. */
export class Scars {
  readonly group = new THREE.Group();
  private craters = pool(
    new THREE.CircleGeometry(1, 9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#2c2820', transparent: true, opacity: 0.55, depthWrite: false }),
    CRATERS,
  );
  private wrecks = pool(wreckModel(), new THREE.MeshLambertMaterial({ vertexColors: true }), WRECKS);
  private rubble = pool(rubbleModel(), new THREE.MeshLambertMaterial({ vertexColors: true }), RUBBLE);
  private wreckList: Debris[] = [];
  private rubbleList: Debris[] = [];
  private nextCrater = 0;
  private nextWreck = 0;
  private nextRubble = 0;
  private m = new THREE.Matrix4();
  private s = new THREE.Matrix4();

  constructor() {
    this.group.add(this.craters, this.wrecks, this.rubble);
    this.reset();
  }

  reset(): void {
    hide(this.craters, CRATERS);
    this.wreckList = Array.from({ length: WRECKS }, () => ({ life: 0, x: 0, z: 0, angle: 0, scale: 1 }));
    this.rubbleList = Array.from({ length: RUBBLE }, () => ({ life: 0, x: 0, z: 0, angle: 0, scale: 1 }));
  }

  crater(x: number, z: number, radius: number): void {
    this.m.makeRotationY(Math.random() * 6.28);
    this.s.makeScale(radius, 1, radius);
    this.m.multiply(this.s).setPosition(x, 0.1 + Math.random() * 0.01, z);
    this.craters.setMatrixAt(this.nextCrater, this.m);
    this.craters.instanceMatrix.needsUpdate = true;
    this.nextCrater = (this.nextCrater + 1) % CRATERS;
  }

  wreck(x: number, z: number, angle: number): void {
    const d = this.wreckList[this.nextWreck];
    this.nextWreck = (this.nextWreck + 1) % WRECKS;
    Object.assign(d, { life: WRECK_LIFE, x, z, angle, scale: 1 });
  }

  collapse(x: number, z: number, scale: number): void {
    const d = this.rubbleList[this.nextRubble];
    this.nextRubble = (this.nextRubble + 1) % RUBBLE;
    Object.assign(d, { life: RUBBLE_LIFE, x, z, angle: Math.random() * 6.28, scale });
  }

  private draw(mesh: THREE.InstancedMesh, list: Debris[], dt: number): void {
    list.forEach((d, i) => {
      d.life = Math.max(0, d.life - dt);
      const k = d.life > 0 ? d.scale : 0;
      // Debris sinks into the ground during its last second.
      const y = 0.08 - (d.life < 1 ? (1 - d.life) * 0.6 : 0);
      this.m.makeRotationY(d.angle);
      this.s.makeScale(k, k, k);
      this.m.multiply(this.s).setPosition(d.x, y, d.z);
      mesh.setMatrixAt(i, this.m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    this.draw(this.wrecks, this.wreckList, dt);
    this.draw(this.rubble, this.rubbleList, dt);
  }
}

interface Flight {
  time: number;
  arrive: number;
  x: number;
  z: number;
  dir: number;
  team: number;
}

interface Chute {
  time: number;
  duration: number;
  x: number;
  z: number;
}

/** Planes crossing the map and paratroopers landing. Purely cosmetic. */
export class AirTraffic {
  readonly group = new THREE.Group();
  private jets = [0, 1].map((team) =>
    pool(jetModel(TEAMS[team]), new THREE.MeshLambertMaterial({ vertexColors: true }), JETS));
  private chutes = pool(chuteModel(), new THREE.MeshLambertMaterial({ vertexColors: true }), CHUTES);
  private flights: Flight[] = [];
  private drops: Chute[] = [];
  private m = new THREE.Matrix4();

  constructor() {
    this.group.add(...this.jets, this.chutes);
  }

  reset(): void {
    this.flights = [];
    this.drops = [];
  }

  flyby(team: number, x: number, z: number, delay: number): void {
    this.flights.push({ time: 0, arrive: delay, x, z, dir: team === 0 ? 1 : -1, team });
  }

  parachutes(x: number, z: number, delay: number): void {
    for (let i = 0; i < 4; i++) {
      this.drops.push({
        time: -i * 0.08, duration: delay,
        x: x + (i - 1.5) * 0.9, z: z + (i % 2 ? 0.6 : -0.6),
      });
    }
  }

  update(dt: number): void {
    const counts = [0, 0];
    for (const f of this.flights) {
      f.time += dt;
      const team = f.team;
      if (counts[team] >= JETS) continue;
      this.m.makeRotationY(f.dir > 0 ? 0 : Math.PI);
      this.m.setPosition(f.x + (f.time - f.arrive) * FLY_SPEED * f.dir, FLY_HEIGHT, f.z);
      this.jets[team].setMatrixAt(counts[team]++, this.m);
    }
    this.flights = this.flights.filter((f) => f.time < f.arrive + 2.5);
    this.m.makeScale(0, 0, 0);
    this.jets.forEach((mesh, team) => {
      for (let i = counts[team]; i < JETS; i++) mesh.setMatrixAt(i, this.m);
      mesh.instanceMatrix.needsUpdate = true;
    });

    let shown = 0;
    for (const c of this.drops) {
      c.time += dt;
      if (shown >= CHUTES || c.time < 0) continue;
      const k = Math.min(1, c.time / c.duration);
      this.m.makeTranslation(c.x, 9 * (1 - k) + 0.1, c.z);
      this.chutes.setMatrixAt(shown++, this.m);
    }
    this.drops = this.drops.filter((c) => c.time < c.duration);
    this.m.makeScale(0, 0, 0);
    for (let i = shown; i < CHUTES; i++) this.chutes.setMatrixAt(i, this.m);
    this.chutes.instanceMatrix.needsUpdate = true;
  }
}
