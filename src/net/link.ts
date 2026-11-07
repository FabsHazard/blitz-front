import Peer, { type DataConnection } from 'peerjs';
import type { AbilityType } from '../sim/data/defs';
import type { MapId } from '../sim/types';
import type { TurnMessage } from './lockstep';

/** Anything read from these is cleaned before use: the other side may be anyone. */
export type NetMessage =
  | TurnMessage
  | { k: 'hello'; loadout: AbilityType[] }
  | { k: 'start'; seed: number; map: MapId; loadouts: [AbilityType[], AbilityType[]] }
  | { k: 'rematch'; loadout: AbilityType[] };

const ROOM_PREFIX = 'blitzfront-v1-';
const JOIN_TIMEOUT_MS = 20000;
/** Letters that are hard to confuse when read aloud or typed on a phone. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const FRIENDLY_ERRORS: Record<string, string> = {
  'peer-unavailable': 'No existe esa sala. Revisa el código.',
  'unavailable-id': 'Ese código está en uso. Crea otra sala.',
  network: 'No se pudo conectar al servidor de salas.',
  'server-error': 'El servidor de salas no responde.',
  'socket-error': 'Se perdió la conexión con el servidor de salas.',
  'webrtc': 'Tu navegador no pudo abrir la conexión directa.',
  'browser-incompatible': 'Este navegador no permite jugar online.',
};

const describe = (type: string): string => FRIENDLY_ERRORS[type] ?? 'No se pudo conectar.';

/** A direct connection between two players. Rooms only exist to find each other. */
export class NetLink {
  onClose: () => void = () => {};
  private closed = false;
  private handler: ((message: NetMessage) => void) | null = null;
  private inbox: NetMessage[] = [];

  private constructor(private peer: Peer, private conn: DataConnection) {
    conn.on('data', (data) => {
      if (!data || typeof data !== 'object' || !('k' in data)) return;
      if (this.handler) this.handler(data as NetMessage);
      else this.inbox.push(data as NetMessage);
    });
    conn.on('close', () => this.handleClose());
    conn.on('error', () => this.handleClose());
  }

  /** Messages can arrive as soon as the channel opens, so they wait here. */
  listen(handler: (message: NetMessage) => void): void {
    this.handler = handler;
    for (const message of this.inbox.splice(0)) handler(message);
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
    this.peer.destroy();
  }

  send(message: NetMessage): void {
    if (this.conn.open) void this.conn.send(message);
  }

  close(): void {
    this.closed = true;
    this.conn.close();
    this.peer.destroy();
  }

  /**
   * Opens a room. `onOpen` fires once the code can be shared. Phones suspend
   * the page while the player shares the code from another app, which drops
   * the link to the room server, so the room quietly reconnects with the
   * same code instead of failing.
   */
  static host(
    code: string, onOpen: () => void, onStatus: (text: string) => void = () => {},
  ): { link: Promise<NetLink>; cancel: () => void } {
    let peer: Peer;
    let opened = false;
    let done = false;
    let retryTimer = 0;
    let resolveLink: (link: NetLink) => void = () => {};
    let rejectLink: (err: Error) => void = () => {};
    const link = new Promise<NetLink>((resolve, reject) => {
      resolveLink = resolve;
      rejectLink = reject;
    });

    const retry = (ms: number) => {
      window.clearTimeout(retryTimer);
      if (!done) retryTimer = window.setTimeout(revive, ms);
    };
    // A suspended page loses its socket; a destroyed peer has to start over.
    const revive = () => {
      if (done) return;
      if (peer.destroyed) {
        onStatus('Reabriendo la sala…');
        start();
      } else if (peer.disconnected) {
        onStatus('Reconectando la sala…');
        try {
          peer.reconnect();
        } catch {
          // A reconnect already in progress throws; the next try catches up.
        }
      } else {
        return;
      }
      retry(3000);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') revive();
    };
    const finish = () => {
      done = true;
      window.clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };

    const start = () => {
      const current = new Peer(ROOM_PREFIX + code, { debug: 0 });
      peer = current;
      current.on('open', () => {
        window.clearTimeout(retryTimer);
        if (!opened) onOpen();
        else onStatus('Esperando a tu rival… Tras compartir, vuelve aquí.');
        opened = true;
      });
      current.on('disconnected', () => retry(document.hidden ? 3000 : 300));
      current.on('error', (err) => {
        // Once the room exists, server hiccups are temporary: keep the room alive.
        if (opened && err.type !== 'browser-incompatible') {
          retry(2000);
          return;
        }
        finish();
        current.destroy();
        rejectLink(new Error(describe(err.type)));
      });
      current.on('connection', (conn) => {
        conn.on('open', () => {
          if (done) return;
          finish();
          resolveLink(new NetLink(current, conn));
        });
      });
    };

    document.addEventListener('visibilitychange', onVisible);
    start();
    return {
      link,
      cancel: () => {
        finish();
        peer.destroy();
      },
    };
  }

  static join(code: string): Promise<NetLink> {
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      const timeout = window.setTimeout(() => {
        peer.destroy();
        reject(new Error('Tiempo agotado. Alguna de las redes puede estar bloqueando la conexión.'));
      }, JOIN_TIMEOUT_MS);
      const fail = (message: string) => {
        window.clearTimeout(timeout);
        peer.destroy();
        reject(new Error(message));
      };
      peer.on('error', (err) => fail(describe(err.type)));
      peer.on('open', () => {
        const conn = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          window.clearTimeout(timeout);
          resolve(new NetLink(peer, conn));
        });
      });
    });
  }
}
