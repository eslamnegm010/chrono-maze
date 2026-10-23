export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const rand = (a, b) => a + Math.random() * (b - a);

/** Frame-rate independent smoothing factor for `x += (target - x) * damp(rate, dt)`. */
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Interpolates between two angles along the shortest arc. */
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** In-place Fisher–Yates shuffle. */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
