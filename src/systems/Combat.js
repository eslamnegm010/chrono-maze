import * as THREE from 'three';
import { TUNE } from '../config/tuning.js';
import { clamp } from '../core/math.js';
import { rayBox, raySphere } from '../core/geometry.js';
import { GameState } from '../core/GameState.js';

const _box = {};
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * Everything that deals or takes damage: the hitscan laser, the thrown
 * weapon, barrel explosions, enemy hits/kills and player damage.
 */
export class Combat {
  constructor(game) {
    this.game = game;
    this.thrown = {
      mesh: game.viewmodel.createThrowable(game.scene),
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
    };
    this.reset();
  }

  reset() {
    this.fireCd = 0;
    this.gunReady = true;
    this.gunReturn = 0;
    this.thrown.active = false;
    this.thrown.mesh.visible = false;
  }

  get canFire() {
    return this.gunReady && this.fireCd <= 0;
  }

  tick(dt) {
    this.fireCd = Math.max(0, this.fireCd - dt);
    if (!this.gunReady && (this.gunReturn -= dt) <= 0) {
      this.gunReady = true;
      this.game.viewmodel.raiseGun();
    }
  }

  /* ───────────── player offence ───────────── */

  fire() {
    const g = this.game;
    if (g.state !== GameState.PLAYING || !this.canFire) return;
    this.fireCd = TUNE.fireCooldown;
    g.time.pulse(0.1);
    g.camRig.addTrauma(0.08);
    g.audio.shoot();
    g.viewmodel.onFire();

    g.camera.updateMatrixWorld();
    const o = g.camera.getWorldPosition(_o);
    const d = g.camera.getWorldDirection(_d);
    const hit = this._traceShot(o, d);

    _hit.copy(o).addScaledVector(d, hit.t);
    g.effects.tracer(g.viewmodel.muzzleWorld(_muzzle), _hit);

    switch (hit.kind) {
      case 'wall':
        _dir.copy(d).negate();
        g.effects.burst(_hit.x - d.x * 0.1, _hit.y - d.y * 0.1, _hit.z - d.z * 0.1, 14, 5, 0x00f3ff, { life: 0.5, dir: _dir });
        break;
      case 'head':
        this.damageEnemy(hit.target, Infinity, d, 'head');
        break;
      case 'body':
        this.damageEnemy(hit.target, 1, d, 'body');
        break;
      case 'barrel':
        this.explodeBarrel(hit.target);
        break;
      case 'bullet':
        g.effects.burst(hit.target.pos.x, hit.target.pos.y, hit.target.pos.z, 18, 4, 0xffe600, { life: 0.5, grav: 2 });
        g.projectiles.remove(hit.target);
        g.scoring.add(TUNE.deflectScore, 'DEFLECT', 'yellow');
        g.audio.deflect();
        g.notifier.hitmarker(false);
        break;
    }
    // Gunshots are loud: nearby enemies come looking.
    g.enemies.alertWithin(g.player.pos, TUNE.hearRange);
  }

  /** Nearest thing the laser hits: wall/floor, enemy head/body, barrel or enemy bullet. */
  _traceShot(o, d) {
    const g = this.game;
    const hit = { t: g.grid.raycast(o, d, TUNE.hitscanRange), kind: 'wall', target: null };
    const consider = (t, kind, target) => {
      if (t < hit.t) Object.assign(hit, { t, kind, target });
    };
    for (const e of g.enemies.alive()) {
      if (e.spawnT < 0.5) continue;
      const s = e.scale;
      consider(raySphere(o, d, e.pos.x, TUNE.headY * s, e.pos.z, TUNE.headR * s), 'head', e);
      _box.minX = e.pos.x - TUNE.bodyHalf * s;
      _box.maxX = e.pos.x + TUNE.bodyHalf * s;
      _box.minZ = e.pos.z - TUNE.bodyHalf * s;
      _box.maxZ = e.pos.z + TUNE.bodyHalf * s;
      _box.minY = 0;
      _box.maxY = TUNE.bodyTop * s;
      consider(rayBox(o, d, _box), 'body', e);
    }
    for (const b of g.barrels.items) {
      if (b.alive) consider(raySphere(o, d, b.pos.x, 1, b.pos.z, 1.05), 'barrel', b);
    }
    for (const b of g.projectiles.active) consider(raySphere(o, d, b.pos.x, b.pos.y, b.pos.z, 0.5), 'bullet', b);
    return hit;
  }

  throwWeapon() {
    const g = this.game;
    if (g.state !== GameState.PLAYING || !this.gunReady) return;
    this.gunReady = false;
    this.gunReturn = TUNE.gunRespawn;
    g.viewmodel.setVisible(false);
    g.audio.throwWeapon();
    g.time.pulse(0.15);
    g.camera.updateMatrixWorld();
    const o = g.camera.getWorldPosition(_o);
    const d = g.camera.getWorldDirection(_d);
    const t = this.thrown;
    t.active = true;
    t.pos.copy(o).addScaledVector(d, 0.6);
    t.pos.y -= 0.15;
    t.vel.copy(d).multiplyScalar(TUNE.throwSpeed);
    t.vel.y += 1.5;
    t.mesh.position.copy(t.pos);
    t.mesh.quaternion.copy(g.camera.quaternion);
    t.mesh.visible = true;
  }

  updateThrown(dt) {
    const t = this.thrown;
    if (!t.active) return;
    const g = this.game;
    const tdt = dt * Math.max(g.time.scale, 0.4);
    t.vel.y -= TUNE.throwGravity * tdt;
    t.pos.addScaledVector(t.vel, tdt);
    t.mesh.position.copy(t.pos);
    t.mesh.rotateX(-18 * tdt);
    g.effects.emit(t.pos.x, t.pos.y, t.pos.z, 0, 0, 0, 0.3, 0.0, 0.8, 1.0, 0, 0);

    const end = (color) => {
      g.effects.burst(t.pos.x, t.pos.y, t.pos.z, 20, 5, color, { life: 0.5 });
      t.active = false;
      t.mesh.visible = false;
    };
    for (const e of g.enemies.alive()) {
      if (Math.hypot(e.pos.x - t.pos.x, e.pos.z - t.pos.z) < 0.85 * e.scale && t.pos.y < 2.2 * e.scale) {
        this.killEnemy(e, _dir.copy(t.vel).normalize(), 'throw');
        return end(0xff0055);
      }
    }
    for (const b of g.barrels.items) {
      if (b.alive && b.pos.distanceTo(t.pos) < 1.3) {
        this.explodeBarrel(b);
        return end(0xffaa22);
      }
    }
    if (t.pos.y < 0.1 || g.grid.pointInSolid(t.pos)) end(0x00f3ff);
  }

  /* ───────────── damage resolution ───────────── */

  damageEnemy(e, dmg, dir, cause) {
    if (!e.alive) return;
    e.hp -= dmg;
    if (e.hp <= 0) {
      this.killEnemy(e, dir, cause);
      return;
    }
    const g = this.game;
    g.notifier.hitmarker(false);
    g.audio.hit();
    e.stun(dir);
    g.effects.burst(e.pos.x, 1.2 * e.scale, e.pos.z, 16, 4, 0x9b30ff, { life: 0.4, dir });
  }

  killEnemy(e, dir, cause) {
    if (!e.alive) return;
    const g = this.game;
    g.enemies.remove(e);
    g.playAt('shatter', e.pos);
    if (cause === 'head') g.audio.headshot();
    g.notifier.hitmarker(true);
    g.scoring.registerKill(e.type, cause);
    g.effects.shatter(e.pos, e.scale, dir, e.model.palette);
    if (cause === 'head') g.effects.burst(e.pos.x, TUNE.headY * e.scale, e.pos.z, 25, 6, 0xffffff, { life: 0.5 });
  }

  explodeBarrel(b) {
    if (!b.alive) return;
    const g = this.game;
    const p = g.player;
    g.barrels.destroy(b);
    g.playAt('explosion', b.pos);
    g.effects.explosion(b.pos, TUNE.blastRadius);

    const pd = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
    g.camRig.addTrauma(clamp(1 - pd / 40, 0.1, 0.9));
    g.scoring.add(TUNE.barrelScore, 'PLASMA BLAST', 'yellow');
    g.notifier.announce('PLASMA BLAST 💥', 'yellow', 700);

    for (const e of [...g.enemies.alive()]) {
      if (Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z) < TUNE.blastRadius) {
        const dir = new THREE.Vector3(e.pos.x - b.pos.x, 0.4, e.pos.z - b.pos.z).normalize();
        this.killEnemy(e, dir, 'blast');
      }
    }
    g.barrels.armWithin(b.pos, TUNE.blastRadius, TUNE.blastChainDelay);
    g.projectiles.destroyWithin(b.pos, TUNE.blastRadius * 0.7);
    if (pd < TUNE.blastPlayerRadius && p.invuln <= 0 && g.state === GameState.PLAYING) {
      this.hurtPlayer(Math.round(TUNE.blastPlayerDmg * (1 - pd / TUNE.blastPlayerRadius) + 8), b.pos.x, b.pos.z);
    }
  }

  hurtPlayer(dmg, fromX, fromZ) {
    const g = this.game;
    const p = g.player;
    p.hp -= dmg;
    p.lastHit = 0;
    g.camRig.flashDamage();
    g.camRig.addTrauma(0.35);
    g.audio.damage();

    // Direction of the hit relative to where the player is looking (0 = front, + = right).
    const dx = fromX - p.pos.x;
    const dz = fromZ - p.pos.z;
    const lx = dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw);
    const lz = dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw);
    g.notifier.damage(Math.atan2(lx, -lz));

    if (p.hp <= 0) {
      p.hp = 0;
      g.onPlayerDeath();
    }
  }
}
