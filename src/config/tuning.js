/**
 * Gameplay tuning. Every balance number lives here so designers can tweak
 * the game without touching system code.
 */

export const EYE_HEIGHT = 1.7;

export const TUNE = Object.freeze({
  // Player movement (metres, seconds)
  walkSpeed: 9.5,
  groundAccel: 13,
  airAccel: 2.5,
  gravity: 26,
  jumpVel: 8.6,
  jumpBuffer: 0.14,
  coyoteTime: 0.1,
  dashSpeed: 32,
  dashTime: 0.16,
  dashCooldown: 1.0,
  playerRadius: 0.55,
  mouseSensitivity: 0.0022,

  // Player survivability
  maxHp: 100,
  regenDelay: 3.5,
  regenRate: 9,

  // Player weapon
  fireCooldown: 0.15,
  gunRespawn: 0.65,
  hitscanRange: 260,
  throwSpeed: 34,
  throwGravity: 12,

  // Time dilation: world speed follows how fast the player moves
  timeMin: 0.05,
  timeMove: 0.9,
  timeAir: 0.55,
  timeFire: 0.5,
  timeLook: 0.16,

  // Enemies
  enemyRadius: 0.5,
  hearRange: 45,
  viewRange: 70,
  loseTrackAfter: 8,
  headY: 1.92,
  headR: 0.34,
  bodyTop: 1.72,
  bodyHalf: 0.46,

  // Barrels
  barrelRadius: 0.85,
  blastRadius: 10,
  blastPlayerRadius: 9,
  blastPlayerDmg: 45,
  blastChainDelay: 0.18,

  // Scoring
  comboWindow: 3,
  comboMax: 5,
  waveClearBonus: 300,
  deflectScore: 25,
  barrelScore: 50,
});

/**
 * Enemy archetypes. To add a new enemy: add an entry here, add its palette in
 * render/SharedAssets.js, then reference the key from waveComposition().
 */
export const ENEMY_TYPES = Object.freeze({
  grunt: {
    key: 'grunt',
    hp: 1,
    scale: 1,
    speedMul: 1,
    windup: 0.6,
    bulletSpeed: 24,
    bulletDamage: 20,
    pellets: 1,
    pelletSpread: 0,
    preferredRange: 15,
    score: 100,
    label: 'KILL',
    palette: 'grunt',
  },
  heavy: {
    key: 'heavy',
    hp: 3,
    scale: 1.25,
    speedMul: 0.7,
    windup: 0.85,
    bulletSpeed: 20,
    bulletDamage: 18,
    pellets: 3,
    pelletSpread: 0.09,
    preferredRange: 11,
    score: 250,
    label: 'HEAVY DOWN',
    palette: 'heavy',
  },
});

/** Extra points & feed label per kill cause. */
export const KILL_BONUS = Object.freeze({
  body: { bonus: 0, label: null },
  head: { bonus: 50, label: 'HEADSHOT' },
  blast: { bonus: 50, label: 'BLAST KILL' },
  throw: { bonus: 75, label: 'THROW KILL' },
});

/** Who spawns in wave n, and how sharp they are. */
export function waveComposition(n) {
  const total = Math.min(4 + n * 2, 16);
  const heavy = n >= 3 ? Math.min(Math.floor((n - 1) / 2), 5) : 0;
  return {
    roster: [
      { type: 'heavy', count: heavy },
      { type: 'grunt', count: total - heavy },
    ],
    difficulty: {
      fireMul: Math.max(0.55, 1 - (n - 1) * 0.06),
      spread: Math.max(0.012, 0.05 - n * 0.004),
    },
  };
}
