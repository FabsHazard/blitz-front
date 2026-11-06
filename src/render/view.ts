import * as THREE from 'three';
import { canPlace } from '../sim/commands';
import { ABILITIES, BALANCE, BUILDINGS, type BuildingType } from '../sim/data/defs';
import { ONE, TICK_RATE, fx } from '../sim/fixed';
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
    this.buildPoints(w);
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

  /** Points the view at a new match. The map is fixed, so the scenery is reused. */
  bind(w: World, owner: number): void {
    this.entities.reset();
    this.scars.reset();
    this.air.reset();
    if (!this.terrain) {
      this.terrain = buildTerrain(w);
      this.scene.add(this.terrain.group);
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

  showAim(x: number, z: number, radius: number): void {
    this.aim.visible = true;
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
      if (count >= 8) break;
      const radius = (s.kind === 'airstrike' ? ABILITIES.airstrike.radius
        : s.kind === 'artillery' ? fx(4.5) : ABILITIES.paradrop.radius) / ONE;
      const pulse = 1 + Math.sin(time * 16) * 0.05;
      m.makeScale(radius * pulse, 1, radius * pulse);
      m.setPosition(s.x / ONE, 0.24, s.y / ONE);
      this.strikeMarks.setMatrixAt(count, m);
      this.strikeMarks.setColorAt(count, color.set(s.owner === owner ? '#7dffb0' : '#ff4d3d'));
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
          const by = (to ? entityHeight(to) : 0) + 0.3;
          const heavy = ev.type === 'tank' || ev.type === 'antitank' || ev.type === 'heli';
          this.entities.recoil(ev.from);
          this.effects.shot(ax, entityHeight(from) + 0.45, az, ev.x / ONE, by, ev.y / ONE, heavy ? 0.1 : 0.05);
          break;
        }
        case 'hit': {
          const target = w.byId.get(ev.id);
          this.entities.flash(ev.id);
          this.effects.hit(ev.x / ONE, target ? entityHeight(target) : 0, ev.y / ONE);
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
          if (ev.kind !== 'artillery') this.air.flyby(ev.owner, ev.x / ONE, ev.y / ONE, ev.delay / TICK_RATE);
          if (ev.kind === 'paradrop') this.air.parachutes(ev.x / ONE, ev.y / ONE, ev.delay / TICK_RATE);
          break;
        case 'blast':
          this.effects.explosion(ev.x / ONE, 0, ev.y / ONE, ev.kind === 'airstrike' ? 3.4 : 1.5);
          this.scars.crater(ev.x / ONE, ev.y / ONE, (ev.radius / ONE) * 0.8);
          this.rig.shake(ev.kind === 'airstrike' ? 0.5 : 0.2, now);
          break;
        default:
          break;
      }
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
