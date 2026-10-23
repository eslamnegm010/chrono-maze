import * as THREE from 'three';
import { TUNE, EYE_HEIGHT } from '../config/tuning.js';
import { clamp, damp } from '../core/math.js';
import { pushFromCircle } from '../core/geometry.js';

const _n = { x: 0, z: 0 };
const _wish = new THREE.Vector3();

/**
 * Player body: health, kinematics (accelerated movement, wall sliding,
 * coyote-time jumps, invulnerable dash) and look angles. Runs in real time —
 * the player is never slowed by time dilation.
 */
export class Player {
  constructor(grid, spawn) {
    this.grid = grid;
    this.spawn = spawn;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.dashDir = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.pos.set(this.grid.cellX(this.spawn.c), 0, this.grid.cellZ(this.spawn.r));
    this.vel.set(0, 0, 0);
    this.yaw = this.spawn.yaw ?? 0;
    this.pitch = 0;
    this.hp = TUNE.maxHp;
    this.onGround = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.dashT = 0;
    this.dashCd = 0;
    this.invuln = 0;
    this.lastHit = 99;
    // View feel (read by CameraRig / Viewmodel)
    this.bobPhase = 0;
    this.landDip = 0;
    this.tilt = 0;
  }

  get eyeY() {
    return this.pos.y + EYE_HEIGHT;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get isDashing() {
    return this.dashT > 0;
  }

  look(dx, dy, sensitivity) {
    this.yaw -= dx * sensitivity;
    this.pitch = clamp(this.pitch - dy * sensitivity, -1.45, 1.45);
  }

  /** Keyboard turning (arrow keys) — accessibility & pointer-lock fallback. */
  turn(keys, dt) {
    this.yaw += ((keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0)) * 2.4 * dt;
    this.pitch = clamp(this.pitch + ((keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0)) * 1.6 * dt, -1.45, 1.45);
  }

  /** World-space desired move direction from WASD, length ≤ 1. */
  wishDir(keys, out) {
    const iz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    out.set(-sy * iz + cy * ix, 0, -cy * iz - sy * ix);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  queueJump() {
    this.jumpBuffer = TUNE.jumpBuffer;
  }

  /** Starts a dash toward the input direction (or forward). Returns false while on cooldown. */
  tryDash(keys) {
    if (this.dashCd > 0) return false;
    const w = this.wishDir(keys, _wish);
    if (w.lengthSq() < 1e-6) w.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.dashDir.copy(w).normalize();
    this.dashT = TUNE.dashTime;
    this.dashCd = TUNE.dashCooldown;
    this.invuln = TUNE.dashTime + 0.1;
    if (!this.onGround && this.vel.y < 0) this.vel.y = 0;
    return true;
  }

  /** Cooldowns and shield regeneration. */
  tick(dt, canRegen) {
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.lastHit += dt;
    if (canRegen && this.lastHit > TUNE.regenDelay && this.hp < TUNE.maxHp) {
      this.hp = Math.min(TUNE.maxHp, this.hp + TUNE.regenRate * dt);
    }
  }

  /** Bleeds off velocity when not controllable (death cam). */
  coast(dt) {
    const k = 1 - damp(6, dt);
    this.vel.x *= k;
    this.vel.z *= k;
  }

  /**
   * Integrates movement for one frame.
   * @param obstacles circles to collide with: [{x, z, r}]
   * @returns {{jumped: boolean, landed: boolean}}
   */
  move(dt, keys, obstacles) {
    const events = { jumped: false, landed: false };
    const wish = this.wishDir(keys, _wish);

    if (this.dashT > 0) {
      this.dashT -= dt;
      const s = this.dashT > 0 ? TUNE.dashSpeed : TUNE.walkSpeed * 1.1;
      this.vel.x = this.dashDir.x * s;
      this.vel.z = this.dashDir.z * s;
    } else {
      const k = damp(this.onGround ? TUNE.groundAccel : TUNE.airAccel, dt);
      this.vel.x += (wish.x * TUNE.walkSpeed - this.vel.x) * k;
      this.vel.z += (wish.z * TUNE.walkSpeed - this.vel.z) * k;
    }

    // Sub-step so fast dashes never tunnel, then slide along whatever we touched.
    const r = TUNE.playerRadius;
    const steps = Math.max(1, Math.ceil((this.speed * dt) / (r * 0.8)));
    let nx = 0;
    let nz = 0;
    for (let i = 0; i < steps; i++) {
      this.pos.x += (this.vel.x * dt) / steps;
      this.pos.z += (this.vel.z * dt) / steps;
      if (this.grid.resolveCircle(this.pos, r, _n)) {
        nx += _n.x;
        nz += _n.z;
      }
      _n.x = _n.z = 0;
      for (const o of obstacles) pushFromCircle(this.pos, r, o.x, o.z, o.r, _n);
      nx += _n.x;
      nz += _n.z;
    }
    const nl = Math.hypot(nx, nz);
    if (nl > 1e-6) {
      nx /= nl;
      nz /= nl;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn < 0) {
        this.vel.x -= nx * vn;
        this.vel.z -= nz * vn;
      }
    }

    this.coyote = this.onGround ? TUNE.coyoteTime : Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && (this.onGround || this.coyote > 0)) {
      this.vel.y = TUNE.jumpVel;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      events.jumped = true;
    }
    if (!this.onGround) {
      this.vel.y -= TUNE.gravity * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= 0) {
        if (this.vel.y < -6) {
          this.landDip = Math.min(0.25, -this.vel.y * 0.02);
          events.landed = true;
        }
        this.pos.y = 0;
        this.vel.y = 0;
        this.onGround = true;
      }
    }
    return events;
  }
}
