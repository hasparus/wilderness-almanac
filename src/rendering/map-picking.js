// @ts-check
import { Box3, Mesh, Vector3 } from 'three';

const MAX_RANGE_VERTICES = 1024 * 3;
/** @typedef {{start: number, end: number, key: string, bounds: Box3}} PickRange */
/** @typedef {{object: Mesh, ranges?: PickRange[]}} PickEntry */

/**
 * Bound contiguous tile ranges once. An optional world-space translation keeps
 * those bounds valid while a chunk settles, without rescanning its vertices.
 * @param {import('three').Object3D[]} roots
 * @param {{offset?: Vector3}} [options] Translation relative to construction-time matrices.
 */
export function createMapPicker(roots, { offset } = {}) {
  /** @type {PickEntry[]} */
  const entries = [];
  const point = new Vector3();
  /** @param {import('three').Object3D} object @returns {void} */
  const visit = (object) => {
    if (!(object instanceof Mesh)) return;
    const faceRanges = /** @type {{end: number, key: string}[] | undefined} */ (
      object.userData.faceRanges
    );
    if (!faceRanges) {
      entries.push({ object });
      return;
    }
    const geometry = object.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;
    /** @type {PickRange[]} */
    const ranges = [];
    let start = 0;
    for (const { end, key } of faceRanges) {
      const previous = ranges.at(-1);
      if (previous?.key === key && end * 3 - previous.start <= MAX_RANGE_VERTICES)
        previous.end = end * 3;
      else ranges.push({ start, end: end * 3, key, bounds: new Box3() });
      start = end * 3;
    }
    for (const range of ranges) {
      for (let cursor = range.start; cursor < range.end; cursor++)
        range.bounds.expandByPoint(
          point.fromBufferAttribute(position, index ? index.getX(cursor) : cursor),
        );
      range.bounds.applyMatrix4(object.matrixWorld);
    }
    entries.push({ object, ranges });
  };
  for (const root of roots) root.traverse(visit);
  /** @type {import('three').Intersection[]} */
  const hits = [];
  const shiftedBounds = new Box3();
  /** @param {import('three').Raycaster} raycaster @returns {import('three').Intersection | null} */
  return (raycaster) => {
    hits.length = 0;
    const shifted = offset && offset.lengthSq() > 0;
    for (const { object, ranges } of entries) {
      if (!ranges) {
        raycaster.intersectObject(object, false, hits);
        continue;
      }
      const geometry = object.geometry;
      const { start, count } = geometry.drawRange;
      try {
        for (const range of ranges) {
          const from = Math.max(start, range.start);
          const to = Math.min(start + count, range.end);
          const bounds = shifted
            ? shiftedBounds.copy(range.bounds).translate(offset)
            : range.bounds;
          if (from >= to || !raycaster.ray.intersectsBox(bounds)) continue;
          geometry.setDrawRange(from, to - from);
          raycaster.intersectObject(object, false, hits);
        }
      } finally {
        geometry.setDrawRange(start, count);
      }
    }
    return hits[0] ?? null;
  };
}
