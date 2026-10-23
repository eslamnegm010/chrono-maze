import * as THREE from 'three';
import { TUNE, waveComposition } from '../config/tuning.js';
import { rand, shuffle } from '../core/math.js';
import { pushFromCircle } from '../core/geometry.js';
import { CellType } from '../world/CellType.js';
import { Enemy } from '../entities/Enemy.js';

/**
 * Owns all live enemies: spawning waves away from the player, the shared
 * flow field that leads hunters to the player, and enemy↔world collisions.
 */
export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.playerField = game.grid.createField();
    this.fieldCell = -1;
    this.fieldTimer = 0;
  }

  get aliveCount() {
    let n = 0;
    for (const e of this.list) if (e.alive) n++;
    return n;
  }

  *alive() {
    for (const e of this.list) if (e.alive) yield e;
  }

  clear() {
    for (const e of this.list) e.dispose();
    this.list = [];
    this.fieldCell = -1;
  }

  remove(e) {
    e.alive = false;
    e.dispose();
  }

  spawn(x, z, typeKey, difficulty) {
    const e = new Enemy(this.game, x, z, typeKey, difficulty);
    this.list.push(e);
    return e;
  }

  /** Spawns wave n on empty cells ≥4 steps away and out of the player's sight when possible. */
  spawnWave(n) {
    const { roster, difficulty } = waveComposition(n);
    const types = roster.flatMap(({ type, count }) => Array(count).fill(type));
    const { grid, player } = this.game;
    const field = grid.bfs(grid.toCol(player.pos.x), grid.toRow(player.pos.z), grid.createField());
    const eye = new THREE.Vector3(player.pos.x, player.eyeY, player.pos.z);
    const from = new THREE.Vector3();

    const hidden = [];
    const fallback = [];
    grid.forEachCell((c, r, t) => {
      if (t !== CellType.EMPTY) return;
      const d = field[grid.index(c, r)];
      if (d < 3) return;
      from.set(grid.cellX(c), 1.6, grid.cellZ(r));
      if (d >= 4 && !grid.hasLineOfSight(from, eye)) hidden.push({ c, r });
      else fallback.push({ c, r });
    });
    const cells = shuffle(hidden).concat(hidden.length < types.length ? shuffle(fallback) : []);
    if (!cells.length) return;

    const crowded = cells.length < types.length;
    types.forEach((type, i) => {
      const k = cells[i % cells.length];
      const jx = crowded ? rand(-3, 3) : rand(-2, 2);
      this.spawn(grid.cellX(k.c) + jx, grid.cellZ(k.r) + rand(-2, 2), type, difficulty);
    });
  }

  alertWithin(pos, range) {
    for (const e of this.alive()) if (e.pos.distanceTo(pos) < range) e.alert(false);
  }

  _updateField(dt) {
    const { grid, player } = this.game;
    const c = grid.toCol(player.pos.x);
    const r = grid.toRow(player.pos.z);
    const cell = grid.index(c, r);
    this.fieldTimer -= dt;
    if (cell !== this.fieldCell || this.fieldTimer <= 0) {
      grid.bfs(c, r, this.playerField);
      this.fieldCell = cell;
      this.fieldTimer = 0.5;
    }
  }

  update(dt, wdt) {
    this._updateField(dt);
    for (const e of this.list) if (e.alive) e.update(dt, wdt);
    this._resolveCollisions();
    if (this.list.some((e) => !e.alive)) this.list = this.list.filter((e) => e.alive);
  }

  _resolveCollisions() {
    const { grid, player, barrels } = this.game;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const R = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < R * R && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (R - d) / 2;
          a.pos.x -= (dx / d) * push;
          a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push;
          b.pos.z += (dz / d) * push;
        }
      }
      for (const bar of barrels.items) if (bar.alive) pushFromCircle(a.pos, a.radius, bar.pos.x, bar.pos.z, TUNE.barrelRadius);
      pushFromCircle(a.pos, a.radius, player.pos.x, player.pos.z, TUNE.playerRadius);
      grid.resolveCircle(a.pos, a.radius);
    }
  }
}
