// @ts-check
import { Box3, Mesh, Vector3 } from 'three';

const MAX_RANGE_VERTICES = 1024 * 3;
/** @typedef {{start: number, end: number, key: string, bounds: Box3}} PickRange */
/** @typedef {{object: Mesh, ranges?: PickRange[]}} PickEntry */

/**
 * Bound contiguous tile ranges once. Follow each hex's shader translation and
 * skip unrevealed ranges without rescanning vertices or changing batch buffers.
 * @param {import('three').Object3D[]} roots
 * @param {{reveal?: (key: string) => {offset: number, visible: boolean} | undefined}} [options]
 */
export function createMapPicker(roots, { reveal } = {}) {
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
  const translation = new Vector3();
  /** @param {Mesh} mesh @param {import('three').Raycaster} raycaster @param {number} offset @returns {import('three').Intersection | null} */
  function intersect(mesh, raycaster, offset) {
    hits.length = 0;
    const originY = raycaster.ray.origin.y;
    try {
      raycaster.ray.origin.y -= offset;
      raycaster.intersectObject(mesh, false, hits);
    } finally {
      raycaster.ray.origin.y = originY;
    }
    const hit = hits[0] ?? null;
    if (hit) hit.point.y += offset;
    return hit;
  }
  /** @param {import('three').Raycaster} raycaster @returns {import('three').Intersection | null} */
  return (raycaster) => {
    /** @type {import('three').Intersection | null} */
    let nearest = null;
    for (const { object, ranges } of entries) {
      if (!ranges) {
        const state = reveal?.(object.userData.key);
        if (state?.visible === false) continue;
        const hit = intersect(object, raycaster, state?.offset ?? 0);
        if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
        continue;
      }
      const geometry = object.geometry;
      const { start, count } = geometry.drawRange;
      try {
        for (const range of ranges) {
          const from = Math.max(start, range.start);
          const to = Math.min(start + count, range.end);
          const state = reveal?.(range.key);
          if (from >= to || state?.visible === false) continue;
          const offset = state?.offset ?? 0;
          const bounds = offset
            ? shiftedBounds.copy(range.bounds).translate(translation.set(0, offset, 0))
            : range.bounds;
          if (!raycaster.ray.intersectsBox(bounds)) continue;
          geometry.setDrawRange(from, to - from);
          const hit = intersect(object, raycaster, offset);
          if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
        }
      } finally {
        geometry.setDrawRange(start, count);
      }
    }
    return nearest;
  };
}
