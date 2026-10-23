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
const THROWABLES = 4;

/**
 * Everything that deals or takes damage: the hitscan laser, thrown weapons,
 * barrel explosions, enemy hits/kills and player damage.
 *
 * Authority: in solo and on the multiplayer host, damage is resolved here.
 * A client only shows its own shot locally and asks the host to resolve it.
 */
export class Combat {
  constructor(game) {
    this.game = game;
    this.thrown = [];
    for (let i = 0; i < THROWABLES; i++) {
      this.thrown.push({
        mesh: game.viewmodel.createThrowable(game.scene),
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
      });
    }
    this.reset();
  }

  reset() {
    this.fireCd = 0;
    this.gunReady = true;
    this.gunReturn = 0;
    for (const t of this.thrown) {
      t.active = false;
      t.mesh.visible = false;
    }
  }

  get canFire() {
    return this.gunReady && this.fireCd <= 0 && !this.game.player.down;
  }

  tick(dt) {
    this.fireCd = Math.max(0, this.fireCd - dt);
    if (!this.gunReady && (this.gunReturn -= dt) <= 0) {
      this.gunReady = true;
      this.game.viewmodel.raiseGun();
    }
  }

  /** The local player as a shooter (name/colour for feed and tracers). */
  get localShooter() {
    const g = this.game;
    return { id: g.selfId, name: g.identity.name, color: g.identity.color.hex };
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
    const muzzle = g.viewmodel.muzzleWorld(_muzzle);

    if (g.isClient) {
      // Show the beam now (against the replicas), let the host decide what it hit.
      const hit = this._traceShot(o, d);
      _hit.copy(o).addScaledVector(d, hit.t);
      g.effects.tracer(muzzle, _hit, this.localShooter.color);
      if (hit.kind === 'wall') this._wallSparks(d);
      g.net.sendFire(o, d, muzzle);
      return;
    }
    this.resolveShot(o, d, muzzle, this.localShooter);
  }

  /** Authoritative shot from any player. Returns the hit description. */
  resolveShot(o, d, muzzle, shooter) {
    const g = this.game;
    const hit = this._traceShot(o, d);
    _hit.copy(o).addScaledVector(d, hit.t);
    g.fx.tracer(muzzle, _hit, shooter.color, shooter.id);

    switch (hit.kind) {
      case 'wall':
        this._wallSparks(d);
        break;
      case 'head':
        this.damageEnemy(hit.target, Infinity, d, 'head', shooter);
        break;
      case 'body':
        this.damageEnemy(hit.target, 1, d, 'body', shooter);
        break;
      case 'barrel':
        this.explodeBarrel(hit.target);
        break;
      case 'bullet':
        g.effects.burst(hit.target.pos.x, hit.target.pos.y, hit.target.pos.z, 18, 4, 0xffe600, { life: 0.5, grav: 2 });
        g.projectiles.remove(hit.target);
        g.scoring.add(TUNE.deflectScore, 'DEFLECT', 'yellow');
        g.confirmHit(shooter, false);
        if (shooter.id === g.selfId) g.audio.deflect();
        break;
    }
    // Gunshots are loud: nearby enemies come looking.
    g.enemies.alertWithin(o, TUNE.hearRange);
    return hit;
  }

  _wallSparks(d) {
    _dir.copy(d).negate();
    this.game.effects.burst(_hit.x - d.x * 0.1, _hit.y - d.y * 0.1, _hit.z - d.z * 0.1, 14, 5, 0x00f3ff, { life: 0.5, dir: _dir });
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
    if (g.state !== GameState.PLAYING || !this.gunReady || g.player.down) return;
    this.gunReady = false;
    this.gunReturn = TUNE.gunRespawn;
    g.viewmodel.setVisible(false);
    g.audio.throwWeapon();
    g.time.pulse(0.15);
    g.camera.updateMatrixWorld();
    const o = g.camera.getWorldPosition(_o).addScaledVector(g.camera.getWorldDirection(_d), 0.6);
    o.y -= 0.15;
    const vel = _d.clone().multiplyScalar(TUNE.throwSpeed);
    vel.y += 1.5;
    // A client's copy is cosmetic; the host simulates the one that counts.
    this.launch(o, vel, g.isClient ? null : this.localShooter);
    if (g.isClient) g.net.sendThrow(o, vel);
  }

  /** @param shooter null for a cosmetic (client-side) throw */
  launch(pos, vel, shooter) {
    const t = this.thrown.find((x) => !x.active) ?? this.thrown[0];
    t.active = true;
    t.shooter = shooter;
    t.pos.copy(pos);
    t.vel.copy(vel);
    t.mesh.position.copy(pos);
    t.mesh.lookAt(_o.copy(pos).add(vel));
    t.mesh.visible = true;
  }

  updateThrown(dt) {
    for (const t of this.thrown) if (t.active) this._updateThrown(t, dt);
  }

  _updateThrown(t, dt) {
    const g = this.game;
    const tdt = dt * Math.max(g.timeField.scaleAt(t.pos), 0.4);
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
        if (t.shooter) this.killEnemy(e, _dir.copy(t.vel).normalize(), 'throw', t.shooter);
        return end(0xff0055);
      }
    }
    for (const b of g.barrels.items) {
      if (b.alive && b.pos.distanceTo(t.pos) < 1.3) {
        if (t.shooter) this.explodeBarrel(b);
        return end(0xffaa22);
      }
    }
    if (t.pos.y < 0.1 || g.grid.pointInSolid(t.pos)) end(0x00f3ff);
  }

  /* ───────────── damage resolution (authoritative) ───────────── */

  damageEnemy(e, dmg, dir, cause, shooter = this.localShooter) {
    if (!e.alive) return;
    e.hp -= dmg;
    if (e.hp <= 0) {
      this.killEnemy(e, dir, cause, shooter);
      return;
    }
    const g = this.game;
    g.confirmHit(shooter, false);
    e.stun(dir);
    g.effects.burst(e.pos.x, 1.2 * e.scale, e.pos.z, 16, 4, 0x9b30ff, { life: 0.4, dir });
  }

  killEnemy(e, dir, cause, shooter = this.localShooter) {
    if (!e.alive) return;
    const g = this.game;
    g.enemies.remove(e);
    g.confirmHit(shooter, true, cause === 'head');
    g.scoring.registerKill(e.type, cause, g.isMultiplayer ? shooter.name : null);
    g.fx.shatter(e.pos, e.scale, dir, e.model.palette.key ?? e.type.palette, cause === 'head');
  }

  explodeBarrel(b) {
    if (!b.alive) return;
    const g = this.game;
    g.barrels.destroy(b);
    g.fx.explosion(b.pos);

    const p = g.player;
    const pd = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
    g.camRig.addTrauma(clamp(1 - pd / 40, 0.1, 0.9));
    g.scoring.add(TUNE.barrelScore, 'PLASMA BLAST', 'yellow');
    g.ui.announce('PLASMA BLAST 💥', 'yellow', 700);

    for (const e of [...g.enemies.alive()]) {
      if (Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z) < TUNE.blastRadius) {
        const dir = new THREE.Vector3(e.pos.x - b.pos.x, 0.4, e.pos.z - b.pos.z).normalize();
        this.killEnemy(e, dir, 'blast', { id: null, name: '💥', color: 0xffaa22 });
      }
    }
    g.barrels.armWithin(b.pos, TUNE.blastRadius, TUNE.blastChainDelay);
    g.projectiles.destroyWithin(b.pos, TUNE.blastRadius * 0.7);
    if (!g.simRunning) return;
    for (const t of g.targets()) {
      const d = Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
      if (d < TUNE.blastPlayerRadius && t.invuln <= 0) {
        this.hurtTarget(t, Math.round(TUNE.blastPlayerDmg * (1 - d / TUNE.blastPlayerRadius) + 8), b.pos.x, b.pos.z);
      }
    }
  }

  /** Damage any player: the local one directly, a remote one via the network. */
  hurtTarget(target, dmg, fromX, fromZ) {
    if (target === this.game.player) this.hurtPlayer(dmg, fromX, fromZ);
    else this.game.net?.sendHit(target.id, dmg, fromX, fromZ);
  }

  hurtPlayer(dmg, fromX, fromZ) {
    const g = this.game;
    const p = g.player;
    if (p.down) return;
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
