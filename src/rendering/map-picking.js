import { Box3, Vector3 } from 'three';

const MAX_RANGE_VERTICES = 1024 * 3;

// Material batches span the whole map. Bound contiguous tile ranges once so
// picking visits nearby triangles without changing the rendered geometry.
export function createMapPicker(roots) {
  const entries = [];
  const point = new Vector3();
  const visit = (object) => {
    if (!object.isMesh) return;
    const faceRanges = object.userData.faceRanges;
    if (!faceRanges) {
      entries.push({ object });
      return;
    }
    const geometry = object.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const ranges = [];
    let start = 0;
    for (const { end, key } of faceRanges) {
      const previous = ranges.at(-1);
      if (previous?.key === key && end * 3 - previous.start <= MAX_RANGE_VERTICES)
        previous.end = end * 3;
      else ranges.push({ start, end: end * 3, key });
      start = end * 3;
    }
    for (const range of ranges) {
      const bounds = new Box3();
      for (let offset = range.start; offset < range.end; offset++)
        bounds.expandByPoint(
          point.fromBufferAttribute(position, index ? index.getX(offset) : offset),
        );
      range.bounds = bounds.applyMatrix4(object.matrixWorld);
    }
    entries.push({ object, ranges });
  };
  for (const root of roots) root.traverse(visit);
  const hits = [];
  return (raycaster) => {
    hits.length = 0;
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
          if (from >= to || !raycaster.ray.intersectsBox(range.bounds)) continue;
          geometry.setDrawRange(from, to - from);
          raycaster.intersectObject(object, false, hits);
        }
      } finally {
        // Foliage LOD owns the draw range; picking must leave it untouched.
        geometry.setDrawRange(start, count);
      }
    }
    return hits[0] ?? null;
  };
}
