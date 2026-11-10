// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OrthographicCamera, Vector3 } from 'three';
import {
  CAMPAIGN_HEXES_WIDE,
  MAP_CAMERA_POSITION,
  MAP_LOOK_AT_HEIGHT,
} from '../src/map-framing.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const skeleton = html.match(/<svg\s+class="hp-map-skeleton"[\s\S]*?<\/svg>/)?.[0];
assert.ok(skeleton);
const viewBox = skeleton
  .match(/viewBox="([^"]+)"/)?.[1]
  .split(/\s+/)
  .map(Number);
const matrix = skeleton
  .match(/patternTransform="matrix\(([^)]+)\)"/)?.[1]
  .split(/\s+/)
  .map(Number);
assert.ok(viewBox && matrix);

test('the static skeleton uses the campaign framing span and axial repeat distances', () => {
  assert.equal(viewBox[2], CAMPAIGN_HEXES_WIDE * 2);
  assert.equal(viewBox[0], -CAMPAIGN_HEXES_WIDE);
  assert.equal(viewBox[1], -viewBox[3] / 2);
  assert.match(skeleton, /preserveAspectRatio="xMidYMid meet"/);
  const repeat = skeleton.match(/id="loading-hexes"\s+width="([^"]+)"\s+height="([^"]+)"/);
  assert.ok(repeat);
  assert.ok(Math.abs(Number(repeat[1]) - Math.sqrt(3)) < 1e-9);
  assert.equal(Number(repeat[2]), 3);
});

for (const [width, height] of [
  [862, 868],
  [690, 770],
  [358, 650],
]) {
  test(`skeleton hex size and orientation match the initial camera at ${width}×${height}`, () => {
    const halfWidth = CAMPAIGN_HEXES_WIDE;
    const halfHeight = (halfWidth * height) / width;
    const camera = new OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 180);
    camera.position.set(...MAP_CAMERA_POSITION);
    camera.lookAt(0, MAP_LOOK_AT_HEIGHT, 0);
    camera.updateMatrixWorld();
    const scale = Math.min(width / viewBox[2], height / viewBox[3]);
    assert.equal(scale, width / (CAMPAIGN_HEXES_WIDE * 2));
    for (let q = -1; q <= 1; q++)
      for (let r = -1; r <= 1; r++) {
        for (let corner = 0; corner < 6; corner++) {
          const angle = (corner * Math.PI) / 3;
          const x = Math.sqrt(3) * (q + r / 2) + Math.sin(angle);
          const z = 1.5 * r + Math.cos(angle);
          const actual = new Vector3(x, MAP_LOOK_AT_HEIGHT, z).project(camera);
          const sx = (matrix[0] * x + matrix[2] * z + matrix[4]) * scale;
          const sy = (matrix[1] * x + matrix[3] * z + matrix[5]) * scale;
          assert.ok(Math.abs(sx - (actual.x * width) / 2) < 1e-6);
          assert.ok(Math.abs(sy + (actual.y * height) / 2) < 1e-6);
        }
      }
  });
}
