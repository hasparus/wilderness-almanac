import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BufferGeometry } from 'three';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';
import { createFogView } from '../src/application/fog-view.js';

// Initially captured before renderer extraction and updated for approved visual
// changes. Check buffers, transforms, materials, wind and picking without WebGL.
function meshDigest(group) {
  const hash = createHash('sha256');
  let meshes = 0,
    vertices = 0;
  const json = (value) => hash.update(JSON.stringify(value));
  group.updateMatrixWorld(true);
  group.traverse((object) => {
    if (!object.isMesh) return;
    meshes++;
    const geometry = object.geometry;
    vertices += geometry.attributes.position.count;
    json([
      object.matrixWorld.elements,
      object.castShadow,
      object.receiveShadow,
      Boolean(object.customDepthMaterial),
      object.userData,
      geometry.groups,
    ]);
    for (const name of Object.keys(geometry.attributes).sort()) {
      const attr = geometry.attributes[name];
      json([name, attr.itemSize, attr.normalized, attr.array.constructor.name]);
      hash.update(Buffer.from(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength));
    }
    if (geometry.index)
      hash.update(
        Buffer.from(
          geometry.index.array.buffer,
          geometry.index.array.byteOffset,
          geometry.index.array.byteLength,
        ),
      );
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      json([
        material.type,
        material.color?.toArray(),
        material.side,
        material.flatShading,
        material.roughness,
        material.metalness,
        material.transparent,
        material.opacity,
        material.depthWrite,
        material.userData,
      ]);
  });
  return { meshes, vertices, digest: hash.digest('hex') };
}
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/rendering.json', import.meta.url)));
for (const { seed, variant, colors, expected } of fixtures)
  test(`rendered geometry, colours and picking metadata match the approved fixtures: seed ${seed}`, () => {
    const world = generateWorld(seed, { generatorVersion: 10 });
    const registry = createMapMaterials();
    const meshes = createMapMeshes(registry);
    try {
      registry.setPalette(colors);
      meshes.setMap(prepareMap(world, generateDressing(world, variant)));
      assert.deepEqual(meshDigest(meshes.group), expected);
      registry.setPalette(['#322333', '#2a6775', '#ed8965']);
      registry.setPalette(colors);
      assert.deepEqual(
        meshDigest(meshes.group),
        expected,
        'recolouring preserves geometry and cached tints',
      );
    } finally {
      meshes.dispose();
      registry.dispose();
    }
  });

for (const artStyle of ['low-poly', 'pixelart'])
  test(`${artStyle} batching consumes prop geometry without cloning or double disposal`, (t) => {
    const world = generateWorld('heliotest');
    const layout = prepareMap(world, generateDressing(world, 0));
    const before = structuredClone(layout);
    const registry = createMapMaterials();
    const meshes = createMapMeshes(registry, { artStyle });
    const clones = t.mock.method(BufferGeometry.prototype, 'clone');
    const dispose = BufferGeometry.prototype.dispose;
    const disposals = new Map();
    t.mock.method(BufferGeometry.prototype, 'dispose', function () {
      disposals.set(this, (disposals.get(this) ?? 0) + 1);
      return dispose.call(this);
    });
    try {
      meshes.setMap(layout);
      let batches = 0,
        padded = 0;
      meshes.group.traverse((object) => {
        if (!object.userData.faceRanges) return;
        batches++;
        const expected = new BufferGeometry();
        expected.setAttribute('position', object.geometry.attributes.position);
        expected.computeBoundingBox();
        expected.computeBoundingSphere();
        if (object.material.userData.pixelFoliage || object.material.userData.pixelDressing) {
          expected.boundingSphere.radius += 0.35;
          padded++;
        }
        assert.deepEqual(object.geometry.boundingBox, expected.boundingBox);
        assert.deepEqual(object.geometry.boundingSphere, expected.boundingSphere);
        expected.dispose();
      });
      assert.ok(batches > 0);
      if (artStyle === 'pixelart') assert.ok(padded > 0);
      const first = meshDigest(meshes.group);
      meshes.setMap(layout);
      assert.deepEqual(meshDigest(meshes.group), first);
      assert.deepEqual(layout, before, 'batching leaves numeric inputs unchanged');
      assert.equal(clones.mock.callCount(), 0);
    } finally {
      meshes.dispose();
      registry.dispose();
    }
    assert.ok(disposals.size > 0);
    assert.ok([...disposals.values()].every((count) => count === 1));
  });

test('rebuilds release old geometry once, retain shared materials, and dispose their owned resources', () => {
  const world = generateWorld('7');
  const layout = prepareMap(world, generateDressing(world, 0)).slice(0, 4);
  const registry = createMapMaterials();
  const meshes = createMapMeshes(registry);
  const watch = (resources) =>
    new Map(
      [...new Set(resources)].map((resource) => {
        const count = { value: 0 };
        resource.addEventListener('dispose', () => count.value++);
        return [resource, count];
      }),
    );
  const geometries = () => {
    const found = [];
    meshes.group.traverse((object) => {
      if (object.geometry) found.push(object.geometry);
    });
    return found;
  };
  meshes.setMap(layout);
  const oldGeometry = watch(geometries());
  const tinted = registry.propMaterial('leaf', 0.2, 1);
  const materials = watch([...Object.values(registry.materials), registry.treeDepth, tinted]);
  meshes.setMap(layout);
  assert.ok([...oldGeometry.values()].every((count) => count.value === 1));
  assert.ok([...materials.values()].every((count) => count.value === 0));
  const currentGeometry = watch(geometries());
  meshes.dispose();
  registry.dispose();
  assert.ok([...currentGeometry.values()].every((count) => count.value === 1));
  assert.ok([...materials.values()].every((count) => count.value === 1));
  assert.equal(meshes.group.children.length, 0);
  assert.equal(meshes.cells.length, 0);
});

test('build records show, swap back and release without rebuilding or disposing', () => {
  const world = generateWorld('7');
  const full = prepareMap(world, generateDressing(world, 0));
  const centre = full.find((tile) => tile.pointOfLight);
  const layout = full.filter(
    (tile) => Math.abs(tile.q - centre.q) <= 1 && Math.abs(tile.r - centre.r) <= 1,
  );
  const states = new Map(
    world.cells.map((cell) => [cell.key, cell.key === centre.key ? 'visited' : 'undiscovered']),
  );
  const registry = createMapMaterials();
  const meshes = createMapMeshes(registry);
  const disposals = (record) => {
    let count = 0;
    record.root.traverse((object) => object.geometry?.addEventListener('dispose', () => count++));
    return () => count;
  };
  try {
    const source = meshes.build(layout);
    const sourceDisposed = disposals(source);
    assert.equal(meshes.group.children.length, 0, 'building does not touch the map');
    assert.ok(source.lightSources.length > 0);
    assert.equal(meshes.show(source), null);
    assert.deepEqual(meshes.group.children, [source.root]);
    assert.deepEqual(meshes.cells, source.cells);
    assert.deepEqual(meshes.lightSources, source.lightSources);
    const projection = meshes.build(createFogView(world, layout, states).layout);
    assert.equal(meshes.show(projection), source, 'show hands back what it replaced');
    assert.deepEqual(meshes.group.children, [projection.root]);
    assert.ok(meshes.cells.every((cell) => cell.fogState));
    assert.equal(sourceDisposed(), 0, 'a replaced record keeps its geometry');
    assert.equal(meshes.show(source), projection);
    assert.deepEqual(meshes.group.children, [source.root], 'the same objects come back');
    assert.deepEqual(meshes.lightSources, source.lightSources);
    meshes.release(projection);
    assert.equal(sourceDisposed(), 0);
    meshes.dispose();
    assert.ok(sourceDisposed() > 0, 'dispose releases the shown record');
    assert.equal(meshes.group.children.length, 0);
    assert.equal(meshes.cells.length, 0);
  } finally {
    meshes.dispose();
    registry.dispose();
  }
});
