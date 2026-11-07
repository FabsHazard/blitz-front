import type { Difficulty } from './ai/bot';
import { FINALE_SECONDS, Session, type MatchSetup } from './game';
import { Controls } from './input/controls';
import { NetLink, newRoomCode } from './net/link';
import { Lockstep } from './net/lockstep';
import { GameView } from './render/view';
import { renderThumbnails } from './render/thumbs';
import {
  ABILITIES, ABILITY_TYPES, LOADOUT_SIZE, cleanLoadout, type AbilityType,
} from './sim/data/defs';
import { MAPS, MAP_IDS } from './sim/map';
import type { MapId } from './sim/types';
import { createWorld } from './sim/world';
import { GameAudio } from './ui/audio';
import { Hud } from './ui/hud';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const showPerf = import.meta.env.DEV || params.has('perf');

const canvas = $<HTMLCanvasElement>('game');
const audio = new GameAudio();
type MapChoice = MapId | 'random';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked; the choice just will not be remembered.
  }
}

let mapChoice: MapChoice = load<MapChoice>('bf-map', 'river');
if (mapChoice !== 'random' && !MAP_IDS.includes(mapChoice)) mapChoice = 'river';
let loadout: AbilityType[] = cleanLoadout(load('bf-loadout', null));

const pickMap = (): MapId =>
  mapChoice === 'random' ? MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)] : mapChoice;

let previewWorld = createWorld({ seed: 1, map: mapChoice === 'random' ? 'river' : mapChoice });
const view = new GameView(canvas, previewWorld);

let session: Session | null = null;
let lastDifficulty: Difficulty = 'normal';
let link: NetLink | null = null;
let myOnlineSide = 0;
let lockstep: Lockstep | null = null;
let wantRematch = [false, false];
let guestLoadout: AbilityType[] = cleanLoadout(null);
let cancelHost: (() => void) | null = null;

const thumbs = [renderThumbnails(0), renderThumbnails(1)];

const hud = new Hud(thumbs[0], {
  train: (unit) => session?.train(unit),
  beginPlacement: (type, x, y) => controls.beginPlacement(type, x, y),
  beginAbility: (kind, x, y) => controls.beginAbility(kind, x, y),
  selectAll: () => session?.selectAll(),
  retreat: () => session?.retreat(),
  clearSelection: () => session?.clearSelection(),
  toggleMute: () => audio.cycleMode(),
  jumpTo: (x, z) => controls.jumpTo(x, z),
  upgrade: (u) => session?.upgrade(u),
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
  startMatch({ kind: 'bot', difficulty, seed, demo, map: pickMap(), loadout }, 0);
}

function beginOnlineMatch(seed: number, map: unknown, loadouts: unknown): void {
  if (!link) return;
  const active = link;
  wantRematch = [false, false];
  const safeMap = MAP_IDS.includes(map as MapId) ? (map as MapId) : 'river';
  const pair = Array.isArray(loadouts) ? loadouts : [];
  lockstep = new Lockstep(myOnlineSide, (message) => active.send(message));
  startMatch({
    kind: 'online', seed: seed | 0, owner: myOnlineSide, net: lockstep, map: safeMap,
    loadouts: [cleanLoadout(pair[0]), cleanLoadout(pair[1])],
  }, myOnlineSide);
  hud.toast(`Mapa: ${MAPS[safeMap].name}`);
}

function hostStartsIfReady(): void {
  if (myOnlineSide !== 0 || !wantRematch[0] || !wantRematch[1]) return;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] | 0;
  const map = pickMap();
  const loadouts: [AbilityType[], AbilityType[]] = [loadout, guestLoadout];
  link?.send({ k: 'start', seed, map, loadouts });
  beginOnlineMatch(seed, map, loadouts);
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
    else if (message.k === 'start') beginOnlineMatch(message.seed, message.map, message.loadouts);
    else if (message.k === 'hello') {
      guestLoadout = cleanLoadout(message.loadout);
      wantRematch = [true, true];
      hostStartsIfReady();
    } else if (message.k === 'rematch') {
      if (myOnlineSide === 0) guestLoadout = cleanLoadout(message.loadout);
      wantRematch[1 - myOnlineSide] = true;
      hostStartsIfReady();
    }
  });
  // The guest says which abilities it brings; the host then starts the match.
  if (side === 1) newLink.send({ k: 'hello', loadout });
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
  hud.hideFinale();
  audio.startMusic(0);
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
    setOnlineStatus('Esperando a tu rival… Tras compartir, vuelve aquí.');
  }, setOnlineStatus);
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
  window.setTimeout(() => { $('end').hidden = false; }, FINALE_SECONDS * 1000);
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
  link?.send({ k: 'rematch', loadout });
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
    view.rig.dist = 44;
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

function renderMapChoices(): void {
  const box = $('maps');
  box.replaceChildren();
  const options: [MapChoice, string, string][] = [
    ...MAP_IDS.map((id): [MapChoice, string, string] => [id, MAPS[id].name, MAPS[id].blurb]),
    ['random', 'Aleatorio', 'Un mapa distinto cada partida.'],
  ];
  for (const [id, name, blurb] of options) {
    const b = document.createElement('button');
    b.className = id === mapChoice ? 'pick on' : 'pick';
    b.textContent = name;
    b.title = blurb;
    b.addEventListener('click', () => {
      mapChoice = id;
      save('bf-map', id);
      $('map-blurb').textContent = blurb;
      if (id !== 'random' && id !== previewWorld.map) {
        previewWorld = createWorld({ seed: 1, map: id });
        if (!session) view.bind(previewWorld, 0);
      }
      renderMapChoices();
    });
    box.append(b);
    if (id === mapChoice) $('map-blurb').textContent = blurb;
  }
}

function renderLoadout(): void {
  const box = $('loadout');
  box.replaceChildren();
  for (const kind of ABILITY_TYPES) {
    const b = document.createElement('button');
    const on = loadout.includes(kind);
    b.className = on ? 'pick on' : 'pick';
    b.textContent = ABILITIES[kind].name;
    b.addEventListener('click', () => {
      if (on) {
        if (loadout.length <= 1) return;
        loadout = loadout.filter((k) => k !== kind);
      } else {
        // Picking a fourth one drops the oldest pick.
        loadout = [...loadout, kind].slice(-LOADOUT_SIZE);
      }
      $('loadout-blurb').textContent = ABILITIES[kind].blurb;
      save('bf-loadout', loadout);
      renderLoadout();
    });
    box.append(b);
  }
  $('loadout-count').textContent = `${loadout.length}/${LOADOUT_SIZE}`;
  const ready = loadout.length === LOADOUT_SIZE;
  document.querySelectorAll<HTMLButtonElement>('[data-diff], #btn-online').forEach((b) => { b.disabled = !ready; });
}

renderMapChoices();
renderLoadout();
audio.startMusic(0);
document.addEventListener('pointerdown', () => audio.unlock(), { once: true });

const invitedRoom = params.get('sala');
if (invitedRoom) {
  showOnline();
  $<HTMLInputElement>('room-input').value = invitedRoom;
  joinRoom(invitedRoom);
} else if (params.has('autostart') || demo) {
  start((params.get('autostart') as Difficulty) || 'normal');
}
