// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { createFogView } from '../src/application/fog-view.js';
import { riverSurface } from '../src/generation/river-surfaces.js';
import { deferRiverSurface, resolveRiverSurface } from '../src/generation/river-surface-cache.js';

/** @typedef {import('../src/generation/river-surface-cache.js').RiverSurfaceInput & {key: string, water?: string, hasIsland?: boolean, mouthSurface?: boolean, riverSurface?: import('../src/generation/river-surface-cache.js').RiverSurface | import('../src/generation/river-surface-cache.js').DeferredRiverSurface}} Tile */

for (const seed of ['7', '77']) {
  test(`seed ${seed}: deferred rivers, islands and mouths resolve to the exact eager layout`, () => {
    const world = generateWorld(seed);
    const dressing = generateDressing(world, 0);
    const eager = prepareMap(world, dressing);
    /** @type {Tile[]} */
    const deferred = prepareMap(world, dressing, { deferRiverSurfaces: true });
    assert.ok(deferred.some((tile) => tile.hasIsland));
    assert.ok(deferred.some((tile) => tile.mouthSurface));
    const before = structuredClone(deferred);
    const resolved = deferred.map((tile) => {
      if (!tile.riverSurface) return tile;
      assert.ok('kind' in tile.riverSurface);
      assert.equal(tile.riverSurface.kind, 'deferred-river-surface');
      assert.deepEqual(Object.keys(tile.riverSurface.input).sort(), [
        'bankBevel',
        'clipWater',
        'river',
        'riverCorners',
        'wx',
        'wz',
      ]);
      assert.equal(Object.hasOwn(tile.riverSurface, 'vertices'), false);
      assert.equal(Object.getOwnPropertyDescriptor(tile, 'riverSurface')?.get, undefined);
      return { ...tile, riverSurface: resolveRiverSurface(tile.riverSurface) };
    });
    assert.deepEqual(resolved, eager, 'including triangle/shore/water order and all metadata');
    assert.deepEqual(deferred, before, 'resolving does not replace descriptors or mutate inputs');

    const river = deferred.find((tile) => tile.water === 'river');
    assert.ok(river);
    const states = new Map(deferred.map((cell) => [cell.key, 'unvisited']));
    /** @type {Tile[]} */
    const fogged = createFogView(world, deferred, states).layout;
    const fog = fogged.find((tile) => tile.key === river.key);
    assert.ok(fog);
    assert.equal(fog.riverSurface, river.riverSurface);
    assert.equal(resolveRiverSurface(fog.riverSurface), resolveRiverSurface(river.riverSurface));
    states.set(river.key, 'undiscovered');
    /** @type {Tile[]} */
    const concealed = createFogView(world, deferred, states).layout;
    const hidden = concealed.find((tile) => tile.key === river.key);
    assert.ok(hidden);
    assert.equal(Object.hasOwn(hidden, 'riverSurface'), false);

    const cloned = structuredClone(deferred);
    const clonedRiver = cloned.find((tile) => tile.key === river.key);
    assert.ok(clonedRiver);
    assert.notEqual(clonedRiver.riverSurface, river.riverSurface);
    assert.deepEqual(
      resolveRiverSurface(clonedRiver.riverSurface),
      resolveRiverSurface(river.riverSurface),
    );
    assert.notEqual(
      resolveRiverSurface(clonedRiver.riverSurface),
      resolveRiverSurface(river.riverSurface),
    );
  });
}

test('resolver passes through absent and eager surfaces by identity', () => {
  assert.equal(resolveRiverSurface(undefined), undefined);
  assert.equal(resolveRiverSurface(null), null);
  /** @type {import('../src/generation/river-surface-cache.js').RiverSurface} */
  const surface = { vertices: [[0, 0, 0]], triangles: [], shore: [] };
  assert.equal(resolveRiverSurface(surface), surface);
});

test('descriptor owns only captured triangulation inputs, even before a recentered copy resolves', () => {
  const world = generateWorld('7');
  /** @type {Tile[]} */
  const layout = prepareMap(world, generateDressing(world, 0), { deferRiverSurfaces: true });
  const tile = layout.find((tile) => tile.water === 'river');
  assert.ok(tile);
  const originalInput = {
    wx: tile.wx,
    wz: tile.wz,
    river: tile.river,
    riverCorners: tile.riverCorners,
    bankBevel: tile.bankBevel,
    clipWater: tile.clipWater,
  };
  const expected = riverSurface(originalInput);
  const descriptor = deferRiverSurface(originalInput);
  assert.deepEqual(Object.keys(descriptor.input).sort(), Object.keys(originalInput).sort());
  assert.notEqual(descriptor.input.river, originalInput.river);
  assert.notEqual(descriptor.input.riverCorners, originalInput.riverCorners);
  const copy = { ...tile, wx: 0, wz: 0, riverSurface: descriptor };
  originalInput.wx += 100;
  originalInput.river.phase += 1;
  originalInput.riverCorners[0][0] += 0.1;
  assert.deepEqual(resolveRiverSurface(copy.riverSurface), expected);
  assert.equal(resolveRiverSurface(copy.riverSurface), resolveRiverSurface(descriptor));
  assert.deepEqual(resolveRiverSurface(structuredClone(descriptor)), expected);
});
