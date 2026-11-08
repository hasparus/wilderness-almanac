// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { riverSurface } from '../src/generation/river-surfaces.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';
import { createFeatureLighting } from '../src/rendering/feature-lighting.js';
import { createWaterLanding } from '../src/rendering/lighthouse-beams.js';
import { createMapControls } from '../src/rendering/map-controls.js';
import { createPartyToken } from '../src/rendering/party-token.js';
import { createIncrementalBuilds } from '../src/rendering/incremental-builds.js';

/** @typedef {import('../src/generation/river-surface-cache.js').RiverSurfaceInput & {key: string, q: number, r: number, top: number, water?: string, mouthSurface?: boolean, riverSurface?: import('../src/generation/river-surface-cache.js').DeferredRiverSurface}} Tile */

/** @returns {Tile[]} */
function layout() {
  const world = generateWorld('7');
  return prepareMap(world, generateDressing(world, 0), { deferRiverSurfaces: true });
}

/** @param {Tile} tile */
function eager(tile) {
  return {
    ...tile,
    riverSurface: tile.riverSurface ? riverSurface(tile.riverSurface.input) : undefined,
  };
}

/** @param {THREE.Object3D} root */
function digest(root) {
  const hash = createHash('sha256');
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    hash.update(JSON.stringify([object.matrixWorld.elements, geometry.groups]));
    for (const [name, attribute] of Object.entries(geometry.attributes).sort()) {
      hash.update(JSON.stringify([name, attribute.itemSize, attribute.normalized]));
      hash.update(
        Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength),
      );
    }
    if (geometry.index) hash.update(Buffer.from(geometry.index.array.buffer));
  });
  return hash.digest('hex');
}

/** @param {import('node:test').TestContext} t @param {Record<string, unknown>} values */
function globals(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

for (const artStyle of ['low-poly', 'pixelart']) {
  test(`${artStyle}: synchronous mesh previews accept deferred rivers and mouths unchanged`, () => {
    const tiles = layout().filter((tile) => tile.riverSurface);
    const before = structuredClone(tiles);
    const registry = createMapMaterials();
    const meshes = createMapMeshes(registry, { artStyle });
    try {
      meshes.setMap(tiles.map(eager));
      const expected = digest(meshes.group);
      meshes.setMap(tiles);
      assert.equal(digest(meshes.group), expected);
      assert.deepEqual(tiles, before);
    } finally {
      meshes.dispose();
      registry.dispose();
    }
  });
}

test('lighting resolves river ground and nearby mouth water without requiring terrain meshes', () => {
  const tiles = layout();
  const tile = tiles.find((tile) => tile.water === 'river');
  const mouth = tiles.find((tile) => tile.mouthSurface);
  assert.ok(tile && mouth);
  const lighting = createFeatureLighting(new THREE.Scene());
  const source = {
    kind: 'warm',
    position: [0, 0.3, 0.05],
    size: [0.07, 0.09],
    matrix: new THREE.Matrix4().makeTranslation(tile.wx, tile.top, tile.wz),
  };
  const texture = new THREE.Texture();
  try {
    lighting.setSources([{ ...source, tile: eager(tile) }], tiles.map(eager));
    const expected = digest(lighting.group);
    lighting.setSources([{ ...source, tile }], tiles);
    assert.equal(digest(lighting.group), expected);
    assert.ok(lighting.group.children.length > 0);
    const position = new THREE.Vector3(mouth.wx, mouth.top, mouth.wz);
    const a = createWaterLanding(position, tiles.map(eager), texture, '#ffffff');
    const b = createWaterLanding(position, tiles, texture, '#ffffff');
    try {
      assert.equal(digest(b), digest(a));
      assert.ok(b.geometry.attributes.position.count > 0);
    } finally {
      for (const mesh of [a, b]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
  } finally {
    lighting.dispose();
    texture.dispose();
  }
});

test('selected river rings and party height resolve from metadata before chunk geometry exists', (t) => {
  globals(t, {
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    document: Object.assign(new EventTarget(), { hidden: false }),
    matchMedia: () => Object.assign(new EventTarget(), { matches: true }),
  });
  const tile = layout().find((tile) => tile.water === 'river');
  assert.ok(tile);
  const g = new THREE.Group();
  g.position.set(tile.wx, 0, tile.wz);
  const cells = [{ ...eager(tile), g }];
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const host = /** @type {HTMLElement} */ (
    /** @type {unknown} */ (
      Object.assign(new EventTarget(), {
        clientWidth: 400,
        clientHeight: 400,
        dataset: {},
        style: { removeProperty() {} },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
      })
    )
  );
  const controls = createMapControls({
    host,
    scene,
    map: new THREE.Group(),
    cells,
    renderer: /** @type {THREE.WebGLRenderer} */ (/** @type {unknown} */ ({ setSize() {} })),
    materials: { line: material, hover: material },
    draw() {},
    onSelect() {},
    onHover() {},
    party: null,
  });
  const party = createPartyToken({ host, draw() {}, onMove() {}, onSelect() {} });
  const state = { key: tile.key, style: 'warden', color: '#00ffff' };
  /** @type {number[] | undefined} */
  let partyPosition;
  const renderer = {
    clearDepth() {},
    /** @param {THREE.Scene} scene */
    render(scene) {
      partyPosition = scene.children[0].position.toArray();
    },
  };
  try {
    controls.select(tile.key, { notify: false });
    const selected = digest(scene);
    party.set(state, cells);
    party.render(renderer);
    const position = partyPosition;
    const deferredCells = [{ ...tile, g }];
    Object.assign(cells[0], deferredCells[0]);
    controls.select(tile.key, { notify: false });
    assert.equal(digest(scene), selected);
    party.set(state, deferredCells);
    party.render(renderer);
    assert.deepEqual(partyPosition, position);
    assert.ok(position && position[1] > tile.top);
  } finally {
    party.dispose();
    controls.dispose();
    material.dispose();
  }
});

test('snapshot flush builds all 40 chunks and realizes the exact eager terrain', () => {
  const tiles = layout();
  const registry = createMapMaterials();
  const meshes = createMapMeshes(registry);
  const expected = new Map(tiles.map((tile) => [tile.key, eager(tile).riverSurface]));
  let chunks = 0;
  const built = new Set();
  const controller = createIncrementalBuilds({
    /** @param {Tile[]} chunk */
    build(chunk) {
      chunks++;
      meshes.setMap(chunk);
      for (const tile of chunk) {
        built.add(tile.key);
        if (tile.riverSurface) {
          meshes.setMap([eager(tile)]);
          const reference = digest(meshes.group);
          meshes.setMap([tile]);
          assert.equal(digest(meshes.group), reference);
          assert.ok(expected.get(tile.key));
        }
      }
      return chunk;
    },
    show() {},
    release() {},
    schedule: () => 1,
    cancel() {},
  });
  try {
    controller.show(tiles, tiles, 'low-poly');
    assert.equal(chunks, 0, 'scheduling does not triangulate terrain');
    controller.flush();
    assert.equal(chunks, 40);
    assert.equal(built.size, tiles.length);
  } finally {
    controller.clear();
    meshes.dispose();
    registry.dispose();
  }
});
