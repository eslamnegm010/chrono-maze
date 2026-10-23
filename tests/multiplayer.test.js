import { describe, it, expect } from 'vitest';
import { blendTimeScale } from '../src/systems/TimeField.js';
import { PLAYER_COLORS, colorByKey, normalizeRoomCode, randomRoomCode, sanitizeName } from '../src/config/players.js';

describe('time bubbles', () => {
  const opts = [10, 0.4];

  it('runs at ambient speed outside every bubble', () => {
    expect(blendTimeScale([{ x: 0, z: 0, s: 1 }], 50, 0, ...opts)).toBe(0.4);
    expect(blendTimeScale([], 0, 0, ...opts)).toBe(0.4);
  });

  it('follows the owner at the centre of a bubble', () => {
    expect(blendTimeScale([{ x: 0, z: 0, s: 0.05 }], 0, 0, ...opts)).toBeCloseTo(0.05, 5);
  });

  it('is dominated by the nearest bubble', () => {
    const sources = [
      { x: 0, z: 0, s: 0.05 },
      { x: 8, z: 0, s: 1 },
    ];
    expect(blendTimeScale(sources, 1, 0, ...opts)).toBeLessThan(0.3);
    expect(blendTimeScale(sources, 7, 0, ...opts)).toBeGreaterThan(0.7);
  });
});

describe('player identity', () => {
  it('sanitizes names and falls back to a random one', () => {
    expect(sanitizeName('  <b>Ali</b>  ')).toBe('bAli/b');
    expect(sanitizeName('x').length).toBeGreaterThanOrEqual(2);
    expect(sanitizeName('a'.repeat(40))).toHaveLength(16);
  });

  it('room codes avoid look-alike characters and normalize', () => {
    for (let i = 0; i < 50; i++) expect(randomRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(normalizeRoomCode(' ab-c d ')).toBe('ABCD');
  });

  it('colours are unique and fall back to the first', () => {
    expect(new Set(PLAYER_COLORS.map((c) => c.key)).size).toBe(PLAYER_COLORS.length);
    expect(colorByKey('nope')).toBe(PLAYER_COLORS[0]);
  });
});
