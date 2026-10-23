import { TUNE } from '../config/tuning.js';
import { clamp, damp } from '../core/math.js';

/**
 * The signature mechanic: the world's time scale follows the player's
 * movement. Standing still ≈ frozen; walking/jumping/dashing/firing/looking
 * around each push time forward by a different amount.
 */
export class TimeController {
  constructor() {
    this.reset();
  }

  reset() {
    this.scale = TUNE.timeMin;
    this.world = 0;
    this.firePulse = 0;
    this.lookActivity = 0;
    this.lookAccum = 0;
  }

  /** Mouse movement in pixels since last frame. */
  addLook(px) {
    this.lookAccum += px;
  }

  /** Briefly forces time forward (shooting, throwing). */
  pulse(seconds) {
    this.firePulse = Math.max(this.firePulse, seconds);
  }

  /** @returns world delta-time for this frame */
  update(dt, player, dying) {
    this.firePulse = Math.max(0, this.firePulse - dt);
    const lookRate = this.lookAccum / Math.max(dt, 1e-4);
    this.lookAccum = 0;
    this.lookActivity += (clamp(lookRate / 2500, 0, 1) - this.lookActivity) * damp(8, dt);

    let target = TUNE.timeMin + (TUNE.timeMove - TUNE.timeMin) * Math.min(1, player.speed / TUNE.walkSpeed);
    if (!player.onGround) target = Math.max(target, TUNE.timeAir);
    if (player.isDashing) target = 1;
    target = Math.max(target, TUNE.timeMin + this.lookActivity * TUNE.timeLook);
    if (this.firePulse > 0) target = Math.max(target, TUNE.timeFire);
    if (dying) target = 0.22;

    this.scale += (target - this.scale) * damp(target > this.scale ? 14 : 7, dt);
    const wdt = dt * this.scale;
    this.world += wdt;
    return wdt;
  }

  get frozen() {
    return this.scale < 0.2;
  }
}
