import * as THREE from 'three';
import { EYE_HEIGHT } from '../config/tuning.js';
import { clamp } from '../core/math.js';

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _pos = new THREE.Vector3();

/**
 * Pooled enemy bullets. They travel on world time, so standing still
 * freezes them mid-air — the core dodge mechanic.
 */
export class EnemyProjectiles {
  constructor(scene, assets, max = 70) {
    this.pool = [];
    this.active = [];
    this.byId = new Map();
    this.nextId = 1;
    for (let i = 0; i < max; i++) {
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(assets.geo.bullet, assets.mat.bullet));
      mesh.add(new THREE.Mesh(assets.geo.bulletTrail, assets.mat.bulletTrail));
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({
        id: 0,
        mesh,
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        dmg: 0,
        trail: 0,
        live: false,
      });
    }
  }

  spawn(origin, dir, speed, dmg, id = this.nextId++) {
    const b = this.pool.find((x) => !x.live);
    if (!b) return null;
    b.id = id;
    b.live = true;
    b.pos.copy(origin);
    b.prev.copy(origin);
    b.vel.copy(dir).multiplyScalar(speed);
    b.life = 6;
    b.dmg = dmg;
    b.trail = 0;
    b.mesh.position.copy(origin);
    b.mesh.quaternion.setFromUnitVectors(UP, dir);
    b.mesh.visible = true;
    this.active.push(b);
    this.byId.set(id, b);
    return b;
  }

  remove(b) {
    const i = this.active.indexOf(b);
    if (i >= 0) this._removeAt(i);
  }

  _removeAt(i) {
    const b = this.active[i];
    b.live = false;
    b.mesh.visible = false;
    this.active.splice(i, 1);
    this.byId.delete(b.id);
  }

  clear() {
    while (this.active.length) this._removeAt(this.active.length - 1);
  }

  destroyWithin(pos, radius) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].pos.distanceTo(pos) < radius) this._removeAt(i);
    }
  }

  _advance(b, wdt, effects) {
    b.prev.copy(b.pos);
    b.pos.addScaledVector(b.vel, wdt);
    b.mesh.position.copy(b.pos);
    b.trail += b.vel.length() * wdt;
    if (b.trail > 0.7) {
      b.trail = 0;
      effects.emit(b.pos.x, b.pos.y, b.pos.z, 0, 0, 0, 0.5, 0.6, 0.0, 0.18, 0, 0);
    }
  }

  /** Authoritative update (solo / host). Each bullet runs on the time of the bubble it is in. */
  update(dt, game) {
    const { grid, effects, timeField } = game;
    const targets = game.simRunning ? game.targets() : [];
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      const wdt = dt * timeField.scaleAt(b.pos);
      this._advance(b, wdt, effects);
      b.life -= wdt;

      const victim = targets.find((t) => this._hitsPlayer(b, t));
      if (victim) {
        if (victim.invuln > 0) continue; // dashing through bullets
        game.combat.hurtTarget(victim, b.dmg, b.prev.x - b.vel.x, b.prev.z - b.vel.z);
        effects.burst(b.pos.x, b.pos.y, b.pos.z, 14, 4, 0xff0055, { life: 0.4 });
        this._removeAt(i);
        continue;
      }
      if (b.pos.y < 0.05 || grid.pointInSolid(b.pos)) {
        effects.burst(b.prev.x, b.prev.y, b.prev.z, 10, 3.5, 0xff3366, { life: 0.35 });
        this._removeAt(i);
        continue;
      }
      if (b.life <= 0) this._removeAt(i);
    }
  }

  /** Host → network: [id, x, y, z, vx, vy, vz] */
  snapshot() {
    const r2 = (v) => Math.round(v * 100) / 100;
    return this.active.map((b) => [b.id, r2(b.pos.x), r2(b.pos.y), r2(b.pos.z), r2(b.vel.x), r2(b.vel.y), r2(b.vel.z)]);
  }

  /** Client: mirror the host's bullets; between snapshots they fly locally on the same time field. */
  applySnapshot(list, game) {
    const seen = new Set();
    for (const [id, x, y, z, vx, vy, vz] of list) {
      seen.add(id);
      const b = this.byId.get(id);
      if (b) {
        b.pos.set(x, y, z);
        b.vel.set(vx, vy, vz);
      } else {
        _dir.set(vx, vy, vz);
        const speed = _dir.length() || 1;
        const nb = this.spawn(_pos.set(x, y, z), _dir.divideScalar(speed), speed, 0, id);
        if (nb) game.playAt('enemyShoot', nb.pos);
      }
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      if (seen.has(b.id)) continue;
      game.effects.burst(b.pos.x, b.pos.y, b.pos.z, 10, 3.5, 0xff3366, { life: 0.35 });
      this._removeAt(i);
    }
  }

  updateReplicas(dt, game) {
    for (const b of this.active) this._advance(b, dt * game.timeField.scaleAt(b.pos), game.effects);
  }

  /** Swept test: closest point of this frame's bullet segment to the player's vertical axis. */
  _hitsPlayer(b, p) {
    const sx = b.pos.x - b.prev.x;
    const sy = b.pos.y - b.prev.y;
    const sz = b.pos.z - b.prev.z;
    const l2 = sx * sx + sz * sz;
    const t = l2 > 1e-9 ? clamp(((p.pos.x - b.prev.x) * sx + (p.pos.z - b.prev.z) * sz) / l2, 0, 1) : 0;
    const qx = b.prev.x + sx * t;
    const qy = b.prev.y + sy * t;
    const qz = b.prev.z + sz * t;
    return Math.hypot(qx - p.pos.x, qz - p.pos.z) < 0.45 && qy > p.pos.y + 0.1 && qy < p.pos.y + EYE_HEIGHT + 0.3;
  }
}
