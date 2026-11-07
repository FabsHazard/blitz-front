import { canPlace } from '../sim/commands';
import { ABILITIES, BUILDINGS, type AbilityType, type BuildingType } from '../sim/data/defs';
import { ONE } from '../sim/fixed';
import type { Entity } from '../sim/types';
import type { GameView } from '../render/view';
import { entityHeight, entityPosition } from '../render/units';
import type { Hud } from '../ui/hud';
import type { Session } from '../game';

const TAP_SLOP = 12;
const LONG_PRESS_MS = 280;
const PICK_RADIUS = 38;
/** The ghost floats above the finger so it stays visible while dragging. */
const FINGER_OFFSET = 70;

interface Pointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export class Controls {
  private pointers = new Map<number, Pointer>();
  private pressTimer = 0;
  private boxing = false;
  private pinchDist = 0;
  private suppressTap = false;
  private placing: BuildingType | null = null;
  private placeCell: [number, number] | null = null;
  private aiming: AbilityType | null = null;
  private aimPoint: [number, number] | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private view: GameView,
    private hud: Hud,
    private session: () => Session | null,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      view.rig.zoomBy(e.deltaY > 0 ? 1.1 : 0.9);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onDown = (e: PointerEvent): void => {
    this.session()?.audio.unlock();
    if (e.button === 2) {
      this.order(e.clientX, e.clientY);
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false,
    });
    window.clearTimeout(this.pressTimer);

    if (this.pointers.size === 1) {
      this.suppressTap = false;
      if (e.shiftKey) this.startBox();
      else this.pressTimer = window.setTimeout(() => this.startBox(), LONG_PRESS_MS);
    } else {
      this.suppressTap = true;
      this.cancelBox();
      this.pinchDist = this.pinchSpan();
    }
  };

  private pinchSpan(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  private onMove = (e: PointerEvent): void => {
    if (this.aiming) {
      this.updateAim(e.clientX, e.clientY);
      return;
    }
    if (this.placing) {
      this.updatePlacement(e.clientX, e.clientY);
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const lastX = p.x;
    const lastY = p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_SLOP && !p.moved) {
      p.moved = true;
      window.clearTimeout(this.pressTimer);
    }

    if (this.pointers.size >= 2) {
      const span = this.pinchSpan();
      this.view.rig.zoomBy(this.pinchDist / span);
      this.pinchDist = span;
      this.view.rig.drag(lastX, lastY, p.x, p.y, this.view.width, this.view.height);
      return;
    }
    if (this.boxing) {
      this.drawBox(p);
    } else if (p.moved) {
      this.view.rig.drag(lastX, lastY, p.x, p.y, this.view.width, this.view.height);
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (this.aiming) {
      this.finishAim();
      return;
    }
    if (this.placing) {
      this.finishPlacement(e.clientY);
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    window.clearTimeout(this.pressTimer);
    if (this.boxing) {
      this.finishBox(p);
    } else if (!p.moved && !this.suppressTap) {
      this.tap(p.x, p.y);
    }
  };

  private onCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    window.clearTimeout(this.pressTimer);
    this.cancelBox();
    if (this.placing) this.endPlacement();
    if (this.aiming) this.endAim();
  };

  private startBox(): void {
    const p = [...this.pointers.values()][0];
    if (!p || p.moved) return;
    this.boxing = true;
    this.drawBox(p);
  }

  private cancelBox(): void {
    this.boxing = false;
    this.hud.box.hidden = true;
  }

  private drawBox(p: Pointer): void {
    const box = this.hud.box;
    box.hidden = false;
    box.style.left = `${Math.min(p.x, p.startX)}px`;
    box.style.top = `${Math.min(p.y, p.startY)}px`;
    box.style.width = `${Math.abs(p.x - p.startX)}px`;
    box.style.height = `${Math.abs(p.y - p.startY)}px`;
  }

  private screenOf(e: Entity, alpha: number): [number, number] {
    const [x, z] = entityPosition(e, alpha);
    return this.view.rig.toScreen(x, entityHeight(e), z, this.view.width, this.view.height);
  }

  private finishBox(p: Pointer): void {
    this.cancelBox();
    const s = this.session();
    if (!s) return;
    const left = Math.min(p.x, p.startX) - 12;
    const right = Math.max(p.x, p.startX) + 12;
    const top = Math.min(p.y, p.startY) - 12;
    const bottom = Math.max(p.y, p.startY) + 12;
    const inside = s.ownSquads().filter((e) => {
      const [x, y] = this.screenOf(e, 1);
      return x >= left && x <= right && y >= top && y <= bottom;
    });
    if (inside.length > 0) s.setSelection(inside.map((e) => e.id));
  }

  private pick(px: number, py: number, wanted: (e: Entity) => boolean): Entity | null {
    const s = this.session();
    if (!s) return null;
    let best: Entity | null = null;
    let bestDist = PICK_RADIUS;
    for (const e of s.world.entities) {
      if (!wanted(e)) continue;
      const [x, y] = this.screenOf(e, 1);
      const radius = e.isBuilding ? 28 * (40 / this.view.rig.dist) : 0;
      const d = Math.hypot(x - px, y - py) - radius;
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  private tap(px: number, py: number): void {
    const s = this.session();
    if (!s) return;
    const own = this.pick(px, py, (e) => e.owner === s.owner && !e.isBuilding && e.type !== 'truck');
    if (own) {
      s.setSelection([own.id]);
      return;
    }
    this.hud.hideUpgrade();
    if (s.selection.size === 0) {
      const mine = this.pick(px, py, (e) => e.owner === s.owner && e.isBuilding);
      if (mine && s.inspect(mine)) return;
    }
    this.order(px, py);
  }

  private order(px: number, py: number): void {
    const s = this.session();
    if (!s) return;
    const enemy = this.pick(px, py, (e) => e.owner !== s.owner);
    if (enemy) {
      if (s.selection.size > 0) {
        s.attack(enemy.id);
        const [x, z] = entityPosition(enemy, 1);
        this.view.showPing(x, z, '#ff6a5c');
      }
      return;
    }
    const g = this.view.rig.ground(px, py, this.view.width, this.view.height);
    if (!g || g.x < 0 || g.z < 0 || g.x > s.world.width || g.z > s.world.height) return;
    if (s.selection.size > 0) {
      s.moveSelection(g.x, g.z, 'amove');
      this.view.showPing(g.x, g.z, '#ffffff');
    } else {
      s.setRally(g.x, g.z);
      this.view.showPing(g.x, g.z, '#7dffb0');
    }
  }

  beginPlacement(type: BuildingType, x: number, y: number): void {
    const s = this.session();
    if (!s) return;
    if (s.world.players[s.owner].supplies < BUILDINGS[type].cost) {
      s.audio.play('deny');
      this.hud.toast('Faltan suministros');
      return;
    }
    s.audio.play('click');
    this.placing = type;
    this.placeCell = null;
    this.view.showValidCells(s.world, s.owner, type);
    this.updatePlacement(x, y);
  }

  private anchor(type: BuildingType, gx: number, gz: number): [number, number] {
    const s = this.session()!;
    const def = BUILDINGS[type];
    if (type === 'refinery') {
      let best: [number, number] | null = null;
      let bestD = 16;
      for (const d of s.world.deposits) {
        const dist = (d.cx + 1 - gx) ** 2 + (d.cy + 1 - gz) ** 2;
        if (dist < bestD) {
          bestD = dist;
          best = [d.cx, d.cy];
        }
      }
      if (best) return best;
    }
    return [Math.round(gx - def.w / 2), Math.round(gz - def.h / 2)];
  }

  private updatePlacement(px: number, py: number): void {
    const s = this.session();
    const type = this.placing;
    if (!s || !type) return;
    if (this.hud.isOverBar(py)) {
      this.placeCell = null;
      this.view.showGhost(type, -99, -99, false);
      return;
    }
    const g = this.view.rig.ground(px, py - FINGER_OFFSET, this.view.width, this.view.height);
    if (!g) return;
    const [cx, cy] = this.anchor(type, g.x, g.z);
    this.placeCell = [cx, cy];
    this.view.showGhost(type, cx, cy, canPlace(s.world, s.owner, type, cx, cy));
  }

  private finishPlacement(py: number): void {
    const s = this.session();
    const type = this.placing;
    const cell = this.placeCell;
    this.endPlacement();
    if (!s || !type) return;
    if (!cell || this.hud.isOverBar(py)) {
      this.hud.toast('Arrastra el edificio al mapa');
      return;
    }
    if (!canPlace(s.world, s.owner, type, cell[0], cell[1])) {
      s.audio.play('deny');
      this.hud.toast(type === 'refinery' ? 'Colócala sobre un yacimiento' : 'Ahí no se puede construir');
      return;
    }
    s.build(type, cell[0], cell[1]);
    this.view.showPing(cell[0] + BUILDINGS[type].w / 2, cell[1] + BUILDINGS[type].h / 2, '#7dffb0');
  }

  private endPlacement(): void {
    this.placing = null;
    this.placeCell = null;
    this.view.hideValidCells();
  }

  beginAbility(kind: AbilityType, x: number, y: number): void {
    const s = this.session();
    if (!s) return;
    s.audio.unlock();
    if (s.world.players[s.owner].cooldowns[kind] > 0) {
      s.audio.play('deny');
      return;
    }
    s.audio.play('click');
    this.aiming = kind;
    this.aimPoint = null;
    this.updateAim(x, y);
  }

  private updateAim(px: number, py: number): void {
    const s = this.session();
    const kind = this.aiming;
    if (!s || !kind) return;
    this.aimPoint = null;
    this.view.hideAim();
    if (this.hud.isOverControls(px, py)) return;
    const g = this.view.rig.ground(px, py - FINGER_OFFSET, this.view.width, this.view.height);
    if (!g || g.x < 0 || g.z < 0 || g.x >= s.world.width || g.z >= s.world.height) return;
    this.aimPoint = [g.x, g.z];
    const def = ABILITIES[kind];
    this.view.showAim(g.x, g.z, def.area / ONE, def.friendly ? '#7dffb0' : kind === 'emp' ? '#7fd8ff' : '#ffd65c');
  }

  private finishAim(): void {
    const s = this.session();
    const kind = this.aiming;
    const point = this.aimPoint;
    this.endAim();
    if (!s || !kind) return;
    if (!point) {
      this.hud.toast('Arrastra la habilidad al mapa');
      return;
    }
    s.ability(kind, point[0], point[1]);
    this.view.showPing(point[0], point[1], '#ffd65c');
  }

  private endAim(): void {
    this.aiming = null;
    this.aimPoint = null;
    this.view.hideAim();
  }

  /** Puts the camera over a minimap position given as fractions of the map. */
  jumpTo(fx: number, fz: number): void {
    const s = this.session();
    if (s) this.view.rig.focus(fx * s.world.width, fz * s.world.height);
  }
}
