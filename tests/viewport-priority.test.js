// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera, Vector3 } from 'three';
import { chunkPriorityBounds, viewportPriority } from '../src/rendering/viewport-priority.js';

/** @param {number} x @param {number} y @param {number} z */
const project = (x, y, z) => ({ x, y, z });

test('a partial edge chunk intersects even when its center is outside the viewport', () => {
  const bounds = chunkPriorityBounds([{ wx: 2, wz: 0, top: 0.2 }]);
  assert.ok(bounds.center.x > 1);
  assert.ok(viewportPriority(bounds, project) < 1);
  const outside = chunkPriorityBounds([{ wx: 3, wz: 0, top: 0.2 }]);
  assert.ok(viewportPriority(outside, project) >= 1);
});

test('height envelope includes raised terrain/props above an offscreen surface center', () => {
  const bounds = chunkPriorityBounds([{ wx: 0, wz: -4, top: 1 }]);
  const sideView = (x = 0, y = 0, z = 0) => ({ x, y: y + z, z: 0 });
  assert.ok(sideView(bounds.center.x, bounds.center.y, bounds.center.z).y < -1);
  assert.ok(viewportPriority(bounds, sideView) < 1);
  assert.equal(bounds.min.y, -0.1);
  assert.equal(bounds.max.y, 4);
});

test('viewport intersection outranks even a nearer offscreen center; distance orders each tier', () => {
  const broad = chunkPriorityBounds([
    { wx: 0, wz: 0, top: 0 },
    { wx: 100, wz: 0, top: 0 },
  ]);
  const outside = chunkPriorityBounds([{ wx: 3, wz: 0, top: 0 }]);
  const farther = chunkPriorityBounds([{ wx: 4, wz: 0, top: 0 }]);
  assert.ok(viewportPriority(broad, project) < viewportPriority(outside, project));
  assert.ok(viewportPriority(outside, project) < viewportPriority(farther, project));
  const center = chunkPriorityBounds([{ wx: 0, wz: 0, top: 0 }]);
  assert.ok(viewportPriority(center, project) < viewportPriority(broad, project));
});

test('projection follows nonorigin focus, pan and zoom with refreshed camera matrices', () => {
  const camera = new OrthographicCamera(-3, 3, 3, -3, 0.1, 100);
  camera.position.set(0, 15, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const point = new Vector3();
  const origin = chunkPriorityBounds([{ wx: 0, wz: 0, top: 0.2 }]);
  const party = chunkPriorityBounds([{ wx: 20, wz: 0, top: 0.2 }]);
  /** @param {import('../src/rendering/viewport-priority.js').ChunkBounds} bounds */
  const score = (bounds) =>
    viewportPriority(bounds, (x, y, z) => point.set(x, y, z).project(camera));
  assert.ok(score(origin) < score(party));
  camera.position.x = 20;
  camera.lookAt(20, 0, 0);
  camera.zoom = 1.2;
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  assert.ok(score(party) < 1);
  assert.ok(score(origin) >= 1);
});
