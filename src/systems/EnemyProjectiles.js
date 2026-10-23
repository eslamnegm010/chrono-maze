import * as THREE from 'three';
import { EYE_HEIGHT } from '../config/tuning.js';
import { clamp } from '../core/math.js';
import { GameState } from '../core/GameState.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Pooled enemy bullets. They travel on world time, so standing still
 * freezes them mid-air — the core dodge mechanic.
 */
export class EnemyProjectiles {
  constructor(scene, assets, max = 70) {
    this.pool = [];
    this.active = [];
    for (let i = 0; i < max; i++) {
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(assets.geo.bullet, assets.mat.bullet));
      mesh.add(new THREE.Mesh(assets.geo.bulletTrail, assets.mat.bulletTrail));
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({
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

  spawn(origin, dir, speed, dmg) {
    const b = this.pool.find((x) => !x.live);
    if (!b) return null;
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
  }

  clear() {
    while (this.active.length) this._removeAt(this.active.length - 1);
  }

  destroyWithin(pos, radius) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].pos.distanceTo(pos) < radius) this._removeAt(i);
    }
  }

  update(wdt, game) {
    const { player: p, grid, effects } = game;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, wdt);
      b.mesh.position.copy(b.pos);
      b.life -= wdt;
      b.trail += b.vel.length() * wdt;
      if (b.trail > 0.7) {
        b.trail = 0;
        effects.emit(b.pos.x, b.pos.y, b.pos.z, 0, 0, 0, 0.5, 0.6, 0.0, 0.18, 0, 0);
      }

      if (game.state === GameState.PLAYING && this._hitsPlayer(b, p)) {
        if (p.invuln > 0) continue; // dashing through bullets
        game.combat.hurtPlayer(b.dmg, b.prev.x - b.vel.x, b.prev.z - b.vel.z);
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
