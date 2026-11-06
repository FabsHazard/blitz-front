import { Bot, PROFILES, type Difficulty } from './ai/bot';
import type { Lockstep } from './net/lockstep';
import type { Command } from './sim/commands';
import {
  BALANCE, BUILDINGS, type AbilityType, type BuildingType, type UnitType,
} from './sim/data/defs';
import { TICK_RATE, fx } from './sim/fixed';
import { findHq } from './sim/systems/economy';
import type { Entity, World } from './sim/types';
import { createWorld, step } from './sim/world';
import type { GameView } from './render/view';
import { buzz, type GameAudio } from './ui/audio';
import type { Hud } from './ui/hud';

const STEP = 1 / TICK_RATE;
const HUD_PERIOD = 0.16;
/** How long the other player can stall the game before the screen says so. */
const WAIT_NOTICE_SECONDS = 1.2;
const WAIT_LIMIT_SECONDS = 45;

export type MatchSetup =
  | { kind: 'bot'; difficulty: Difficulty; seed: number; demo: boolean }
  | { kind: 'online'; seed: number; owner: number; net: Lockstep };

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
      this.world = createWorld({ seed: setup.seed });
    } else {
      const { difficulty, seed, demo } = setup;
      const mult = PROFILES[difficulty].incomeMult;
      this.owner = 0;
      this.world = createWorld({ seed, incomeMult: [demo ? mult : 100, mult] });
      this.bots = [new Bot(1, difficulty, seed + 1)];
      if (demo) this.bots.push(new Bot(0, difficulty, seed + 2));
    }
    view.bind(this.world, this.owner);
    hud.reset(this.owner, thumbs);
  }

  private send(c: Command): void {
    if (this.net) this.net.issue(c);
    else this.pending.push(c);
  }

  abort(reason: string): void {
    if (this.aborted || this.world.winner !== -1) return;
    this.aborted = true;
    this.hud.setWaiting(false);
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

  ability(kind: AbilityType, x: number, z: number): void {
    this.send({ t: 'ability', p: this.owner, a: kind, x: fx(x), y: fx(z) });
    buzz(25);
  }

  private playSounds(): void {
    const w = this.world;
    for (const ev of w.events) {
      switch (ev.k) {
        case 'shot':
          this.audio.play(ev.type === 'infantry' ? 'rifle' : 'cannon');
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
            this.audio.play('bigBoom');
            buzz(60);
          } else {
            this.audio.play('boom');
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
        case 'strike':
          if (ev.kind !== 'artillery') this.audio.play('jet');
          if (ev.owner !== this.owner) {
            this.audio.play('alert');
            this.hud.toast('¡Ataque enemigo en camino!');
          }
          break;
        case 'blast':
          this.audio.play(ev.kind === 'airstrike' ? 'bigBoom' : 'boom');
          buzz(ev.kind === 'airstrike' ? 80 : 30);
          break;
        default:
          break;
      }
    }
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
    if (w.winner !== -1) this.events.onEnd(this);
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
