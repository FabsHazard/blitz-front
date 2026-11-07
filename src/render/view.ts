import * as THREE from 'three';
import { canPlace } from '../sim/commands';
import { ABILITIES, BALANCE, BUILDINGS, type BuildingType } from '../sim/data/defs';
import { ONE, TICK_RATE } from '../sim/fixed';
import type { GameEvent, World } from '../sim/types';
import { CameraRig } from './camera';
import { Effects } from './effects';
import { TEAMS, flagClothModel, flagModel } from './models/catalog';
import { AirTraffic, Scars } from './scars';
import { buildTerrain, type TerrainView } from './terrain';
import { EntityRenderer, entityHeight, entityPosition } from './units';

const NEUTRAL = '#f4f1e6';

interface PointView {
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  cloth: THREE.Mesh;
}

function teamColor(owner: number): string {
  return owner < 0 ? NEUTRAL : TEAMS[owner].main;
}

export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly rig: CameraRig;
  readonly scene = new THREE.Scene();
  readonly entities = new EntityRenderer();
  readonly effects = new Effects();
  readonly scars = new Scars();
  readonly air = new AirTraffic();
  width = 1;
  height = 1;
  private terrain: TerrainView | null = null;
  private mapId = '';
  private sun = new THREE.DirectionalLight('#fff4dc', 2.5);
  private points: PointView[] = [];
  private pointGroup = new THREE.Group();
  private ping: THREE.Mesh;
  private pingLife = 0;
  private rally: THREE.Mesh;
  private validCells: THREE.InstancedMesh;
  private ghost: THREE.Mesh;
  private aim: THREE.Mesh;
  private strikeMarks: THREE.InstancedMesh;
  private smokeClock = 0;
  private finale: { x: number; z: number; start: number; won: boolean; color: THREE.Color; next: number } | null = null;
  private pixelRatio: number;

  constructor(canvas: HTMLCanvasElement, w: World) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setClearColor('#a8dcef');
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = true;

    this.rig = new CameraRig(w.width, w.height);
    this.scene.fog = new THREE.Fog('#a8dcef', 90, 200);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#88a56c', 1.5));
    this.setupSun(w);

    this.ping = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }),
    );
    this.ping.visible = false;

    this.rally = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.7, 4).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ color: '#7dffb0' }),
    );

    this.validCells = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#a6ffb8', transparent: true, opacity: 0.3, depthWrite: false }),
      w.width * w.height,
    );
    this.validCells.count = 0;
    this.validCells.frustumCulled = false;

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.55 }),
    );
    this.ghost.visible = false;

    const ringGeometry = new THREE.RingGeometry(0.9, 1, 36).rotateX(-Math.PI / 2);
    this.aim = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({ color: '#ffd65c', transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.aim.visible = false;
    this.strikeMarks = new THREE.InstancedMesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }),
      8,
    );
    this.strikeMarks.count = 0;
    this.strikeMarks.frustumCulled = false;
    this.strikeMarks.setColorAt(0, new THREE.Color('#ffffff'));

    this.scene.add(
      this.entities.group, this.effects.group, this.scars.group, this.air.group, this.pointGroup,
      this.ping, this.rally, this.validCells, this.ghost, this.aim, this.strikeMarks,
    );
    this.bind(w, 0);
    this.resize();
  }

  private setupSun(w: World): void {
    const s = this.sun;
    s.position.set(w.width / 2 - 26, 46, w.height / 2 - 20);
    s.target.position.set(w.width / 2, 0, w.height / 2);
    s.castShadow = true;
    s.shadow.mapSize.set(1536, 1536);
    const c = s.shadow.camera;
    c.left = -50; c.right = 50; c.top = 42; c.bottom = -42; c.near = 1; c.far = 130;
    s.shadow.bias = -0.0015;
    this.scene.add(s, s.target);
  }

  private buildPoints(w: World): void {
    for (const child of [...this.pointGroup.children]) {
      this.pointGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.points = [];
    const pole = flagModel();
    const cloth = flagClothModel();
    for (const p of w.points) {
      const x = p.x / ONE;
      const z = p.y / ONE;
      const radius = BALANCE.captureRadius / ONE;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius - 0.16, radius, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      const fill = new THREE.Mesh(
        new THREE.CircleGeometry(radius - 0.16, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.22, depthWrite: false }),
      );
      const poleMesh = new THREE.Mesh(pole, new THREE.MeshLambertMaterial({ vertexColors: true }));
      const clothMesh = new THREE.Mesh(cloth, new THREE.MeshLambertMaterial({ vertexColors: true, color: NEUTRAL }));
      ring.position.set(x, 0.16, z);
      fill.position.set(x, 0.15, z);
      poleMesh.position.set(x, 0.09, z);
      clothMesh.position.set(x, 0.09, z);
      poleMesh.castShadow = true;
      this.pointGroup.add(ring, fill, poleMesh, clothMesh);
      this.points.push({ ring, fill, cloth: clothMesh });
    }
  }

  /** Points the view at a new match, rebuilding the scenery only if the map changed. */
  bind(w: World, owner: number): void {
    this.entities.reset();
    this.scars.reset();
    this.air.reset();
    this.endFinale();
    if (this.mapId !== w.map) {
      this.mapId = w.map;
      if (this.terrain) {
        this.scene.remove(this.terrain.group);
        this.terrain.group.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
      }
      this.terrain = buildTerrain(w);
      this.scene.add(this.terrain.group);
      this.buildPoints(w);
    }
    this.rig.flipped = owner === 1;
    if (owner === 0) this.rig.focus(18, 23);
    else this.rig.focus(w.width - 18, w.height - 23);
    this.rig.dist = 44;
    this.requestShadows();
  }

  requestShadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    this.width = canvas.clientWidth || window.innerWidth;
    this.height = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.rig.resize(this.width / this.height);
  }

  /** Lowers resolution on devices that cannot keep up. */
  lowerQuality(): boolean {
    if (this.pixelRatio <= 1) return false;
    this.pixelRatio = Math.max(1, this.pixelRatio - 0.4);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.resize();
    return true;
  }

  showPing(x: number, z: number, color: string): void {
    this.ping.position.set(x, 0.2, z);
    (this.ping.material as THREE.MeshBasicMaterial).color.set(color);
    this.ping.visible = true;
    this.pingLife = 0.45;
  }

  showValidCells(w: World, owner: number, type: BuildingType): void {
    const m = new THREE.Matrix4();
    let count = 0;
    const def = BUILDINGS[type];
    for (let cy = 0; cy < w.height; cy++) {
      for (let cx = 0; cx < w.width; cx++) {
        const ok = type === 'refinery'
          ? w.deposits.some((d) => cx >= d.cx && cx < d.cx + 2 && cy >= d.cy && cy < d.cy + 2
            && canPlace(w, owner, type, d.cx, d.cy))
          : canPlace(w, owner, type, Math.min(cx, w.width - def.w), Math.min(cy, w.height - def.h));
        if (!ok) continue;
        m.makeTranslation(cx + 0.5, 0.14, cy + 0.5);
        this.validCells.setMatrixAt(count++, m);
      }
    }
    this.validCells.count = count;
    this.validCells.instanceMatrix.needsUpdate = true;
  }

  hideValidCells(): void {
    this.validCells.count = 0;
    this.ghost.visible = false;
  }

  showGhost(type: BuildingType, cx: number, cy: number, valid: boolean): void {
    const def = BUILDINGS[type];
    this.ghost.visible = true;
    this.ghost.scale.set(def.w, 0.9, def.h);
    this.ghost.position.set(cx + def.w / 2, 0.5, cy + def.h / 2);
    (this.ghost.material as THREE.MeshBasicMaterial).color.set(valid ? '#7dffb0' : '#ff6a5c');
  }

  showAim(x: number, z: number, radius: number, color = '#ffd65c'): void {
    this.aim.visible = true;
    (this.aim.material as THREE.MeshBasicMaterial).color.set(color);
    this.aim.position.set(x, 0.22, z);
    this.aim.scale.set(radius, 1, radius);
  }

  hideAim(): void {
    this.aim.visible = false;
  }

  /** Telegraphs incoming strikes to both players so they can be dodged. */
  private updateStrikes(w: World, owner: number, time: number): void {
    const color = new THREE.Color();
    const m = new THREE.Matrix4();
    let count = 0;
    for (const s of w.strikes) {
      if (count >= 8 || w.winner !== -1) break;
      const radius = ABILITIES[s.kind].area / ONE;
      const pulse = 1 + Math.sin(time * 16) * 0.05;
      m.makeScale(radius * pulse, 1, radius * pulse);
      m.setPosition(s.x / ONE, 0.24, s.y / ONE);
      this.strikeMarks.setMatrixAt(count, m);
      const friendly = ABILITIES[s.kind].friendly || s.kind === 'paradrop' || s.kind === 'armor';
      this.strikeMarks.setColorAt(count, color.set(
        s.owner !== owner ? (friendly ? '#ffb347' : '#ff4d3d') : s.kind === 'emp' ? '#7fd8ff' : '#7dffb0'));
      count++;
    }
    this.strikeMarks.count = count;
    this.strikeMarks.instanceMatrix.needsUpdate = true;
    if (this.strikeMarks.instanceColor) this.strikeMarks.instanceColor.needsUpdate = true;
  }

  private emitDamageSmoke(w: World, dt: number): void {
    this.smokeClock += dt;
    if (this.smokeClock < 0.24) return;
    this.smokeClock = 0;
    for (const e of w.entities) {
      if (e.stun > 0) this.effects.zap(e.x / ONE, entityHeight(e), e.y / ONE);
      if (e.building > 0 || e.type === 'infantry' || e.type === 'antitank') continue;
      const pct = e.hp / e.maxHp;
      if (pct >= 0.5) continue;
      this.effects.smoke(e.x / ONE, entityHeight(e) + (e.isBuilding ? 1 : 0.45), e.y / ONE, pct < 0.25);
    }
  }

  handleEvents(w: World, events: readonly GameEvent[], alpha: number, now: number): void {
    for (const ev of events) {
      switch (ev.k) {
        case 'shot': {
          const from = w.byId.get(ev.from);
          if (!from) break;
          const [ax, az] = from.isBuilding ? [from.x / ONE, from.y / ONE] : entityPosition(from, alpha);
          const to = w.byId.get(ev.to);
          const punch = ev.type === 'tank' || ev.type === 'antitank' ? 1 : ev.type === 'infantry' ? 0.45 : 0.7;
          this.entities.hurt(ev.to, punch, ax, az);
          const by = (to ? entityHeight(to) : 0) + 0.3;
          const heavy = ev.type === 'tank' || ev.type === 'antitank' || ev.type === 'heli';
          this.entities.recoil(ev.from);
          this.effects.shot(ax, entityHeight(from) + 0.45, az, ev.x / ONE, by, ev.y / ONE, heavy ? 0.1 : 0.05);
          break;
        }
        case 'hit': {
          const target = w.byId.get(ev.id);
          this.entities.flash(ev.id);
          const armored = target !== undefined && (target.isBuilding || target.type === 'tank' || target.type === 'heli' || target.type === 'truck');
          this.effects.hit(ev.x / ONE, target ? entityHeight(target) : 0, ev.y / ONE, armored);
          break;
        }
        case 'death': {
          const big = ev.type === 'hq' ? 4 : ev.type in BUILDINGS ? 2.4 : ev.type === 'tank' || ev.type === 'heli' ? 1.3 : 0.7;
          this.effects.explosion(ev.x / ONE, ev.type === 'heli' ? 2 : 0, ev.y / ONE, big);
          if (ev.type in BUILDINGS) {
            this.scars.collapse(ev.x / ONE, ev.y / ONE, ev.type === 'hq' ? 3.4 : ev.type === 'turret' ? 1 : 2);
            this.scars.crater(ev.x / ONE, ev.y / ONE, ev.type === 'hq' ? 3 : 1.8);
          } else if (ev.type === 'tank' || ev.type === 'truck' || ev.type === 'heli') {
            this.scars.wreck(ev.x / ONE, ev.y / ONE, this.entities.headingOf(ev.id));
            this.scars.crater(ev.x / ONE, ev.y / ONE, 0.8);
          }
          if (big >= 1.3) this.rig.shake(big * 0.09, now);
          if (ev.type in BUILDINGS) this.requestShadows();
          break;
        }
        case 'built':
          this.requestShadows();
          break;
        case 'strike':
          if (ev.kind === 'airstrike' || ev.kind === 'paradrop' || ev.kind === 'armor') {
            this.air.flyby(ev.owner, ev.x / ONE, ev.y / ONE, ev.delay / TICK_RATE);
          }
          if (ev.kind === 'paradrop' || ev.kind === 'armor') {
            this.air.parachutes(ev.x / ONE, ev.y / ONE, ev.delay / TICK_RATE);
          }
          break;
        case 'blast': {
          const r = ev.radius / ONE;
          if (ev.kind === 'emp' || ev.kind === 'repair') {
            this.effects.ring(ev.x / ONE, ev.y / ONE, r, ev.kind === 'emp' ? 'emp' : 'heal');
            for (const e of w.entities) {
              const dx = e.x / ONE - ev.x / ONE;
              const dz = e.y / ONE - ev.y / ONE;
              if (dx * dx + dz * dz > r * r) continue;
              if (ev.kind === 'emp') this.entities.hurt(e.id, 0.8);
              else for (let i = 0; i < 3; i++) this.effects.heal(e.x / ONE, entityHeight(e), e.y / ONE);
            }
            if (ev.kind === 'emp') this.rig.shake(0.12, now);
            break;
          }
          this.effects.explosion(ev.x / ONE, 0, ev.y / ONE, ev.kind === 'airstrike' ? 3.4 : 1.5);
          this.scars.crater(ev.x / ONE, ev.y / ONE, r * 0.8);
          this.rig.shake(ev.kind === 'airstrike' ? 0.5 : 0.2, now);
          for (const e of w.entities) {
            const dx = e.x / ONE - ev.x / ONE;
            const dz = e.y / ONE - ev.y / ONE;
            if (dx * dx + dz * dz <= (r + 1) * (r + 1)) this.entities.hurt(e.id, 1.4, ev.x / ONE, ev.y / ONE);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /** The end of a match: the camera goes to the fallen base while it blows up. */
  playFinale(x: number, z: number, won: boolean, winnerOwner: number, now: number): void {
    this.finale = {
      x, z, start: now, won, next: now,
      color: new THREE.Color(winnerOwner >= 0 && winnerOwner < 2 ? TEAMS[winnerOwner].main : '#ffd65c'),
    };
  }

  endFinale(): void {
    this.finale = null;
  }

  private updateFinale(time: number): void {
    const f = this.finale;
    if (!f) return;
    const t = time - f.start;
    const ease = Math.min(1, t / 1.4);
    this.rig.target.x += (f.x - this.rig.target.x) * ease * 0.08;
    this.rig.target.y += (f.z - this.rig.target.y) * ease * 0.08;
    this.rig.dist += (28 - this.rig.dist) * 0.03;
    if (time < f.next) return;
    if (t < 2.4) {
      const a = Math.random() * 6.28;
      const d = Math.random() * 2.6;
      this.effects.explosion(f.x + Math.cos(a) * d, 0.5, f.z + Math.sin(a) * d, 1 + Math.random() * 1.2);
      this.rig.shake(0.25, time);
      f.next = time + 0.14 + Math.random() * 0.12;
    } else if (f.won && t < 9) {
      const a = Math.random() * 6.28;
      this.effects.firework(f.x + Math.cos(a) * 5, 6 + Math.random() * 3, f.z + Math.sin(a) * 4, f.color);
      f.next = time + 0.35 + Math.random() * 0.3;
    }
  }

  private updatePoints(w: World, time: number): void {
    w.points.forEach((p, i) => {
      const view = this.points[i];
      const pct = Math.abs(p.value) / BALANCE.captureMax;
      (view.ring.material as THREE.MeshBasicMaterial).color.set(p.contested ? '#ffd65c' : teamColor(p.owner));
      (view.fill.material as THREE.MeshBasicMaterial).color.set(p.value === 0 ? NEUTRAL : teamColor(p.value > 0 ? 0 : 1));
      view.fill.scale.set(pct, 1, pct);
      (view.cloth.material as THREE.MeshLambertMaterial).color.set(teamColor(p.owner));
      view.cloth.rotation.y = Math.sin(time * 3 + i) * 0.3;
    });
  }

  render(w: World, alpha: number, time: number, dt: number, selection: Set<number>, owner: number): void {
    this.rig.update(time);
    this.terrain?.animate(time);
    this.updatePoints(w, time);
    this.entities.update(w, alpha, time, dt, selection, this.rig);
    for (const lost of this.entities.lost) {
      this.effects.explosion(lost.x, 0, lost.z, 0.8);
      this.scars.wreck(lost.x, lost.z, lost.heading);
    }
    this.entities.lost.length = 0;
    this.updateFinale(time);
    this.effects.update(dt);
    this.scars.update(dt);
    this.air.update(dt);
    this.updateStrikes(w, owner, time);
    this.emitDamageSmoke(w, dt);

    if (this.pingLife > 0) {
      this.pingLife -= dt;
      const k = 0.5 + (1 - this.pingLife / 0.45) * 0.9;
      this.ping.scale.set(k, 1, k);
      this.ping.visible = this.pingLife > 0;
    }
    const player = w.players[owner];
    this.rally.position.set(player.rallyX / ONE, 1 + Math.sin(time * 3) * 0.1, player.rallyY / ONE);
    this.renderer.render(this.scene, this.rig.camera);
  }
}
