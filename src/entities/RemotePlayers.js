import * as THREE from 'three';
import { EYE_HEIGHT, TUNE } from '../config/tuning.js';
import { colorByKey } from '../config/players.js';
import { damp, lerpAngle } from '../core/math.js';
import { buildEnemyModel } from './EnemyModel.js';
import { playerPalette } from '../render/SharedAssets.js';

/**
 * Another player in the room. `pos`/`vel` are the latest networked values
 * (used by gameplay: enemy targeting, hits, time field); the robot model is
 * smoothed toward them for display.
 */
class Avatar {
  constructor(id, name, colorKey) {
    this.id = id;
    this.name = name;
    this.color = colorByKey(colorKey);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.ts = TUNE.timeMin;
    this.hp = TUNE.maxHp;
    this.down = false;
    this.invuln = 0;
    this.reviveFrac = 0;
    this.seen = false;
  }

  get eyeY() {
    return this.pos.y + EYE_HEIGHT;
  }
}

function bubbleRing(scene, hex) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const fillMat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.05, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(TUNE.bubbleRadius - 0.22, TUNE.bubbleRadius, 96), mat);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(TUNE.bubbleRadius, 64), fillMat);
  for (const m of [ring, fill]) {
    m.rotation.x = -Math.PI / 2;
    group.add(m);
  }
  ring.position.y = 0.05;
  fill.position.y = 0.04;
  scene.add(group);
  return {
    group,
    /** Frozen bubbles glow brighter so everyone can read where time is stopped. */
    show(x, z, ts, visible) {
      group.visible = visible;
      group.position.set(x, 0, z);
      const frozen = 1 - Math.min(1, ts / TUNE.timeMove);
      mat.opacity = 0.12 + 0.5 * frozen;
      fillMat.opacity = 0.02 + 0.07 * frozen;
    },
    dispose() {
      scene.remove(group);
    },
  };
}

function nameplate(name, color) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 96;
  const g = cv.getContext('2d');
  g.font = '900 44px Cairo, Arial';
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const label = `${name} ${color.sigil}`;
  const w = Math.min(500, g.measureText(label).width + 48);
  // Dark pill keeps the label readable under bloom.
  g.fillStyle = 'rgba(5, 8, 20, 0.72)';
  g.beginPath();
  g.roundRect(256 - w / 2, 14, w, 72, 36);
  g.fill();
  g.strokeStyle = color.css;
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = color.css;
  g.fillText(label, 256, 52);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, color: 0xd8d8d8 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.2, 0.6, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export class RemotePlayers {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.map = new Map();
    this.selfRing = null;
  }

  get size() {
    return this.map.size;
  }

  values() {
    return this.map.values();
  }

  get(id) {
    return this.map.get(id);
  }

  upsert(id, name, colorKey) {
    let a = this.map.get(id);
    if (a && a.name === name && a.color.key === colorKey) return a;
    if (a) this.remove(id);
    a = new Avatar(id, name, colorKey);
    const palette = playerPalette(this.assets, a.color);
    a.model = buildEnemyModel(this.assets, { palette: palette.key });
    a.model.root.visible = false;
    a.plate = nameplate(name, a.color);
    a.plate.position.y = 2.75;
    a.model.root.add(a.plate);
    a.ring = bubbleRing(this.scene, a.color.hex);
    this.scene.add(a.model.root);
    this.map.set(id, a);
    return a;
  }

  remove(id) {
    const a = this.map.get(id);
    if (!a) return;
    this.scene.remove(a.model.root);
    a.ring.dispose();
    this.map.delete(id);
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
  }

  /** s = [x, y, z, yaw, pitch, vx, vz, ts, hp, down, invuln, reviveFrac] */
  applyState(id, s) {
    const a = this.map.get(id);
    if (!a) return;
    a.pos.set(s[0], s[1], s[2]);
    a.yaw = s[3];
    a.pitch = s[4];
    a.vel.set(s[5], 0, s[6]);
    a.ts = s[7];
    a.hp = s[8];
    a.down = !!s[9];
    a.invuln = s[10];
    if (s.length > 11) a.reviveFrac = s[11];
    if (!a.seen) {
      a.seen = true;
      a.model.root.position.copy(a.pos);
      a.model.root.visible = true;
    }
  }

  setSelfColor(color, multiplayer) {
    if (this.selfRing) this.selfRing.dispose();
    this.selfRing = multiplayer ? bubbleRing(this.scene, color.hex) : null;
  }

  update(dt, localPlayer, localScale) {
    if (this.selfRing) this.selfRing.show(localPlayer.pos.x, localPlayer.pos.z, localScale, !localPlayer.down);
    for (const a of this.map.values()) {
      if (!a.seen) continue;
      const m = a.model;
      const root = m.root;
      const k = damp(14, dt);
      const ox = root.position.x;
      const oz = root.position.z;
      root.position.x += (a.pos.x - root.position.x) * k;
      root.position.z += (a.pos.z - root.position.z) * k;
      root.position.y = a.down ? 0.25 : root.position.y + (a.pos.y - root.position.y) * k;
      // The model faces +Z, the camera looks down -Z: offset by π.
      const yaw = lerpAngle(root.rotation.y, a.yaw + Math.PI, k);
      root.rotation.set(0, yaw, a.down ? Math.PI / 2 : 0);

      const speed = Math.hypot(root.position.x - ox, root.position.z - oz) / Math.max(dt, 1e-4);
      a.walk = (a.walk || 0) + speed * dt * 2.4;
      const swing = Math.sin(a.walk) * Math.min(0.65, speed * 0.12);
      m.legL.rotation.x = swing;
      m.legR.rotation.x = -swing;
      m.armL.rotation.x = -swing * 0.8;
      m.armR.rotation.x = -Math.PI / 2 - a.pitch;
      a.ring.show(a.pos.x, a.pos.z, a.ts, !a.down);
    }
  }
}
