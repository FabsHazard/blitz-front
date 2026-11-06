import { describe, expect, it } from 'vitest';
import { Bot } from '../src/ai/bot';
import { Lockstep, type TurnMessage } from '../src/net/lockstep';
import { isValidCommand } from '../src/sim/commands';
import { fx } from '../src/sim/fixed';
import { nextRandom } from '../src/sim/rng';
import { createWorld, hashState, step } from '../src/sim/world';

/** Two full clients joined by a fake network with random delivery delay. */
function playOnline(seed: number, maxLatency: number, maxFrames = 200000) {
  const jitter = { rng: seed };
  const inFlight: { at: number; to: number; message: TurnMessage }[] = [];
  let frame = 0;
  const lane = [0, 0];
  const post = (to: number) => (message: TurnMessage) => {
    // Reliable ordered channel: nothing overtakes an earlier message.
    const at = Math.max(lane[to], frame + nextRandom(jitter) % (maxLatency + 1));
    lane[to] = at;
    inFlight.push({ at, to, message });
  };
  const clients = [0, 1].map((me) => ({
    world: createWorld({ seed }),
    net: new Lockstep(me, post(1 - me)),
    bot: new Bot(me, 'normal', seed + me + 1),
  }));

  let stalls = 0;
  while (clients.some((c) => c.world.winner === -1) && frame < maxFrames) {
    frame++;
    for (let i = inFlight.length - 1; i >= 0; i--) {
      if (inFlight[i].at > frame) continue;
      const [item] = inFlight.splice(i, 1);
      clients[item.to].net.receive(item.message);
    }
    for (const c of clients) {
      if (c.world.winner !== -1) continue;
      for (const command of c.bot.think(c.world)) c.net.issue(command);
      const commands = c.net.next(c.world);
      if (commands) step(c.world, commands);
      else stalls++;
    }
    if (clients[0].world.tick === clients[1].world.tick) {
      expect(hashState(clients[0].world)).toBe(hashState(clients[1].world));
    }
  }
  return { clients, stalls };
}

describe('online play', () => {
  it('keeps both peers identical through a whole match with a bad connection', () => {
    const { clients } = playOnline(77, 8);
    expect(clients[0].world.winner).not.toBe(-1);
    expect(clients[0].world.winner).toBe(clients[1].world.winner);
    expect(clients[0].world.tick).toBe(clients[1].world.tick);
    expect(clients[0].net.desynced).toBe(false);
    expect(clients[1].net.desynced).toBe(false);
  });

  it('waits instead of diverging when the network lags', () => {
    expect(playOnline(5, 30).stalls).toBeGreaterThan(0);
  });

  it('detects a desync through the state hashes', () => {
    const sent: TurnMessage[][] = [[], []];
    const peers = [new Lockstep(0, (m) => sent[1].push(m)), new Lockstep(1, (m) => sent[0].push(m))];
    const worlds = [createWorld({ seed: 1 }), createWorld({ seed: 1 })];
    worlds[1].players[0].supplies += 1;
    for (let tick = 0; tick < 60; tick++) {
      for (const me of [0, 1]) {
        for (const m of sent[me].splice(0)) peers[me].receive(m);
        const commands = peers[me].next(worlds[me]);
        if (commands) step(worlds[me], commands);
      }
    }
    expect(peers[0].desynced || peers[1].desynced).toBe(true);
  });

  it('never lets the remote peer act as the local player', () => {
    const net = new Lockstep(0, () => {});
    const w = createWorld({ seed: 1 });
    net.receive({ k: 'turn', turn: 0, cmds: [{ t: 'train', p: 0, unit: 'tank' }] });
    expect(net.next(w)).toEqual([]);
    net.receive({ k: 'turn', turn: 2, cmds: [{ t: 'rally', p: 0, x: fx(1), y: fx(1) }] });
    for (let i = 0; i < 6; i++) step(w, net.next(w) ?? []);
    expect(net.next(w)).toEqual([{ t: 'rally', p: 1, x: fx(1), y: fx(1) }]);
  });

  it('rejects malformed commands', () => {
    const bad: unknown[] = [
      null, 5, {}, { t: 'nope' }, { t: 'rally', p: 0, x: 1.5, y: 2 },
      { t: 'move', p: 0, ids: 'x', x: 1, y: 1, mode: 'move' },
      { t: 'move', p: 0, ids: [1], x: 1, y: 1, mode: 'teleport' },
      { t: 'train', p: 0, unit: 'constructor' }, { t: 'build', p: 0, b: 'hq', cx: 1, cy: 1 },
      { t: 'ability', p: 0, a: 'nuke', x: 1, y: 1 },
    ];
    for (const c of bad) expect(isValidCommand(c), JSON.stringify(c)).toBe(false);
    expect(isValidCommand({ t: 'train', p: 0, unit: 'tank' })).toBe(true);
  });
});
