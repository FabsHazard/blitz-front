import * as THREE from 'three';

const PUFF_CAP = 240;
const TRACER_CAP = 90;

interface Puff {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number; size: number;
}

interface Tracer {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  life: number; max: number; width: number;
}

const FIRE = [new THREE.Color('#ffd65c'), new THREE.Color('#ff9a3c'), new THREE.Color('#f25c33')];
const SMOKE = [new THREE.Color('#5a5a60'), new THREE.Color('#77777c')];
const DUST = new THREE.Color('#d6c79c');

/** Pooled low-poly particles. They shrink instead of fading to avoid blending costs. */
export class Effects {
  readonly group = new THREE.Group();
  private puffs: THREE.InstancedMesh;
  private tracers: THREE.InstancedMesh;
  private puffPool: Puff[] = [];
  private tracerPool: Tracer[] = [];
  private nextPuff = 0;
  private nextTracer = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private s = new THREE.Vector3();
  private forward = new THREE.Vector3(0, 0, 1);

  constructor() {
    this.puffs = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      PUFF_CAP,
    );
    this.tracers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ffe48a' }),
      TRACER_CAP,
    );
    this.puffs.frustumCulled = false;
    this.tracers.frustumCulled = false;
    this.puffs.setColorAt(0, new THREE.Color(1, 1, 1));
    for (let i = 0; i < PUFF_CAP; i++) {
      this.puffPool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0 });
    }
    for (let i = 0; i < TRACER_CAP; i++) {
      this.tracerPool.push({ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, life: 0, max: 1, width: 0.05 });
    }
    this.group.add(this.puffs, this.tracers);
  }

  private puff(x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size: number, color: THREE.Color): void {
    const index = this.nextPuff;
    this.nextPuff = (index + 1) % PUFF_CAP;
    const p = this.puffPool[index];
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = p.max = life;
    p.size = size;
    this.puffs.setColorAt(index, color);
  }

  shot(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number): void {
    const t = this.tracerPool[this.nextTracer];
    this.nextTracer = (this.nextTracer + 1) % TRACER_CAP;
    t.ax = ax; t.ay = ay; t.az = az;
    t.bx = bx; t.by = by; t.bz = bz;
    t.life = t.max = 0.13;
    t.width = width;
    if (width > 0.07) this.puff(ax, ay, az, 0, 0.3, 0, 0.14, 0.2, FIRE[0]);
  }

  hit(x: number, y: number, z: number): void {
    const a = Math.random() * 6.28;
    this.puff(x + Math.cos(a) * 0.3, y + 0.25, z + Math.sin(a) * 0.3, 0, 0.8, 0, 0.26, 0.13, DUST);
  }

  /** A wisp rising from something damaged. */
  smoke(x: number, y: number, z: number, burning: boolean): void {
    const drift = () => (Math.random() - 0.5) * 0.3;
    this.puff(
      x + drift(), y, z + drift(), 0.25 + drift(), 0.8 + Math.random() * 0.5, drift(),
      1 + Math.random() * 0.5, 0.15 + Math.random() * 0.14, SMOKE[Math.random() < 0.5 ? 0 : 1],
    );
    if (burning) this.puff(x + drift(), y, z + drift(), 0, 0.9, 0, 0.3, 0.16, FIRE[1]);
  }

  explosion(x: number, y: number, z: number, scale: number): void {
    const count = Math.round(9 * scale);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28;
      const speed = (1 + Math.random() * 2.4) * scale;
      this.puff(
        x, y + 0.3, z, Math.cos(a) * speed, 1.4 + Math.random() * 2.2 * scale, Math.sin(a) * speed,
        0.4 + Math.random() * 0.3, (0.2 + Math.random() * 0.26) * scale,
        FIRE[Math.floor(Math.random() * FIRE.length)],
      );
    }
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28;
      this.puff(
        x + Math.cos(a) * 0.3, y + 0.4, z + Math.sin(a) * 0.3,
        Math.cos(a) * 0.5, 1 + Math.random(), Math.sin(a) * 0.5,
        0.9 + Math.random() * 0.6, (0.26 + Math.random() * 0.3) * scale,
        SMOKE[i % 2],
      );
    }
  }

  update(dt: number): void {
    for (let i = 0; i < PUFF_CAP; i++) {
      const p = this.puffPool[i];
      if (p.life > 0) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vx *= 0.94;
        p.vz *= 0.94;
      }
      const k = p.life > 0 ? Math.sqrt(p.life / p.max) * p.size : 0;
      this.m.makeScale(k, k, k);
      this.m.setPosition(p.x, p.y, p.z);
      this.puffs.setMatrixAt(i, this.m);
    }
    this.puffs.instanceMatrix.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;

    for (let i = 0; i < TRACER_CAP; i++) {
      const t = this.tracerPool[i];
      if (t.life <= 0) {
        this.m.makeScale(0, 0, 0);
      } else {
        t.life -= dt;
        const progress = 1 - t.life / t.max;
        const head = Math.min(1, progress * 1.5);
        const tail = Math.max(0, progress * 1.5 - 0.5);
        this.a.set(t.ax, t.ay, t.az).lerp(this.b.set(t.bx, t.by, t.bz), tail);
        this.b.set(t.ax, t.ay, t.az).lerp(this.s.set(t.bx, t.by, t.bz), head);
        const length = this.a.distanceTo(this.b);
        const dir = this.s.copy(this.b).sub(this.a).normalize();
        this.q.setFromUnitVectors(this.forward, dir);
        this.m.compose(
          this.a.add(this.b).multiplyScalar(0.5), this.q,
          this.s.set(t.width, t.width, Math.max(0.01, length)),
        );
      }
      this.tracers.setMatrixAt(i, this.m);
    }
    this.tracers.instanceMatrix.needsUpdate = true;
  }
}
