import * as THREE from 'three';
import { BUILDINGS, UNITS, isBuildingType, type BuildingType, type UnitType } from '../sim/data/defs';
import { ONE } from '../sim/fixed';
import type { Entity, World } from '../sim/types';
import { buildingModel, turretHead, unitModel, type PartRole, type UnitModel } from './models/catalog';
import type { CameraRig } from './camera';

const MEMBER_CAPACITY = 150;
const BUILDING_CAPACITY = 24;
const BAR_CAPACITY = 80;
const UNIT_TYPES: UnitType[] = ['infantry', 'antitank', 'tank', 'heli', 'truck'];
const BUILDING_TYPES: BuildingType[] = ['hq', 'barracks', 'factory', 'helipad', 'refinery', 'turret'];

interface Visual {
  heading: number;
  aim: number;
  moving: boolean;
  flash: number;
  rotor: number;
  recoil: number;
  /** 1 right after being hit, fading to 0. */
  hurt: number;
  /** Direction the hit pushed it, as an angle on the ground. */
  hurtDir: number;
  /** Members drawn last frame, to notice the ones that just fell. */
  alive: number;
  x: number;
  z: number;
}

interface Fallen {
  type: UnitType;
  owner: number;
  x: number;
  z: number;
  angle: number;
  side: number;
  t: number;
}

/** A squad member lost this frame; the view turns vehicles into wrecks. */
export interface LostMember {
  type: UnitType;
  x: number;
  z: number;
  heading: number;
}

const lambert = new THREE.MeshLambertMaterial({ vertexColors: true });

function instanced(geometry: THREE.BufferGeometry, capacity: number, shadow = false): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, lambert, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = shadow;
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  return mesh;
}

function angleLerp(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

export function entityPosition(e: Entity, alpha: number): [number, number] {
  return [(e.px + (e.x - e.px) * alpha) / ONE, (e.py + (e.y - e.py) * alpha) / ONE];
}

export function entityRadius(e: Entity): number {
  if (isBuildingType(e.type)) return e.type === 'hq' ? 2.2 : e.type === 'turret' ? 0.7 : 1.6;
  if (e.type === 'tank') return 1;
  return 0.8;
}

export function entityHeight(e: Entity): number {
  if (e.type === 'heli') return 2.1;
  return 0;
}

/** Draws everything that belongs to an entity: bodies, shadows, rings and bars. */
export class EntityRenderer {
  readonly group = new THREE.Group();
  private units = new Map<string, InstancedSet>();
  private models = new Map<string, UnitModel>();
  private buildings = new Map<string, THREE.InstancedMesh>();
  private heads: THREE.InstancedMesh[] = [];
  private visuals = new Map<number, Visual>();
  private fallen: Fallen[] = [];
  readonly lost: LostMember[] = [];
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private blobs: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private barBack: THREE.InstancedMesh;
  private barFill: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private scale = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private color = new THREE.Color();
  private white = new THREE.Color(1, 1, 1);
  private flashColor = new THREE.Color(2.2, 1.9, 1.7);

  constructor() {
    for (let team = 0; team < 2; team++) {
      for (const type of UNIT_TYPES) {
        const model = unitModel(type, team);
        this.models.set(`${type}${team}`, model);
        for (const part of model.parts) {
          const mesh = instanced(part.geometry, MEMBER_CAPACITY);
          const set = this.getSet(type, team);
          set[part.role] = mesh;
          this.group.add(mesh);
        }
      }
      for (const type of BUILDING_TYPES) {
        const mesh = instanced(buildingModel(type, team), BUILDING_CAPACITY, true);
        this.buildings.set(`${type}${team}`, mesh);
        this.group.add(mesh);
      }
      const head = instanced(turretHead(team), BUILDING_CAPACITY, true);
      this.heads.push(head);
      this.group.add(head);
    }

    this.blobs = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#10210f', transparent: true, opacity: 0.26, depthWrite: false }),
      MEMBER_CAPACITY * 2,
    );
    this.blobs.frustumCulled = false;

    this.rings = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.86, 1, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false }),
      60,
    );
    this.rings.frustumCulled = false;

    const barGeo = new THREE.PlaneGeometry(1, 1);
    this.barBack = new THREE.InstancedMesh(
      barGeo, new THREE.MeshBasicMaterial({ color: '#141a1f', depthTest: false, transparent: true, opacity: 0.72 }), BAR_CAPACITY,
    );
    this.barFill = new THREE.InstancedMesh(
      barGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true }), BAR_CAPACITY,
    );
    this.barFill.setColorAt(0, this.white);
    this.barBack.frustumCulled = false;
    this.barFill.frustumCulled = false;
    this.barBack.renderOrder = 10;
    this.barFill.renderOrder = 11;
    this.group.add(this.blobs, this.rings, this.barBack, this.barFill);
  }

  private getSet(type: UnitType, team: number): InstancedSet {
    const key = `${type}${team}`;
    let set = this.units.get(key);
    if (!set) {
      set = {};
      this.units.set(key, set);
    }
    return set;
  }

  reset(): void {
    this.visuals.clear();
    this.fallen.length = 0;
    this.lost.length = 0;
  }

  /** Makes a unit flinch away from a hit; without a source it shakes in place. */
  hurt(id: number, strength: number, fromX?: number, fromZ?: number): void {
    const v = this.visuals.get(id);
    if (!v) return;
    v.hurt = Math.min(1.4, Math.max(v.hurt, strength));
    v.hurtDir = fromX === undefined || fromZ === undefined
      ? Math.random() * 6.28 : Math.atan2(v.z - fromZ, v.x - fromX);
  }

  flash(id: number): void {
    const v = this.visuals.get(id);
    if (v) v.flash = 0.1;
  }

  recoil(id: number): void {
    const v = this.visuals.get(id);
    if (v) v.recoil = 1;
  }

  headingOf(id: number): number {
    return this.visuals.get(id)?.heading ?? 0;
  }

  private visual(e: Entity): Visual {
    let v = this.visuals.get(e.id);
    if (!v) {
      const start = e.owner === 0 ? 0 : Math.PI;
      v = {
        heading: start, aim: start, moving: false, flash: 0, rotor: e.id, recoil: 0,
        hurt: 0, hurtDir: 0, alive: UNITS[e.type as UnitType]?.members ?? 1, x: e.x / ONE, z: e.y / ONE,
      };
      this.visuals.set(e.id, v);
    }
    return v;
  }

  private place(mesh: THREE.InstancedMesh, x: number, y: number, z: number, angle: number,
    sx = 1, sy = 1, sz = 1, flash = false): void {
    this.m.makeRotationY(angle);
    this.scale.makeScale(sx, sy, sz);
    this.m.multiply(this.scale);
    this.m.setPosition(x, y, z);
    const i = mesh.count++;
    mesh.setMatrixAt(i, this.m);
    mesh.setColorAt(i, flash ? this.flashColor : this.white);
  }

  private blob(x: number, z: number, radius: number): void {
    if (this.blobs.count >= this.blobs.instanceMatrix.count) return;
    this.m.makeScale(radius, 1, radius * 0.8);
    this.m.setPosition(x, 0.09, z);
    this.blobs.setMatrixAt(this.blobs.count++, this.m);
  }

  private drawUnit(w: World, e: Entity, alpha: number, time: number, dt: number): void {
    const type = e.type as UnitType;
    const def = UNITS[type];
    const model = this.models.get(`${type}${e.owner}`)!;
    const set = this.getSet(type, e.owner);
    const vis = this.visual(e);
    const [px, pz] = entityPosition(e, alpha);
    vis.x = px;
    vis.z = pz;
    vis.hurt = Math.max(0, vis.hurt - dt * 4);
    const shove = vis.hurt * vis.hurt * 0.16;
    const x = px + Math.cos(vis.hurtDir) * shove;
    const z = pz + Math.sin(vis.hurtDir) * shove;

    const dx = e.x - e.px;
    const dz = e.y - e.py;
    vis.moving = dx !== 0 || dz !== 0;
    if (Math.abs(dx) + Math.abs(dz) > 8) {
      vis.heading = angleLerp(vis.heading, Math.atan2(-dz, dx), Math.min(1, dt * 9));
    }
    const target = e.targetId ? w.byId.get(e.targetId) : undefined;
    const wantedAim = target ? Math.atan2(-(target.y - e.y), target.x - e.x) : vis.heading;
    vis.aim = angleLerp(vis.aim, wantedAim, Math.min(1, dt * 12));
    if (vis.flash > 0) vis.flash -= dt;
    const flashing = vis.flash > 0;
    vis.recoil = Math.max(0, vis.recoil - dt * 7);
    const kick = vis.recoil * vis.recoil * 0.2;
    const kickX = -Math.cos(vis.aim) * kick;
    const kickZ = Math.sin(vis.aim) * kick;

    const alive = Math.max(1, Math.ceil(def.members * e.hp / e.maxHp));
    const cos = Math.cos(vis.heading);
    const sin = Math.sin(vis.heading);
    for (let i = alive; i < Math.min(vis.alive, def.members); i++) {
      const [ox, oz] = model.formation[i];
      const lx = px + ox * cos + oz * sin;
      const lz = pz - ox * sin + oz * cos;
      if (def.members >= 3) {
        this.fallen.push({ type, owner: e.owner, x: lx, z: lz, angle: vis.aim, side: Math.random() < 0.5 ? -1 : 1, t: 0 });
      } else {
        this.lost.push({ type, x: lx, z: lz, heading: vis.heading });
      }
    }
    vis.alive = alive;
    const crouch = def.members >= 3 ? 1 - Math.min(1, vis.hurt) * 0.28 : 1;
    const rock = type === 'tank' || type === 'truck' ? Math.sin(time * 40) * vis.hurt * 0.08 : 0;
    const bodyAngle = type === 'tank' || type === 'truck' ? vis.heading : vis.aim;

    for (let i = 0; i < alive; i++) {
      const [ox, oz] = model.formation[i];
      const mx = x + ox * cos + oz * sin;
      const mz = z - ox * sin + oz * cos;
      const walking = def.members >= 3 && vis.moving;
      const bob = walking ? Math.abs(Math.sin(time * 11 + i * 1.7)) * 0.07 : 0;
      const hover = type === 'heli' ? Math.sin(time * 2.2 + e.id) * 0.1 : 0;
      const y = 0.09 + model.altitude + bob + hover;
      const tilt = (type === 'heli' && vis.moving) || vis.hurt > 0.05 ? 1 : 0;

      if (set.hull) {
        if (tilt) {
          const wobble = type === 'heli' ? Math.sin(time * 30) * vis.hurt * 0.25 : 0;
          this.q.setFromEuler(this.euler.set(rock, bodyAngle, (type === 'heli' && vis.moving ? -0.16 : 0) + wobble));
          this.m.compose(this.v.set(mx, y, mz), this.q, this.s.set(1, crouch, 1));
          const index = set.hull.count++;
          set.hull.setMatrixAt(index, this.m);
          set.hull.setColorAt(index, flashing ? this.flashColor : this.white);
        } else {
          this.place(set.hull, mx + kickX * 0.5, y, mz + kickZ * 0.5, bodyAngle, 1, 1, 1, flashing);
        }
      }
      if (set.turret) this.place(set.turret, mx + kickX, y + 0.33, mz + kickZ, vis.aim, 1, 1, 1, flashing);
      if (set.rotor) {
        vis.rotor += dt * 26;
        this.place(set.rotor, mx, y + 0.42, mz, vis.rotor);
      }
      this.blob(mx, mz, type === 'tank' ? 0.62 : type === 'heli' ? 0.8 : type === 'truck' ? 0.5 : 0.2);
    }
  }

  private drawBuilding(w: World, e: Entity, alpha: number, dt: number): void {
    const type = e.type as BuildingType;
    const mesh = this.buildings.get(`${type}${e.owner}`)!;
    const x = e.x / ONE;
    const z = e.y / ONE;
    const vis = this.visual(e);
    if (vis.flash > 0) vis.flash -= dt;
    const progress = e.building > 0 ? 1 - 0.8 * (e.building / BUILDINGS[type].buildTicks) : 1;
    this.place(mesh, x, 0.05, z, 0, 1, progress, 1, vis.flash > 0);
    if (type === 'turret' && e.building === 0) {
      const target = e.targetId ? w.byId.get(e.targetId) : undefined;
      if (target) {
        const [tx, tz] = entityPosition(target, alpha);
        vis.aim = angleLerp(vis.aim, Math.atan2(-(tz - z), tx - x), Math.min(1, dt * 10));
      }
      vis.recoil = Math.max(0, vis.recoil - dt * 7);
      const kick = vis.recoil * 0.12;
      this.place(
        this.heads[e.owner], x - Math.cos(vis.aim) * kick, 0.65, z + Math.sin(vis.aim) * kick,
        vis.aim, 1, 1, 1, vis.flash > 0,
      );
    }
  }

  private drawBar(e: Entity, x: number, z: number, camera: CameraRig): void {
    const count = this.barBack.count;
    if (count >= BAR_CAPACITY) return;
    const y = e.isBuilding ? (e.type === 'hq' ? 3.5 : 1.9) : entityHeight(e) + 1.05;
    const width = e.isBuilding ? (e.type === 'hq' ? 3 : 1.6) : 1.1;
    const height = 0.17 * (camera.dist / 40) + 0.04;
    const pct = Math.max(0, e.hp / e.maxHp);
    this.q.copy(camera.camera.quaternion);

    this.m.compose(this.v.set(x, y, z), this.q, this.s.set(width + 0.08, height + 0.08, 1));
    this.barBack.setMatrixAt(count, this.m);

    const right = this.v.set(1, 0, 0).applyQuaternion(this.q).multiplyScalar(-(width * (1 - pct)) / 2);
    this.m.compose(right.add(new THREE.Vector3(x, y, z)), this.q, this.s.set(Math.max(0.001, width * pct), height, 1));
    this.barFill.setMatrixAt(count, this.m);
    this.color.setHSL(pct * 0.33, 0.85, 0.5);
    this.barFill.setColorAt(count, this.color);
    this.barBack.count = this.barFill.count = count + 1;
  }

  /** Soldiers that just fell topple over, lie there a moment and sink away. */
  private drawFallen(dt: number): void {
    let keep = 0;
    for (const f of this.fallen) {
      f.t += dt;
      if (f.t > 2.6) continue;
      this.fallen[keep++] = f;
      const hull = this.getSet(f.type, f.owner).hull;
      if (!hull || hull.count >= MEMBER_CAPACITY) continue;
      const topple = Math.min(1, f.t / 0.3);
      const sink = f.t > 1.6 ? (f.t - 1.6) * 0.35 : 0;
      this.q.setFromEuler(this.euler.set(f.side * topple * 1.45, f.angle, 0));
      this.m.compose(this.v.set(f.x, 0.1 - sink, f.z), this.q, this.s.set(1, 1, 1));
      const index = hull.count++;
      hull.setMatrixAt(index, this.m);
      hull.setColorAt(index, this.color.setRGB(0.7, 0.7, 0.7));
    }
    this.fallen.length = keep;
  }

  update(w: World, alpha: number, time: number, dt: number, selection: Set<number>, camera: CameraRig): void {
    for (const set of this.units.values()) {
      for (const role of ROLES) if (set[role]) set[role]!.count = 0;
    }
    for (const mesh of this.buildings.values()) mesh.count = 0;
    for (const head of this.heads) head.count = 0;
    this.blobs.count = 0;
    this.rings.count = 0;
    this.barBack.count = 0;
    this.barFill.count = 0;

    for (const e of w.entities) {
      if (e.isBuilding) this.drawBuilding(w, e, alpha, dt);
      else this.drawUnit(w, e, alpha, time, dt);

      const [x, z] = e.isBuilding ? [e.x / ONE, e.y / ONE] : entityPosition(e, alpha);
      const selected = selection.has(e.id);
      if (selected) {
        const r = entityRadius(e) * (1 + Math.sin(time * 6) * 0.05);
        this.m.makeScale(r, 1, r);
        this.m.setPosition(x, 0.13, z);
        this.rings.setMatrixAt(this.rings.count++, this.m);
      }
      if (selected || e.hp < e.maxHp) this.drawBar(e, x, z, camera);
    }

    this.drawFallen(dt);

    if (this.visuals.size > w.entities.length + 40) {
      for (const id of this.visuals.keys()) if (!w.byId.has(id)) this.visuals.delete(id);
    }

    for (const set of this.units.values()) {
      for (const role of ROLES) if (set[role]) flush(set[role]!);
    }
    for (const mesh of this.buildings.values()) flush(mesh);
    for (const head of this.heads) flush(head);
    flush(this.blobs);
    flush(this.rings);
    flush(this.barBack);
    flush(this.barFill);
  }
}

type InstancedSet = Partial<Record<PartRole, THREE.InstancedMesh>>;
const ROLES: PartRole[] = ['hull', 'turret', 'rotor'];

function flush(mesh: THREE.InstancedMesh): void {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
