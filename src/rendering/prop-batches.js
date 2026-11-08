import { BufferGeometry, BufferAttribute, Matrix3, Matrix4, Vector3 } from 'three';
import { windWeight } from './ambient-motion.js';

function isFloatAttribute(attribute, itemSize) {
  return (
    attribute &&
    !attribute.normalized &&
    !attribute.isInterleavedBufferAttribute &&
    attribute.itemSize === itemSize &&
    attribute.array instanceof Float32Array
  );
}

export function describePropPart(geometry, matrix, { expand, compact, base, wind, phase, uv }) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const texture = uv ? geometry.attributes.uv : null;
  if (
    !isFloatAttribute(position, 3) ||
    !isFloatAttribute(normal, 3) ||
    (texture && !isFloatAttribute(texture, 2))
  )
    throw new Error('Prop batches require unnormalized Float32 position/normal/UV attributes');
  return {
    position: position.array,
    normal: normal.array,
    uv: texture?.array,
    index: geometry.index?.array,
    matrix: matrix.elements,
    expand,
    compact,
    base,
    wind,
    phase,
    count: expand ? geometry.index.count : position.count,
    faces: (geometry.index?.count ?? position.count) / 3,
  };
}

function packParts(parts) {
  const compact = parts[0].compact;
  const textured = !!parts[0].uv;
  const indexed = !!parts[0].index && !parts[0].expand;
  let vertices = 0,
    indexCount = 0;
  for (const part of parts) {
    if (
      part.compact !== compact ||
      !!part.uv !== textured ||
      (!!part.index && !part.expand) !== indexed
    )
      throw new Error('Incompatible prop batch parts');
    vertices += part.count;
    if (indexed) indexCount += part.index.length;
  }
  const position = new Float32Array(vertices * 3);
  const normal = compact ? new Int8Array(vertices * 3) : new Float32Array(vertices * 3);
  const uv = textured
    ? compact
      ? new Uint16Array(vertices * 2)
      : new Float32Array(vertices * 2)
    : null;
  const swayWeight = compact ? new Uint8Array(vertices) : new Float32Array(vertices);
  const wavePhase = compact ? null : new Float32Array(vertices);
  let index = indexed
    ? vertices > 65535
      ? new Uint32Array(indexCount)
      : new Uint16Array(indexCount)
    : null;
  const matrix = new Matrix4(),
    normalMatrix = new Matrix3(),
    p = new Vector3(),
    n = new Vector3();
  let vertexOffset = 0,
    indexOffset = 0,
    maxIndex = 0;
  for (const part of parts) {
    matrix.fromArray(part.matrix);
    normalMatrix.getNormalMatrix(matrix);
    for (let vertex = 0; vertex < part.count; vertex++) {
      const source = part.expand ? part.index[vertex] : vertex;
      const input = source * 3,
        output = (vertexOffset + vertex) * 3;
      p.set(part.position[input], part.position[input + 1], part.position[input + 2]).applyMatrix4(
        matrix,
      );
      position[output] = p.x;
      position[output + 1] = p.y;
      position[output + 2] = p.z;
      n.set(part.normal[input], part.normal[input + 1], part.normal[input + 2]).applyNormalMatrix(
        normalMatrix,
      );
      if (compact) {
        normal[output] = Math.round(Math.fround(n.x) * 127);
        normal[output + 1] = Math.round(Math.fround(n.y) * 127);
        normal[output + 2] = Math.round(Math.fround(n.z) * 127);
      } else {
        normal[output] = n.x;
        normal[output + 1] = n.y;
        normal[output + 2] = n.z;
      }
      const target = vertexOffset + vertex;
      const weight = part.wind ? windWeight(position[output + 1] - part.base, part.wind) : 0;
      swayWeight[target] = compact ? Math.round(Math.fround(weight) * 255) : weight;
      if (wavePhase) wavePhase[target] = part.phase;
      if (uv) {
        uv[target * 2] = compact ? Math.round(part.uv[source * 2] * 65535) : part.uv[source * 2];
        uv[target * 2 + 1] = compact
          ? Math.round(part.uv[source * 2 + 1] * 65535)
          : part.uv[source * 2 + 1];
      }
    }
    if (indexed)
      for (let i = 0; i < part.index.length; i++) {
        const value = vertexOffset + part.index[i];
        index[indexOffset++] = value;
        if (value > maxIndex) maxIndex = value;
      }
    vertexOffset += part.count;
  }
  if (index instanceof Uint32Array && maxIndex < 65535) index = new Uint16Array(index);
  return { position, normal, uv, swayWeight, wavePhase, index, compact };
}

export function mergePropParts(parts) {
  const arrays = packParts(parts);
  const geometry = new BufferGeometry();
  for (const [name, itemSize] of [
    ['position', 3],
    ['normal', 3],
    ['uv', 2],
    ['swayWeight', 1],
    ['wavePhase', 1],
  ])
    if (arrays[name])
      geometry.setAttribute(
        name,
        new BufferAttribute(arrays[name], itemSize, arrays.compact && name !== 'position'),
      );
  if (arrays.index) geometry.setIndex(new BufferAttribute(arrays.index, 1));
  return geometry;
}
