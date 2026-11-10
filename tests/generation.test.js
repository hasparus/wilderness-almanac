import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fixtures from './fixtures/generation-v10.json' with { type: 'json' };
import { dressingFingerprint } from './dressing-fingerprint.js';
import { createTopology } from '../src/map-data.js';
import { generateWorld, generateDressing, GENERATOR_VERSION } from '../src/generation/world.js';
import { planSettlements, settlementSuitability } from '../src/generation/settlement-placement.js';
import { deepForestWeight, poiSuitability } from '../src/generation/points-of-interest.js';
import { distance } from '../src/generation/hex.js';
import { prepareMountainRanges } from '../src/generation/mountain-surfaces.js';
import { surfaceHeight } from '../src/generation/math.js';
import { createCampaign, exportCampaign, importCampaign } from '../src/application/campaigns.js';
import { campaignWorld, campaignDressing, lockHex } from '../src/generation/campaign-world.js';
import { mapLink, readMapLink } from '../src/ui/map-link.js';
import { terrainFootingGeometry } from '../src/rendering/geometry.js';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const colors = ['#cdab8f', '#0b365e', '#11b329'];

test('mountain villages and high/steep sites use one 0.3 suitability penalty', () => {
  const cell = { q: 0, r: 0, terrain: 'meadow', elevation: 1 };
  const byKey = new Map([['1,0', { q: 1, r: 0, elevation: 0 }]]);
  assert.equal(settlementSuitability(cell, byKey, 'village'), 1);
  assert.equal(settlementSuitability({ ...cell, elevation: 3 }, byKey, 'village'), 0.3);
  assert.equal(settlementSuitability({ ...cell, elevation: 3 }, byKey, 'town'), 0.3);
  const mountain = { ...cell, elevation: 4, terrain: 'mountains' };
  assert.equal(settlementSuitability(mountain, byKey, 'village'), 0.3);
  for (const type of ['town', 'city'])
    assert.equal(settlementSuitability(mountain, byKey, type), 0);
  assert.equal(settlementSuitability({ ...cell, water: 'river' }, byKey, 'village'), 0);
  assert.equal(settlementSuitability({ ...cell, terrain: 'dense forest' }, byKey, 'village'), 0);
});

test('regional plans choose towns without cities and scale after positive modifiers to zero', () => {
  const world = {
    ...createTopology(),
    preferences: { settlements: 2 },
    naming: { weights: { PL: 3.2, F: 1, M: 1, LW: 1, DW: 1, W: 1 } },
  };
  let townsOnly = false;
  for (let seed = 0; seed < 100; seed++) {
    world.seed = String(seed);
    for (const plan of planSettlements(world)) {
      assert.ok(plan.city + plan.town <= 2 && plan.village <= 4);
      townsOnly ||= plan.city === 0 && plan.town === 2;
    }
  }
  assert.ok(townsOnly);
  for (const region of world.regions) {
    const cells = world.cells.filter((cell) => cell.regionId === region.id);
    cells.forEach((cell, index) => {
      cell.water = index < 4 ? null : 'ocean';
    });
  }
  for (const plan of planSettlements(world)) {
    assert.equal(plan.density, 0);
    assert.equal(plan.city + plan.town + plan.village, 0);
  }
});

test('current worlds respect regional/footprint caps and spacing across slider combinations', () => {
  const settings = [
    {},
    { water: 2, settlements: 2 },
    { water: 1, settlements: 1 },
    { elevation: 2, settlements: 1 },
    { forests: 2, settlements: 2 },
    { settlements: -2 },
  ];
  let townsOnly = 0,
    mountainVillages = 0,
    emptyWetRegions = 0;
  for (const preferences of settings)
    for (let seed = 0; seed < 12; seed++) {
      const world = generateWorld(String(seed), { preferences, generatorVersion: 10 });
      const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
      for (const plan of world.settlementPlans) {
        const settlements = world.settlements.filter((s) => s.regionId === plan.regionId);
        assert.ok(settlements.filter((s) => s.type !== 'village').length <= 2);
        assert.ok(settlements.filter((s) => s.type === 'village').length <= 4);
        assert.ok(settlements.reduce((sum, s) => sum + s.hexKeys.length, 0) <= plan.hexBudget);
        townsOnly += Number(
          settlements.length > 0 &&
            settlements.every((s) => s.type !== 'city') &&
            settlements.some((s) => s.type === 'town'),
        );
        if (plan.landFraction <= 0.1) {
          assert.equal(settlements.length, 0);
          emptyWetRegions++;
        }
      }
      for (const settlement of world.settlements) {
        for (const key of settlement.hexKeys) {
          const cell = byKey.get(key);
          assert.ok(settlementSuitability(cell, byKey, settlement.type) > 0);
          mountainVillages += Number(cell.terrain === 'mountains');
          for (const other of world.settlements.filter((s) => s.id !== settlement.id))
            assert.ok(other.hexKeys.every((otherKey) => distance(cell, byKey.get(otherKey)) > 2));
        }
      }
      assert.deepEqual(world, generateWorld(String(seed), { preferences, generatorVersion: 10 }));
    }
  assert.ok(townsOnly > 0 && mountainVillages > 0 && emptyWetRegions > 0);
});

test('deep forest bonus is local, bounded at 2, and does not extend to forest-edge meadows', () => {
  const cells = createTopology().cells.filter((cell) => distance(cell) <= 2);
  const byKey = new Map(cells.map((cell) => [cell.key, cell]));
  const centre = byKey.get('0,0');
  for (const cell of cells) cell.terrain = 'dense forest';
  assert.equal(deepForestWeight(centre, byKey), 2);
  assert.equal(deepForestWeight({ ...centre, terrain: 'meadow' }, byKey), 1);
  for (const cell of cells.filter((cell) => distance(cell) === 2)) cell.terrain = 'meadow';
  assert.equal(deepForestWeight(centre, byKey), 1);
});

test('current POI preferences add fresh water, deep forest, small islands and shared mines only', () => {
  const cell = { key: '0,0', q: 0, r: 0, terrain: 'meadow', elevation: 2 };
  const context = {
    generatorVersion: 10,
    byKey: new Map(),
    pl: () => 99,
    smallPL: () => 99,
    mountain: () => 99,
    lake: () => 99,
    canyon: new Set(),
    deepForest: () => 1,
    freshwater: () => 99,
    islandSizes: new Map([['island', 2]]),
  };
  const score = (kind, value = cell, overrides = {}) =>
    poiSuitability(kind, value, { ...context, ...overrides });
  assert.equal(score('encampment', cell, { freshwater: () => 1 }), score('encampment') * 1.5);
  assert.equal(score('encampment', cell, { freshwater: () => 2 }), score('encampment') * 1.2);
  const forest = { ...cell, terrain: 'dense forest' };
  for (const kind of ['ruins', 'mystic'])
    assert.equal(score(kind, forest, { deepForest: () => 2 }), score(kind, forest) * 2);
  assert.equal(score('abbey', { ...cell, islandId: 'island' }), score('abbey') * 3);
  const settlement = { ...cell, pointOfLight: { type: 'village' } };
  assert.ok(score('dungeon', settlement) > 0);
  for (const kind of ['ruins', 'lair', 'stronghold', 'encampment', 'abbey', 'battlefield'])
    assert.equal(score(kind, settlement), 0);
});

test('mountain village footings fit their sampled slope and survive locking/export/import', () => {
  const world = generateWorld('1', { generatorVersion: 10 });
  const village = world.cells.find(
    (cell) => cell.elevation === 4 && cell.pointOfLight?.type === 'village',
  );
  assert.ok(village);
  const dressing = generateDressing(world, 0);
  const surface = prepareMountainRanges(world, dressing).get(village.key).surface;
  const props = dressing.cells.find((cell) => cell.key === village.key).props;
  const buildings = props.filter((prop) => ['house', 'tower'].includes(prop.kind));
  assert.ok(buildings.length >= 2);
  assert.ok(!props.some((prop) => prop.kind === 'fence'));
  for (const prop of buildings) {
    assert.equal(prop.foundationHeights.length, 12);
    for (let side = 0; side < 12; side++) {
      const ground = surfaceHeight(
        surface,
        prop.x + Math.cos((side * Math.PI) / 6) * prop.footprint,
        prop.z + Math.sin((side * Math.PI) / 6) * prop.footprint,
      );
      assert.ok(Math.abs(prop.y + prop.foundationHeights[side] + 0.015 - ground) < 1e-9);
    }
    const geometry = terrainFootingGeometry(prop.footprint, prop.foundationHeights);
    assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
    geometry.dispose();
  }
  const campaign = lockHex(createCampaign(world, colors, 'test'), village.key, world, dressing);
  const imported = importCampaign(exportCampaign(campaign));
  const replay = campaignWorld(imported);
  assert.deepEqual(replay, world);
  assert.deepEqual(campaignDressing(imported, replay), campaignDressing(campaign, world));
  const link = readMapLink(mapLink('https://example.com/', campaign));
  assert.equal(link.generatorVersion, 10);
  assert.deepEqual(generateWorld(link.seed, link), world);
});

test('version 10 preserves captured world and dressing output', () => {
  assert.equal(GENERATOR_VERSION, 10);
  for (const fixture of fixtures) {
    const world = generateWorld(fixture.seed, { preferences: fixture.preferences });
    assert.equal(digest(world), fixture.world);
    assert.equal(dressingFingerprint(generateDressing(world, 2)), fixture.dressing);
  }
  for (const generatorVersion of [6, 7, 8, 9, 11])
    assert.throws(() => generateWorld('7', { generatorVersion }), /unsupported/);
});
