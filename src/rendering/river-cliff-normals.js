// @ts-check
import { riverLandValue } from '../generation/river-surfaces.js';

/** @typedef {{river: import('../generation/river-surfaces.js').RiverField, wx: number, wz: number}} RiverCell */
/** @typedef {[number, number, number]} Normal */

/** @param {RiverCell} cell @param {number[]} point @returns {Normal | null} */
function fieldNormal(cell, point) {
  const x = cell.wx + point[0],
    z = cell.wz + point[2],
    e = 0.002;
  const dx = riverLandValue(cell.river, x + e, z) - riverLandValue(cell.river, x - e, z);
  const dz = riverLandValue(cell.river, x, z + e) - riverLandValue(cell.river, x, z - e);
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
  const length = Math.hypot(dx, dz) || 1;
  return Number.isFinite(length) ? [-dx / length, 0, -dz / length] : null;
}

/**
 * Keep finite field normals unchanged. At a mouth's discontinuous support boundary,
 * use the shoreline segment's geometric normal, oriented toward the water.
 * @param {RiverCell} cell
 * @param {number[]} a
 * @param {number[]} b
 * @returns {[Normal, Normal]}
 */
export function riverCliffNormals(cell, a, b) {
  const na = fieldNormal(cell, a),
    nb = fieldNormal(cell, b);
  if (na && nb) return [na, nb];
  const dx = b[0] - a[0],
    dz = b[2] - a[2],
    length = Math.hypot(dx, dz);
  /** @type {Normal} */
  let normal = length ? [dz / length, 0, -dx / length] : [1, 0, 0];
  const middle = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
  const reference = na ?? nb ?? fieldNormal(cell, middle);
  let alignment = reference ? normal[0] * reference[0] + normal[2] * reference[2] : 0;
  if (!alignment) {
    const x = cell.wx + middle[0],
      z = cell.wz + middle[2],
      e = 0.002;
    alignment =
      riverLandValue(cell.river, x - normal[0] * e, z - normal[2] * e) -
      riverLandValue(cell.river, x + normal[0] * e, z + normal[2] * e);
  }
  if (alignment < 0) normal = [-normal[0], 0, -normal[2]];
  return [na ?? normal, nb ?? normal];
}
