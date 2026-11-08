// @ts-check
import { DIRECTIONS } from '../../../src/generation/hex.js';

/** @template {{q: number, r: number}} T
 * @param {T[]} layout
 * @param {number} size Zero selects a single monolithic chunk.
 * @returns {Map<string, T[]>}
 */
export function partition(layout, size) {
  /** @type {Map<string, T[]>} */
  const chunks = new Map();
  for (const tile of layout) {
    const id =
      size === 0 ? 'monolithic' : `${Math.floor(tile.q / size)},${Math.floor(tile.r / size)}`;
    if (!chunks.has(id)) chunks.set(id, []);
    /** @type {T[]} */ (chunks.get(id)).push(tile);
  }
  return chunks;
}
/** @param {import('./types.js').WorldCell[]} source
 * @param {import('./types.js').FogStates | null} states
 * @returns {string} Includes neighbouring visibility for shared edge geometry.
 */
export function fogSignature(source, states) {
  if (!states) return 'source';
  return source
    .map(
      (tile) =>
        `${states.get(tile.key)}:${DIRECTIONS.reduce(
          (mask, [q, r], i) =>
            mask | (states.get(`${tile.q + q},${tile.r + r}`) !== 'undiscovered' ? 1 << i : 0),
          0,
        )}`,
    )
    .join('|');
}
/** @param {import('three').Object3D[]} roots
 * @returns {import('./types.js').GeometryStats} Shared geometry is counted once.
 */
export function geometryStats(roots) {
  /** @type {Set<import('three').BufferGeometry>} */
  const geometries = new Set();
  const totals = { objects: 0, meshes: 0, vertices: 0, triangles: 0, attributeBytes: 0 };
  for (const root of roots)
    root.traverse((object) => {
      totals.objects++;
      if (!(/** @type {import('three').Mesh} */ (object).isMesh)) return;
      totals.meshes++;
      const g = /** @type {import('three').Mesh} */ (object).geometry;
      if (geometries.has(g)) return;
      geometries.add(g);
      totals.vertices += g.attributes.position?.count ?? 0;
      totals.triangles += (g.index?.count ?? g.attributes.position?.count ?? 0) / 3;
      totals.attributeBytes +=
        Object.values(g.attributes).reduce((sum, a) => sum + a.array.byteLength, 0) +
        (g.index?.array.byteLength ?? 0);
    });
  return totals;
}
