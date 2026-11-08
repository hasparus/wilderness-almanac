import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFeatureLighting, lighthouseTarget } from '../src/rendering/feature-lighting.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { createFogView } from '../src/application/fog-view.js';
import { worldPosition } from '../src/generation/hex.js';
import { glowPulse } from '../src/rendering/feature-glow.js';
import { surfaceHeight } from '../src/generation/math.js';

const land = { key: '0,0', q: 0, r: 0, top: 0.5, terrain: 'meadow' };
const sea = { key: '1,0', q: 1, r: 0, top: 0.2, terrain: 'open water', water: 'ocean' };
const source = (kind = 'warm', tile = land) => ({
  kind,
  tile,
  position: [0, 0.3, 0.05],
  size: [0.07, 0.09],
  matrix: new THREE.Matrix4().makeTranslation(0, 0.5, 0),
});
function camera() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(3, 5, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

// Sample the actual batched glow/UV/texture at a world-space ground position.
function glowAt(mesh, x, z, time = 0) {
  const { position, uv } = mesh.geometry.attributes;
  const indices = mesh.geometry.index?.array ?? Array.from({ length: position.count }, (_, i) => i);
  const sampled = new Set();
  let result = 0;
  const at = (i) => new THREE.Vector3(position.getX(i), 0, position.getZ(i));
  const sample = new THREE.Vector3(x, 0, z);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3);
    const weights = THREE.Triangle.getBarycoord(sample, at(a), at(b), at(c), new THREE.Vector3());
    if (Math.min(weights.x, weights.y, weights.z) < -1e-6) continue;
    const u = uv.getX(a) * weights.x + uv.getX(b) * weights.y + uv.getX(c) * weights.z;
    const v = uv.getY(a) * weights.x + uv.getY(b) * weights.y + uv.getY(c) * weights.z;
    const { data, width, height } = mesh.material.map.image;
    // Match the glow texture's linear filtering, including pixel centres.
    const tx = Math.max(0, Math.min(width - 1, u * width - 0.5));
    const ty = Math.max(0, Math.min(height - 1, v * height - 0.5));
    const x0 = Math.floor(tx),
      y0 = Math.floor(ty);
    const alpha = (x, y) => data[(y * width + x) * 4 + 3] / 255;
    const lerp = (a, b, t) => a + (b - a) * t;
    const opacity = lerp(
      lerp(alpha(x0, y0), alpha(Math.min(x0 + 1, width - 1), y0), tx - x0),
      lerp(
        alpha(x0, Math.min(y0 + 1, height - 1)),
        alpha(Math.min(x0 + 1, width - 1), Math.min(y0 + 1, height - 1)),
        tx - x0,
      ),
      ty - y0,
    );
    const phase = mesh.geometry.attributes.glowPhase?.getX(a);
    const rate = mesh.geometry.attributes.glowRate?.getX(a);
    const key = phase === undefined ? 'landing' : `${phase}:${rate}`;
    if (sampled.has(key)) continue;
    sampled.add(key);
    const pulse = phase === undefined ? 1 : glowPulse(time, { phase, rate });
    const strength = mesh.geometry.attributes.glowStrength?.getX(a) ?? 1;
    result += opacity * mesh.material.opacity * pulse * strength;
  }
  return result;
}

test('all night glows are batched, native light counts are bounded and modes reuse resources', () => {
  const scene = new THREE.Scene(),
    lighting = createFeatureLighting(scene),
    view = camera();
  const entries = Array.from({ length: 300 }, (_, i) =>
    source(['warm', 'mystic', 'dungeon'][i % 3]),
  );
  const before = structuredClone(entries.map(({ matrix, ...entry }) => entry));
  lighting.setSources(entries, [land, sea]);
  const geometry = lighting.group.children.map((mesh) => mesh.geometry);
  assert.equal(lighting.group.children.length, 6);
  assert.equal(lighting.points.length, 4);
  assert.equal(lighting.beams.length, 2);
  assert.ok([...lighting.points, ...lighting.beams].every((light) => !light.castShadow));
  lighting.update(0, view);
  assert.equal(lighting.group.visible, false);
  assert.ok(lighting.points.every((light) => light.intensity === 0));
  assert.ok([...lighting.points, ...lighting.beams].every((light) => !light.visible));
  lighting.setMode('night');
  lighting.update(0, view);
  assert.equal(lighting.group.visible, true);
  const initial = lighting.points[0].intensity;
  lighting.update(3, view);
  assert.notEqual(lighting.points[0].intensity, initial);
  lighting.setMode('day');
  lighting.update(3, view);
  assert.deepEqual(
    lighting.group.children.map((mesh) => mesh.geometry),
    geometry,
  );
  assert.deepEqual(
    entries.map(({ matrix, ...entry }) => entry),
    before,
  );
  let disposed = 0;
  geometry.forEach((item) => item.addEventListener('dispose', () => disposed++));
  lighting.setSources([], []);
  assert.equal(disposed, geometry.length);
  lighting.dispose();
  assert.equal(scene.children.length, 0);
});

test('every lighthouse has a broad sweeping shaft and a round water landing while native spots stay capped', () => {
  const lighting = createFeatureLighting(new THREE.Scene()),
    view = camera();
  const water = [];
  for (let q = -4; q <= 4; q++)
    for (let r = -4; r <= 4; r++) {
      const { wx } = worldPosition({ q, r });
      water.push({ ...(wx > 0.9 ? sea : land), key: `${q},${r}`, q, r });
    }
  lighting.setSources(
    Array.from({ length: 4 }, () => source('lighthouse')),
    water,
  );
  assert.equal(lighting.beamGroup.children.length, 4);
  lighting.setMode('night');
  const positions = [];
  for (let time = 0; time <= 40; time += 1) {
    lighting.update(time, view);
    positions.push(lighting.beams[0].target.position.clone());
    for (const node of lighting.beamGroup.children) {
      assert.ok(node.getObjectByName('lighthouse:shaft').material.opacity >= 0.16 * 0.4);
      assert.ok(node.getObjectByName('lighthouse:landing').material.opacity >= 0.7 * 0.4);
    }
  }
  assert.ok(
    Math.max(...positions.map((a) => Math.max(...positions.map((b) => a.distanceTo(b))))) >
      Math.sqrt(3),
    'the water landing sweeps across more than one hex',
  );
  const node = lighting.beamGroup.children[0],
    landing = node.getObjectByName('lighthouse:landing');
  const target = lighting.beams[0].target.position;
  assert.ok(glowAt(landing, target.x, target.z) > 0.2);
  assert.ok(
    Math.abs(
      glowAt(landing, target.x + 0.2, target.z) - glowAt(landing, target.x, target.z + 0.2),
    ) < 0.04,
    'the soft water footprint is circular',
  );
  assert.equal(glowAt(landing, target.x + 0.75, target.z), 0);
  assert.equal(glowAt(landing, 0, 0), 0, 'no landing geometry covers the lighthouse land hex');
  let disposed = 0;
  landing.geometry.addEventListener('dispose', () => disposed++);
  landing.material.addEventListener('dispose', () => disposed++);
  node.getObjectByName('lighthouse:shaft').material.addEventListener('dispose', () => disposed++);
  lighting.setMode('day');
  lighting.update(5, view);
  assert.equal(lighting.beamGroup.visible, false);
  assert.ok(lighting.beams.every((light) => light.intensity === 0));
  lighting.setSources([], []);
  assert.equal(disposed, 3);
  lighting.dispose();
});

test('lighthouse reach stops before a far bank, hidden water or the map boundary', () => {
  const origin = new THREE.Vector3(0, 0.8, 0);
  for (const obstruction of [
    null,
    { ...land, q: 2, key: '2,0' },
    { ...sea, q: 2, key: '2,0', fogState: 'undiscovered' },
  ]) {
    const target = lighthouseTarget(origin, [land, sea, ...(obstruction ? [obstruction] : [])]);
    assert.ok(target);
    assert.ok(target.x > 1.7 && target.x < 2.6);
    assert.equal(target.y, sea.top + 0.025);
  }
});

test('each building has its own stronger glow instead of one settlement-wide pool', () => {
  const lighting = createFeatureLighting(new THREE.Scene());
  const tile = { ...land, pointOfLight: { type: 'town' } };
  const entries = [-0.46, 0.46].map((x) => ({
    ...source('warm', tile),
    feature: 'town',
    position: [x, 0.3, 0.05],
  }));
  lighting.setSources(entries, [tile]);
  lighting.setMode('night');
  lighting.update(0, camera());
  const ground = lighting.group.getObjectByName('warm:ground');
  assert.equal(lighting.group.getObjectByName('warm:window').geometry.attributes.position.count, 8);
  assert.equal(new Set(ground.geometry.attributes.glowPhase.array).size, 2);
  assert.equal(glowAt(ground, 0, 0.05), 0, 'there is no blanket glow at the settlement centre');
  for (const x of [-0.46, 0.46]) assert.ok(glowAt(ground, x, 0.05) > 0.18);
  assert.ok(ground.material.opacity > 0.22 * 2, 'peak glow is over twice the original intensity');
  assert.equal(glowAt(ground, 0.9, 0.05), 0);
  assert.ok(lighting.points.every((light) => !light.visible));
  const spread = [];
  for (const type of ['village', 'town', 'city']) {
    lighting.setSources([{ ...source('warm', tile), feature: type }], [tile]);
    lighting.update(0, camera());
    spread.push(glowAt(lighting.group.getObjectByName('warm:ground'), 0.34, 0.05));
  }
  assert.ok(spread[0] < 0.002, 'village spill remains negligible at this distance');
  assert.ok(spread[1] > spread[0] && spread[2] > spread[1]);
  lighting.dispose();
});

test('corner landmarks spread light inward and use their own size even on a city tile', () => {
  const lighting = createFeatureLighting(new THREE.Scene());
  const tile = { ...land, pointOfLight: { type: 'city' } };
  lighting.setMode('night');
  const spread = [];
  for (const feature of ['watchtower', 'abbey', 'stronghold']) {
    lighting.setSources(
      [{ ...source('warm', tile), feature, position: [0.64, 0.3, 0.05] }],
      [tile],
    );
    lighting.update(0, camera());
    const ground = lighting.group.getObjectByName('warm:ground');
    spread.push(glowAt(ground, 0.34, 0.05));
    assert.equal(glowAt(ground, 0.86, 0.05), 0);
  }
  assert.ok(spread[0] > 0.01, 'a corner light is no longer reduced to its small edge clearance');
  assert.ok(spread[0] < spread[1] && spread[1] < spread[2]);
  lighting.dispose();
});

test('all settlement glows stay bright away from the camera centre through the entire pulse', () => {
  const lighting = createFeatureLighting(new THREE.Scene());
  const tiles = Array.from({ length: 9 }, (_, i) => ({
    ...land,
    key: `${i * 2},0`,
    q: i * 2,
    pointOfLight: { type: 'town' },
  }));
  lighting.setSources(
    tiles.flatMap((tile) => {
      const { wx, wz } = worldPosition(tile);
      return ['warm', 'mystic'].map((kind) => ({
        ...source(kind, tile),
        feature: kind === 'warm' ? 'town' : 'mystic',
        matrix: new THREE.Matrix4().makeTranslation(wx, 0.5, wz + (kind === 'mystic' ? 0.4 : 0)),
      }));
    }),
    tiles,
  );
  lighting.setMode('night');
  const view = camera();
  lighting.update(0, view);
  const ground = lighting.group.getObjectByName('warm:ground');
  const geometry = ground.geometry;
  const positions = lighting.points.map((light) => light.position.clone());
  const initial = tiles.map((tile) => glowAt(ground, worldPosition(tile).wx, 0.05));
  view.position.x += 25;
  view.lookAt(25, 0, 0);
  view.updateMatrixWorld();
  lighting.update(0, view);
  assert.notDeepEqual(
    lighting.points.map((light) => light.position),
    positions,
  );
  assert.ok(
    lighting.points.every((light) => light.position.z > 0.4),
    'only non-building sources use the camera-centred native pool',
  );
  assert.equal(ground.geometry, geometry);
  assert.deepEqual(
    tiles.map((tile) => glowAt(ground, worldPosition(tile).wx, 0.05)),
    initial,
    'every settlement keeps the same visible glow when native lights move elsewhere',
  );
  for (let time = 0; time < 15; time += 0.25) {
    lighting.update(time, view);
    for (const tile of tiles) assert.ok(glowAt(ground, worldPosition(tile).wx, 0.05, time) > 0.18);
  }
  lighting.dispose();
});

test('ground glows follow exact relief and road tops, and do not bridge river water', () => {
  const lighting = createFeatureLighting(new THREE.Scene());
  const surface = {
    vertices: [
      [0, 0.1, 0],
      [0.7, 0.25, 0],
      [0, 0.3, 0.7],
    ],
    triangles: [[0, 1, 2]],
  };
  for (const field of ['surface', 'riverSurface', 'roadSurface']) {
    const tile = { ...land, [field]: { ...surface, materialIndices: [2] } };
    lighting.setSources([source('warm', tile)], [tile]);
    lighting.update(0, camera());
    const ground = lighting.group.getObjectByName('warm:ground');
    const positions = ground.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const expected =
        surfaceHeight(surface, positions.getX(i), positions.getZ(i)) +
        (field === 'roadSurface' ? 0 : land.top) +
        0.012;
      assert.ok(Math.abs(positions.getY(i) - expected) < 1e-6);
    }
    assert.equal(glowAt(ground, -0.1, -0.1), 0, 'no light plane spans a missing bank triangle');
  }
  lighting.dispose();
});

test('unseen coastline and fogged sources emit no light', () => {
  const origin = new THREE.Vector3(0, 0.8, 0);
  assert.equal(lighthouseTarget(origin, [land]), null);
  assert.equal(lighthouseTarget(origin, [land, { ...sea, fogState: 'undiscovered' }]), null);
  assert.ok(lighthouseTarget(origin, [land, sea]));
  assert.equal(
    lighthouseTarget(origin, [
      land,
      { ...sea, fogState: 'undiscovered' },
      { ...sea, q: 2, key: '2,0' },
    ]),
    null,
    'beams cannot cross a hidden hex to reach visible water',
  );
  const scene = new THREE.Scene(),
    lighting = createFeatureLighting(scene);
  lighting.setSources(
    [
      source('mystic', { ...land, fogState: 'undiscovered' }),
      source('lighthouse', { ...land, fogState: 'unvisited' }),
    ],
    [land, sea],
  );
  lighting.setMode('night');
  lighting.update(0, camera());
  assert.equal(lighting.group.children.length, 0);
  assert.equal(lighting.beamGroup.children.length, 0);
  assert.ok(lighting.points.every((light) => light.intensity === 0));
  lighting.dispose();
});

test('source positions follow actual model transforms and the fog projection without changing dressing', () => {
  const world = generateWorld('7'),
    dressing = generateDressing(world, 0);
  const layout = prepareMap(world, dressing),
    saved = JSON.stringify(layout);
  const registry = createMapMaterials(),
    meshes = createMapMeshes(registry);
  meshes.setMap(layout);
  assert.deepEqual(
    new Set(meshes.lightSources.map((light) => light.kind)),
    new Set(['warm', 'lighthouse', 'mystic', 'dungeon']),
  );
  for (const light of meshes.lightSources) {
    const position = new THREE.Vector3().fromArray(light.position).applyMatrix4(light.matrix);
    assert.ok(position.toArray().every(Number.isFinite));
    assert.ok(position.y > light.tile.top);
    assert.ok(
      [
        'village',
        'town',
        'city',
        'watchtower',
        'abbey',
        'stronghold',
        'mystic',
        'dungeon',
      ].includes(light.feature),
      'source metadata distinguishes settlement population from co-located landmarks',
    );
  }
  const key = meshes.lightSources[0].tile.key;
  const states = new Map(
    world.cells.map((cell) => [cell.key, cell.key === key ? 'visited' : 'undiscovered']),
  );
  meshes.setMap(createFogView(world, layout, states).layout);
  assert.ok(meshes.lightSources.length > 0);
  assert.ok(meshes.lightSources.every((light) => light.tile.key === key));
  assert.equal(JSON.stringify(layout), saved);
  meshes.dispose();
  registry.dispose();
});

test('city pools stay soft while POIs retain enhanced per-source glows', () => {
  const lighting = createFeatureLighting(new THREE.Scene());
  lighting.setMode('night');
  const view = camera(),
    windows = [],
    strength = [],
    groundStrength = [];
  try {
    for (const feature of ['village', 'town', 'city', 'abbey', 'mystic', 'dungeon']) {
      const kind = ['mystic', 'dungeon'].includes(feature) ? feature : 'warm';
      lighting.setSources([{ ...source(kind), feature }], [land], { artStyle: 'pixelart' });
      lighting.update(0, view);
      const window = lighting.group.getObjectByName(`${kind}:window`);
      window.geometry.computeBoundingBox();
      windows.push(window.geometry.boundingBox.getSize(new THREE.Vector3()).x);
      strength.push(window.geometry.attributes.glowStrength.getX(0));
      groundStrength.push(
        lighting.group.getObjectByName(`${kind}:ground`).geometry.attributes.glowStrength.getX(0),
      );
      assert.equal(lighting.group.children.length, 2);
      if (kind !== 'warm') {
        const point = lighting.points.find((light) => light.visible);
        assert.ok(Math.abs(point.distance - 2.4) < 1e-10);
      }
    }
    assert.ok(Math.abs(windows[0] - windows[1]) < 1e-6);
    assert.ok(windows.slice(2).every((width) => Math.abs(width / windows[1] - 1.5) < 1e-6));
    assert.deepEqual(strength.slice(0, 2), [1, 1]);
    assert.ok(Math.abs(strength[2] - 0.7) < 1e-6);
    assert.ok(Math.abs(groundStrength[2] - 0.35) < 1e-6);
    assert.ok(strength.slice(3).every((value) => Math.abs(value - 1.3) < 1e-6));
    assert.equal(lighting.points.length, 4);
    assert.equal(lighting.beams.length, 2);
  } finally {
    lighting.dispose();
  }
});

test('city light crosses shared bevels onto dry neighbours, stopping at water, fog and cliffs', () => {
  const lighting = createFeatureLighting(new THREE.Scene());
  const city = { ...land, pointOfLight: { type: 'city' } };
  const neighbour = { ...land, key: '1,0', q: 1 };
  const emitter = { ...source('warm', city), feature: 'city', position: [0.72, 0.3, 0] };
  lighting.setMode('night');
  try {
    lighting.setSources([emitter], [city, neighbour], { artStyle: 'pixelart' });
    lighting.update(0, camera());
    const mesh = lighting.group.getObjectByName('warm:ground');
    assert.ok(glowAt(mesh, 0.85, 0) > 0.001, 'city bevel receives light');
    assert.ok(glowAt(mesh, 0.89, 0) > 0.001, 'neighbour bevel receives the same pool');
    assert.ok(glowAt(mesh, 1.02, 0) > 0.001, 'light continues onto the neighbouring top');
    assert.equal(lighting.group.children.length, 2, 'spill shares the existing glow batches');
    for (const blocked of [
      { ...neighbour, water: 'ocean', terrain: 'open water' },
      { ...neighbour, fogState: 'undiscovered' },
      { ...neighbour, fogState: 'unvisited' },
      { ...neighbour, top: neighbour.top + 0.22 },
    ]) {
      lighting.setSources([emitter], [city, blocked], { artStyle: 'pixelart' });
      lighting.update(0, camera());
      assert.equal(glowAt(lighting.group.getObjectByName('warm:ground'), 1.02, 0), 0);
    }
  } finally {
    lighting.dispose();
  }
});

test('a fog projection keeps the full layout lighting resident until the layout changes', () => {
  const world = generateWorld('7');
  const layout = prepareMap(world, generateDressing(world, 0));
  const registry = createMapMaterials(),
    meshes = createMapMeshes(registry),
    lighting = createFeatureLighting(new THREE.Scene());
  try {
    meshes.setMap(layout);
    lighting.setSources(meshes.lightSources, layout);
    const glow = [...lighting.group.children],
      beams = [...lighting.beamGroup.children];
    let disposed = 0;
    for (const mesh of glow) mesh.geometry.addEventListener('dispose', () => disposed++);
    const key = meshes.lightSources[0].tile.key;
    const states = new Map(
      world.cells.map((cell) => [cell.key, cell.key === key ? 'visited' : 'undiscovered']),
    );
    const fogged = createFogView(world, layout, states).layout;
    meshes.setMap(fogged);
    assert.equal(lighting.setSources(meshes.lightSources, fogged), true);
    assert.notDeepEqual(lighting.group.children, glow);
    assert.equal(disposed, 0, 'the full lighting survives while fog is on');
    meshes.setMap(layout);
    assert.equal(lighting.setSources(meshes.lightSources, layout), true);
    assert.deepEqual(lighting.group.children, glow, 'fog off restores the retained glow batches');
    assert.deepEqual(lighting.beamGroup.children, beams);
    assert.equal(lighting.setSources(meshes.lightSources, layout), false);
    meshes.setMap([...layout]);
    lighting.setSources(meshes.lightSources, [...layout]);
    assert.equal(disposed, glow.length, 'a new layout releases the retained lighting');
  } finally {
    lighting.dispose();
    meshes.dispose();
    registry.dispose();
  }
});
