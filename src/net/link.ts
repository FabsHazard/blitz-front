import Peer, { type DataConnection } from 'peerjs';
import type { TurnMessage } from './lockstep';

export type NetMessage =
  | TurnMessage
  | { k: 'start'; seed: number }
  | { k: 'rematch' };

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

  /** Opens a room. `onOpen` fires once the code can be shared. */
  static host(code: string, onOpen: () => void): { link: Promise<NetLink>; cancel: () => void } {
    const peer = new Peer(ROOM_PREFIX + code, { debug: 0 });
    const link = new Promise<NetLink>((resolve, reject) => {
      peer.on('open', onOpen);
      peer.on('error', (err) => reject(new Error(describe(err.type))));
      peer.on('connection', (conn) => {
        conn.on('open', () => resolve(new NetLink(peer, conn)));
      });
    });
    return { link, cancel: () => peer.destroy() };
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
