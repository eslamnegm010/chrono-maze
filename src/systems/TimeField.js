import { TUNE } from '../config/tuning.js';

/**
 * Chrono Fields: in multiplayer, time is a field in space. Every standing
 * player emits a bubble whose speed follows their own movement; anything in
 * the world runs at the blended speed of the bubbles it is in, and at an
 * ambient speed outside all of them. In solo play the whole world simply
 * follows the one player, exactly like the original game.
 */
export class TimeField {
  constructor() {
    this.sources = [];
    this.solo = true;
    this.soloScale = TUNE.timeMin;
  }

  /** @param sources [{x, z, s}] — s is that player's personal time scale */
  set(solo, soloScale, sources) {
    this.solo = solo;
    this.soloScale = soloScale;
    this.sources = sources;
  }

  scaleAt(pos) {
    if (this.solo) return this.soloScale;
    return blendTimeScale(this.sources, pos.x, pos.z);
  }
}

/** Pure blend used by both host and clients (and unit tests). */
export function blendTimeScale(sources, x, z, radius = TUNE.bubbleRadius, ambient = TUNE.ambientTime) {
  let wSum = 0;
  let sSum = 0;
  for (const src of sources) {
    const d = Math.hypot(src.x - x, src.z - z);
    if (d >= radius) continue;
    const f = 1 - d / radius;
    const w = (f * f) / (1 + d * 0.15); // nearest bubble dominates
    wSum += w;
    sSum += w * src.s;
  }
  if (wSum < 1e-4) return ambient;
  const inside = Math.min(1, wSum * 2.5); // smooth edge from bubble to ambient
  return (sSum / wSum) * inside + ambient * (1 - inside);
}
