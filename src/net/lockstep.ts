import { isValidCommand, type Command } from '../sim/commands';
import type { World } from '../sim/types';
import { hashState } from '../sim/world';

export const TICKS_PER_TURN = 3;
/** Commands run this many turns after being issued (400 ms), hiding network latency. */
export const INPUT_DELAY = 2;
const HASH_EVERY_TURNS = 5;

export interface TurnMessage {
  k: 'turn';
  turn: number;
  cmds: Command[];
  hashTurn?: number;
  hash?: number;
}

/**
 * Keeps two peers on the same simulation by exchanging only commands. The
 * world advances past a turn boundary once both sides' commands for that turn
 * are known, so a slow peer pauses the game instead of diverging from it.
 */
export class Lockstep {
  private queue: Command[] = [];
  private own = new Map<number, Command[]>();
  private remote = new Map<number, Command[]>();
  private ownHashes = new Map<number, number>();
  private remoteHashes = new Map<number, number>();
  desynced = false;

  constructor(
    private readonly me: number,
    private readonly send: (message: TurnMessage) => void,
  ) {}

  issue(command: Command): void {
    this.queue.push(command);
  }

  receive(message: TurnMessage): void {
    const safe = Array.isArray(message.cmds) ? message.cmds : [];
    // The sender can only ever act as the other player, whatever `p` it claims.
    const other = 1 - this.me;
    this.remote.set(
      message.turn,
      safe.filter(isValidCommand).map((c) => ({ ...c, p: other })),
    );
    if (message.hashTurn !== undefined && message.hash !== undefined) {
      this.remoteHashes.set(message.hashTurn, message.hash);
      this.compareHash(message.hashTurn);
    }
  }

  private compareHash(turn: number): void {
    const mine = this.ownHashes.get(turn);
    const theirs = this.remoteHashes.get(turn);
    if (mine === undefined || theirs === undefined) return;
    if (mine !== theirs) this.desynced = true;
    this.ownHashes.delete(turn);
    this.remoteHashes.delete(turn);
  }

  /** Commands for the next tick, or null when it must wait for the other peer. */
  next(w: World): Command[] | null {
    if (w.tick % TICKS_PER_TURN !== 0) return [];
    const turn = w.tick / TICKS_PER_TURN;
    const theirs = turn < INPUT_DELAY ? [] : this.remote.get(turn);
    if (!theirs) return null;
    const mine = this.own.get(turn) ?? [];

    const message: TurnMessage = { k: 'turn', turn: turn + INPUT_DELAY, cmds: this.queue };
    if (turn % HASH_EVERY_TURNS === 0) {
      const hash = hashState(w);
      this.ownHashes.set(turn, hash);
      message.hashTurn = turn;
      message.hash = hash;
      this.compareHash(turn);
    }
    this.own.set(turn + INPUT_DELAY, this.queue);
    this.queue = [];
    this.send(message);

    this.own.delete(turn);
    this.remote.delete(turn);
    // Both peers must apply the turn in the same order.
    return this.me === 0 ? [...mine, ...theirs] : [...theirs, ...mine];
  }
}
