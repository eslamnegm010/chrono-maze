import * as THREE from 'three';
import { TUNE, ENEMY_TYPES } from '../config/tuning.js';
import { damp, lerpAngle, rand } from '../core/math.js';
import { GameState } from '../core/GameState.js';
import { buildEnemyModel } from './EnemyModel.js';

const UP = new THREE.Vector3(0, 1, 0);
const _eye = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _target = { x: 0, z: 0 };

export const EnemyState = Object.freeze({ PATROL: 'patrol', HUNT: 'hunt' });

/**
 * One enemy robot: PATROL wanders between random cells; HUNT keeps a
 * preferred range from the player, strafes, follows the player flow field
 * when sight is lost, and fires telegraphed shots. All AI runs on world time.
 */
export class Enemy {
  /**
   * @param game     the Game (context: grid, player, time, audio, effects, projectiles…)
   * @param typeKey  key into ENEMY_TYPES
   * @param difficulty from waveComposition(): { fireMul, spread }
   */
  constructor(game, x, z, typeKey, difficulty) {
    this.game = game;
    this.type = ENEMY_TYPES[typeKey];
    this.model = buildEnemyModel(game.assets, this.type);
    this.scale = this.type.scale;
    this.radius = TUNE.enemyRadius * this.scale;
    this.hp = this.type.hp;
    this.alive = true;
    this.state = EnemyState.PATROL;
    this.yaw = Math.random() * Math.PI * 2;
    this.spawnT = 0;
    this.flashT = 0;
    this.stagger = 0;
    this.windup = 0;
    this.fireMul = difficulty.fireMul;
    this.spread = difficulty.spread;
    this.fireCd = rand(1.6, 2.6) * this.fireMul;
    this.lostT = 0;
    this.idleT = 0;
    this.seed = Math.random() * 100;
    this.walkPhase = Math.random() * 10;
    this.canSee = false;
    this.lastSeen = new THREE.Vector3();
    this.patrolField = game.grid.createField();
    this.hasPatrol = false;

    this.model.root.position.set(x, 0, z);
    this.model.root.scale.setScalar(0.01);
    game.scene.add(this.model.root, this.model.aim);
    this.pickPatrol();
    game.effects.burst(x, 1.2, z, 30, 5, this.model.palette.fx, { life: 0.8, grav: -2, drag: 2 });
  }

  get pos() {
    return this.model.root.position;
  }

  get isHunting() {
    return this.state === EnemyState.HUNT;
  }

  get spawned() {
    return this.spawnT >= 1;
  }

  dispose() {
    this.game.scene.remove(this.model.root, this.model.aim);
  }

  alert(playSound) {
    if (this.state === EnemyState.HUNT) return;
    this.state = EnemyState.HUNT;
    this.model.beacon.visible = true;
    this.lostT = 0;
    this.fireCd = Math.max(this.fireCd, rand(0.6, 1.1));
    this.lastSeen.copy(this.game.player.pos);
    if (playSound) this.game.playAt('alert', this.pos);
  }

  /** Applies a non-lethal hit reaction (Combat decides lethality). */
  stun(dir) {
    this.flashT = 0.08;
    this.stagger = 0.4;
    this.cancelWindup();
    this.pos.x += dir.x * 0.5;
    this.pos.z += dir.z * 0.5;
    this.alert(false);
  }

  cancelWindup() {
    this.windup = 0;
    this.model.aim.visible = false;
  }

  pickPatrol() {
    const grid = this.game.grid;
    for (let tries = 0; tries < 20; tries++) {
      const c = 1 + Math.floor(Math.random() * (grid.cols - 2));
      const r = 1 + Math.floor(Math.random() * (grid.rows - 2));
      if (!grid.isWalkable(c, r)) continue;
      grid.bfs(c, r, this.patrolField);
      this.hasPatrol = true;
      return;
    }
    this.hasPatrol = false;
  }

  update(dt, wdt) {
    const g = this.game;
    const p = g.player;
    const m = this.model;
    const s = this.scale;
    const animDt = dt * Math.max(g.time.scale, 0.3);

    if (this.spawnT < 1) {
      this.spawnT = Math.min(1, this.spawnT + animDt / 0.7);
      m.root.scale.setScalar(s * (0.01 + 0.99 * (1 - Math.pow(1 - this.spawnT, 3))));
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      const mat = this.flashT > 0 ? g.assets.mat.flash : m.palette.body;
      for (const f of m.flashables) f.material = mat;
    }

    // Perception
    const toX = p.pos.x - this.pos.x;
    const toZ = p.pos.z - this.pos.z;
    const dist = Math.hypot(toX, toZ) || 1e-4;
    const nx = toX / dist;
    const nz = toZ / dist;
    _eye.set(p.pos.x, p.eyeY, p.pos.z);
    _from.set(this.pos.x, 1.6 * s, this.pos.z);
    this.canSee = g.state !== GameState.DYING && dist < TUNE.viewRange && g.grid.hasLineOfSight(_from, _eye);

    if (this.state === EnemyState.PATROL && this.spawned && this.canSee) {
      const facing = Math.sin(this.yaw) * nx + Math.cos(this.yaw) * nz;
      if (facing > 0.3 || dist < 14) this.alert(true);
    }
    if (this.state === EnemyState.HUNT) {
      if (this.canSee) {
        this.lastSeen.copy(p.pos);
        this.lostT = 0;
      } else if ((this.lostT += wdt) > TUNE.loseTrackAfter) {
        this.state = EnemyState.PATROL;
        m.beacon.visible = false;
        this.pickPatrol();
      }
    }

    // Steering
    const { mx, mz, speed: baseSpeed, faceYaw } = this._steer(wdt, toX, toZ, dist, nx, nz);
    let speed = baseSpeed;
    if (!this.spawned) speed = 0;
    if (this.stagger > 0) {
      this.stagger -= wdt;
      speed *= 0.2;
    }
    speed *= this.type.speedMul;

    const ox = this.pos.x;
    const oz = this.pos.z;
    this.pos.x += mx * speed * wdt;
    this.pos.z += mz * speed * wdt;
    this.yaw = lerpAngle(this.yaw, faceYaw, damp(this.isHunting ? 10 : 5, wdt));
    m.root.rotation.y = this.yaw;

    this._animate(wdt, animDt, ox, oz);
    this._updateFiring(wdt);
  }

  _steer(wdt, toX, toZ, dist, nx, nz) {
    const g = this.game;
    let mx = 0;
    let mz = 0;
    let speed = 0;
    let faceYaw = this.yaw;

    if (this.state === EnemyState.PATROL) {
      if (this.idleT > 0) {
        this.idleT -= wdt;
        if (this.idleT <= 0) this.pickPatrol();
      } else if (this.hasPatrol && g.grid.stepAlongField(this.pos, this.patrolField, _target)) {
        mx = _target.x - this.pos.x;
        mz = _target.z - this.pos.z;
        speed = 1.8;
        faceYaw = Math.atan2(mx, mz);
      } else {
        this.idleT = rand(1.2, 3);
      }
    } else {
      if (this.canSee) {
        const desired = this.type.preferredRange;
        const fwd = dist > desired + 4 ? 1 : dist < desired - 7 ? -0.7 : 0;
        const strafe = Math.sin(g.time.world * 0.7 + this.seed) * 0.85;
        mx = nx * fwd - nz * strafe;
        mz = nz * fwd + nx * strafe;
        speed = 3.4;
      } else if (g.grid.stepAlongField(this.pos, g.enemies.playerField, _target)) {
        mx = _target.x - this.pos.x;
        mz = _target.z - this.pos.z;
        speed = 3.9;
      } else {
        mx = this.lastSeen.x - this.pos.x;
        mz = this.lastSeen.z - this.pos.z;
        speed = 3.4;
      }
      if (this.canSee) faceYaw = Math.atan2(toX, toZ);
      else if (Math.abs(mx) + Math.abs(mz) > 0.01) faceYaw = Math.atan2(mx, mz);
      if (this.windup > 0) speed *= 0.2;
    }

    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    return { mx, mz, speed, faceYaw };
  }

  _animate(wdt, animDt, ox, oz) {
    const m = this.model;
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz) / Math.max(wdt, 1e-5);
    this.walkPhase += moved * wdt * 2.4;
    const swing = Math.sin(this.walkPhase) * Math.min(0.65, moved * 0.2);
    m.legL.rotation.x = swing;
    m.legR.rotation.x = -swing;
    m.armL.rotation.x = -swing * 0.8;
    m.body.position.y = Math.abs(Math.cos(this.walkPhase)) * Math.min(0.06, moved * 0.02);
    const armTarget = this.isHunting ? -Math.PI / 2 + (this.windup > 0 ? 0 : Math.sin(this.game.time.world * 3 + this.seed) * 0.05) : -0.35;
    m.armR.rotation.x += (armTarget - m.armR.rotation.x) * damp(10, animDt);
    m.tip.scale.setScalar(this.windup > 0 ? 1 + (1 - this.windup / this.type.windup) * 2.2 : 1);
  }

  /** Telegraphed firing: cooldown → wind-up (glow + laser sight) → shot. */
  _updateFiring(wdt) {
    const g = this.game;
    if (this.isHunting && this.canSee && this.spawned && g.state === GameState.PLAYING) {
      if (this.windup > 0) {
        this.windup -= wdt;
        this._updateAimLine();
        if (this.windup <= 0) {
          this.model.aim.visible = false;
          this._fire();
        }
      } else if ((this.fireCd -= wdt) <= 0) {
        this.windup = this.type.windup;
        this.model.aim.visible = true;
        g.playAt('windup', this.pos);
      }
    } else if (this.windup > 0) {
      this.cancelWindup();
      this.fireCd = Math.max(this.fireCd, 0.5);
    }
  }

  _updateAimLine() {
    const p = this.game.player;
    const aim = this.model.aim;
    this.model.tip.getWorldPosition(_tip);
    _to.set(p.pos.x, p.eyeY - 0.3, p.pos.z).sub(_tip);
    const len = _to.length();
    if (len < 3) {
      aim.visible = false;
      return;
    }
    _to.divideScalar(len);
    // Stops short of the player so the beam reads as a warning, not a smear across the camera.
    const shown = Math.min(len - 2.5, this.game.grid.raycast(_tip, _to, len));
    aim.visible = true;
    aim.position.copy(_tip).addScaledVector(_to, shown / 2);
    aim.quaternion.setFromUnitVectors(UP, _to);
    const w = 0.01 + (1 - this.windup / this.type.windup) * 0.02;
    aim.scale.set(w, shown, w);
  }

  _fire() {
    const g = this.game;
    const p = g.player;
    const T = this.type;
    this.fireCd = rand(1.6, 2.6) * this.fireMul;
    const origin = this.model.tip.getWorldPosition(new THREE.Vector3());
    const target = _to.set(p.pos.x, p.eyeY - 0.3, p.pos.z);
    const lead = (origin.distanceTo(target) / T.bulletSpeed) * 0.4;
    target.x += p.vel.x * lead;
    target.z += p.vel.z * lead;
    const dir = target.sub(origin).normalize();
    for (let i = 0; i < T.pellets; i++) {
      const d = dir.clone();
      const side = (i - (T.pellets - 1) / 2) * T.pelletSpread;
      d.applyAxisAngle(UP, side + rand(-this.spread, this.spread));
      d.y += rand(-this.spread, this.spread) * 0.6;
      d.normalize();
      g.projectiles.spawn(origin, d, T.bulletSpeed, T.bulletDamage);
    }
    g.playAt('enemyShoot', this.pos);
    g.effects.burst(origin.x, origin.y, origin.z, 8, 3, 0xff3366, { life: 0.25, grav: 0 });
  }
}
