import { CellType } from './CellType.js';
import { clamp } from '../core/math.js';
import { rayBox } from '../core/geometry.js';

export const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Spatial model of a level: cell ↔ world conversion, collision, ray casting
 * and navigation fields. Pure logic — no rendering — so it is unit-testable.
 *
 * World layout: column c → x, row r → z, the grid centred on the origin.
 * Anything outside the grid counts as wall.
 */
export class Grid {
  constructor(level) {
    this.level = level;
    this.cells = level.grid;
    this.rows = level.grid.length;
    this.cols = level.grid[0].length;
    this.size = this.rows * this.cols;
    this.cell = level.cellSize;
    this.wallHeight = level.wallHeight;
    this.pillarHeight = level.pillarHeight;
    this.pillarHalf = (level.cellSize * level.pillarScale) / 2;
    this._boxA = {};
    this._boxB = {};
    this._dir = { x: 0, y: 0, z: 0 };
    this._queue = new Int32Array(this.size);
  }

  cellX(c) {
    return (c - this.cols / 2) * this.cell + this.cell / 2;
  }
  cellZ(r) {
    return (r - this.rows / 2) * this.cell + this.cell / 2;
  }
  toCol(x) {
    return Math.floor(x / this.cell + this.cols / 2);
  }
  toRow(z) {
    return Math.floor(z / this.cell + this.rows / 2);
  }
  index(c, r) {
    return r * this.cols + c;
  }
  inBounds(c, r) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }
  type(c, r) {
    return this.inBounds(c, r) ? this.cells[r][c] : CellType.WALL;
  }
  isSolid(c, r) {
    const t = this.type(c, r);
    return t === CellType.WALL || t === CellType.PILLAR;
  }
  isWalkable(c, r) {
    const t = this.type(c, r);
    return t === CellType.EMPTY || t === CellType.BARREL;
  }

  forEachCell(fn) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) fn(c, r, this.cells[r][c]);
    }
  }

  /** Collision box of a solid cell (pillars are narrower and taller than walls). */
  cellBox(c, r, out = {}) {
    const pillar = this.type(c, r) === CellType.PILLAR;
    const h = pillar ? this.pillarHalf : this.cell / 2;
    const x = this.cellX(c);
    const z = this.cellZ(r);
    out.minX = x - h;
    out.maxX = x + h;
    out.minZ = z - h;
    out.maxZ = z + h;
    out.minY = 0;
    out.maxY = pillar ? this.pillarHeight : this.wallHeight;
    return out;
  }

  pointInSolid(p) {
    const c = this.toCol(p.x);
    const r = this.toRow(p.z);
    if (!this.isSolid(c, r)) return false;
    const b = this.cellBox(c, r, this._boxB);
    return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ && p.y <= b.maxY;
  }

  /**
   * Pushes a circle (xz) out of every solid cell it overlaps — the basis of
   * smooth wall sliding. Contact normals are accumulated into nOut.
   */
  resolveCircle(pos, radius, nOut) {
    let hit = false;
    if (nOut) {
      nOut.x = 0;
      nOut.z = 0;
    }
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const c0 = this.toCol(pos.x - radius);
      const c1 = this.toCol(pos.x + radius);
      const r0 = this.toRow(pos.z - radius);
      const r1 = this.toRow(pos.z + radius);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (!this.isSolid(c, r)) continue;
          const b = this.cellBox(c, r, this._boxA);
          const qx = clamp(pos.x, b.minX, b.maxX);
          const qz = clamp(pos.z, b.minZ, b.maxZ);
          const dx = pos.x - qx;
          const dz = pos.z - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= radius * radius) continue;
          let nx;
          let nz;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            nx = dx / d;
            nz = dz / d;
            pos.x = qx + nx * radius;
            pos.z = qz + nz * radius;
          } else {
            // Centre is inside the box: leave through the nearest face.
            const dl = pos.x - b.minX;
            const dr = b.maxX - pos.x;
            const dtop = pos.z - b.minZ;
            const dbot = b.maxZ - pos.z;
            const m = Math.min(dl, dr, dtop, dbot);
            if (m === dl) [nx, nz, pos.x] = [-1, 0, b.minX - radius];
            else if (m === dr) [nx, nz, pos.x] = [1, 0, b.maxX + radius];
            else if (m === dtop) [nx, nz, pos.z] = [0, -1, b.minZ - radius];
            else [nx, nz, pos.z] = [0, 1, b.maxZ + radius];
          }
          if (nOut) {
            nOut.x += nx;
            nOut.z += nz;
          }
          hit = moved = true;
        }
      }
      if (!moved) break;
    }
    return hit;
  }

  /**
   * Grid DDA ray march against walls, pillars and the floor. Works in 3D so
   * shots can pass over walls. `d` must be normalized. Returns the hit
   * distance, or maxDist if nothing was hit before it.
   */
  raycast(o, d, maxDist) {
    let best = maxDist;
    if (d.y < -1e-6) {
      const tf = -o.y / d.y;
      if (tf < best) best = Math.max(0, tf);
    }
    let c = this.toCol(o.x);
    let r = this.toRow(o.z);
    const stepC = d.x > 0 ? 1 : -1;
    const stepR = d.z > 0 ? 1 : -1;
    const ax = Math.abs(d.x);
    const az = Math.abs(d.z);
    const tDeltaC = ax > 1e-9 ? this.cell / ax : Infinity;
    const tDeltaR = az > 1e-9 ? this.cell / az : Infinity;
    let tMaxC = ax > 1e-9 ? ((c + (stepC > 0 ? 1 : 0) - this.cols / 2) * this.cell - o.x) / d.x : Infinity;
    let tMaxR = az > 1e-9 ? ((r + (stepR > 0 ? 1 : 0) - this.rows / 2) * this.cell - o.z) / d.z : Infinity;
    let t = 0;
    for (let i = 0; i < 4 * (this.rows + this.cols) && t <= best; i++) {
      if (this.isSolid(c, r)) {
        const th = rayBox(o, d, this.cellBox(c, r, this._boxB));
        if (th !== Infinity) {
          if (th < best) best = th;
          break;
        }
      }
      if (c < -2 || c > this.cols + 1 || r < -2 || r > this.rows + 1) break;
      if (tMaxC < tMaxR) {
        t = tMaxC;
        tMaxC += tDeltaC;
        c += stepC;
      } else {
        t = tMaxR;
        tMaxR += tDeltaR;
        r += stepR;
      }
    }
    return best;
  }

  hasLineOfSight(a, b) {
    const d = this._dir;
    d.x = b.x - a.x;
    d.y = b.y - a.y;
    d.z = b.z - a.z;
    const dist = Math.hypot(d.x, d.y, d.z);
    if (dist < 1e-4) return true;
    d.x /= dist;
    d.y /= dist;
    d.z /= dist;
    return this.raycast(a, d, dist) >= dist - 0.05;
  }

  createField() {
    return new Int16Array(this.size);
  }

  /**
   * Breadth-first distance field (in cells) from (c0, r0) over walkable cells.
   * -1 marks unreachable cells. Enemies descend it to navigate the maze.
   */
  bfs(c0, r0, out) {
    out.fill(-1);
    const q = this._queue;
    let head = 0;
    let tail = 0;
    if (this.isWalkable(c0, r0)) {
      out[this.index(c0, r0)] = 0;
      q[tail++] = this.index(c0, r0);
    } else {
      // Target stands in a non-walkable cell (e.g. a gap between pillars): seed its neighbours.
      for (const [dc, dr] of NEIGHBORS) {
        const c = c0 + dc;
        const r = r0 + dr;
        if (!this.isWalkable(c, r)) continue;
        const i = this.index(c, r);
        if (out[i] < 0) {
          out[i] = 1;
          q[tail++] = i;
        }
      }
    }
    while (head < tail) {
      const i = q[head++];
      const c = i % this.cols;
      const r = (i / this.cols) | 0;
      const nd = out[i] + 1;
      for (const [dc, dr] of NEIGHBORS) {
        const nc = c + dc;
        const nr = r + dr;
        if (!this.isWalkable(nc, nr)) continue;
        const j = this.index(nc, nr);
        if (out[j] >= 0) continue;
        out[j] = nd;
        q[tail++] = j;
      }
    }
    return out;
  }

  /**
   * Writes the centre of the neighbouring cell one step closer to the field's
   * origin into `out`. Returns false when already in the target cell or stuck.
   */
  stepAlongField(pos, field, out) {
    const c = this.toCol(pos.x);
    const r = this.toRow(pos.z);
    const here = this.isWalkable(c, r) ? field[this.index(c, r)] : -1;
    if (here === 0) return false;
    let best = here >= 0 ? here : Infinity;
    let bc = -1;
    let br = -1;
    for (const [dc, dr] of NEIGHBORS) {
      const nc = c + dc;
      const nr = r + dr;
      if (!this.isWalkable(nc, nr)) continue;
      const v = field[this.index(nc, nr)];
      if (v >= 0 && v < best) {
        best = v;
        bc = nc;
        br = nr;
      }
    }
    if (bc < 0) return false;
    out.x = this.cellX(bc);
    out.z = this.cellZ(br);
    return true;
  }
}
