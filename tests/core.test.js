import { describe, it, expect } from 'vitest';
import { clamp, damp, lerpAngle, shuffle } from '../src/core/math.js';
import { rayBox, raySphere, pushFromCircle } from '../src/core/geometry.js';
import { Settings } from '../src/core/Settings.js';
import { ENEMY_TYPES, KILL_BONUS, waveComposition } from '../src/config/tuning.js';

describe('math', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('damp is frame-rate independent', () => {
    // Two half-steps must equal one full step.
    const one = damp(10, 0.1);
    const half = damp(10, 0.05);
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(one, 10);
  });

  it('lerpAngle takes the short way round', () => {
    expect(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5)).toBeCloseTo(Math.PI, 6);
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('shuffle keeps every element', () => {
    const a = [1, 2, 3, 4, 5, 6];
    expect(shuffle([...a]).sort()).toEqual(a);
  });
});

describe('geometry', () => {
  const box = { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -1, maxZ: 1 };

  it('rayBox hits, misses and reports inside as 0', () => {
    expect(rayBox({ x: -5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, box)).toBeCloseTo(4);
    expect(rayBox({ x: -5, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, box)).toBe(Infinity);
    expect(rayBox({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, box)).toBe(0);
    expect(rayBox({ x: 5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, box)).toBe(Infinity);
  });

  it('raySphere', () => {
    expect(raySphere({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 1 }, 0, 0, 0, 1)).toBeCloseTo(9);
    expect(raySphere({ x: 5, y: 0, z: -10 }, { x: 0, y: 0, z: 1 }, 0, 0, 0, 1)).toBe(Infinity);
  });

  it('pushFromCircle separates overlapping circles', () => {
    const p = { x: 0.5, z: 0 };
    const n = { x: 0, z: 0 };
    expect(pushFromCircle(p, 0.5, 0, 0, 0.5, n)).toBe(true);
    expect(p.x).toBeCloseTo(1);
    expect(n.x).toBeCloseTo(1);
  });
});

describe('Settings', () => {
  const memory = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  };

  it('persists values and best score', () => {
    const store = memory();
    const s = new Settings(store);
    s.set('sens', 2);
    expect(s.submitScore(500)).toBe(true);
    expect(s.submitScore(100)).toBe(false);
    const reloaded = new Settings(store);
    expect(reloaded.values.sens).toBe(2);
    expect(reloaded.best).toBe(500);
  });

  it('survives corrupt storage', () => {
    const store = memory();
    store.setItem('chronomaze_settings', '{not json');
    expect(new Settings(store).values.vol).toBe(0.7);
  });
});

describe('tuning', () => {
  it('wave rosters only reference known enemy types and grow over time', () => {
    let prev = 0;
    for (let n = 1; n <= 20; n++) {
      const { roster, difficulty } = waveComposition(n);
      const total = roster.reduce((s, r) => s + r.count, 0);
      for (const r of roster) {
        expect(ENEMY_TYPES[r.type]).toBeDefined();
        expect(r.count).toBeGreaterThanOrEqual(0);
      }
      expect(total).toBeGreaterThanOrEqual(prev);
      expect(difficulty.fireMul).toBeGreaterThan(0);
      prev = total;
    }
  });

  it('every kill cause has a bonus entry', () => {
    for (const cause of ['body', 'head', 'blast', 'throw']) expect(KILL_BONUS[cause]).toBeDefined();
  });
});
