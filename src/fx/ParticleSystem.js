import * as THREE from 'three';
import { rand } from '../core/math.js';

/**
 * Ring-buffer particle system rendered as one additive Points draw call.
 * Particles fade by darkening their colour (black is invisible when additive).
 */
export class ParticleSystem {
  constructor(scene, texture, max = 1400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.next = 0;
    this.dirty = true;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    const mat = new THREE.PointsMaterial({
      size: 0.32,
      map: texture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, r, g, b, grav, drag) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    this.base[k] = this.col[k] = r;
    this.base[k + 1] = this.col[k + 1] = g;
    this.base[k + 2] = this.col[k + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.dirty = true;
  }

  /** Spherical burst. opts: { life, grav, drag, up, dir } */
  burst(x, y, z, count, speed, color, opts = {}) {
    const life = opts.life ?? 0.6;
    const grav = opts.grav ?? 9;
    const drag = opts.drag ?? 1.5;
    const up = opts.up ?? 0;
    const r = ((color >> 16) & 255) / 255;
    const g = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    for (let n = 0; n < count; n++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * rand(0.25, 1);
      let vx = s * Math.cos(th) * sp;
      let vy = u * sp + up;
      let vz = s * Math.sin(th) * sp;
      if (opts.dir) {
        vx += opts.dir.x * speed * 0.6;
        vy += opts.dir.y * speed * 0.6;
        vz += opts.dir.z * speed * 0.6;
      }
      this.emit(x, y, z, vx, vy, vz, life * rand(0.5, 1.2), r, g, b, grav, drag);
    }
  }

  clear() {
    this.life.fill(0);
    this.col.fill(0);
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -999;
    this.posAttr.needsUpdate = this.colAttr.needsUpdate = true;
    this.dirty = false;
  }

  update(dt) {
    if (!this.dirty) return;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      const l = this.life[i] - dt;
      if (l <= 0) {
        this.life[i] = 0;
        this.col[k] = this.col[k + 1] = this.col[k + 2] = 0;
        this.pos[k + 1] = -999;
        continue;
      }
      any = true;
      this.life[i] = l;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= dr;
      this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt;
      this.vel[k + 2] *= dr;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.05) {
        this.pos[k + 1] = 0.05;
        this.vel[k + 1] *= -0.4;
        this.vel[k] *= 0.7;
        this.vel[k + 2] *= 0.7;
      }
      const f = l / this.maxLife[i];
      this.col[k] = this.base[k] * f;
      this.col[k + 1] = this.base[k + 1] * f;
      this.col[k + 2] = this.base[k + 2] * f;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.dirty = any;
  }
}
