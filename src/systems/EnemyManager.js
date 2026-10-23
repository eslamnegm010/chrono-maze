import * as THREE from 'three';
import { TUNE, ENEMY_TYPES, waveComposition } from '../config/tuning.js';
import { rand, shuffle } from '../core/math.js';
import { pushFromCircle } from '../core/geometry.js';
import { CellType } from '../world/CellType.js';
import { Enemy } from '../entities/Enemy.js';

/**
 * Owns all live enemies: spawning waves away from the players, one flow
 * field per player that leads hunters to them, and enemy↔world collisions.
 * On a multiplayer client it instead mirrors the host's enemies (replicas).
 */
const TYPE_KEYS = Object.keys(ENEMY_TYPES);
export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.fields = new Map(); // target id → { field, cell, timer }
    this.nextId = 1;
    this.byId = new Map();
  }

  /** BFS field leading to a target, refreshed when it changes cell (or every 0.5 s). */
  fieldFor(target) {
    if (!target) return null;
    const { grid } = this.game;
    let f = this.fields.get(target.id);
    if (!f) {
      f = { field: grid.createField(), cell: -1, timer: 0 };
      this.fields.set(target.id, f);
    }
    const c = grid.toCol(target.pos.x);
    const r = grid.toRow(target.pos.z);
    const cell = grid.index(c, r);
    if (cell !== f.cell || f.timer <= 0) {
      grid.bfs(c, r, f.field);
      f.cell = cell;
      f.timer = 0.5;
    }
    return f.field;
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
    this.byId.clear();
    this.fields.clear();
  }

  remove(e) {
    e.alive = false;
    e.dispose();
    this.byId.delete(e.id);
  }

  spawn(x, z, typeKey, difficulty, id = this.nextId++) {
    const e = new Enemy(this.game, x, z, typeKey, difficulty);
    e.id = id;
    this.list.push(e);
    this.byId.set(id, e);
    return e;
  }

  /** Host → network: [id, typeIndex, x, z, yaw, flags, windupFrac, targetId] */
  snapshot() {
    const r2 = (v) => Math.round(v * 100) / 100;
    const out = [];
    for (const e of this.list) {
      if (!e.alive) continue;
      const flags = (e.isHunting ? 1 : 0) | (e.windup > 0 ? 2 : 0);
      const frac = e.windup > 0 ? r2(1 - e.windup / e.type.windup) : 0;
      out.push([
        e.id,
        TYPE_KEYS.indexOf(e.type.key),
        r2(e.pos.x),
        r2(e.pos.z),
        r2(e.yaw),
        flags,
        frac,
        e.windup > 0 ? (e.target?.id ?? 0) : 0,
      ]);
    }
    return out;
  }

  /** Client: create/update/remove replicas to match the host. */
  applySnapshot(list) {
    const seen = new Set();
    for (const row of list) {
      const id = row[0];
      seen.add(id);
      let e = this.byId.get(id);
      if (!e) {
        e = this.spawn(row[2], row[3], TYPE_KEYS[row[1]] ?? 'grunt', { fireMul: 1, spread: 0 }, id);
        e.yaw = row[4];
      }
      e.applyNet(row);
    }
    for (const e of this.list) if (e.alive && !seen.has(e.id)) this.remove(e);
    this.list = this.list.filter((e) => e.alive);
  }

  updateReplicas(dt) {
    const tf = this.game.timeField;
    for (const e of this.list) if (e.alive) e.updateReplica(dt, dt * tf.scaleAt(e.pos));
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

  /** Each enemy runs on the time of the bubble it stands in. */
  update(dt) {
    for (const f of this.fields.values()) f.timer -= dt;
    const tf = this.game.timeField;
    for (const e of this.list) if (e.alive) e.update(dt, dt * tf.scaleAt(e.pos));
    this._resolveCollisions();
    if (this.list.some((e) => !e.alive)) this.list = this.list.filter((e) => e.alive);
  }

  _resolveCollisions() {
    const { grid, barrels } = this.game;
    const players = this.game.bodies();
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
      for (const p of players) pushFromCircle(a.pos, a.radius, p.pos.x, p.pos.z, TUNE.playerRadius);
      grid.resolveCircle(a.pos, a.radius);
    }
  }
}
