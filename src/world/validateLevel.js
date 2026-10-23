import { CellType, VALID_CELL_TYPES } from './CellType.js';
import { Grid } from './Grid.js';

/**
 * Returns a list of human-readable problems with a level definition
 * (empty when the level is playable). Run by the test suite and at startup.
 */
export function validateLevel(level) {
  const errors = [];
  const g = level?.grid;
  if (!Array.isArray(g) || g.length === 0 || !Array.isArray(g[0]) || g[0].length === 0) {
    return ['grid is empty'];
  }
  for (const key of ['cellSize', 'wallHeight', 'pillarHeight', 'pillarScale']) {
    if (!(level[key] > 0)) errors.push(`${key} must be a positive number`);
  }

  const cols = g[0].length;
  g.forEach((row, r) => {
    if (row.length !== cols) errors.push(`row ${r} has ${row.length} cells, expected ${cols}`);
    row.forEach((v, c) => {
      if (!VALID_CELL_TYPES.has(v)) errors.push(`unknown cell type ${v} at (${c},${r})`);
    });
  });
  if (errors.length) return errors;

  const rows = g.length;
  for (let c = 0; c < cols; c++) {
    if (g[0][c] !== CellType.WALL || g[rows - 1][c] !== CellType.WALL) errors.push(`border column ${c} is open`);
  }
  for (let r = 0; r < rows; r++) {
    if (g[r][0] !== CellType.WALL || g[r][cols - 1] !== CellType.WALL) errors.push(`border row ${r} is open`);
  }

  const grid = new Grid(level);
  const { c, r } = level.spawn ?? {};
  if (grid.type(c, r) !== CellType.EMPTY) {
    errors.push(`spawn (${c},${r}) must be an empty cell`);
    return errors;
  }

  const field = grid.bfs(c, r, grid.createField());
  grid.forEachCell((cc, rr) => {
    if (grid.isWalkable(cc, rr) && field[grid.index(cc, rr)] < 0) {
      errors.push(`cell (${cc},${rr}) is unreachable from spawn`);
    }
  });
  return errors;
}
