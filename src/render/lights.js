/**
 * three.js r155+ uses physically based light units. These helpers convert the
 * artist-friendly intensities the game was tuned with into the new units, so
 * all lighting tweaks stay in one place.
 */

/** Ambient / hemisphere / directional lights: legacy mode scaled them by π. */
export const legacyIntensity = (i) => i * Math.PI;

/**
 * Point lights use decay 0 + a cutoff distance, which gives the smooth,
 * range-limited falloff the neon look relies on.
 */
export const POINT_DECAY = 0;
export const pointIntensity = (i) => i * Math.PI * 0.45;
