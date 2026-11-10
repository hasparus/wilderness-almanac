// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import fixtures from './fixtures/river-surfaces-v10.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import { generateWorld } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { riverSurface } from '../src/generation/river-surfaces.js';
import { createCampaign, exportCampaign, importCampaign } from '../src/application/campaigns.js';
import {
  campaignWorld,
  campaignDressing,
  updateHex,
  lockHex,
} from '../src/generation/campaign-world.js';

/**
 * @typedef {import('../src/generation/river-surfaces.js').RiverCell & {
 *   key: string,
 *   mouthSurface?: boolean,
 *   riverSurface?: import('../src/generation/river-surfaces.js').RiverSurface,
 * }} PreparedCell
 */

/** @param {unknown} value */
function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(value, (_key, item) => (Object.is(item, -0) ? '-0' : item)))
    .digest('hex');
}

/** @param {PreparedCell[]} cells */
function snapshot(cells) {
  return cells
    .filter((cell) => cell.riverSurface)
    .map((cell) => {
      const surface = cell.riverSurface;
      assert.ok(surface?.water);
      return {
        key: cell.key,
        mouth: !!cell.mouthSurface,
        islands: cell.river.islands.length,
        vertices: surface.vertices.length,
        triangles: surface.triangles.length,
        shore: surface.shore.length,
        waterTriangles: surface.water.triangles.length,
        hash: digest(surface),
      };
    });
}

/** @param {string} seed */
function generatedSnapshot(seed) {
  const world = generateWorld(seed, { generatorVersion: 10 });
  return snapshot(prepareMap(world, { cells: [], mountains: [] }));
}

function editedLockedSnapshot() {
  const base = generateWorld('7', { generatorVersion: 10 });
  let campaign = createCampaign(base, ['#cdab8f', '#0b365e', '#11b329'], 'test');
  /** @type {{ key: string, water?: string | null, pointOfLight?: unknown }[]} */
  const cells = base.cells;
  const editedCell = cells.find((cell) => !cell.water && !cell.pointOfLight);
  assert.ok(editedCell);
  const key = editedCell.key;
  campaign = updateHex(campaign, key, { terrain: 'river', poi: null });
  const world = campaignWorld(campaign, base);
  const dressing = campaignDressing(campaign, world);
  campaign = lockHex(campaign, key, world, dressing);
  const imported = importCampaign(exportCampaign(campaign));
  assert.ok(imported.hexEdits);
  const edits = /** @type {Record<string, { lock?: unknown }>} */ (imported.hexEdits.cells);
  assert.ok(edits[key].lock);
  const replay = campaignWorld(imported, base);
  assert.deepEqual(replay, world);
  const replayDressing = campaignDressing(imported, replay);
  assert.deepEqual(replayDressing, campaignDressing(campaign, world));
  return { key, surfaces: snapshot(prepareMap(replay, replayDressing)) };
}

function unbeveledSnapshot() {
  const world = generateWorld('77', { generatorVersion: 10 });
  /** @type {PreparedCell[]} */
  const cells = prepareMap(world, { cells: [], mountains: [] });
  const cell = cells.find((cell) => cell.riverSurface && cell.river.islands.length);
  assert.ok(cell);
  /** @type {import('../src/generation/river-surfaces.js').RiverField} */
  const river = {
    ...cell.river,
    bankHeight: undefined,
    landEdges: [[[cell.wx - 1, cell.wz], [cell.wx + 1, cell.wz], 0.14, 0.36]],
  };
  const input = { ...cell, river, bankBevel: false, clipWater: false };
  const before = structuredClone(input);
  const surface = riverSurface(input);
  assert.deepEqual(input, before);
  assert.equal(surface.water, undefined);
  assert.equal(surface.materialIndices, undefined);
  return digest(surface);
}

for (const [seed, expected] of Object.entries(fixtures.generated)) {
  test(`all river and mouth surfaces for ${seed} match fc28a3b exactly`, () => {
    assert.deepEqual(generatedSnapshot(seed), expected);
  });
}

test('baseline covers empty/nonempty island fields and river mouths', () => {
  assert.equal(fixtures.baseline, 'fc28a3b0576a153c9e148a7cae8d0db1c1767e2a');
  const surfaces = Object.values(fixtures.generated).flat();
  assert.equal(surfaces.length, 65);
  assert.equal(surfaces.filter((surface) => surface.islands > 0).length, 11);
  assert.equal(surfaces.filter((surface) => surface.mouth).length, 6);
  assert.ok(surfaces.some((surface) => !surface.mouth && surface.islands === 0));
});

test('edited river and locked campaign replay match fc28a3b surfaces', () => {
  assert.deepEqual(editedLockedSnapshot(), fixtures.editedLocked);
});

test('unbeveled lattice and interpolated bank heights match fc28a3b without mutating input', () => {
  assert.equal(unbeveledSnapshot(), fixtures.unbeveled);
});
