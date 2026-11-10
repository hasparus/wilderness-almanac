// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from 'three';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { riverLandValue } from '../src/generation/river-surfaces.js';
import { riverCliffNormals } from '../src/rendering/river-cliff-normals.js';
import { createTerrainBuilder } from '../src/rendering/terrain-meshes.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';

/** @param {number} [angle] */
function mouthCell(angle = 0) {
  return {
    wx: 0,
    wz: 0,
    river: {
      phase: 0,
      roughness: 0,
      channel: [],
      islands: [],
      landEdges: [],
      mouths: [{ x: 0, z: 0, nx: Math.cos(angle), nz: Math.sin(angle), width: 0.15 }],
    },
  };
}

/** @param {ReturnType<typeof mouthCell>} cell @param {number[]} point */
function originalNormal(cell, point) {
  const x = cell.wx + point[0],
    z = cell.wz + point[2],
    e = 0.002;
  const dx = riverLandValue(cell.river, x + e, z) - riverLandValue(cell.river, x - e, z);
  const dz = riverLandValue(cell.river, x, z + e) - riverLandValue(cell.river, x, z - e);
  const length = Math.hypot(dx, dz) || 1;
  return [-dx / length, 0, -dz / length];
}

test('finite shoreline normals retain their exact previous values', () => {
  const cell = mouthCell(),
    a = [0.1, 0.14, 0.25],
    b = [0.1, 0.14, 0.35];
  assert.deepEqual(riverCliffNormals(cell, a, b), [
    originalNormal(cell, a),
    originalNormal(cell, b),
  ]);
  const boundary = [0, 0.14, 0.25];
  assert.ok(originalNormal(cell, boundary).some(Number.isNaN));
  const [fallback, unchanged] = riverCliffNormals(cell, boundary, b);
  assert.ok(fallback.every(Number.isFinite));
  assert.deepEqual(unchanged, originalNormal(cell, b));
});

test('mouth support boundaries get unit normals facing water in either segment order', () => {
  for (let side = 0; side < 6; side++) {
    const cell = mouthCell((side * Math.PI) / 3),
      { nx, nz } = cell.river.mouths[0];
    const a = [-nz * 0.25, 0.14, nx * 0.25],
      b = [-nz * 0.4, 0.14, nx * 0.4];
    assert.ok(originalNormal(cell, a).some(Number.isNaN));
    for (const pair of [
      [a, b],
      [b, a],
    ])
      for (const normal of riverCliffNormals(cell, pair[0], pair[1])) {
        assert.ok(normal.every(Number.isFinite));
        assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-12);
        assert.ok(normal[0] * -nx + normal[2] * -nz > 1 - 1e-12);
      }
  }
});

test('undefined field differences and zero-length shore segments stay finite', () => {
  const cell = mouthCell(),
    a = [-0.2, 0.14, 0.25],
    b = [-0.2, 0.14, 0.4];
  for (const pair of [
    [a, b],
    [a, a],
  ]) {
    for (const normal of riverCliffNormals(cell, pair[0], pair[1])) {
      assert.ok(normal.every(Number.isFinite));
      assert.equal(Math.hypot(...normal), 1);
    }
  }
});

for (const seed of ['7', '77', '19']) {
  test(`seed ${seed}: river-mouth terrain contains only finite vertices and normals`, () => {
    const world = generateWorld(seed, { generatorVersion: 10 });
    /** @type {Array<import('../src/generation/river-surface-cache.js').RiverSurfaceInput & {key: string, mouthSurface?: boolean}>} */
    const layout = prepareMap(world, generateDressing(world, 0));
    const mouths = layout.filter((tile) => tile.mouthSurface);
    assert.ok(mouths.length > 0);
    const registry = createMapMaterials();
    const build = createTerrainBuilder({
      materials: registry.materials,
      makeCrossing: undefined,
      pixelModelMaterial: undefined,
      pixelTerrainMaterial: undefined,
    });
    try {
      for (const tile of mouths) {
        const { g: root } = build(tile);
        try {
          root.traverse((object) => {
            if (!(object instanceof Mesh)) return;
            for (const attribute of ['position', 'normal']) {
              const buffer = object.geometry.getAttribute(attribute);
              for (let i = 0; i < buffer.count; i++) {
                assert.ok(
                  [buffer.getX(i), buffer.getY(i), buffer.getZ(i)].every(Number.isFinite),
                  `${seed}/${tile.key}/${attribute}/${i}`,
                );
              }
            }
          });
        } finally {
          root.traverse((object) => {
            if (object instanceof Mesh) object.geometry.dispose();
          });
        }
      }
    } finally {
      registry.dispose();
    }
  });
}
