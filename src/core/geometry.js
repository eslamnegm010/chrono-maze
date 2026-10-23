/**
 * Allocation-free geometric queries on plain {x, y, z} objects, so they work
 * with THREE.Vector3 and in unit tests without a renderer.
 * Boxes are { minX, maxX, minY, maxY, minZ, maxZ }.
 */

function slab(o, d, lo, hi, range) {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let t1 = (lo - o) / d;
  let t2 = (hi - o) / d;
  if (t1 > t2) [t1, t2] = [t2, t1];
  if (t1 > range.min) range.min = t1;
  if (t2 < range.max) range.max = t2;
  return true;
}

const _range = { min: 0, max: 0 };

/** Distance along a normalized ray to an axis-aligned box, 0 if inside, Infinity on miss. */
export function rayBox(o, d, b) {
  _range.min = -Infinity;
  _range.max = Infinity;
  if (!slab(o.x, d.x, b.minX, b.maxX, _range)) return Infinity;
  if (!slab(o.y, d.y, b.minY, b.maxY, _range)) return Infinity;
  if (!slab(o.z, d.z, b.minZ, b.maxZ, _range)) return Infinity;
  if (_range.max < 0 || _range.min > _range.max) return Infinity;
  return _range.min > 0 ? _range.min : 0;
}

/** Distance along a normalized ray to a sphere, 0 if inside, Infinity on miss. */
export function raySphere(o, d, cx, cy, cz, rad) {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - rad * rad;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  if (t >= 0) return t;
  return c < 0 ? 0 : Infinity;
}

/** Pushes circle `pos` (xz) out of circle (cx, cz, cr). Adds the contact normal to nOut. */
export function pushFromCircle(pos, radius, cx, cz, cr, nOut) {
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  const R = radius + cr;
  const d2 = dx * dx + dz * dz;
  if (d2 >= R * R) return false;
  const d = Math.sqrt(d2);
  const nx = d2 > 1e-8 ? dx / d : 1;
  const nz = d2 > 1e-8 ? dz / d : 0;
  pos.x = cx + nx * R;
  pos.z = cz + nz * R;
  if (nOut) {
    nOut.x += nx;
    nOut.z += nz;
  }
  return true;
}
