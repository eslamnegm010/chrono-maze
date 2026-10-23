import * as THREE from 'three';
import { CellType } from './CellType.js';

/**
 * Explosive barrels placed on BARREL cells. Explosions themselves are
 * resolved by Combat; this class owns the meshes, alive state and chain fuses.
 */
export class Barrels {
  constructor(scene, grid) {
    this.items = [];
    const bodyGeo = new THREE.CylinderGeometry(0.8, 0.8, 2.0, 16);
    const ringGeo = new THREE.CylinderGeometry(0.84, 0.84, 0.16, 16);
    const capGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffc400, roughness: 0.35, metalness: 0.4, emissive: 0x3a2200 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });

    grid.forEachCell((c, r, t) => {
      if (t !== CellType.BARREL) return;
      const g = new THREE.Group();
      g.position.set(grid.cellX(c), 0, grid.cellZ(r));
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 1;
      g.add(body);
      for (const y of [0.45, 1.55]) {
        const ring = new THREE.Mesh(ringGeo, this.glowMat);
        ring.position.y = y;
        g.add(ring);
      }
      const cap = new THREE.Mesh(capGeo, this.glowMat);
      cap.position.y = 2.02;
      g.add(cap);
      scene.add(g);
      this.items.push({ mesh: g, pos: new THREE.Vector3(g.position.x, 1, g.position.z), alive: true, fuse: -1 });
    });
  }

  /** Brings back every destroyed barrel (start of each wave / new run). */
  restore() {
    for (const b of this.items) {
      b.alive = true;
      b.fuse = -1;
      b.mesh.visible = true;
    }
  }

  destroy(b) {
    b.alive = false;
    b.fuse = -1;
    b.mesh.visible = false;
  }

  /** Arms every live barrel within radius to explode after `delay` world-seconds. */
  armWithin(pos, radius, delay) {
    for (const b of this.items) {
      if (b.alive && b.fuse < 0 && b.pos.distanceTo(pos) < radius) b.fuse = delay;
    }
  }

  update(wdt, realTime, onDetonate) {
    for (const b of this.items) {
      if (!b.alive || b.fuse < 0) continue;
      b.fuse -= wdt;
      if (b.fuse < 0) onDetonate(b);
    }
    this.glowMat.color.setHSL(0.08, 1, 0.45 + 0.15 * Math.sin(realTime * 4));
  }
}
