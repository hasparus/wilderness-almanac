// @ts-check

/** @typedef {{wx: number, wz: number, top: number}} PriorityTile */
/** @typedef {{x: number, y: number, z: number}} Point */
/** @typedef {{min: Point, max: Point, center: Point}} ChunkBounds */

/**
 * Conservative pre-build envelope: full hex radius plus crown/edge overhang,
 * base sides, and headroom for the <=1.2 ridge and its trees/landmarks. This is
 * scheduling metadata, never a culling bound or a replacement for mesh bounds.
 * @param {PriorityTile[]} tiles
 * @returns {ChunkBounds}
 */
export function chunkPriorityBounds(tiles) {
  const min = { x: Infinity, y: -0.1, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const center = { x: 0, y: 0, z: 0 };
  for (const tile of tiles) {
    min.x = Math.min(min.x, tile.wx - 1.25);
    min.z = Math.min(min.z, tile.wz - 1.25);
    max.x = Math.max(max.x, tile.wx + 1.25);
    max.z = Math.max(max.z, tile.wz + 1.25);
    max.y = Math.max(max.y, tile.top + 3);
    center.x += tile.wx;
    center.y += tile.top;
    center.z += tile.wz;
  }
  center.x /= tiles.length;
  center.y /= tiles.length;
  center.z /= tiles.length;
  return { min, max, center };
}

/**
 * Project all eight envelope corners for orthographic viewport intersection.
 * Every intersecting chunk ranks before every offscreen chunk, then by distance
 * to the viewport center. The bounded distance keeps these tiers disjoint.
 * @param {ChunkBounds} bounds
 * @param {(x: number, y: number, z: number) => Point} project May return a reused point.
 * @returns {number}
 */
export function viewportPriority({ min, max, center }, project) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y])
      for (const z of [min.z, max.z]) {
        const p = project(x, y, z);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        minZ = Math.min(minZ, p.z);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
        maxZ = Math.max(maxZ, p.z);
      }
  const intersects = minX <= 1 && maxX >= -1 && minY <= 1 && maxY >= -1 && minZ <= 1 && maxZ >= -1;
  const p = project(center.x, center.y, center.z);
  const distance = p.x ** 2 + p.y ** 2;
  return (intersects ? 0 : 1) + distance / (1 + distance);
}
