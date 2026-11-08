// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  Raycaster,
  Vector3,
} from 'three';
import {
  CHUNK_REVEAL_MS,
  chunkRevealProgress,
  createChunkTransitions,
} from '../src/rendering/chunk-transitions.js';
import { createMapPicker } from '../src/rendering/map-picking.js';

/** @param {MeshBasicMaterial} [material] */
function chunk(material = new MeshBasicMaterial()) {
  const root = new Group();
  const mesh = new Mesh(new BoxGeometry(), material);
  root.add(mesh);
  return { root, mesh, material };
}

test('120 ms drop is already visible, fast out, and restores exact shared resources', () => {
  const { root, mesh, material } = chunk();
  const second = new Mesh(mesh.geometry, material);
  root.add(second);
  root.position.y = 2;
  const depth = new MeshDepthMaterial();
  mesh.customDepthMaterial = depth;
  material.customProgramCacheKey = () => 'wind-and-wave';
  const transitions = createChunkTransitions({ enabled: () => true, distance: () => 0.15 });
  let baseDisposals = 0,
    geometryDisposals = 0,
    temporaryDisposals = 0;
  material.addEventListener('dispose', () => baseDisposals++);
  mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
  transitions.enter(root);
  const temporary = mesh.material;
  temporary.addEventListener('dispose', () => temporaryDisposals++);
  assert.notEqual(temporary, material);
  assert.equal(second.material, temporary, 'one wrapper per material per chunk');
  assert.equal(temporary.customProgramCacheKey(), 'wind-and-wave');
  assert.equal(mesh.customDepthMaterial, depth);
  assert.equal(material.transparent, false);
  assert.equal(material.opacity, 1);
  assert.equal(temporary.opacity, 0.18);
  assert.equal(root.position.y, 2.15);
  assert.equal(CHUNK_REVEAL_MS, 120);
  transitions.tick(1000);
  transitions.tick(1060);
  assert.equal(chunkRevealProgress(0.5), 0.9375);
  assert.equal(temporary.opacity, 0.18 + 0.82 * 0.9375);
  assert.ok(Math.abs(root.position.y - 2.009375) < 1e-10);
  assert.equal(transitions.tick(1120), true);
  assert.equal(root.position.y, 2);
  assert.equal(mesh.material, material);
  assert.equal(second.material, material);
  assert.equal(temporaryDisposals, 1);
  assert.equal(baseDisposals, 0);
  assert.equal(geometryDisposals, 0);
  assert.equal(transitions.active(), false);
  assert.equal(transitions.tick(1130), false);
  transitions.finishAll();
  assert.equal(temporaryDisposals, 1);
});

test('streamed chunks have independent clocks, without a delay or restarting siblings', () => {
  const a = chunk(),
    b = chunk(a.material);
  const transitions = createChunkTransitions({ enabled: () => true, distance: () => 1 });
  transitions.enter(a.root);
  transitions.tick(500);
  transitions.tick(560);
  transitions.enter(b.root);
  transitions.enter(a.root);
  transitions.tick(560);
  assert.equal(a.root.position.y, 0.0625);
  assert.equal(b.root.position.y, 1);
  assert.notEqual(a.mesh.material, b.mesh.material);
  transitions.tick(620);
  assert.equal(a.root.position.y, 0);
  assert.equal(b.root.position.y, 0.0625);
  transitions.tick(680);
  assert.equal(transitions.active(), false);
});

test('concealment cancels synchronously and never resurrects a detached chunk', () => {
  const a = chunk(),
    b = chunk();
  const transitions = createChunkTransitions({ enabled: () => true, distance: () => 1 });
  transitions.enter(a.root);
  transitions.enter(b.root);
  transitions.tick(0);
  transitions.retain(new Set([b.root]));
  assert.equal(a.root.position.y, 0);
  assert.equal(a.mesh.material, a.material);
  assert.equal(b.root.position.y, 1);
  transitions.tick(50);
  assert.equal(a.root.position.y, 0);
  transitions.retain(new Set());
  assert.equal(transitions.active(), false);
});

test('disabled/reduced motion skips arrival and finishes an in-flight reveal', () => {
  let enabled = false;
  const { root, mesh, material } = chunk();
  const transitions = createChunkTransitions({ enabled: () => enabled, distance: () => 1 });
  transitions.enter(root);
  assert.equal(transitions.active(), false);
  assert.equal(mesh.material, material);
  enabled = true;
  transitions.enter(root);
  transitions.tick(0);
  enabled = false;
  transitions.tick(1);
  assert.equal(root.position.y, 0);
  assert.equal(mesh.material, material);
  assert.equal(transitions.active(), false);
});

test('light meshes follow the chunk and cleanup restores material arrays and positions', () => {
  const { root } = chunk();
  const glow = new Mesh(new BoxGeometry(), [
    new MeshBasicMaterial({ opacity: 0.45 }),
    new MeshBasicMaterial(),
  ]);
  const originals = glow.material;
  glow.position.y = 3;
  const transitions = createChunkTransitions({ enabled: () => true, distance: () => 1 });
  transitions.enter(root, [glow]);
  assert.equal(glow.position.y, 4);
  assert.equal(glow.material[0].opacity, 0.45 * 0.18);
  transitions.finishAll();
  assert.equal(glow.position.y, 3);
  assert.equal(glow.material, originals);
});

test('range picking follows translated chunks and preserves geometry draw ranges', () => {
  const { root, mesh } = chunk();
  mesh.userData.faceRanges = [{ end: 12, key: '0,0' }];
  root.updateWorldMatrix(true, true);
  const pick = createMapPicker([root], { offset: root.position });
  root.position.y = 3;
  root.updateWorldMatrix(true, true);
  const ray = new Raycaster(new Vector3(0, 3, 5), new Vector3(0, 0, -1));
  assert.equal(pick(ray)?.object, mesh);
  assert.deepEqual(mesh.geometry.drawRange, { start: 0, count: Infinity });
  root.position.y = 0;
  root.updateWorldMatrix(true, true);
  assert.equal(pick(ray), null);
  ray.ray.origin.y = 0;
  assert.equal(pick(ray)?.object, mesh);
});
