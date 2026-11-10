// @ts-check
import { DIRECTIONS } from './hex.js';
import { TOP_RADIUS } from './math.js';
import { ridgeSurface } from './ridge-surface.js';
import { randomFor } from './seed.js';
import { mountainRidges } from './mountain-ridges.js';

/**
 * @typedef {{ key: string, q: number, r: number, wx: number, wz: number, elevation: number }} MountainCell
 * @typedef {{ seed: string, cells: MountainCell[], elevation: {
 *   ranges: { id: string, hexKeys: string[] }[],
 * } }} MountainWorld
 * @typedef {{ rangeId: string, phase: number, angle: number, heightScale: number, profile?: number }} MountainShape
 * @typedef {{ mountains: MountainShape[], revisions?: Record<string, number> }} MountainDressing
 * @typedef {{ vertices: number[][], triangles: number[][] }} MountainSurface
 * @typedef {{ type: string, shared: boolean[], corners: number[][], surface: MountainSurface }} MountainData
 * @typedef {(string | number | undefined)[]} MountainSignature
 */

/** @type {WeakMap<MountainWorld, WeakMap<MountainDressing, {
 *   signature: MountainSignature, surfaces: Map<string, MountainData>,
 * }>>} */
const prepared = new WeakMap();

/** @param {MountainWorld} world @param {MountainDressing} dressing */
function mountainSignature(world, dressing) {
  /** @type {MountainSignature} */
  const signature = [world.seed, world.cells.length];
  for (const cell of world.cells)
    signature.push(
      cell.key,
      cell.q,
      cell.r,
      cell.wx,
      cell.wz,
      cell.elevation,
      dressing.revisions?.[cell.key],
    );
  signature.push(world.elevation.ranges.length);
  for (const range of world.elevation.ranges)
    signature.push(range.id, range.hexKeys.length, ...range.hexKeys);
  signature.push(dressing.mountains.length);
  for (const shape of dressing.mountains)
    signature.push(shape.rangeId, shape.phase, shape.angle, shape.heightScale, shape.profile);
  return signature;
}

/** @param {Map<string, MountainData>} surfaces */
function cloneSurfaces(surfaces) {
  return new Map(
    [...surfaces].map(([key, data]) => [
      key,
      {
        type: data.type,
        shared: data.shared.slice(),
        corners: data.corners.map((point) => point.slice()),
        surface: {
          vertices: data.surface.vertices.map((vertex) => vertex.slice()),
          triangles: data.surface.triangles.map((triangle) => triangle.slice()),
        },
      },
    ]),
  );
}

/** @param {MountainWorld} world @param {MountainDressing} dressing */
export function prepareMountainRanges(world, dressing) {
  if (dressing.mountains.some((shape) => shape.profile !== 1 && 'ridges' in shape))
    return buildMountainRanges(world, dressing);
  const signature = mountainSignature(world, dressing);
  let dressings = prepared.get(world);
  const cached = dressings?.get(dressing);
  if (
    cached &&
    cached.signature.length === signature.length &&
    signature.every((value, index) => Object.is(value, cached.signature[index]))
  )
    return cloneSurfaces(cached.surfaces);
  const surfaces = buildMountainRanges(world, dressing);
  if (!dressings) prepared.set(world, (dressings = new WeakMap()));
  dressings.set(dressing, { signature, surfaces });
  return cloneSurfaces(surfaces);
}

// Build broad, faceted ranges. A single height field per range
// keeps neighbouring mountain tiles joined instead of placing isolated cones.
/** @param {MountainWorld} world @param {MountainDressing} dressing */
function buildMountainRanges(world, dressing) {
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const shapes = new Map(dressing.mountains.map((shape) => [shape.rangeId, shape]));
  /** @type {Map<string, Omit<MountainData, 'surface'> & { surface?: MountainSurface }>} */
  const result = new Map();
  for (const range of world.elevation.ranges) {
    const shape = shapes.get(range.id);
    if (!shape) continue;
    const cells = range.hexKeys
      .map((key) => /** @type {MountainCell} */ (byKey.get(key)))
      .filter((cell) => cell.elevation === 4);
    if (!cells.length) continue;
    const keys = new Set(cells.map((cell) => cell.key));
    /** @type {MountainShape & { boundary: number[][][], spines: number[][][],
     *   ridges?: ReturnType<typeof mountainRidges> }} */
    const field = { ...shape, boundary: [], spines: [] };
    for (const cell of cells) {
      const shared = DIRECTIONS.map(([q, r]) => keys.has(`${cell.q + q},${cell.r + r}`));
      const corners = Array.from({ length: 6 }, (_, k) => {
        const radius = shared[(7 - k) % 6] || shared[(8 - k) % 6] ? 1 : TOP_RADIUS;
        return [Math.sin((k * Math.PI) / 3) * radius, Math.cos((k * Math.PI) / 3) * radius];
      });
      result.set(cell.key, { type: 'Mountains', shared, corners });
      for (let k = 0; k < 6; k++) {
        if (shared[(7 - k) % 6]) continue;
        field.boundary.push(
          [corners[k], corners[(k + 1) % 6]].map(([x, z]) => [x + cell.wx, z + cell.wz]),
        );
      }
      for (let k = 0; k < 3; k++) {
        if (!shared[k]) continue;
        const [q, r] = DIRECTIONS[k];
        const next = /** @type {MountainCell} */ (byKey.get(`${cell.q + q},${cell.r + r}`));
        field.spines.push([
          [cell.wx, cell.wz],
          [next.wx, next.wz],
        ]);
      }
    }
    if (shape.profile === 1) field.ridges = mountainRidges(cells, shape, world.seed);
    for (const cell of cells) {
      const data = /** @type {MountainData} */ (result.get(cell.key));
      data.surface = ridgeSurface({ ...cell, corners: data.corners }, field);
      // Keep the existing low-poly facets but limit their added silhouette.
      for (const vertex of data.surface.vertices) vertex[1] *= shape.heightScale;
      const revision = dressing.revisions?.[cell.key];
      if (revision) {
        const random = randomFor(world.seed, `ridge-detail:${cell.key}:${revision}`);
        const phase = random() * Math.PI * 2;
        for (const vertex of data.surface.vertices) {
          // Local relief fades to zero at every edge, retaining shared seams.
          const radius = Math.max(
            ...DIRECTIONS.map(
              (_, side) =>
                vertex[0] * Math.cos((side * Math.PI) / 3) +
                vertex[2] * Math.sin((side * Math.PI) / 3),
            ),
          );
          const weight = Math.max(0, 1 - radius / ((Math.sqrt(3) / 2) * TOP_RADIUS));
          vertex[1] *= 1 + Math.sin(vertex[0] * 4 + vertex[2] * 3 + phase) * 0.3 * weight;
        }
      }
    }
  }
  return /** @type {Map<string, MountainData>} */ (result);
}
