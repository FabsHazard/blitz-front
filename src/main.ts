import type { Difficulty } from './ai/bot';
import { Session, type MatchSetup } from './game';
import { Controls } from './input/controls';
import { NetLink, newRoomCode } from './net/link';
import { Lockstep } from './net/lockstep';
import { GameView } from './render/view';
import { renderThumbnails } from './render/thumbs';
import { createWorld } from './sim/world';
import { GameAudio } from './ui/audio';
import { Hud } from './ui/hud';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const showPerf = import.meta.env.DEV || params.has('perf');

const canvas = $<HTMLCanvasElement>('game');
const audio = new GameAudio();
const previewWorld = createWorld({ seed: 1 });
const view = new GameView(canvas, previewWorld);

let session: Session | null = null;
let lastDifficulty: Difficulty = 'normal';
let link: NetLink | null = null;
let myOnlineSide = 0;
let lockstep: Lockstep | null = null;
let wantRematch = [false, false];
let cancelHost: (() => void) | null = null;

const thumbs = [renderThumbnails(0), renderThumbnails(1)];

const hud = new Hud(thumbs[0], {
  train: (unit) => session?.train(unit),
  beginPlacement: (type, x, y) => controls.beginPlacement(type, x, y),
  beginAbility: (kind, x, y) => controls.beginAbility(kind, x, y),
  selectAll: () => session?.selectAll(),
  retreat: () => session?.retreat(),
  clearSelection: () => session?.clearSelection(),
  toggleMute: () => (audio.muted = !audio.muted),
  jumpTo: (x, z) => controls.jumpTo(x, z),
});
const controls = new Controls(canvas, view, hud, () => session);

function requestLandscape(): void {
  const root = document.documentElement;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (coarse && root.requestFullscreen) {
    root.requestFullscreen()
      .then(() => (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> }).lock?.('landscape'))
      .catch(() => { /* Not supported everywhere; the rotate screen covers this case. */ });
  }
}

function startMatch(setup: MatchSetup, owner: number): void {
  audio.unlock();
  for (const id of ['menu', 'online', 'end']) $(id).hidden = true;
  $('hud').hidden = false;
  session = new Session(view, hud, audio, setup, thumbs[owner], {
    onEnd: showResults,
    onAbort: showAbort,
  });
  exposeForTesting();
}

function start(difficulty: Difficulty): void {
  lastDifficulty = difficulty;
  const seed = (Math.random() * 1e9) | 0;
  startMatch({ kind: 'bot', difficulty, seed, demo }, 0);
}

function beginOnlineMatch(seed: number): void {
  if (!link) return;
  const active = link;
  wantRematch = [false, false];
  lockstep = new Lockstep(myOnlineSide, (message) => active.send(message));
  startMatch({ kind: 'online', seed, owner: myOnlineSide, net: lockstep }, myOnlineSide);
}

function hostStartsIfReady(): void {
  if (myOnlineSide !== 0 || !wantRematch[0] || !wantRematch[1]) return;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] | 0;
  link?.send({ k: 'start', seed });
  beginOnlineMatch(seed);
}

function connect(newLink: NetLink, side: number): void {
  link = newLink;
  myOnlineSide = side;
  newLink.onClose = () => {
    link = null;
    if (session && session.world.winner === -1) session.abort('El rival se desconectó.');
    else if (!$('end').hidden) $('btn-again').setAttribute('disabled', '');
    setOnlineStatus('');
  };
  newLink.listen((message) => {
    if (message.k === 'turn') lockstep?.receive(message);
    else if (message.k === 'start') beginOnlineMatch(message.seed);
    else if (message.k === 'rematch') {
      wantRematch[1 - myOnlineSide] = true;
      hostStartsIfReady();
    }
  });
  if (side === 0) {
    wantRematch = [true, true];
    hostStartsIfReady();
  }
}

function setOnlineStatus(text: string): void {
  $('online-status').textContent = text;
}

function leaveOnline(): void {
  cancelHost?.();
  cancelHost = null;
  link?.close();
  link = null;
  lockstep = null;
}

function showMenu(): void {
  leaveOnline();
  session = null;
  view.bind(previewWorld, 0);
  $('end').hidden = true;
  $('hud').hidden = true;
  $('online').hidden = true;
  $('menu').hidden = false;
}

function showOnline(): void {
  setOnlineStatus('');
  $('online-choose').hidden = false;
  $('online-room').hidden = true;
  $('menu').hidden = true;
  $('online').hidden = false;
}

function createRoom(): void {
  audio.unlock();
  const code = newRoomCode();
  setOnlineStatus('Abriendo sala…');
  const { link: pending, cancel } = NetLink.host(code, () => {
    $('online-choose').hidden = true;
    $('online-room').hidden = false;
    $('room-code').textContent = code;
    setOnlineStatus('Esperando a tu rival…');
  });
  cancelHost = cancel;
  pending.then((newLink) => {
    cancelHost = null;
    connect(newLink, 0);
  }).catch((err: Error) => setOnlineStatus(err.message));
}

function joinRoom(raw: string): void {
  audio.unlock();
  const code = raw.trim().toUpperCase();
  if (code.length !== 5) {
    setOnlineStatus('El código tiene 5 caracteres.');
    return;
  }
  setOnlineStatus('Conectando…');
  NetLink.join(code)
    .then((newLink) => {
      setOnlineStatus('Conectado. Empezando…');
      connect(newLink, 1);
    })
    .catch((err: Error) => setOnlineStatus(err.message));
}

async function shareRoom(): Promise<void> {
  const url = `${location.origin}${location.pathname}?sala=${$('room-code').textContent}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Blitz Front', text: 'Juguemos 1 contra 1', url });
    else {
      await navigator.clipboard.writeText(url);
      setOnlineStatus('Enlace copiado. Esperando a tu rival…');
    }
  } catch {
    setOnlineStatus(url);
  }
}

function showAbort(reason: string): void {
  $('end-title').textContent = 'Partida terminada';
  $('end-reason').textContent = reason;
  $('end-stats').innerHTML = '';
  $('btn-again').hidden = true;
  $('end').hidden = false;
}

function showResults(s: Session): void {
  const w = s.world;
  const won = w.winner === s.owner;
  $('end-title').textContent = w.winner === 2 ? 'Empate' : won ? 'Victoria' : 'Derrota';
  $('end-reason').textContent = s.endReason();
  const me = w.players[s.owner].stats;
  const foe = w.players[1 - s.owner].stats;
  const row = (label: string, a: number, b: number) => `<tr><td>${label}</td><td>${a}</td><td>${b}</td></tr>`;
  $('end-stats').innerHTML = `<tr><td></td><th>Tú</th><th>Rival</th></tr>${
    row('Escuadrones creados', me.unitsMade, foe.unitsMade)}${
    row('Bajas causadas', me.kills, foe.kills)}${
    row('Escuadrones perdidos', me.unitsLost, foe.unitsLost)}${
    row('Suministros ganados', me.suppliesEarned, foe.suppliesEarned)}`;
  const seconds = Math.round(w.tick / 15);
  $('end-reason').textContent += ` Duración ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.`;
  const again = $<HTMLButtonElement>('btn-again');
  again.hidden = false;
  again.disabled = lockstep !== null && link === null;
  again.textContent = 'Revancha';
  window.setTimeout(() => { $('end').hidden = false; }, 1200);
}

function exposeForTesting(): void {
  if (import.meta.env.DEV || params.has('debug')) {
    (window as unknown as { __game: unknown }).__game = { session, view, controls };
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((button) => {
  button.addEventListener('click', () => {
    requestLandscape();
    start(button.dataset.diff as Difficulty);
  });
});
$('btn-again').addEventListener('click', () => {
  if (!lockstep) {
    start(lastDifficulty);
    return;
  }
  wantRematch[myOnlineSide] = true;
  link?.send({ k: 'rematch' });
  const again = $<HTMLButtonElement>('btn-again');
  again.disabled = true;
  again.textContent = 'Esperando…';
  hostStartsIfReady();
});
$('btn-menu').addEventListener('click', showMenu);
$('btn-online').addEventListener('click', () => { requestLandscape(); showOnline(); });
$('btn-create').addEventListener('click', createRoom);
$('btn-join').addEventListener('click', () => joinRoom($<HTMLInputElement>('room-input').value));
$('btn-share').addEventListener('click', () => void shareRoom());
$('btn-online-back').addEventListener('click', showMenu);

window.addEventListener('resize', () => view.resize());
window.addEventListener('orientationchange', () => view.resize());

let previous = performance.now();
let perfClock = 0;
let perfFrames = 0;
let slowSeconds = 0;
const emptySelection = new Set<number>();

function loop(nowMs: number): void {
  const now = nowMs / 1000;
  const dt = Math.min(0.1, (nowMs - previous) / 1000);
  previous = nowMs;

  if (session) {
    session.frame(dt, now);
  } else {
    // The menu sits over a slow pan across the empty battlefield.
    view.rig.focus(36 + Math.sin(now * 0.08) * 16, 22);
    view.render(previewWorld, 1, now, dt, emptySelection, 0);
  }

  perfFrames++;
  perfClock += dt;
  if (perfClock >= 1) {
    const fps = perfFrames / perfClock;
    slowSeconds = session && fps < 40 ? slowSeconds + 1 : 0;
    if (slowSeconds >= 4) {
      view.lowerQuality();
      slowSeconds = 0;
    }
    if (showPerf) {
      const info = view.renderer.info.render;
      hud.perf.hidden = false;
      hud.perf.textContent = `${fps.toFixed(0)} fps · ${info.calls} draws · ${(info.triangles / 1000).toFixed(1)}k tris`;
    }
    perfClock = 0;
    perfFrames = 0;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

const invitedRoom = params.get('sala');
if (invitedRoom) {
  showOnline();
  $<HTMLInputElement>('room-input').value = invitedRoom;
  joinRoom(invitedRoom);
} else if (params.has('autostart') || demo) {
  start((params.get('autostart') as Difficulty) || 'normal');
}
