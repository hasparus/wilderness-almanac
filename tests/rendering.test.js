import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  // The same layout reference keeps its build; a replaced layout releases it.
  const built = [...meshes.group.children];
  assert.equal(meshes.setMap(layout), false);
  assert.deepEqual(meshes.group.children, built);
  assert.ok([...oldGeometry.values()].every((count) => count.value === 0));
  assert.equal(meshes.setMap([...layout]), true);
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

test('fog projections retain the full build so toggling fog restores it without a rebuild', () => {
  const world = generateWorld('7');
  // A settlement and its neighbours, so the build carries light sources.
  const full = prepareMap(world, generateDressing(world, 0));
  const centre = full.find((tile) => tile.pointOfLight);
  const layout = full.filter(
    (tile) => Math.abs(tile.q - centre.q) <= 1 && Math.abs(tile.r - centre.r) <= 1,
  );
  const states = new Map(
    world.cells.map((cell) => [cell.key, cell.key === centre.key ? 'visited' : 'undiscovered']),
  );
  const fogged = createFogView(world, layout, states).layout;
  const registry = createMapMaterials();
  const meshes = createMapMeshes(registry);
  const disposals = () => {
    const counts = new Map();
    meshes.group.traverse((object) => {
      if (object.geometry && !counts.has(object.geometry)) {
        const count = { value: 0 };
        object.geometry.addEventListener('dispose', () => count.value++);
        counts.set(object.geometry, count);
      }
    });
    return () => [...counts.values()].reduce((sum, count) => sum + count.value, 0);
  };
  try {
    meshes.setMap(layout);
    const built = [...meshes.group.children],
      fullCells = [...meshes.cells],
      fullLights = [...meshes.lightSources],
      fullDisposed = disposals();
    assert.ok(fullLights.length > 0);
    assert.equal(meshes.setMap(fogged), true);
    const fogBuild = [...meshes.group.children],
      fogDisposed = disposals();
    assert.notDeepEqual(fogBuild, built);
    assert.equal(fullDisposed(), 0, 'the full build survives while fog is on');
    assert.ok(meshes.cells.every((cell) => cell.fogState));
    assert.equal(meshes.setMap(layout), true);
    assert.deepEqual(meshes.group.children, built, 'fog off restores the retained build');
    assert.deepEqual(meshes.cells, fullCells);
    assert.deepEqual(meshes.lightSources, fullLights);
    assert.equal(fogDisposed(), 0, 'the fog build is kept for the next toggle');
    assert.equal(meshes.setMap(fogged), true);
    assert.deepEqual(meshes.group.children, fogBuild);
    assert.equal(fullDisposed() + fogDisposed(), 0);
    // A replaced layout invalidates both the current and the retained build.
    meshes.setMap([...layout]);
    assert.ok(fullDisposed() > 0 && fogDisposed() > 0, 'stale builds are released');
    const latest = disposals();
    meshes.setMap(createFogView(world, layout, states).layout);
    assert.equal(latest(), 0);
    meshes.dispose();
    assert.ok(latest() > 0, 'dispose releases the current and retained builds');
    assert.equal(meshes.group.children.length, 0);
    assert.equal(meshes.cells.length, 0);
  } finally {
    meshes.dispose();
    registry.dispose();
  }
});

test('changing the art style releases retained fog builds before pixel materials are freed', () => {
  const world = generateWorld('7');
  const layout = prepareMap(world, generateDressing(world, 0)).slice(0, 6);
  const states = new Map(
    world.cells.map((cell) => [cell.key, cell.key === layout[0].key ? 'visited' : 'undiscovered']),
  );
  const registry = createMapMaterials();
  const meshes = createMapMeshes(registry);
  try {
    meshes.setMap(layout, { artStyle: 'pixelart' });
    let disposed = 0;
    meshes.group.traverse((object) =>
      object.geometry?.addEventListener('dispose', () => disposed++),
    );
    meshes.setMap(createFogView(world, layout, states).layout, { artStyle: 'pixelart' });
    assert.equal(disposed, 0);
    meshes.setMap(layout, { artStyle: 'low-poly' });
    assert.ok(disposed > 0, 'the pixelart build is not restored under a different style');
    assert.ok(meshes.group.children.length > 0);
  } finally {
    meshes.dispose();
    registry.dispose();
  }
});
