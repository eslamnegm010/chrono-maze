export const CellType = Object.freeze({
  EMPTY: 0,
  WALL: 1,
  BARREL: 2,
  PILLAR: 3,
});

export const VALID_CELL_TYPES = new Set(Object.values(CellType));
