import { describe, it, expect } from 'vitest';
import { LEVELS } from '../src/config/levels/index.js';
import { validateLevel } from '../src/world/validateLevel.js';
import core from '../src/config/levels/core.js';

describe('level definitions', () => {
  for (const level of LEVELS) {
    it(`"${level.id}" is valid`, () => {
      expect(validateLevel(level)).toEqual([]);
    });
  }
});

describe('validateLevel', () => {
  const clone = (patch) => ({ ...core, grid: core.grid.map((row) => [...row]), ...patch });

  it('rejects a spawn inside a pillar', () => {
    expect(validateLevel(clone({ spawn: { c: 7, r: 7 } }))[0]).toMatch(/spawn/);
  });

  it('rejects an open border', () => {
    const lvl = clone();
    lvl.grid[0][3] = 0;
    expect(validateLevel(lvl).some((e) => e.includes('border'))).toBe(true);
  });

  it('rejects unreachable cells', () => {
    const lvl = clone();
    // Wall off the top-left corner cell (1,1).
    lvl.grid[1][2] = 1;
    lvl.grid[2][1] = 1;
    expect(validateLevel(lvl).some((e) => e.includes('(1,1)'))).toBe(true);
  });

  it('rejects ragged rows and unknown cells', () => {
    const lvl = clone();
    lvl.grid[3] = lvl.grid[3].slice(1);
    expect(validateLevel(lvl)[0]).toMatch(/row 3/);
    const lvl2 = clone();
    lvl2.grid[5][5] = 9;
    expect(validateLevel(lvl2)[0]).toMatch(/unknown cell type 9/);
  });
});
