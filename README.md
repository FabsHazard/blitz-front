# Blitz Front

RTS low-poly para celular, de partidas cortas, hecho con Three.js y TypeScript.

## Jugar

```bash
npm install
npm run dev -- --host
```

- En PC: abre `http://localhost:5173`.
- En el celular: conéctalo a la misma Wi-Fi y abre la dirección `Network` que imprime Vite.

Con ratón: arrastrar mueve la cámara, la rueda hace zoom, Mayús + arrastrar selecciona y el clic derecho da una orden.

## 1 contra 1 online

En el menú, toca **1 contra 1 online**, crea una sala y comparte el enlace o el código de 5 letras. La partida va directa entre los dos jugadores por WebRTC: solo viajan comandos, y cada uno simula el mundo. El servidor público de PeerJS únicamente sirve para que los dos se encuentren.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Pruebas de reglas, determinismo, online y partidas IA contra IA |
| `npm run build` | Comprueba tipos y genera `dist/` |
| `npm run deploy` | Prueba, compila y publica en la rama `gh-pages` |

Parámetros de URL útiles: `?demo` (IA contra IA), `?autostart=hard` (empieza directo) y `?perf` (contador de FPS).

## Arquitectura

```
input / IA --> comandos --> simulación (15 ticks/s) --> estado --> render interpolado
```

- `src/sim/`: reglas del juego, deterministas y sin dependencias de Three.js ni del DOM.
- `src/ai/`: bot que solo lee el mundo y emite comandos normales.
- `src/render/`: escena Three.js; todos los modelos se generan por código.
- `src/input/` y `src/ui/`: gestos táctiles, HUD y audio sintetizado.

**Regla para el futuro multijugador:** nada cambia el mundo salvo un `Command`, y en `src/sim` y `src/ai` no se usan floats no enteros en el estado, `Math.random`, trigonometría ni relojes. `hashState()` sirve para detectar divergencias, y una prueba vigila estas APIs prohibidas.

El balance se ajusta en `src/sim/data/defs.ts`.
