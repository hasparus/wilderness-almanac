// @ts-check
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateWorld, generateDressing } from '../../../src/generation.js';
import { prepareMap } from '../../../src/generation/presentation.js';
import { createFogView } from '../../../src/application/fog-view.js';
import { computeFogOfWar } from '../../../src/application/fog-of-war.js';
import { partition, fogSignature } from '../src/chunks.js';

const root = new URL('../', import.meta.url);
for (const name of [
  'src/main.js',
  'src/fiber.js',
  'src/chunks.js',
  'src/types.js',
  'scripts/check.mjs',
  'scripts/compare.mjs',
  'vite.config.mjs',
])
  execFileSync(process.execPath, ['--check', new URL(name, root).pathname]);
const world = generateWorld('heliotest', { generatorVersion: 10 });
/** @type {import('../src/types.js').Tile[]} */
const layout = prepareMap(world, generateDressing(world, 0));
const before = structuredClone(layout);
/** @type {import('../src/types.js').FogStates} */
const states = computeFogOfWar(world, { cells: { '0,0': { visited: true } } });
for (const size of [1, 4, 8, 0]) {
  const chunks = partition(layout, size);
  assert.equal([...chunks.values()].flat().length, layout.length);
  assert.equal(new Set([...chunks.values()].flat()).size, layout.length);
  const a = createFogView(world, layout, states).layout;
  const b = createFogView(world, layout, states).layout;
  assert.notEqual(a, b);
  for (const tiles of chunks.values())
    assert.equal(fogSignature(tiles, states), fogSignature(tiles, new Map(states)));
}
const tile = /** @type {import('../src/types.js').Tile} */ (layout.find((t) => t.key === '0,0'));
/** @type {import('../src/types.js').FogStates} */
const visible = new Map(layout.map((t) => [t.key, 'visited']));
const hiddenNeighbour = new Map(visible);
hiddenNeighbour.set('0,-1', 'undiscovered');
assert.notEqual(fogSignature([tile], visible), fogSignature([tile], hiddenNeighbour));
const grayscale = new Map(visible);
grayscale.set(tile.key, 'unvisited');
assert.notEqual(fogSignature([tile], visible), fogSignature([tile], grayscale));
assert.equal(fogSignature([tile], null), 'source');
assert.deepEqual(layout, before);
console.log(
  'Syntax, partition, fog signatures and source immutability passed. Browser verification is separate.',
);
