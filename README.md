# Chrono-Maze 3D

A neon first-person shooter set in a cyber labyrinth, where **time only moves when you move**.
Stand still and enemy bullets freeze in mid-air. Move and the whole world speeds up with you.

Built with [three.js](https://threejs.org/) and [Vite](https://vitejs.dev/). The game ships no image or audio assets: textures are drawn on canvases at startup and every sound is synthesised with Web Audio.

## Quick start

```bash
nvm use            # Node 20 (see .nvmrc); any Node ≥ 18 works
npm install
npm run dev        # http://localhost:5173
```

| Script            | What it does                                 |
| ----------------- | -------------------------------------------- |
| `npm run dev`     | Dev server with hot reload                   |
| `npm run build`   | Production build into `dist/`                |
| `npm run preview` | Serve the production build locally           |
| `npm test`        | Unit tests (Vitest)                          |
| `npm run lint`    | ESLint                                       |
| `npm run format`  | Prettier (write)                             |
| `npm run check`   | lint + test + build: run this before pushing |

Add `?debug` to the URL to expose the running game as `window.__game` in the console. It is always exposed in dev mode.

## Controls

| Input             | Action                                  |
| ----------------- | --------------------------------------- |
| `W A S D`         | Move (this is what makes time flow)     |
| Mouse / arrows    | Look                                    |
| Left click (hold) | Hitscan laser (headshot = instant kill) |
| `Shift`           | Dash (invulnerable while dashing)       |
| `Space`           | Jump                                    |
| `F` / right click | Throw the gun (kills anything it hits)  |
| `Esc` / `P`       | Pause                                   |
| `H`               | Toggle the controls panel               |

## Deploying

The build is a static site with relative paths, so `dist/` can be hosted anywhere: GitHub Pages, Netlify, Vercel, itch.io, or an S3/CDN bucket.

**GitHub Pages (preconfigured):** push to `main`, then in the repo settings go to _Settings → Pages → Source_ and choose _GitHub Actions_. The workflow in `.github/workflows/deploy.yml` tests, builds and publishes on every push to `main`.

## Project layout

```
src/
  main.js              entry: validates the level, boots the Game
  config/              all data: levels, tuning numbers, enemy types, wave rosters
  core/                Game (composition root + state machine), math, geometry, settings
  world/               Grid (collision, raycasts, pathfinding), level validation, scene building, barrels
  entities/            Player, Enemy (AI), EnemyModel (mesh)
  systems/             Combat, EnemyManager, WaveDirector, projectiles, scoring, time dilation, camera
  weapon/              first-person viewmodel
  render/              renderer + post-processing, shared GPU assets, procedural textures
  fx/                  particles, shards, tracers, explosions
  audio/               procedural sound synth
  input/               keyboard / mouse / pointer lock
  ui/                  HUD, radar, notifications, menus
  styles/              CSS
tests/                 unit tests for pure logic (grid, levels, math, settings, tuning)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together and how to extend them (new levels, enemies, weapons).

## Tech notes

- **three.js 0.160** is pinned exactly. Lights use physical units; the conversions from the game's original tuning live in `src/render/lights.js`.
- Colour management is turned off (`main.js`) because the palette was authored as raw neon values.
- Bloom and post-processing can be switched off in the menu for weaker GPUs. The game then renders directly, without the effect composer.
