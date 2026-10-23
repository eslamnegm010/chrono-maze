import { TUNE } from '../config/tuning.js';
import { damp } from '../core/math.js';

/** First-person camera: head bob, strafe tilt, landing dip, trauma shake, FOV kick, death cam. */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.reset();
  }

  reset() {
    this.trauma = 0;
    this.fovKick = 0;
    this.damageFx = 0;
  }

  addTrauma(v) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  kickFov() {
    this.fovKick = 1;
  }

  flashDamage() {
    this.damageFx = 1;
  }

  /** Slow idle orbit behind the main menu. */
  attract(dt, player, realTime) {
    player.yaw += dt * 0.12;
    player.pitch = Math.sin(realTime * 0.3) * 0.08 + 0.05;
    this.camera.position.set(player.pos.x, player.eyeY + 0.4, player.pos.z);
    this.camera.rotation.set(player.pitch, player.yaw, 0);
  }

  update(dt, player, keys, { playing, dying, dieT, realTime }) {
    const p = player;
    const sf = Math.min(1, p.speed / TUNE.walkSpeed);
    if (p.onGround && p.speed > 0.5) p.bobPhase += p.speed * dt * 1.15;
    const bobY = Math.sin(p.bobPhase * 2) * 0.045 * sf;
    const bobX = Math.cos(p.bobPhase) * 0.028 * sf;
    p.landDip += (0 - p.landDip) * damp(8, dt);

    const tiltTarget = dying ? 0.5 : playing ? (keys.KeyA ? 0.022 : 0) - (keys.KeyD ? 0.022 : 0) : 0;
    p.tilt += (tiltTarget - p.tilt) * damp(dying ? 2 : 8, dt);

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const sh = this.trauma * this.trauma;
    const t = realTime * 40;
    const shakeP = Math.sin(t * 1.1) * 0.03 * sh;
    const shakeY = Math.sin(t * 0.9 + 1.3) * 0.03 * sh;
    const shakeR = Math.sin(t * 1.3 + 2.1) * 0.04 * sh;

    let eyeY = p.eyeY + bobY - p.landDip;
    if (dying) eyeY = Math.max(0.35, p.eyeY - dieT * 1.2);
    this.camera.position.set(p.pos.x + bobX * Math.cos(p.yaw), eyeY, p.pos.z - bobX * Math.sin(p.yaw));
    this.camera.rotation.set(p.pitch + shakeP, p.yaw + shakeY, p.tilt + shakeR);

    this.fovKick = Math.max(0, this.fovKick - dt * 3);
    const fov = 78 + this.fovKick * 12 + sf * 3;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.damageFx = Math.max(0, this.damageFx - dt * 2.5);
  }
}
