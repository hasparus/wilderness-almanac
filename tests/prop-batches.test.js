import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Euler,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix3,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { windWeight } from '../src/rendering/ambient-motion.js';
import { describePropPart, mergePropParts } from '../src/rendering/prop-batches.js';

function referenceBake(geometry, matrix, { expand, compact, base, wind, phase, uv }) {
  const result = expand ? geometry.toNonIndexed() : geometry.clone();
  result.applyMatrix4(matrix);
  for (const name of Object.keys(result.attributes))
    if (name !== 'position' && name !== 'normal' && !(name === 'uv' && uv))
      result.deleteAttribute(name);
  const positions = result.attributes.position;
  const sway = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++)
    sway[i] = wind ? windWeight(positions.getY(i) - base, wind) : 0;
  result.setAttribute('swayWeight', new BufferAttribute(sway, 1));
  if (compact) {
    for (const [name, Type, scale] of [
      ['normal', Int8Array, 127],
      ['uv', Uint16Array, 65535],
      ['swayWeight', Uint8Array, 255],
    ]) {
      const attribute = result.attributes[name];
      result.setAttribute(
        name,
        new BufferAttribute(
          Type.from(attribute.array, (value) => Math.round(value * scale)),
          attribute.itemSize,
          true,
        ),
      );
    }
  } else
    result.setAttribute(
      'wavePhase',
      new BufferAttribute(new Float32Array(positions.count).fill(phase), 1),
    );
  return result;
}

function buffers(geometry) {
  return Object.fromEntries(
    [...Object.entries(geometry.attributes), ['index', geometry.index]]
      .filter(([, attribute]) => attribute)
      .map(([name, attribute]) => [
        name,
        {
          type: attribute.array.constructor.name,
          itemSize: attribute.itemSize,
          normalized: attribute.normalized,
          bytes: Buffer.from(
            attribute.array.buffer,
            attribute.array.byteOffset,
            attribute.array.byteLength,
          ),
        },
      ]),
  );
}

for (const compact of [false, true])
  for (const topology of ['indexed', 'expanded', 'nonindexed'])
    for (const uv of compact ? [true] : [false, true])
      test(`direct prop packing matches the component bake: ${compact ? 'compact' : 'float'}, ${topology}, UV=${uv}`, () => {
        const components = [],
          parts = [],
          baked = [];
        for (let i = 0; i < 5; i++) {
          const box = new BoxGeometry(0.23, 0.77, 0.41);
          const geometry = topology === 'nonindexed' ? box.toNonIndexed() : box;
          if (geometry !== box) box.dispose();
          geometry.setAttribute(
            'discarded',
            new BufferAttribute(new Float32Array(geometry.attributes.position.count), 1),
          );
          const matrix = new Matrix4().compose(
            new Vector3(i * 0.73333333, 0.371111111 + i / 7, -i / 3),
            new Quaternion().setFromEuler(new Euler(i * 0.17, i * 0.33, -i * 0.11)),
            new Vector3(0.73 + i / 9, 1.37, i === 4 ? -0.87 : 0.87),
          );
          const options = {
            expand: topology === 'expanded',
            compact,
            uv,
            base: 0.18,
            wind: i % 2 ? { height: 1.21, strength: 0.67 } : undefined,
            phase: i / 7,
          };
          const before = structuredClone(buffers(geometry));
          components.push({ geometry, before });
          parts.push(describePropPart(geometry, matrix, options));
          baked.push(referenceBake(geometry, matrix, options));
          assert.equal(
            parts.at(-1).faces,
            (geometry.index?.count ?? geometry.attributes.position.count) / 3,
          );
        }
        const expected = mergeGeometries(baked);
        const actual = mergePropParts(parts);
        assert.deepEqual(buffers(actual), buffers(expected));
        actual.computeBoundingBox();
        expected.computeBoundingBox();
        actual.computeBoundingSphere();
        expected.computeBoundingSphere();
        assert.deepEqual(actual.boundingBox, expected.boundingBox);
        assert.deepEqual(actual.boundingSphere, expected.boundingSphere);
        for (const { geometry, before } of components) {
          assert.deepEqual(
            structuredClone(buffers(geometry)),
            before,
            'source arrays are untouched',
          );
          geometry.dispose();
        }
        for (const geometry of [...baked, expected, actual]) geometry.dispose();
      });

for (const maximum of [65534, 65535, 65536])
  test(`index width follows Three.js primitive-restart boundary: ${maximum}`, () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(65537 * 3), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(65537 * 3), 3));
    geometry.setIndex([0, 1, maximum]);
    const matrix = new Matrix4();
    const options = { expand: false, compact: false, base: 0, phase: 0, uv: false };
    const baked = referenceBake(geometry, matrix, options);
    const expected = mergeGeometries([baked]);
    const actual = mergePropParts([describePropPart(geometry, matrix, options)]);
    assert.deepEqual(buffers(actual), buffers(expected));
    for (const owned of [geometry, baked, expected, actual]) owned.dispose();
  });

test('foliage quantization keeps the intermediate Float32 rounding of normals and wind', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 1, 0, 1, 1, 0, 0, 1, 1]), 3),
  );
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(6), 2));
  const matrix = new Matrix4().makeRotationZ(Math.acos(0.5 / 127 + 1e-10));
  const normal = new Vector3(1, 0, 0).applyNormalMatrix(new Matrix3().getNormalMatrix(matrix));
  assert.equal(Math.round(normal.x * 127), 1);
  assert.equal(Math.round(Math.fround(normal.x) * 127), 0);
  const y = Math.fround(new Vector3(0, 1, 0).applyMatrix4(matrix).y);
  const options = {
    expand: false,
    compact: true,
    uv: true,
    base: y - Math.sqrt(0.5 - 1e-9),
    wind: { height: 1 },
  };
  const actual = mergePropParts([describePropPart(geometry, matrix, options)]);
  const expected = referenceBake(geometry, matrix, options);
  assert.equal(actual.attributes.normal.array[0], 0);
  assert.equal(actual.attributes.swayWeight.array[0], 128);
  assert.deepEqual(buffers(actual), buffers(expected));
  for (const owned of [geometry, actual, expected]) owned.dispose();
});

test('rejects incompatible batches and unsupported component attributes', () => {
  const geometry = new BoxGeometry();
  const options = { expand: false, compact: false, base: 0, phase: 0, uv: true };
  const part = describePropPart(geometry, new Matrix4(), options);
  for (const change of [{ compact: true }, { uv: undefined }, { expand: true }])
    assert.throws(() => mergePropParts([part, { ...part, ...change }]), /Incompatible prop batch/);
  for (const attribute of [
    new BufferAttribute(new Float32Array(72), 3, true),
    new BufferAttribute(new Float64Array(72), 3),
    new BufferAttribute(new Float32Array(72), 2),
    new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array(72), 3), 3, 0),
    undefined,
  ]) {
    geometry.setAttribute('normal', attribute);
    assert.throws(() => describePropPart(geometry, new Matrix4(), options), /unnormalized Float32/);
  }
  geometry.dispose();
});
