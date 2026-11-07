import { Bot, PROFILES, botLoadout, type Difficulty } from './ai/bot';
import type { Lockstep } from './net/lockstep';
import type { Command } from './sim/commands';
import {
  BALANCE, BUILDINGS, UPGRADES, upgradeFor,
  type AbilityType, type BuildingType, type UnitType, type UpgradeType,
} from './sim/data/defs';
import { ONE, TICK_RATE, fx } from './sim/fixed';
import { findHq } from './sim/systems/economy';
import type { Entity, MapId, World } from './sim/types';
import { createWorld, step } from './sim/world';
import type { GameView } from './render/view';
import { buzz, type GameAudio, type Sound } from './ui/audio';
import type { Hud } from './ui/hud';

const STEP = 1 / TICK_RATE;
const HUD_PERIOD = 0.16;
/** How long the other player can stall the game before the screen says so. */
const WAIT_NOTICE_SECONDS = 1.2;
const WAIT_LIMIT_SECONDS = 45;

export type MatchSetup =
  | { kind: 'bot'; difficulty: Difficulty; seed: number; demo: boolean; map: MapId; loadout: AbilityType[] }
  | { kind: 'online'; seed: number; owner: number; net: Lockstep; map: MapId; loadouts: [AbilityType[], AbilityType[]] };

/** Seconds the camera spends on the fallen base before the results appear. */
export const FINALE_SECONDS = 3.2;

const SHOT_SOUND: Partial<Record<string, Sound>> = {
  infantry: 'rifle', antitank: 'rocket', tank: 'cannon', heli: 'mg', turret: 'mg',
};

export interface SessionEvents {
  onEnd(session: Session): void;
  onAbort(reason: string): void;
}

/** One match. Input turns into commands here; the world only changes in step(). */
export class Session {
  readonly world: World;
  readonly owner: number;
  readonly selection = new Set<number>();
  private bots: Bot[] = [];
  private net: Lockstep | null = null;
  private waited = 0;
  private aborted = false;
  private pending: Command[] = [];
  private accumulator = 0;
  private hudClock = 0;
  private lastAttackAlert = -99;
  private heat = 0;
  private hqPositions: [number, number][] = [];

  constructor(
    private view: GameView,
    private hud: Hud,
    readonly audio: GameAudio,
    setup: MatchSetup,
    thumbs: Map<string, string>,
    private events: SessionEvents,
  ) {
    if (setup.kind === 'online') {
      this.owner = setup.owner;
      this.net = setup.net;
      this.world = createWorld({ seed: setup.seed, map: setup.map, loadouts: setup.loadouts });
    } else {
      const { difficulty, seed, demo, map } = setup;
      const mult = PROFILES[difficulty].incomeMult;
      this.owner = 0;
      const mine = demo ? botLoadout(seed + 8) : setup.loadout;
      this.world = createWorld({
        seed, map, incomeMult: [demo ? mult : 100, mult], loadouts: [mine, botLoadout(seed + 7)],
      });
      this.bots = [new Bot(1, difficulty, seed + 1)];
      if (demo) this.bots.push(new Bot(0, difficulty, seed + 2));
    }
    for (let owner = 0; owner < 2; owner++) {
      const hq = findHq(this.world, owner)!;
      this.hqPositions.push([hq.x / ONE, hq.y / ONE]);
    }
    view.bind(this.world, this.owner);
    hud.reset(this.owner, thumbs, this.world.players[this.owner].loadout);
    audio.startMusic(1);
  }

  private send(c: Command): void {
    if (this.net) this.net.issue(c);
    else this.pending.push(c);
  }

  abort(reason: string): void {
    if (this.aborted || this.world.winner !== -1) return;
    this.aborted = true;
    this.hud.setWaiting(false);
    this.audio.stopMusic();
    this.events.onAbort(reason);
  }

  ownSquads(): Entity[] {
    return this.world.entities.filter((e) =>
      e.owner === this.owner && !e.isBuilding && e.type !== 'truck');
  }

  setSelection(ids: number[]): void {
    this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.audio.play('click');
    buzz(8);
  }

  clearSelection(): void {
    this.selection.clear();
  }

  selectAll(): void {
    this.setSelection(this.ownSquads().map((e) => e.id));
  }

  moveSelection(x: number, z: number, mode: 'move' | 'amove'): void {
    this.send({ t: 'move', p: this.owner, ids: [...this.selection], x: fx(x), y: fx(z), mode });
    this.audio.play('click');
  }

  attack(target: number): void {
    this.send({ t: 'attack', p: this.owner, ids: [...this.selection], target });
    this.audio.play('click');
  }

  setRally(x: number, z: number): void {
    this.send({ t: 'rally', p: this.owner, x: fx(x), y: fx(z) });
    this.hud.toast('Punto de reunión');
  }

  retreat(): void {
    const hq = findHq(this.world, this.owner);
    if (!hq) return;
    const x = hq.x + fx(this.owner === 0 ? 5 : -5);
    this.send({ t: 'move', p: this.owner, ids: [...this.selection], x, y: hq.y, mode: 'move' });
    this.audio.play('click');
  }

  train(unit: UnitType): void {
    this.send({ t: 'train', p: this.owner, unit });
    this.audio.play('click');
  }

  build(type: BuildingType, cx: number, cy: number): void {
    this.send({ t: 'build', p: this.owner, b: type, cx, cy });
    this.audio.play('done');
    buzz(15);
  }

  upgrade(u: UpgradeType): void {
    this.send({ t: 'upgrade', p: this.owner, u });
    this.audio.play('click');
  }

  /** A tap on one of your own buildings offers its upgrade, if it has one. */
  inspect(building: Entity): boolean {
    const u = upgradeFor(building.type as BuildingType);
    if (!u || building.building > 0) return false;
    this.hud.showUpgrade(u);
    this.audio.play('click');
    return true;
  }

  ability(kind: AbilityType, x: number, z: number): void {
    this.send({ t: 'ability', p: this.owner, a: kind, x: fx(x), y: fx(z) });
    buzz(25);
  }

  /** Fights far from the camera sound quieter. */
  private volumeAt(x: number, y: number): number {
    const rig = this.view.rig;
    const d = Math.hypot(x / ONE - rig.target.x, y / ONE - rig.target.y);
    const near = 10 + rig.dist * 0.35;
    return d <= near ? 1 : 1 / (1 + ((d - near) / 9) ** 2);
  }

  private playSounds(): void {
    const w = this.world;
    for (const ev of w.events) {
      switch (ev.k) {
        case 'shot':
          this.heat += 1;
          this.audio.play(SHOT_SOUND[ev.type] ?? 'cannon', this.volumeAt(ev.x, ev.y));
          break;
        case 'hit': {
          const target = w.byId.get(ev.id);
          const seconds = w.tick / TICK_RATE;
          if (target?.owner === this.owner && target.isBuilding && seconds - this.lastAttackAlert > 12) {
            this.lastAttackAlert = seconds;
            this.audio.play('alert');
            this.hud.toast('¡Base bajo ataque!');
          }
          break;
        }
        case 'death':
          if (ev.type in BUILDINGS) {
            this.audio.play('bigBoom', this.volumeAt(ev.x, ev.y) + 0.3);
            if (ev.owner === this.owner) buzz(60);
          } else {
            this.audio.play('boom', this.volumeAt(ev.x, ev.y));
          }
          break;
        case 'capture':
          this.audio.play('capture');
          if (ev.owner === this.owner) this.hud.noteCaptured();
          this.hud.toast(ev.owner === this.owner ? 'Punto capturado' : 'Punto perdido');
          break;
        case 'suddenDeath':
          this.audio.play('alert');
          this.hud.toast('¡Muerte súbita!');
          break;
        case 'built':
          if (ev.owner === this.owner) this.audio.play('done');
          break;
        case 'spawn':
          if (ev.owner === this.owner) this.audio.play('ready', 0.8);
          break;
        case 'researched':
          if (ev.owner === this.owner) {
            this.audio.play('upgrade');
            this.hud.toast(`Mejora lista: ${UPGRADES[ev.upgrade].name}`);
          }
          break;
        case 'strike':
          if (ev.kind === 'artillery') this.audio.play('whistle');
          else if (ev.kind === 'airstrike') this.audio.play('jet');
          else if (ev.kind === 'paradrop' || ev.kind === 'armor') {
            this.audio.play('jet', 0.6);
            this.audio.play('drop');
          }
          if (ev.owner !== this.owner && ev.kind !== 'repair') {
            this.audio.play('alert');
            this.hud.toast(ev.kind === 'paradrop' || ev.kind === 'armor'
              ? '¡Refuerzos enemigos en camino!' : '¡Ataque enemigo en camino!');
          }
          break;
        case 'blast':
          if (ev.kind === 'emp') this.audio.play('zap');
          else if (ev.kind === 'repair') this.audio.play('heal');
          else {
            this.audio.play(ev.kind === 'airstrike' ? 'bigBoom' : 'boom', this.volumeAt(ev.x, ev.y) + 0.3);
            buzz(ev.kind === 'airstrike' ? 80 : 30);
          }
          break;
        default:
          break;
      }
    }
  }

  private updateMusic(dt: number): void {
    this.heat *= Math.exp(-dt / 3);
    this.audio.setIntensity(this.world.suddenDeath ? 3 : this.heat > 10 ? 2 : 1);
  }

  /** The camera flies to the base that fell while the result is announced. */
  private beginFinale(now: number): void {
    const w = this.world;
    const won = w.winner === this.owner;
    const loser = w.winner === 2 ? this.owner : 1 - w.winner;
    const [x, z] = this.hqPositions[loser];
    this.view.playFinale(x, z, won, w.winner, now);
    this.hud.showFinale(w.winner === 2 ? 'EMPATE' : won ? '¡VICTORIA!' : 'DERROTA', won);
    if (!won) document.body.classList.add('lost');
    this.selection.clear();
    this.audio.stopMusic();
    this.audio.play(won ? 'victory' : 'defeat');
    buzz(won ? 120 : 250);
  }

  /** Advances one tick; false means the other player's commands have not arrived. */
  private tick(now: number): boolean {
    const w = this.world;
    let commands: Command[];
    if (this.net) {
      const turn = this.net.next(w);
      if (!turn) return false;
      commands = turn;
      if (this.net.desynced) this.abort('La partida se desincronizó.');
    } else {
      commands = this.pending;
      this.pending = [];
      for (const bot of this.bots) commands.push(...bot.think(w));
    }
    step(w, commands);
    this.view.handleEvents(w, w.events, 1, now);
    this.playSounds();
    for (const id of this.selection) if (!w.byId.has(id)) this.selection.delete(id);
    if (w.winner !== -1) {
      this.beginFinale(now);
      this.events.onEnd(this);
    }
    return true;
  }

  private noteWait(dt: number, stalled: boolean): void {
    this.waited = stalled ? this.waited + dt : 0;
    this.hud.setWaiting(this.waited > WAIT_NOTICE_SECONDS);
    if (this.waited > WAIT_LIMIT_SECONDS) this.abort('El rival dejó de responder.');
  }

  frame(dt: number, now: number): void {
    const w = this.world;
    if (w.winner === -1 && !this.aborted) {
      this.accumulator += dt;
      let stalled = false;
      while (this.accumulator >= STEP && w.winner === -1) {
        if (!this.tick(now)) {
          stalled = true;
          this.accumulator = STEP;
          break;
        }
        this.accumulator -= STEP;
      }
      this.noteWait(dt, stalled);
      this.updateMusic(dt);
    }
    this.view.render(w, Math.min(1, this.accumulator / STEP), now, dt, this.selection, this.owner);

    this.hudClock += dt;
    if (this.hudClock >= HUD_PERIOD) {
      this.hudClock = 0;
      const rig = this.view.rig;
      this.hud.update(w, this.owner, this.selection.size);
      this.hud.drawMinimap(w, rig.target.x, rig.target.y, rig.dist);
    }
  }

  /** Explains how the match ended, for the results screen. */
  endReason(): string {
    const w = this.world;
    if (w.winner === 2) return 'Ambos Cuarteles cayeron a la vez.';
    if (w.holdTicks >= BALANCE.holdToWinTicks) {
      return w.winner === this.owner ? 'Dominaste los 3 puntos.' : 'El enemigo dominó los 3 puntos.';
    }
    return w.winner === this.owner ? 'Cuartel General enemigo destruido.' : 'Tu Cuartel General fue destruido.';
  }
}
