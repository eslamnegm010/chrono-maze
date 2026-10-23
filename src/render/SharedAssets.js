import * as THREE from 'three';
import { createTextures } from './textures.js';

/**
 * Geometries & materials shared by every instance (enemies, bullets, FX),
 * created once so spawning never allocates GPU resources.
 */
export function createSharedAssets(renderer) {
  const tex = createTextures(renderer);

  const geo = {
    // Limbs are translated so their pivot sits at the hip / shoulder.
    pelvis: new THREE.BoxGeometry(0.55, 0.25, 0.35),
    torso: new THREE.BoxGeometry(0.72, 0.85, 0.42),
    head: new THREE.BoxGeometry(0.42, 0.42, 0.42),
    visor: new THREE.BoxGeometry(0.36, 0.09, 0.04),
    core: new THREE.BoxGeometry(0.2, 0.2, 0.04),
    shoulder: new THREE.BoxGeometry(0.26, 0.2, 0.34),
    leg: new THREE.BoxGeometry(0.22, 0.8, 0.24).translate(0, -0.4, 0),
    arm: new THREE.BoxGeometry(0.17, 0.62, 0.17).translate(0, -0.31, 0),
    gun: new THREE.BoxGeometry(0.11, 0.15, 0.55),
    tip: new THREE.SphereGeometry(0.075, 10, 8),
    shard: new THREE.TetrahedronGeometry(0.22, 0),
    unitCylinder: new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
    bullet: new THREE.SphereGeometry(0.13, 10, 8),
    bulletTrail: new THREE.CylinderGeometry(0.02, 0.11, 1.4, 6, 1, true).translate(0, -0.7, 0),
    blast: new THREE.SphereGeometry(1, 20, 14),
  };

  const additive = (color, opacity) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

  const mat = {
    gun: new THREE.MeshStandardMaterial({ color: 0x181a26, roughness: 0.3, metalness: 0.9 }),
    tip: new THREE.MeshBasicMaterial({ color: 0xff2a55 }),
    flash: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    bullet: new THREE.MeshBasicMaterial({ color: 0xff3366 }),
    bulletTrail: additive(0xff0044, 0.55),
    aim: additive(0xff0033, 0.35),
    alert: new THREE.SpriteMaterial({ map: tex.alert, transparent: true, depthWrite: false }),
  };

  /** Per enemy-type look. Keys match ENEMY_TYPES[*].palette. */
  const palettes = {
    grunt: {
      body: new THREE.MeshStandardMaterial({ color: 0xff1f4f, roughness: 0.3, metalness: 0.65, emissive: 0x3a0010 }),
      visor: new THREE.MeshBasicMaterial({ color: 0xfff27a }),
      shard: new THREE.MeshStandardMaterial({ color: 0xff1f4f, emissive: 0x66001c, roughness: 0.1, metalness: 0.5 }),
      fx: 0xff0055,
    },
    heavy: {
      body: new THREE.MeshStandardMaterial({ color: 0x3b2a5c, roughness: 0.35, metalness: 0.85, emissive: 0x16052b }),
      visor: new THREE.MeshBasicMaterial({ color: 0xff7a00 }),
      shard: new THREE.MeshStandardMaterial({ color: 0x6b3fb0, emissive: 0x2a0a50, roughness: 0.1, metalness: 0.6 }),
      fx: 0x9b30ff,
    },
  };

  return { tex, geo, mat, palettes };
}
