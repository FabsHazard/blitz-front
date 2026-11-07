import {
  ABILITIES, BALANCE, BUILDINGS, UNITS, UPGRADES,
  type AbilityType, type BuildingType, type UnitType, type UpgradeType,
} from '../sim/data/defs';
import { canResearchAt } from '../sim/systems/research';
import type { SoundMode } from './audio';
import { ONE, TICK_RATE } from '../sim/fixed';
import { incomePerSecond } from '../sim/systems/economy';
import { squadCount } from '../sim/systems/production';
import { Terrain, type World } from '../sim/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TRAIN: UnitType[] = ['infantry', 'antitank', 'tank', 'heli'];
const BUILD: BuildingType[] = ['barracks', 'refinery', 'factory', 'helipad', 'turret'];
const SOUND_LABELS: Record<SoundMode, string> = { all: 'Sonido', sfx: 'Sin música', none: 'Silencio' };

interface Slot {
  root: HTMLButtonElement;
  count?: HTMLElement;
  progress?: HTMLElement;
}

function slot(key: string, name: string, cost: number, thumb: string | undefined, unit: boolean): Slot {
  const root = document.createElement('button');
  root.className = unit ? 'slot unit' : 'slot';
  root.dataset.key = key;
  root.innerHTML = `<img alt="" src="${thumb ?? ''}"><span class="name">${name}</span><span class="cost">${cost}</span>`;
  return { root };
}

export interface HudActions {
  train(unit: UnitType): void;
  beginPlacement(type: BuildingType, x: number, y: number): void;
  beginAbility(kind: AbilityType, x: number, y: number): void;
  selectAll(): void;
  retreat(): void;
  clearSelection(): void;
  toggleMute(): SoundMode;
  jumpTo(x: number, z: number): void;
  upgrade(u: UpgradeType): void;
}

export class Hud {
  private supplies = $('supplies');
  private income = $('income');
  private timer = $('timer');
  private clockLabel = $('clock-label');
  private clock = $('clock');
  private pips = Array.from($('pips').children) as HTMLElement[];
  private squads = $('squad-count');
  private banner = $('banner');
  private toastEl = $('toast');
  private hintEl = $('hint');
  private minimap = $<HTMLCanvasElement>('minimap');
  private mapCtx = this.minimap.getContext('2d')!;
  private background: HTMLCanvasElement | null = null;
  private trainSlots = new Map<UnitType, Slot>();
  private buildSlots = new Map<BuildingType, Slot>();
  private toastTimer = 0;
  readonly bar = $('bar');
  readonly perf = $('perf');
  readonly box = $('box');
  private retreat = $<HTMLButtonElement>('btn-retreat');
  private clear = $<HTMLButtonElement>('btn-clear');
  private hasCaptured = false;
  private powers = new Map<AbilityType, { root: HTMLButtonElement; fill: HTMLElement; time: HTMLElement }>();
  private wasUnderdog = false;
  private flipped = false;
  private waiting = $('waiting');
  private upgradePanel = $('upgrade');
  private upgradeButton = $<HTMLButtonElement>('upgrade-buy');
  private upgradeShown: UpgradeType | null = null;
  private finale = $('finale');

  constructor(thumbs: Map<string, string>, private actions: HudActions) {
    for (const type of TRAIN) {
      const s = slot(type, UNITS[type].name, UNITS[type].cost, thumbs.get(type), true);
      s.count = document.createElement('span');
      s.count.className = 'count';
      s.count.hidden = true;
      s.progress = document.createElement('span');
      s.progress.className = 'progress';
      s.root.append(s.count, s.progress);
      s.root.addEventListener('click', () => actions.train(type));
      this.trainSlots.set(type, s);
      this.bar.append(s.root);
    }
    const sep = document.createElement('span');
    sep.className = 'sep';
    this.bar.append(sep);
    for (const type of BUILD) {
      const s = slot(type, BUILDINGS[type].name, BUILDINGS[type].cost, thumbs.get(type), false);
      s.root.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
        actions.beginPlacement(type, ev.clientX, ev.clientY);
      });
      this.buildSlots.set(type, s);
      this.bar.append(s.root);
    }

    this.upgradeButton.addEventListener('click', () => {
      if (this.upgradeShown) actions.upgrade(this.upgradeShown);
    });
    $('upgrade-close').addEventListener('click', () => this.hideUpgrade());

    $('btn-all').addEventListener('click', actions.selectAll);
    this.retreat.addEventListener('click', actions.retreat);
    this.clear.addEventListener('click', actions.clearSelection);
    const mute = $('btn-mute');
    mute.addEventListener('click', () => {
      const mode = actions.toggleMute();
      mute.textContent = SOUND_LABELS[mode];
      mute.classList.toggle('off', mode === 'none');
    });

    const jump = (ev: PointerEvent) => {
      const r = this.minimap.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width;
      const y = (ev.clientY - r.top) / r.height;
      actions.jumpTo(this.flipped ? 1 - x : x, this.flipped ? 1 - y : y);
    };
    this.minimap.addEventListener('pointerdown', jump);
    this.minimap.addEventListener('pointermove', (ev) => { if (ev.buttons || ev.pointerType === 'touch') jump(ev); });
  }

  isOverBar(y: number): boolean {
    return y >= this.bar.getBoundingClientRect().top;
  }

  isOverControls(x: number, y: number): boolean {
    const r = $('abilities').getBoundingClientRect();
    return this.isOverBar(y) || (x <= r.right && y >= r.top);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1500);
  }

  noteCaptured(): void {
    this.hasCaptured = true;
  }

  private buildPowers(loadout: AbilityType[]): void {
    const box = $('abilities');
    box.replaceChildren();
    this.powers.clear();
    for (const kind of loadout) {
      const root = document.createElement('button');
      root.className = 'power';
      root.innerHTML = `<span class="fill"></span><span class="label">${ABILITIES[kind].name}</span><span class="time"></span>`;
      root.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        root.releasePointerCapture?.(ev.pointerId);
        this.actions.beginAbility(kind, ev.clientX, ev.clientY);
      });
      box.append(root);
      this.powers.set(kind, {
        root,
        fill: root.querySelector('.fill') as HTMLElement,
        time: root.querySelector('.time') as HTMLElement,
      });
    }
  }

  showUpgrade(u: UpgradeType): void {
    this.upgradeShown = u;
    this.upgradePanel.hidden = false;
    $('upgrade-name').textContent = UPGRADES[u].name;
    $('upgrade-blurb').textContent = UPGRADES[u].blurb;
  }

  hideUpgrade(): void {
    this.upgradeShown = null;
    this.upgradePanel.hidden = true;
  }

  private updateUpgrade(w: World, owner: number): void {
    const u = this.upgradeShown;
    if (!u) return;
    const state = w.players[owner].research[u];
    const def = UPGRADES[u];
    const b = this.upgradeButton;
    if (state === -1) {
      b.textContent = 'Mejorado';
      b.disabled = true;
    } else if (state > 0) {
      b.textContent = `Investigando ${Math.round((1 - state / def.ticks) * 100)}%`;
      b.disabled = true;
    } else {
      b.textContent = `Mejorar · ${def.cost}`;
      b.disabled = w.players[owner].supplies < def.cost || !canResearchAt(w, owner, u);
    }
  }

  showFinale(text: string, good: boolean): void {
    this.finale.textContent = text;
    this.finale.className = good ? 'good' : 'bad';
    this.finale.hidden = false;
    document.body.classList.add('ending');
  }

  hideFinale(): void {
    this.finale.hidden = true;
    document.body.classList.remove('ending', 'lost');
  }

  reset(owner: number, thumbs: Map<string, string>, loadout: AbilityType[]): void {
    this.buildPowers(loadout);
    this.hideUpgrade();
    this.hideFinale();
    this.hasCaptured = false;
    this.background = null;
    this.wasUnderdog = false;
    this.flipped = owner === 1;
    this.setWaiting(false);
    for (const [key, thumb] of thumbs) {
      const img = this.bar.querySelector<HTMLImageElement>(`[data-key="${key}"] img`);
      if (img) img.src = thumb;
    }
  }

  setWaiting(waiting: boolean): void {
    this.waiting.hidden = !waiting;
  }

  private buildBackground(w: World): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = w.width;
    canvas.height = w.height;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < w.height; y++) {
      for (let x = 0; x < w.width; x++) {
        const t = w.terrain[y * w.width + x];
        ctx.fillStyle = t === Terrain.Water ? '#4fbfe0' : t === Terrain.Rock ? '#868c94'
          : t === Terrain.Tree ? '#4f9c52' : t === Terrain.Bridge ? '#a98a63' : '#8fcf6d';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return canvas;
  }

  drawMinimap(w: World, camX: number, camZ: number, camDist: number): void {
    const ctx = this.mapCtx;
    const c = this.minimap;
    this.background ??= this.buildBackground(w);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.flipped) ctx.setTransform(-1, 0, 0, -1, c.width, c.height);
    ctx.drawImage(this.background, 0, 0, c.width, c.height);
    const sx = c.width / (w.width * ONE);
    const sy = c.height / (w.height * ONE);
    for (const p of w.points) {
      ctx.fillStyle = p.owner === 0 ? '#3f86e0' : p.owner === 1 ? '#e8603c' : '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, 7, 0, 6.3);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    for (const e of w.entities) {
      ctx.fillStyle = e.owner === 0 ? '#1f5fd0' : '#d8341a';
      const size = e.isBuilding ? 9 : 6;
      ctx.fillRect(e.x * sx - size / 2, e.y * sy - size / 2, size, size);
    }
    const viewW = camDist * 1.1 * (c.width / w.width);
    const viewH = camDist * 0.6 * (c.height / w.height);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(camX * (c.width / w.width) - viewW / 2, camZ * (c.height / w.height) - viewH / 2, viewW, viewH);
  }

  private updateTrain(w: World, owner: number, money: number, capped: boolean): void {
    for (const [type, s] of this.trainSlots) {
      const def = UNITS[type];
      const producers = w.entities.filter((e) => e.owner === owner && e.type === def.producer && e.building === 0);
      s.root.classList.toggle('locked', producers.length === 0);
      s.root.classList.toggle('poor', money < def.cost || capped);
      let queued = 0;
      let best = 0;
      for (const b of producers) {
        queued += b.queue.filter((q) => q === type).length;
        if (b.queue[0] === type) best = Math.max(best, b.queueProgress / def.buildTicks);
      }
      s.count!.hidden = queued === 0;
      s.count!.textContent = String(queued);
      s.progress!.style.width = `${best * 100}%`;
    }
  }

  private updatePowers(w: World, owner: number): void {
    const cooldowns = w.players[owner].cooldowns;
    for (const [kind, p] of this.powers) {
      const left = cooldowns[kind];
      const ready = left === 0;
      p.root.classList.toggle('ready', ready);
      p.fill.style.height = `${(left / ABILITIES[kind].cooldown) * 100}%`;
      p.time.textContent = ready ? '' : String(Math.ceil(left / TICK_RATE));
    }
  }

  private updateHint(w: World, owner: number): void {
    const mine = w.entities.filter((e) => e.owner === owner);
    let text = '';
    if (!this.hasCaptured && w.tick < TICK_RATE * 150) {
      if (!mine.some((e) => e.type === 'barracks')) text = 'Arrastra Barracas al terreno verde';
      else if (!mine.some((e) => e.type === 'infantry' || e.type === 'antitank')) text = 'Toca Infantería para entrenar';
      else text = 'Toca Todos y luego una bandera';
    }
    this.hintEl.hidden = text === '';
    this.hintEl.textContent = text;
  }

  update(w: World, owner: number, selected: number): void {
    const player = w.players[owner];
    this.supplies.textContent = String(player.supplies);
    this.income.textContent = `+${Math.trunc(incomePerSecond(w, owner) * player.incomeMult / 100)}/s`;
    this.income.classList.toggle('boost', player.underdog);
    if (player.underdog && !this.wasUnderdog) this.toast('¡Refuerzos de emergencia!');
    this.wasUnderdog = player.underdog;
    this.updatePowers(w, owner);
    this.updateUpgrade(w, owner);

    const left = Math.max(0, BALANCE.suddenDeathTick - w.tick);
    const seconds = Math.ceil(left / TICK_RATE);
    this.timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    this.clockLabel.textContent = w.suddenDeath ? '¡Muerte súbita!' : 'Muerte súbita';
    this.clock.classList.toggle('danger', w.suddenDeath || seconds <= 30);

    w.points.forEach((p, i) => {
      this.pips[i].className = `${p.owner === -1 ? '' : `p${p.owner}`}${p.contested ? ' fight' : ''}`;
    });

    const squads = squadCount(w, owner);
    this.squads.textContent = `${squads}/${BALANCE.maxSquads}`;
    this.updateTrain(w, owner, player.supplies, squads >= BALANCE.maxSquads);

    for (const [type, s] of this.buildSlots) {
      s.root.classList.toggle('poor', player.supplies < BUILDINGS[type].cost);
    }

    if (w.holdOwner !== -1) {
      const remaining = Math.ceil((BALANCE.holdToWinTicks - w.holdTicks) / TICK_RATE);
      this.banner.hidden = false;
      this.banner.classList.toggle('good', w.holdOwner === owner);
      this.banner.textContent = w.holdOwner === owner
        ? `Dominas el mapa: victoria en ${remaining}s`
        : `¡El enemigo domina el mapa! Derrota en ${remaining}s`;
    } else {
      this.banner.hidden = true;
    }

    this.retreat.disabled = selected === 0;
    this.clear.disabled = selected === 0;
    this.updateHint(w, owner);
  }
}
