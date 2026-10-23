import * as THREE from 'three';
import { TUNE } from '../config/tuning.js';
import { clamp, damp } from '../core/math.js';
import { legacyIntensity, pointIntensity, POINT_DECAY } from '../render/lights.js';

const GUN_SCALE = 0.72;
const MUZZLE_Z = -0.76; // in gun-local units

/**
 * The first-person plasma pistol, rendered in its own scene/camera.
 * Handles sway, bob, recoil, raise animation, muzzle flash and lights.
 */
export class Viewmodel {
  constructor(weaponScene, weaponCam, mainCamera, assets) {
    this.weaponCam = weaponCam;
    this.mainCamera = mainCamera;

    weaponScene.add(new THREE.AmbientLight(0xffffff, legacyIntensity(0.35)));
    weaponScene.add(new THREE.HemisphereLight(0x6fa8ff, 0x2a0840, legacyIntensity(0.7)));
    const key = new THREE.DirectionalLight(0xbff4ff, legacyIntensity(0.9));
    key.position.set(1, 2, 1);
    weaponScene.add(key);
    this.gunLight = new THREE.PointLight(0x00f3ff, 0, 3, POINT_DECAY);
    this.gunLight.position.set(0.28, -0.15, -1.0);
    weaponScene.add(this.gunLight);
    this.gunLightPeak = pointIntensity(3);

    this.muzzleLight = new THREE.PointLight(0x00f3ff, 0, 18, POINT_DECAY);
    this.muzzleLight.position.set(0.3, -0.2, -1.2);
    mainCamera.add(this.muzzleLight);
    this.muzzleLightPeak = pointIntensity(4);

    this.coreMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff });
    this.gun = this._buildGun(assets);
    weaponScene.add(this.gun);

    this.reset();
  }

  _buildGun(assets) {
    const dark = new THREE.MeshStandardMaterial({ color: 0x161826, metalness: 0.9, roughness: 0.22 });
    const mid = new THREE.MeshStandardMaterial({ color: 0x2a2d45, metalness: 0.7, roughness: 0.35 });
    const pink = new THREE.MeshBasicMaterial({ color: 0xff0055 });
    const gun = new THREE.Group();
    const add = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      gun.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(0.1, 0.13, 0.42), dark, 0, 0, -0.12);
    add(new THREE.BoxGeometry(0.075, 0.085, 0.36), mid, 0, 0.005, -0.48);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.52), this.coreMat, 0, 0.075, -0.2);
    add(new THREE.BoxGeometry(0.105, 0.02, 0.3), this.coreMat, 0, -0.035, -0.14);
    add(new THREE.BoxGeometry(0.08, 0.24, 0.11), mid, 0, -0.15, 0.04, -0.28);
    add(new THREE.BoxGeometry(0.04, 0.05, 0.08), dark, 0, 0.095, 0.02);
    add(new THREE.BoxGeometry(0.11, 0.05, 0.05), pink, 0, -0.06, -0.3);
    add(new THREE.TorusGeometry(0.045, 0.012, 8, 20), this.coreMat, 0, 0.005, -0.67);

    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: assets.tex.flash, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.flash.position.set(0, 0.005, MUZZLE_Z);
    this.flash.scale.setScalar(0.22);
    this.flash.visible = false;
    gun.add(this.flash);
    gun.scale.setScalar(GUN_SCALE);
    return gun;
  }

  /** A world-space copy of the gun used as the thrown projectile. */
  createThrowable(scene) {
    const copy = this.gun.clone();
    copy.remove(copy.children[copy.children.length - 1]); // drop the flash sprite
    copy.visible = false;
    scene.add(copy);
    return copy;
  }

  reset() {
    this.recoil = 0;
    this.raise = 1;
    this.swayX = 0;
    this.swayY = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.flashT = 0;
  }

  addLook(dx, dy) {
    this.lookDX += dx;
    this.lookDY += dy;
  }

  setVisible(v) {
    this.gun.visible = v;
  }

  /** Re-equip animation after a throw. */
  raiseGun() {
    this.raise = 0;
    this.gun.visible = true;
  }

  onFire() {
    this.recoil = 1;
    this.muzzleLight.intensity = this.muzzleLightPeak;
    this.gunLight.intensity = this.gunLightPeak;
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flashT = 0.05;
  }

  /**
   * World position of the muzzle as seen through the main camera. The weapon
   * camera has a different FOV, so the view-space point is rescaled to land
   * on the same screen pixel.
   */
  muzzleWorld(out) {
    const deg = THREE.MathUtils.degToRad;
    const k = Math.tan(deg(this.mainCamera.fov / 2)) / Math.tan(deg(this.weaponCam.fov / 2));
    const tipZ = this.gun.position.z + MUZZLE_Z * GUN_SCALE;
    const s = k / -tipZ;
    out.set(this.gun.position.x * s, (this.gun.position.y + 0.005) * s, -1);
    return this.mainCamera.localToWorld(out);
  }

  update(dt, player, ready, hidden) {
    const tsx = clamp(-this.lookDX * 0.0007, -0.05, 0.05);
    const tsy = clamp(this.lookDY * 0.0007, -0.05, 0.05);
    this.lookDX = this.lookDY = 0;
    this.swayX += (tsx - this.swayX) * damp(10, dt);
    this.swayY += (tsy - this.swayY) * damp(10, dt);
    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.raise = Math.min(1, this.raise + dt * 4);

    const sf = Math.min(1, player.speed / TUNE.walkSpeed);
    const bx = Math.cos(player.bobPhase) * 0.012 * sf;
    const by = Math.abs(Math.sin(player.bobPhase)) * 0.014 * sf;
    const r = 1 - this.raise;
    const lean = player.isDashing ? 0.15 : 0;
    this.gun.position.set(0.24 + this.swayX + bx, -0.21 + this.swayY - by - r * r * 0.45 - player.landDip * 0.3, -0.6 + this.recoil * 0.07);
    this.gun.rotation.set(this.recoil * 0.22 + this.swayY * 1.5 + r * 0.6, this.swayX * 2, -this.swayX * 1.5 + lean);

    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.flash.visible = false;
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * this.muzzleLightPeak * 10);
    this.gunLight.intensity = Math.max(0, this.gunLight.intensity - dt * this.gunLightPeak * 10);
    this.coreMat.color.setHex(ready ? 0x00f3ff : 0x0a6f80);
    if (hidden) this.gun.visible = false;
  }
}
