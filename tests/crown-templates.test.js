import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute, Matrix4 } from 'three';
import { crownGeometry, crownTemplate } from '../src/rendering/pixel-foliage-geometry.js';
import {
  describePropPart,
  describePropTemplate,
  mergePropParts,
} from '../src/rendering/prop-batches.js';

function makeCrown(indices = [0, 1, 2]) {
  return Object.freeze({
    points: Object.freeze([-0.3, 0.7, 0.1, 0.4, 0.9, -0.2, 0.1, 0.2, 0.6]),
    normals: Object.freeze([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: Object.freeze([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]),
    indices: Object.freeze(indices),
  });
}

function arrays(geometry) {
  return {
    ...Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, value]) => [name, value.array]),
    ),
    index: geometry.index?.array,
  };
}

test('crown geometries share only template arrays, with independent attributes and disposal', () => {
  const crown = makeCrown();
  const before = structuredClone(crown);
  const template = crownTemplate(crown);
  const first = crownGeometry(crown);
  const second = crownGeometry(crown);
  assert.equal(crownTemplate(crown), template);
  assert.notEqual(crownTemplate(makeCrown()), template, 'cache is keyed by crown identity');
  assert.notEqual(first, second);
  for (const name of ['position', 'normal', 'uv']) {
    assert.notEqual(first.attributes[name], second.attributes[name]);
    assert.equal(first.attributes[name].array, template[name]);
    assert.equal(second.attributes[name].array, template[name]);
    first.attributes[name].needsUpdate = true;
    assert.equal(second.attributes[name].version, 0);
  }
  assert.notEqual(first.index, second.index);
  assert.equal(first.index.array, second.index.array);
  let firstDisposed = 0,
    secondDisposed = 0;
  first.addEventListener('dispose', () => firstDisposed++);
  second.addEventListener('dispose', () => secondDisposed++);
  const snapshot = structuredClone(arrays(second));
  first.dispose();
  assert.equal(firstDisposed, 1);
  assert.equal(secondDisposed, 0);
  assert.deepEqual(arrays(second), snapshot);
  const third = crownGeometry(crown);
  assert.equal(third.attributes.position.array, template.position);
  assert.notEqual(third.attributes.position, first.attributes.position);
  second.dispose();
  assert.equal(secondDisposed, 1);
  third.dispose();
  assert.deepEqual(crown, before);
});

for (const indices of [[], [0, 1, 2], [0, 1, 65534], [0, 1, 65535], [0, 1, 65536]])
  test(`crown template conversion matches Three.js, including index boundary: ${indices.at(-1)}`, () => {
    const crown = makeCrown(indices);
    const expected = new BufferGeometry();
    expected.setAttribute('position', new Float32BufferAttribute(crown.points, 3));
    expected.setAttribute('normal', new Float32BufferAttribute(crown.normals, 3));
    expected.setAttribute('uv', new Float32BufferAttribute(crown.uvs, 2));
    expected.setIndex(crown.indices);
    const actual = crownGeometry(crown);
    assert.deepEqual(arrays(actual), arrays(expected));
    actual.dispose();
    expected.dispose();
  });

test('direct far-crown descriptors match geometry descriptors without mutating shared templates', () => {
  const crown = makeCrown();
  const before = structuredClone(crown);
  const template = crownTemplate(crown);
  const templateBefore = structuredClone(template);
  const geometry = crownGeometry(crown);
  const matrix = new Matrix4().makeRotationY(0.371).scale({ x: -0.73, y: 1.31, z: 0.87 });
  matrix.setPosition(0.1, 0.2, -0.3);
  for (const compact of [true, false])
    for (const expand of [true, false])
      for (const uv of [true, false]) {
        const options = {
          compact,
          expand,
          uv,
          phase: 0.7,
          base: 0.2,
          wind: { height: 0.8, strength: 1 },
        };
        const direct = describePropTemplate(template, matrix, options);
        const wrapped = describePropPart(geometry, matrix, options);
        assert.deepEqual(direct, wrapped);
        const actual = mergePropParts([direct, direct]);
        const expected = mergePropParts([wrapped, wrapped]);
        assert.deepEqual(arrays(actual), arrays(expected));
        assert.deepEqual(actual.boundingBox, expected.boundingBox);
        assert.deepEqual(actual.boundingSphere, expected.boundingSphere);
        assert.notEqual(actual.attributes.position.array, template.position);
        actual.dispose();
        expected.dispose();
      }
  assert.deepEqual(template, templateBefore);
  assert.deepEqual(crown, before);
  geometry.dispose();
});
