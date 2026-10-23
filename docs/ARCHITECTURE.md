# Architecture

## Layers

```
config  ──►  world / core (pure logic)  ──►  entities / systems  ──►  core/Game  ──►  main.js
                                                   ▲                      │
                           render · fx · audio · ui · input  ◄────────────┘
```

| Layer                   | Depends on                 | Rule                                                                                  |
| ----------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `config/`               | nothing                    | Plain data. All balance numbers and content definitions live here.                    |
| `core/math`, `geometry` | nothing                    | Pure functions on `{x, y, z}` objects, so they are unit-testable without three.js.    |
| `world/Grid`            | `CellType`, math, geometry | The spatial truth: collisions, raycasts, line of sight, BFS navigation. No rendering. |
| `entities/`, `systems/` | the `game` context         | Gameplay. They read and write shared state through the `game` object.                 |
| `render/`, `fx/`, `ui/` | three.js / DOM             | Presentation only. Nothing here decides gameplay outcomes.                            |
| `core/Game`             | everything                 | Composition root: builds every subsystem, owns the state machine and the frame loop.  |

### The `game` context

Systems don't import each other. Each one gets the `Game` instance and reaches shared services through it: `game.grid`, `game.player`, `game.time`, `game.audio`, `game.effects`, `game.projectiles`, `game.enemies`, `game.combat`, `game.scoring`, `game.notifier`, `game.camRig`. This keeps construction order in one place (`Game` constructor) and avoids circular imports.

### Two clocks

- **Real time (`dt`)**: the player, camera, viewmodel, UI and cooldowns. The player is never slowed.
- **World time (`wdt = dt × time.scale`)**: enemies, enemy bullets, shards and particles.

`TimeController` derives `time.scale` from player speed, airtime, dashing, firing and mouse movement. Anything that should freeze when the player stands still must use `wdt`.

### Frame order (`Game.update`)

1. Player timers, combat cooldowns, combo timer, held-trigger fire
2. Player movement (real time)
3. Time dilation produces `wdt`
4. Enemies: perception, steering, firing, collisions
5. Enemy projectiles, thrown weapon, barrel chain fuses
6. FX, wave director
7. Camera rig, viewmodel
8. HUD and radar, then render

### State machine (`core/GameState.js`)

```
MENU ──start──► PLAYING ──Esc / focus lost──► PAUSED ──resume──► PLAYING
                   │
                hp ≤ 0
                   ▼
                 DYING (1.6 s death cam) ──► OVER ──play again──► PLAYING
```

Pointer lock drives PLAYING ↔ PAUSED. When pointer lock is unavailable, `Input` falls back to drag-to-look.

### Rendering

`RenderPipeline` renders the world scene, then the weapon scene after clearing depth (so the gun never clips into walls), then bloom, then `ChronoShader` (slow-time tint, chromatic aberration, damage vignette). With post-processing disabled it does the same two-pass render without the composer.

Shared geometries and materials (`SharedAssets`) and every transient effect (bullets, shards, tracers, particles) are **pooled**, so spawning never allocates GPU resources mid-game.

## Extending

### Add a level

1. Create `src/config/levels/<name>.js` with the same shape as `core.js` (grid, cell size, heights, spawn).
2. Add it to `LEVELS` in `src/config/levels/index.js`.
3. Run `npm test`. `levels.test.js` validates every listed level: rectangular grid, closed border, known cell types, empty spawn cell, every walkable cell reachable.

Level selection UI is not built yet. Today `DEFAULT_LEVEL` is loaded. A level picker only needs to pass a different level to `new Game(document, level)`.

### Add an enemy type

1. Add an entry to `ENEMY_TYPES` in `config/tuning.js` (hp, scale, speed, wind-up, pellets, score…).
2. Add a matching palette in `render/SharedAssets.js` (`palettes.<key>`).
3. Put it in a wave roster in `waveComposition()`.

For behaviour beyond the stat block (e.g. a melee charger), give the type a `behavior` key and branch in `Enemy._steer` / `_updateFiring`. If behaviours grow, extract them into strategy objects under `entities/behaviors/`.

### Add a weapon

Player offence lives in `systems/Combat.js` (`fire`, `_traceShot`, `throwWeapon`) and its visuals in `weapon/Viewmodel.js`. The natural next step is a `weapons/` folder of weapon definitions (cooldown, spread, damage, projectile vs hitscan) that `Combat` reads from, mirroring how `ENEMY_TYPES` works.

### Tune balance

Every number is in `config/tuning.js` (`TUNE`, `ENEMY_TYPES`, `KILL_BONUS`, `waveComposition`). Gameplay code should not contain magic balance constants.

## Testing

`tests/` covers the pure layers: grid conversions, collision push-out, raycasts, line of sight, BFS and path-following, level validation, math, geometry, settings persistence and tuning invariants. Rendering and DOM code are exercised by running the game (`npm run dev`), and the `?debug` hook lets an automated browser step the simulation via `window.__game.update(dt)`.
