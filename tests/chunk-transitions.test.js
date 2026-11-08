// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BufferAttribute,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  PlaneGeometry,
  Raycaster,
  Vector3,
} from 'three';
import {
  HEX_REVEAL_MS,
  HEX_STAGGER_MS,
  hexRevealProgress,
  createChunkTransitions,
} from '../src/rendering/chunk-transitions.js';
import { lightRevealRanges, tagRevealGeometry } from '../src/rendering/hex-reveal-geometry.js';
import { createMapPicker } from '../src/rendering/map-picking.js';

/** @param {string} [key] */
function chunk(key = 'a') {
  const root = new Group(),
    material = new MeshBasicMaterial();
  const mesh = new Mesh(new BoxGeometry(), material);
  mesh.userData.key = key;
  mesh.castShadow = true;
  root.add(mesh);
  root.updateWorldMatrix(true, true);
  return { root, mesh, material };
}
/** @param {import('three').Material} material */
function compile(material) {
  const shader = /** @type {Parameters<import('three').Material['onBeforeCompile']>[0]} */ ({
    uniforms: /** @type {Record<string, import('three').IUniform>} */ ({}),
    vertexShader: '#include <begin_vertex>\n#include <project_vertex>\n#include <worldpos_vertex>',
    fragmentShader: '#include <alphatest_fragment>',
  });
  material.onBeforeCompile(shader, /** @type {import('three').WebGLRenderer} */ ({}));
  return shader;
}

test('hexes rise independently for 120ms, with a bounded eight-millisecond stagger', () => {
  const { root, mesh, material } = chunk();
  const depth = new MeshDepthMaterial();
  mesh.customDepthMaterial = depth;
  const transitions = createChunkTransitions({ enabled: () => true, distance: () => 0.15 });
  transitions.enter(root, ['b', 'a']);
  assert.equal(HEX_REVEAL_MS, 120);
  assert.equal(HEX_STAGGER_MS, 8);
  assert.equal(root.position.y, 0, 'chunk transform never moves as a block');
  assert.deepEqual(transitions.presentation(root, 'a'), {
    offset: -0.15,
    visible: false,
    opacity: 0,
  });
  assert.deepEqual(transitions.presentation(root, 'b'), {
    offset: -0.15,
    visible: true,
    opacity: 0.18,
  });
  assert.equal(material.transparent, false);
  assert.notEqual(mesh.material, material);
  const shader = compile(mesh.material);
  assert.deepEqual(Array.from(shader.uniforms.hexRevealDelays.value.slice(0, 2)), [8, 0]);
  assert.match(shader.vertexShader, /-hexRevealDistance/);
  transitions.tick(1000);
  transitions.tick(1060);
  assert.equal(hexRevealProgress(0.5), 0.9375);
  assert.equal(transitions.presentation(root, 'b')?.offset, -0.15 * 0.0625);
  assert.ok(
    (transitions.presentation(root, 'a')?.offset ?? 0) <
      (transitions.presentation(root, 'b')?.offset ?? 0),
  );
  transitions.tick(1120);
  assert.equal(transitions.active(), true, 'last hex finishes after the first');
  assert.equal(transitions.tick(1128), true);
  assert.equal(mesh.material, material);
  assert.equal(mesh.customDepthMaterial, depth);
  assert.equal(transitions.active(), false);
  assert.equal(transitions.tick(1130), false);
});

test('cached replay reuses one-byte batch attributes and does not split meshes or rescan bounds', () => {
  const { root, mesh, material } = chunk();
  mesh.userData.faceRanges = [
    { end: 6, key: 'a' },
    { end: 12, key: 'b' },
  ];
  mesh.geometry.computeBoundingSphere();
  const originalSphere = mesh.geometry.boundingSphere;
  mesh.geometry.computeBoundingSphere = () => {
    throw new Error('Existing bounds must not be rescanned');
  };
  const positions = mesh.geometry.getAttribute('position');
  const transitions = createChunkTransitions({ enabled: () => true, distance: () => 0.15 });
  transitions.enter(root, ['a', 'b']);
  const temporary = mesh.material;
  const attribute = mesh.geometry.getAttribute('hexRevealSlot');
  assert.ok(attribute instanceof BufferAttribute);
  assert.ok(attribute.array instanceof Uint8Array);
  assert.deepEqual(new Set(attribute.array), new Set([0, 1]));
  assert.equal(root.children.length, 1);
  assert.equal(mesh.geometry.getAttribute('position'), positions);
  assert.equal(mesh.geometry.boundingSphere, originalSphere);
  transitions.finishAll();
  transitions.enter(root, ['b', 'a']);
  assert.equal(mesh.material, temporary, 'cached replay keeps the compiled material wrapper');
  assert.equal(mesh.geometry.getAttribute('hexRevealSlot'), attribute);
  assert.equal(attribute.version, 0, 'cached replay uploads no replacement attribute');
  assert.deepEqual(
    Array.from(compile(mesh.material).uniforms.hexRevealDelays.value.slice(0, 2)),
    [8, 0],
  );
  transitions.finishAll();
  assert.equal(mesh.material, material);
});

test('streamed chunks have independent clocks without restarting existing arrivals', () => {
  const a = chunk(),
    b = chunk();
  const transitions = createChunkTransitions({ enabled: () => true, distance: () => 1 });
  transitions.enter(a.root, ['a']);
  transitions.tick(500);
  transitions.tick(560);
  transitions.enter(b.root, ['a']);
  transitions.enter(a.root, ['a']);
  transitions.tick(560);
  assert.equal(transitions.presentation(a.root, 'a')?.offset, -0.0625);
  assert.equal(transitions.presentation(b.root, 'a')?.offset, -1);
  transitions.tick(620);
  assert.equal(transitions.has(a.root), false);
  assert.equal(transitions.presentation(b.root, 'a')?.offset, -0.0625);
  transitions.tick(680);
  assert.equal(transitions.active(), false);
});

test('concealment restores incoming/underlay materials and disposes wrappers, not geometry', () => {
  const a = chunk(),
    before = chunk();
  const transitions = createChunkTransitions({ enabled: () => true, distance: () => 1 });
  let disposed = 0,
    geometryDisposed = 0;
  a.mesh.geometry.addEventListener('dispose', () => geometryDisposed++);
  transitions.enter(a.root, ['a'], [], before.root);
  a.mesh.material.addEventListener('dispose', () => disposed++);
  const underlayShader = compile(before.mesh.material);
  assert.match(underlayShader.vertexShader, /gl_Position.z \+=/);
  assert.match(underlayShader.fragmentShader, /hexRevealAlpha >= 1.0/);
  transitions.tick(0);
  transitions.retain(new Set());
  assert.equal(a.mesh.material, a.material);
  assert.equal(before.mesh.material, before.material);
  assert.equal(disposed, 0, 'wrappers retain compiled shaders for cached replay');
  transitions.release(a.root);
  assert.equal(disposed, 1);
  assert.equal(geometryDisposed, 0);
  assert.equal(transitions.tick(1000), false);
  assert.equal(a.mesh.customDepthMaterial, undefined);
});

test('disabled/reduced motion skips arrivals and settles active hexes', () => {
  let enabled = false;
  const { root, mesh, material } = chunk();
  const transitions = createChunkTransitions({ enabled: () => enabled, distance: () => 1 });
  transitions.enter(root, ['a']);
  assert.equal(transitions.active(), false);
  enabled = true;
  transitions.enter(root, ['a']);
  transitions.tick(0);
  enabled = false;
  transitions.tick(1);
  assert.equal(mesh.material, material);
  assert.equal(transitions.active(), false);
});

test('color and depth shader hooks retain wind while adding per-hex visibility', () => {
  const { root, mesh, material } = chunk();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = { value: 42 };
  };
  const depth = new MeshDepthMaterial();
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = { value: 42 };
  };
  mesh.customDepthMaterial = depth;
  const transitions = createChunkTransitions({ enabled: () => true, distance: () => 1 });
  transitions.enter(root, ['a']);
  const color = compile(mesh.material),
    shadow = compile(/** @type {import('three').Material} */ (mesh.customDepthMaterial));
  assert.equal(color.uniforms.windTime.value, 42);
  assert.equal(shadow.uniforms.windTime.value, 42);
  assert.match(shadow.fragmentShader, /discard/);
  assert.equal(color.uniforms.hexRevealTime, shadow.uniforms.hexRevealTime);
  transitions.finishAll();
});

test('light batches preserve source hex ownership across merging', () => {
  const a = new PlaneGeometry(),
    b = new BoxGeometry();
  tagRevealGeometry(a, 'a');
  tagRevealGeometry(b, 'b');
  assert.deepEqual(lightRevealRanges([a, b]), [
    { end: 2, key: 'a' },
    { end: 14, key: 'b' },
  ]);
});

test('picking follows each shader-offset hex, skips hidden hexes and restores the ray/range', () => {
  const { root, mesh } = chunk();
  mesh.userData.faceRanges = [{ end: 12, key: 'a' }];
  let visible = true;
  const pick = createMapPicker([root], { reveal: () => ({ offset: -3, visible }) });
  const ray = new Raycaster(new Vector3(0, -3, 5), new Vector3(0, 0, -1));
  const hit = pick(ray);
  assert.equal(hit?.object, mesh);
  assert.equal(hit?.point.y, -3);
  assert.equal(ray.ray.origin.y, -3);
  assert.deepEqual(mesh.geometry.drawRange, { start: 0, count: Infinity });
  visible = false;
  assert.equal(pick(ray), null);
});
