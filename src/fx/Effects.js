import * as THREE from 'three';
import { rand } from '../core/math.js';
import { ParticleSystem } from './ParticleSystem.js';
import { pointIntensity, POINT_DECAY } from '../render/lights.js';

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

/**
 * Pooled visual effects: particles, enemy shards, laser tracers and
 * explosion flashes. Nothing here affects gameplay.
 */
export class Effects {
  constructor(scene, assets, grid) {
    this.grid = grid;
    this.particles = new ParticleSystem(scene, assets.tex.dot, 1400);

    this.shards = [];
    for (let i = 0; i < 180; i++) {
      const m = new THREE.Mesh(assets.geo.shard, assets.palettes.grunt.shard);
      m.visible = false;
      scene.add(m);
      this.shards.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, real: 0 });
    }
    this.shardNext = 0;

    this.tracers = [];
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x7ffcff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const m = new THREE.Mesh(assets.geo.unitCylinder, mat);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    this.tracerNext = 0;

    this.blasts = [];
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffaa33,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const m = new THREE.Mesh(assets.geo.blast, mat);
      m.visible = false;
      scene.add(m);
      this.blasts.push({ mesh: m, life: 0, radius: 1 });
    }
    this.blastLight = new THREE.PointLight(0xff8a20, 0, 34, POINT_DECAY);
    this.blastLightPeak = pointIntensity(6);
    scene.add(this.blastLight);
  }

  burst(x, y, z, count, speed, color, opts) {
    this.particles.burst(x, y, z, count, speed, color, opts);
  }

  emit(...args) {
    this.particles.emit(...args);
  }

  /** Enemy death: tumbling shards + sparks in the enemy's palette. */
  shatter(pos, scale, dir, palette) {
    for (let i = 0; i < 16; i++) {
      const sh = this.shards[this.shardNext];
      this.shardNext = (this.shardNext + 1) % this.shards.length;
      sh.mesh.material = palette.shard;
      sh.mesh.visible = true;
      sh.mesh.scale.setScalar(scale * rand(0.6, 1.3));
      sh.mesh.position.set(pos.x + rand(-0.35, 0.35) * scale, rand(0.3, 2.0) * scale, pos.z + rand(-0.35, 0.35) * scale);
      sh.vel.set(dir.x * rand(3, 8) + rand(-2.5, 2.5), rand(1.5, 6), dir.z * rand(3, 8) + rand(-2.5, 2.5));
      sh.spin.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
      sh.life = rand(2.5, 4);
      sh.real = 10;
    }
    this.burst(pos.x, 1.3 * scale, pos.z, 40, 7, palette.fx, { life: 0.8, dir });
  }

  tracer(a, b, color = 0x7ffcff) {
    const t = this.tracers[this.tracerNext];
    this.tracerNext = (this.tracerNext + 1) % this.tracers.length;
    _dir.subVectors(b, a);
    const len = _dir.length();
    if (len < 0.01) return;
    _dir.divideScalar(len);
    t.mesh.position.copy(a).addScaledVector(_dir, len / 2);
    t.mesh.quaternion.setFromUnitVectors(UP, _dir);
    t.mesh.scale.set(0.035, len, 0.035);
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 1;
    t.mesh.visible = true;
    t.life = 0.12;
  }

  explosion(pos, radius) {
    this.blastLight.position.set(pos.x, 2.5, pos.z);
    this.blastLight.intensity = this.blastLightPeak;
    const fl = this.blasts.find((x) => x.life <= 0) || this.blasts[0];
    fl.mesh.position.copy(pos);
    fl.life = 1;
    fl.radius = radius;
    fl.mesh.visible = true;
    this.burst(pos.x, 1, pos.z, 90, 14, 0xffaa22, { life: 1.0, grav: 4, drag: 2.2, up: 3 });
    this.burst(pos.x, 1, pos.z, 40, 8, 0xff3300, { life: 1.4, grav: -1, drag: 1.5 });
    this.burst(pos.x, 1, pos.z, 30, 18, 0xfff2a0, { life: 0.4, grav: 0, drag: 3 });
  }

  clear() {
    for (const s of this.shards) {
      s.life = 0;
      s.mesh.visible = false;
    }
    this.particles.clear();
  }

  update(dt, wdt, timeScale) {
    // A sliver of real time keeps sparks drifting even when time is frozen.
    this.particles.update(wdt + dt * 0.08);
    this._updateShards(dt, wdt);

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.mesh.visible = false;
        continue;
      }
      const f = t.life / 0.12;
      t.mesh.material.opacity = f;
      t.mesh.scale.x = t.mesh.scale.z = 0.01 + 0.03 * f;
    }

    const bdt = dt * Math.max(timeScale, 0.4);
    for (const b of this.blasts) {
      if (b.life <= 0) continue;
      b.life -= bdt * 2.2;
      if (b.life <= 0) {
        b.mesh.visible = false;
        continue;
      }
      b.mesh.scale.setScalar(1 + (1 - b.life) * b.radius * 0.9);
      b.mesh.material.opacity = b.life * b.life;
    }
    this.blastLight.intensity = Math.max(0, this.blastLight.intensity - bdt * this.blastLightPeak * 1.5);
  }

  _updateShards(dt, wdt) {
    const grid = this.grid;
    for (const s of this.shards) {
      if (s.life <= 0) continue;
      s.life -= wdt;
      s.real -= dt;
      if (s.life <= 0 || s.real <= 0) {
        s.life = 0;
        s.mesh.visible = false;
        continue;
      }
      const m = s.mesh;
      s.vel.y -= 14 * wdt;
      const px = m.position.x;
      const pz = m.position.z;
      m.position.addScaledVector(s.vel, wdt);
      if (grid.pointInSolid(m.position)) {
        m.position.x = px;
        m.position.z = pz;
        s.vel.x *= -0.4;
        s.vel.z *= -0.4;
      }
      if (m.position.y < 0.12) {
        m.position.y = 0.12;
        s.vel.y *= -0.35;
        s.vel.x *= 0.6;
        s.vel.z *= 0.6;
        s.spin.multiplyScalar(0.6);
      }
      m.rotation.x += s.spin.x * wdt;
      m.rotation.y += s.spin.y * wdt;
      m.rotation.z += s.spin.z * wdt;
      if (s.life < 0.6) m.scale.multiplyScalar(Math.max(0, 1 - wdt * 4));
    }
  }
}
