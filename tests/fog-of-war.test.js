import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopology } from '../src/map-data.js';
import { distance } from '../src/generation/hex.js';
import {
  computeFogOfWar,
  sightRange,
  canSee,
  hexSightLine,
} from '../src/application/fog-of-war.js';
import { createFogView, createFogViewer } from '../src/application/fog-view.js';
import { describeHex } from '../src/ui/map-link.js';
import { inspectDistances } from '../src/generation/campaign-world.js';
import { partyMetadata } from '../src/application/party-token.js';
import { generateWorld } from '../src/generation/world.js';
import {
  createCampaign,
  exportCampaign,
  importCampaign,
  validateCampaign,
} from '../src/application/campaigns.js';
import { createCampaignSession } from '../src/application/campaign-session.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';

function fixture() {
  const world = { ...createTopology(), settlements: [], pointsOfInterest: [] };
  for (const cell of world.cells) Object.assign(cell, { terrain: 'meadow', elevation: 1 });
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  return { world, byKey, source: byKey.get('0,0') };
}
const visits = (...keys) => ({
  cells: Object.fromEntries(keys.map((key) => [key, { visited: true }])),
});

test('empty/all visited states, radius bonuses and reversible visibility', () => {
  const { world, source } = fixture();
  assert.ok([...computeFogOfWar(world).values()].every((value) => value === 'undiscovered'));
  for (const [elevation, poi, range] of [
    [1, null, 1],
    [3, null, 2],
    [4, null, 3],
    [2, 'stronghold', 2],
    [3, 'watchtower', 3],
  ]) {
    source.elevation = elevation;
    source.pointsOfInterest = poi ? [{ kind: poi, variant: 'lighthouse' }] : [];
    assert.equal(sightRange(source), range);
    const states = computeFogOfWar(world, visits(source.key));
    for (const cell of world.cells)
      assert.equal(
        states.get(cell.key),
        distance(source, cell) === 0
          ? 'visited'
          : distance(source, cell) <= range
            ? 'unvisited'
            : 'undiscovered',
      );
  }
  assert.ok(
    [...computeFogOfWar(world, visits(...world.cells.map((cell) => cell.key))).values()].every(
      (value) => value === 'visited',
    ),
  );
  assert.equal(computeFogOfWar(world, visits()).get('1,0'), 'undiscovered');
});

test('a +2 blocker is visible, hides farther hexes, and another visited source can reveal them', () => {
  const { world, byKey, source } = fixture();
  source.elevation = 2;
  source.pointsOfInterest = [{ kind: 'stronghold' }];
  byKey.get('1,0').elevation = 4;
  assert.equal(canSee(source, byKey.get('1,0'), byKey), true);
  assert.equal(canSee(source, byKey.get('2,0'), byKey), false);
  assert.equal(computeFogOfWar(world, visits('0,0', '3,0')).get('2,0'), 'unvisited');
  source.elevation = 3;
  assert.equal(canSee(source, byKey.get('2,0'), byKey), true);
});

test('water extends to the first shore without island hopping; rivers do not extend sight', () => {
  for (const water of ['ocean', 'lake']) {
    const { byKey, source } = fixture();
    for (let q = 1; q <= 7; q++)
      Object.assign(byKey.get(`${q},0`), { terrain: 'open water', water, elevation: 0 });
    assert.equal(canSee(source, byKey.get('7,0'), byKey), true);
    assert.equal(canSee(source, byKey.get('8,0'), byKey), true);
    assert.equal(canSee(source, byKey.get('9,0'), byKey), false);
    Object.assign(byKey.get('4,0'), { terrain: 'meadow', water: null });
    assert.equal(canSee(source, byKey.get('4,0'), byKey), true);
    assert.equal(canSee(source, byKey.get('5,0'), byKey), false);
  }
  const { byKey, source } = fixture();
  Object.assign(byKey.get('1,0'), { water: 'river', terrain: 'river', elevation: 0 });
  assert.equal(canSee(source, byKey.get('2,0'), byKey), false);
  Object.assign(byKey.get('2,0'), { water: 'ocean', terrain: 'open water', elevation: 0 });
  assert.equal(
    canSee(source, byKey.get('3,0'), byKey),
    false,
    'water beyond normal range cannot start an extension',
  );
});

test('supercover includes both sides of a seam and conservatively blocks all six rotations', () => {
  let source = { q: 0, r: 0, key: '0,0', elevation: 3, pointsOfInterest: [] };
  let target = { q: 1, r: 1 },
    blocker = { q: 1, r: 0 };
  const rotate = ({ q, r }) => ({ q: -r, r: q + r });
  for (let turn = 0; turn < 6; turn++) {
    const { byKey } = fixture();
    const end = byKey.get(`${target.q},${target.r}`);
    const obstacle = byKey.get(`${blocker.q},${blocker.r}`);
    obstacle.elevation = 5;
    assert.equal(canSee(source, end, byKey), false);
    assert.ok(hexSightLine(source, end, byKey).some(({ cell }) => cell.key === obstacle.key));
    obstacle.elevation = 1;
    assert.equal(canSee(source, end, byKey), true);
    target = rotate(target);
    blocker = rotate(blocker);
  }
});

test('inland elevation adds water reach without revealing the intervening land or a new far shore', () => {
  for (const water of ['ocean', 'lake'])
    for (const elevation of [1, 2, 3, 4]) {
      const { world, byKey, source } = fixture();
      source.elevation = elevation;
      const range = sightRange(source),
        reach = range + Math.max(0, elevation - 1);
      for (let q = reach; q <= reach + 2; q++)
        Object.assign(byKey.get(`${q},0`), { terrain: 'open water', water, elevation: 0 });
      const states = computeFogOfWar(world, visits(source.key));
      for (let q = reach; q <= reach + 2; q++)
        assert.equal(
          states.get(`${q},0`),
          'unvisited',
          `${water} seen from elevation ${elevation}`,
        );
      if (elevation > 1)
        for (const cell of world.cells)
          if (!cell.water && cell.key !== source.key)
            assert.equal(
              states.get(cell.key),
              distance(source, cell) <= range ? 'unvisited' : 'undiscovered',
              'Extra water sight does not reveal any additional land',
            );
      assert.equal(states.get(source.key), 'visited');
    }
});

test('water just beyond the inland allowance remains hidden and landmarks retain their normal bonuses', () => {
  for (const elevation of [1, 2, 3, 4]) {
    const { world, byKey, source } = fixture();
    source.elevation = elevation;
    const reach = sightRange(source) + Math.max(0, elevation - 1);
    Object.assign(byKey.get(`${reach + 1},0`), {
      terrain: 'open water',
      water: 'ocean',
      elevation: 0,
    });
    assert.equal(canSee(source, byKey.get(`${reach + 1},0`), byKey), false);
    assert.equal(computeFogOfWar(world, visits(source.key)).get(`${reach + 1},0`), 'undiscovered');
    source.pointsOfInterest = [{ kind: 'watchtower' }];
    source.pointOfLight = { type: 'town' };
    assert.equal(canSee(source, byKey.get(`${reach + 1},0`), byKey), true);
    assert.equal(computeFogOfWar(world, visits(source.key)).get(`${reach + 1},0`), 'unvisited');
  }
});

test('equal or higher terrain blocks the additional water sight while lower terrain does not', () => {
  const { world, byKey, source } = fixture();
  source.elevation = 3;
  for (let q = 4; q <= 7; q++)
    Object.assign(byKey.get(`${q},0`), { terrain: 'open water', water: 'ocean', elevation: 0 });
  for (const q of [1, 3])
    for (const elevation of [2, 3, 4]) {
      byKey.get(`${q},0`).elevation = elevation;
      assert.equal(canSee(source, byKey.get('7,0'), byKey), elevation < source.elevation);
      assert.equal(
        computeFogOfWar(world, visits('0,0')).get('7,0'),
        elevation < source.elevation ? 'unvisited' : 'undiscovered',
      );
      if (q === 1)
        assert.equal(
          canSee(source, byKey.get('2,0'), byKey),
          true,
          'Ordinary land sight is unchanged',
        );
      byKey.get(`${q},0`).elevation = 1;
    }
});

test('coastal sources keep existing sight and inland water sight never hops over islands', () => {
  const { byKey, source } = fixture();
  source.elevation = 3;
  for (let q = 4; q <= 7; q++)
    Object.assign(byKey.get(`${q},0`), { terrain: 'open water', water: 'lake', elevation: 0 });
  assert.equal(canSee(source, byKey.get('7,0'), byKey), true);
  Object.assign(byKey.get('-1,0'), { terrain: 'open water', water: 'ocean', elevation: 0 });
  assert.equal(
    canSee(source, byKey.get('7,0'), byKey),
    false,
    'A coastal source gets no inland allowance',
  );
  Object.assign(byKey.get('-1,0'), { terrain: 'meadow', water: null, elevation: 1 });
  Object.assign(byKey.get('5,0'), { terrain: 'meadow', water: null, elevation: 1 });
  assert.equal(canSee(source, byKey.get('4,0'), byKey), true);
  assert.equal(
    canSee(source, byKey.get('5,0'), byKey),
    false,
    'The extra water view does not reveal the island',
  );
  assert.equal(
    canSee(source, byKey.get('6,0'), byKey),
    false,
    'The island ends the water extension',
  );
});

test('extra inland water sight checks equal-height seam contacts in all six rotations', () => {
  let target = { q: 3, r: 3 },
    blocker = { q: 1, r: 0 };
  const rotate = ({ q, r }) => ({ q: -r, r: q + r });
  for (let turn = 0; turn < 6; turn++) {
    const { world, byKey, source } = fixture();
    source.elevation = 4;
    const end = byKey.get(`${target.q},${target.r}`);
    const obstacle = byKey.get(`${blocker.q},${blocker.r}`);
    // A wide water cap avoids introducing an island or coastline seam at entry.
    for (const cell of world.cells)
      if (distance(source, cell) >= 4)
        Object.assign(cell, { terrain: 'open water', water: 'ocean', elevation: 0 });
    assert.equal(canSee(source, end, byKey), true);
    obstacle.elevation = 4;
    assert.ok(hexSightLine(source, end, byKey).some(({ cell }) => cell.key === obstacle.key));
    assert.equal(canSee(source, end, byKey), false);
    target = rotate(target);
    blocker = rotate(blocker);
  }
});

test('projection masks unknown geometry and POIs consistently without changing campaign data', () => {
  const { world, byKey } = fixture();
  byKey.get('1,0').pointsOfInterest = [{ kind: 'dungeon', variant: 'mine' }];
  byKey.get('2,0').pointsOfInterest = [{ kind: 'stronghold', variant: 0 }];
  byKey.get('2,0').pointOfLight = { id: 'hidden-town', type: 'town' };
  byKey.get('2,0').elevation = 4;
  const layout = world.cells.map((cell) => ({
    ...cell,
    type: 'Land',
    top: 1.2,
    surface: { vertices: [] },
    shared: [true, true, true, true, true, true],
    props: cell.pointsOfInterest.map((poi) => ({ kind: 'poi', poiKind: poi.kind })),
  }));
  const before = structuredClone({ world, layout });
  const states = computeFogOfWar(world, visits('0,0'));
  const view = createFogView(world, layout, states);
  const known = view.world.cells.find((cell) => cell.key === '1,0');
  const unknown = view.layout.find((cell) => cell.key === '2,0');
  assert.equal(unknown.top, 0.56);
  assert.equal(unknown.elevation, 1);
  assert.equal(unknown.surface, null);
  assert.deepEqual(unknown.props, []);
  assert.deepEqual(known.pointsOfInterest, []);
  assert.deepEqual(view.layout.find((cell) => cell.key === '1,0').props, []);
  assert.match(describeHex(unknown), /Undiscovered hex$/);
  assert.doesNotMatch(describeHex(known), /mine|dungeon/);
  assert.equal(inspectDistances(view.world, known).settlement, null);
  const metadata = partyMetadata(
    world,
    { partyToken: { key: '0,0' }, hexEdits: visits('0,0'), fogOfWar: true },
    { visibleWorld: view.world },
  );
  assert.equal(metadata.visited, 1);
  assert.equal(metadata.land, 469);
  assert.equal(metadata.poi, null);
  const withoutFog = partyMetadata(
    world,
    { partyToken: { key: '0,0' }, hexEdits: visits('0,0'), fogOfWar: false },
    { visibleWorld: view.world },
  );
  assert.ok(withoutFog.poi, 'Fog off includes POIs hidden in the fog projection');
  assert.deepEqual(
    withoutFog,
    partyMetadata(world, { partyToken: { key: '0,0' }, hexEdits: visits('0,0') }),
  );
  assert.deepEqual({ world, layout }, before);
  assert.equal(createFogView(world, layout, null).layout, layout);
});

test('grayscale variants include tints and motion shaders, update with palettes, and dispose', () => {
  const registry = createMapMaterials();
  const roof = registry.propMaterial('roof', 1, 2);
  const gray = registry.fogMaterial(roof, 'unvisited');
  const tree = registry.fogMaterial(registry.materials.leaf, 'unvisited');
  const wave = registry.fogMaterial(registry.materials.wave, 'unvisited');
  assert.equal(gray.color.r, gray.color.g);
  assert.equal(gray.color.g, gray.color.b);
  assert.equal(tree.userData.treeSway, true);
  assert.equal(wave.customProgramCacheKey(), 'hex-wave-drift-v2');
  assert.equal(registry.fogMaterial(roof, 'visited'), roof);
  registry.setPalette(['#fdf3a1', '#1dc9f4', '#a134c1']);
  assert.equal(gray.color.r, gray.color.g);
  assert.equal(gray.color.g, gray.color.b);
  let disposed = 0;
  for (const material of [gray, tree, wave]) material.addEventListener('dispose', () => disposed++);
  const meshes = createMapMeshes(registry);
  meshes.setMap([
    { q: 0, r: 0, key: '0,0', type: 'Land', top: 0.56, props: [], fogState: 'undiscovered' },
    { q: 1, r: 0, key: '1,0', type: 'Land', top: 0.56, props: [], fogState: 'unvisited' },
  ]);
  assert.equal(meshes.cells.length, 2);
  meshes.group.traverse((mesh) => {
    if (mesh.isMesh) assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
  });
  meshes.dispose();
  registry.dispose();
  assert.equal(disposed, 3);
});

test('session fog mode persists independently of Undo and permits only tracking actions', () => {
  const campaign = createCampaign(
    generateWorld('fog-tests'),
    ['#cdab8f', '#0b365e', '#11b329'],
    'Forbidden Lands',
  );
  const session = createCampaignSession({
    persist: () => ({ campaignSaved: true, preferencesSaved: true }),
  });
  session.open(campaign);
  session.select('0,0');
  assert.equal(session.apply({ terrain: 'meadow' }).ok, true);
  const before = session.snapshot();
  session.fogOfWar(true);
  assert.equal(session.snapshot().canUndo, false);
  assert.equal(session.apply({ terrain: 'wetlands' }).ok, false);
  assert.equal(session.regenerate().ok, false);
  assert.equal(session.icon().ok, false);
  assert.equal(session.undo().ok, false);
  assert.equal(session.visit().ok, true);
  assert.equal(session.snapshot().canUndo, true);
  assert.equal(session.undo().ok, true);
  assert.equal(session.snapshot().campaign.fogOfWar, true);
  assert.deepEqual(session.snapshot().campaign.hexEdits, before.campaign.hexEdits);
  const cached = session.snapshot().visibility;
  session.palette(['#123456', '#123456', '#123456'], 'Custom');
  assert.equal(session.snapshot().visibility, cached);
  assert.equal(session.moveParty('2,0').ok, true);
  assert.equal(session.snapshot().visibility.get('2,0'), 'visited');
  session.setMultiEdit(true);
  assert.equal(session.applyBatch({ visited: true }).ok, true);
  assert.equal(session.applyBatch({ elevation: 2 }).ok, false);
  const imported = importCampaign(exportCampaign(session.snapshot().campaign));
  assert.equal(imported.fogOfWar, true);
  assert.throws(() => validateCampaign({ ...imported, fogOfWar: 'yes' }));
  session.fogOfWar(false);
  assert.equal(session.snapshot().visibility, null);
});

test('every permitted landmark is retained; other unvisited POIs stay hidden until visited', () => {
  const { world } = fixture();
  const kinds = [
    'watchtower',
    'abbey',
    'ruins',
    'stronghold',
    'encampment',
    'lair',
    'mystic',
    'battlefield',
    'dungeon',
  ];
  for (let i = 0; i < kinds.length; i++)
    world.cells[i].pointsOfInterest = [
      { kind: kinds[i], variant: kinds[i] === 'watchtower' ? 'lighthouse' : 0 },
    ];
  world.cells[0].crossing = { kind: 'bridge' };
  const layout = world.cells.map((cell) => ({
    ...cell,
    props: cell.pointsOfInterest.map((poi) => ({ kind: 'poi', poiKind: poi.kind })),
    top: 0.56,
    type: 'Land',
  }));
  const states = new Map(world.cells.map((cell) => [cell.key, 'unvisited']));
  const view = createFogView(world, layout, states);
  assert.equal(view.world.cells[0].crossing.kind, 'bridge');
  for (let i = 0; i < kinds.length; i++) {
    assert.equal(view.world.cells[i].pointsOfInterest.length, i < 4 ? 1 : 0);
    assert.equal(view.layout[i].props.length, i < 4 ? 1 : 0);
    states.set(world.cells[i].key, 'visited');
  }
  const visited = createFogView(world, layout, states);
  for (let i = 0; i < kinds.length; i++) assert.equal(visited.layout[i].props.length, 1);
});

test('proximity uses only discovered settlement footprints; coverage keeps the real land count', () => {
  const { world, byKey } = fixture();
  const first = { id: 'joined', type: 'town' },
    other = { id: 'other', type: 'village' };
  byKey.get('0,0').pointOfLight = first;
  byKey.get('1,0').pointOfLight = first;
  byKey.get('2,0').pointOfLight = other;
  byKey.get('-3,0').pointOfLight = other;
  Object.assign(byKey.get('6,0'), { water: 'lake', terrain: 'open water' });
  const layout = world.cells.map((cell) => ({ ...cell, props: [], top: 0.56, type: 'Land' }));
  const states = new Map(world.cells.map((cell) => [cell.key, 'undiscovered']));
  states.set('0,0', 'visited');
  states.set('1,0', 'unvisited');
  states.set('-3,0', 'unvisited');
  const view = createFogView(world, layout, states);
  assert.equal(
    inspectDistances(
      view.world,
      view.world.cells.find((cell) => cell.key === '0,0'),
    ).settlement,
    3,
  );
  const metadata = partyMetadata(
    world,
    { partyToken: { key: '0,0' }, hexEdits: visits('0,0', '6,0'), fogOfWar: true },
    { visibleWorld: view.world },
  );
  assert.equal(metadata.land, 468);
  assert.equal(metadata.visited, 1);
  assert.equal(metadata.settlement, 0);
});

test('the fog viewer hands back the same plain view and projection across toggles', () => {
  const { world } = fixture();
  const layout = world.cells.map((cell) => ({ ...cell, props: [] }));
  const viewer = createFogViewer();
  const plain = viewer(world, layout, null);
  assert.equal(plain.layout, layout);
  const states = computeFogOfWar(world, visits('0,0'));
  const fogged = viewer(world, layout, states);
  assert.notEqual(fogged.layout, layout);
  assert.equal(viewer(world, layout, null), plain, 'fog off returns the same plain view');
  assert.equal(viewer(world, layout, states), fogged, 'fog on returns the retained projection');
  assert.notEqual(viewer(world, layout, new Map(states)), fogged, 'new visibility projects again');
  assert.notEqual(viewer(world, [...layout], null), plain, 'a new layout is a new view');
});
