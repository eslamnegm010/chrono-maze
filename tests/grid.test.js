import { describe, it, expect } from 'vitest';
import { Grid } from '../src/world/Grid.js';
import { CellType } from '../src/world/CellType.js';
import core from '../src/config/levels/core.js';

const grid = new Grid(core);

describe('Grid coordinates', () => {
  it('round-trips cell → world → cell', () => {
    grid.forEachCell((c, r) => {
      expect(grid.toCol(grid.cellX(c))).toBe(c);
      expect(grid.toRow(grid.cellZ(r))).toBe(r);
    });
  });

  it('treats out-of-bounds as wall', () => {
    expect(grid.type(-1, 0)).toBe(CellType.WALL);
    expect(grid.isSolid(grid.cols, grid.rows)).toBe(true);
  });
});

describe('Grid.resolveCircle', () => {
  it('leaves a circle in open space untouched', () => {
    const p = { x: grid.cellX(core.spawn.c), z: grid.cellZ(core.spawn.r) };
    expect(grid.resolveCircle(p, 0.55)).toBe(false);
  });

  it('player spawn is not inside geometry (regression: prototype spawned inside a pillar)', () => {
    const p = { x: grid.cellX(core.spawn.c), y: 1, z: grid.cellZ(core.spawn.r) };
    expect(grid.pointInSolid(p)).toBe(false);
    expect(grid.resolveCircle({ ...p }, 0.55)).toBe(false);
  });

  it('pushes a circle out of a wall to exactly its radius', () => {
    // (0,0) is a corner wall; stand just inside cell (1,1) overlapping the wall to its west.
    const wallEdge = grid.cellX(0) + grid.cell / 2;
    const p = { x: wallEdge + 0.2, z: grid.cellZ(1) };
    const n = { x: 0, z: 0 };
    expect(grid.resolveCircle(p, 0.55, n)).toBe(true);
    expect(p.x).toBeCloseTo(wallEdge + 0.55, 6);
    expect(n.x).toBeGreaterThan(0);
  });

  it('ejects a circle whose centre is inside a wall', () => {
    const p = { x: grid.cellX(0) + grid.cell / 2 - 0.1, z: grid.cellZ(1) };
    grid.resolveCircle(p, 0.5);
    expect(grid.pointInSolid({ ...p, y: 1 })).toBe(false);
  });
});

describe('Grid.raycast', () => {
  it('hits the wall at the expected distance', () => {
    // From the centre of (1,1) looking west (-x) the wall face is half a cell away.
    const o = { x: grid.cellX(1), y: 1.7, z: grid.cellZ(1) };
    const d = { x: -1, y: 0, z: 0 };
    expect(grid.raycast(o, d, 100)).toBeCloseTo(grid.cell / 2, 6);
  });

  it('hits the floor when looking down', () => {
    const o = { x: grid.cellX(1), y: 2, z: grid.cellZ(1) };
    expect(grid.raycast(o, { x: 0, y: -1, z: 0 }, 100)).toBeCloseTo(2, 6);
  });

  it('returns maxDist when nothing is hit', () => {
    const o = { x: grid.cellX(1), y: 1.7, z: grid.cellZ(1) };
    expect(grid.raycast(o, { x: 0, y: 0, z: 1 }, 3)).toBe(3);
  });

  it('line of sight is blocked by walls and clear in a corridor', () => {
    // Row 1, cols 1..3 are open; col 4 is a wall.
    const a = { x: grid.cellX(1), y: 1.6, z: grid.cellZ(1) };
    expect(grid.hasLineOfSight(a, { x: grid.cellX(3), y: 1.7, z: grid.cellZ(1) })).toBe(true);
    expect(grid.hasLineOfSight(a, { x: grid.cellX(5), y: 1.7, z: grid.cellZ(1) })).toBe(false);
  });
});

describe('Grid navigation', () => {
  it('bfs distance is 0 at the origin and grows by one per step', () => {
    const f = grid.bfs(1, 1, grid.createField());
    expect(f[grid.index(1, 1)]).toBe(0);
    expect(f[grid.index(2, 1)]).toBe(1);
    expect(f[grid.index(3, 1)]).toBe(2);
    expect(f[grid.index(0, 0)]).toBe(-1);
  });

  it('stepAlongField always moves closer to the target', () => {
    const target = { c: 14, r: 14 };
    const f = grid.bfs(target.c, target.r, grid.createField());
    const pos = { x: grid.cellX(1), z: grid.cellZ(1) };
    const out = { x: 0, z: 0 };
    let steps = 0;
    while (grid.stepAlongField(pos, f, out) && steps < 200) {
      const before = f[grid.index(grid.toCol(pos.x), grid.toRow(pos.z))];
      pos.x = out.x;
      pos.z = out.z;
      expect(f[grid.index(grid.toCol(pos.x), grid.toRow(pos.z))]).toBe(before - 1);
      steps++;
    }
    expect([grid.toCol(pos.x), grid.toRow(pos.z)]).toEqual([target.c, target.r]);
  });
});
