import * as THREE from 'three';

const TILT = THREE.MathUtils.degToRad(54);
const MIN_DIST = 16;
const MAX_DIST = 62;

/** Tilted toy-box camera. Everything is expressed through the ground plane y=0. */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(30, 1, 1, 260);
  target = new THREE.Vector2();
  dist = 40;
  /** Player 2 looks at the map from the opposite side, with their base on the left. */
  flipped = false;
  private shakeUntil = 0;
  private shakeAmount = 0;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private projected = new THREE.Vector3();

  constructor(private mapW: number, private mapH: number) {}

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  focus(x: number, z: number): void {
    this.target.set(x, z);
    this.clamp();
  }

  shake(amount: number, now: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeUntil = now + 0.28;
  }

  private clamp(): void {
    this.target.x = THREE.MathUtils.clamp(this.target.x, 0, this.mapW);
    this.target.y = THREE.MathUtils.clamp(this.target.y, -2, this.mapH + 2);
  }

  update(now: number): void {
    const remaining = this.shakeUntil - now;
    const k = remaining > 0 ? this.shakeAmount * (remaining / 0.28) : 0;
    if (remaining <= 0) this.shakeAmount = 0;
    const sx = k ? Math.sin(now * 71) * k : 0;
    const sz = k ? Math.cos(now * 57) * k : 0;
    this.camera.position.set(
      this.target.x + sx,
      Math.sin(TILT) * this.dist,
      this.target.y + Math.cos(TILT) * this.dist * (this.flipped ? -1 : 1) + sz,
    );
    this.camera.lookAt(this.target.x + sx, 0, this.target.y + sz);
    this.camera.updateMatrixWorld();
  }

  /** Ground point under a position in normalized device coordinates. */
  private groundAtNdc(nx: number, ny: number): THREE.Vector3 | null {
    this.ndc.set(nx, ny);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray.intersectPlane(this.plane, this.hit);
  }

  ground(px: number, py: number, width: number, height: number): THREE.Vector3 | null {
    return this.groundAtNdc((px / width) * 2 - 1, -(py / height) * 2 + 1);
  }

  /** Moves the camera so the ground under (ax, ay) ends up under (bx, by). */
  drag(ax: number, ay: number, bx: number, by: number, width: number, height: number): void {
    const from = this.ground(ax, ay, width, height)?.clone();
    const to = this.ground(bx, by, width, height);
    if (!from || !to) return;
    this.target.x += from.x - to.x;
    this.target.y += from.z - to.z;
    this.clamp();
  }

  zoomBy(factor: number): void {
    this.dist = THREE.MathUtils.clamp(this.dist * factor, MIN_DIST, MAX_DIST);
  }

  toScreen(x: number, y: number, z: number, width: number, height: number): [number, number] {
    const p = this.projected.set(x, y, z).project(this.camera);
    return [(p.x + 1) * 0.5 * width, (1 - p.y) * 0.5 * height];
  }
}
