import test from 'node:test';
import assert from 'node:assert/strict';
import { websitePathWorld } from '../src/generation/website-path-world.js';
import { DIRECTIONS, components, neighbours } from '../src/generation/hex.js';
import { footerScene } from '../tools/footer-scene.mjs';
import { heroScenePlugin } from '../tools/hero-scene-plugin.mjs';
import { palettes } from '../src/palette.js';

test('website trail stays compact, connected and rises from the coast into wilderness', () => {
  const world = websitePathWorld();
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  assert.equal(world.cells.length, 14);
  assert.equal(components(world.cells, byKey).length, 1);
  const columns = new Map();
  for (const cell of world.cells) {
    const column = columns.get(cell.q) ?? [];
    column.push(cell);
    columns.set(cell.q, column);
  }
  assert.ok([...columns.values()].some((cells) => cells.length >= 3));
  assert.ok(world.cells.filter((cell) => neighbours(cell, byKey).length >= 3).length >= 8);
  assert.ok(
    Math.max(...world.cells.map((cell) => cell.r)) -
      Math.min(...world.cells.map((cell) => cell.r)) <=
      4,
  );
  assert.ok(world.cells.filter((cell) => byKey.has(`${cell.q},${cell.r + 1}`)).length >= 6);
  const path = ['-3,2', '-2,2', '-2,1', '-1,1', '-1,0', '0,0', '1,0', '1,-1', '1,-2', '2,-2'].map(
    (key) => byKey.get(key),
  );
  assert.equal(path[0].water, 'ocean');
  assert.equal(path[1].pointOfLight.type, 'village');
  assert.ok(neighbours(path[1], byKey).includes(path[0]));
  for (let index = 1; index < path.length; index++)
    assert.ok(path[index].elevation >= path[index - 1].elevation);
  assert.equal(path.at(-1).terrain, 'mountains');
  assert.ok(world.cells.some((cell) => cell.terrain === 'light forest'));
  assert.ok(world.cells.some((cell) => cell.terrain === 'dense forest'));
  assert.deepEqual(world.pointsOfInterest.map((poi) => poi.kind).sort(), ['abbey', 'watchtower']);
});

test('website road connects the village, farmland, city and abbey without broken ports', () => {
  const world = websitePathWorld();
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  for (const cell of world.cells) {
    for (let side = 0; side < 6; side++) {
      if (!((cell.road?.exits ?? 0) & (1 << side))) continue;
      const [q, r] = DIRECTIONS[side];
      const next = byKey.get(`${cell.q + q},${cell.r + r}`);
      assert.ok(next);
      assert.ok(next.road.exits & (1 << ((side + 3) % 6)));
      assert.equal(Boolean(next.water), false);
      assert.ok(Math.abs(cell.elevation - next.elevation) <= 1);
    }
  }
  for (const key of ['-2,2', '-2,1', '-1,1', '-1,0', '0,0', '1,0'])
    assert.ok(byKey.get(key).road.exits);
  assert.equal(world.roads.edges.length, 5);
});

test('footer scene replays its dressing, walls, roads and mountains using the app palette', () => {
  const scene = footerScene();
  assert.deepEqual(scene, footerScene());
  assert.deepEqual(scene.palette, palettes.thronefall);
  assert.equal(scene.hexes.length, 14);
  const city = scene.layout.filter((cell) => cell.pointOfLight?.type === 'city');
  assert.equal(city.length, 2);
  assert.ok(city.flatMap((cell) => cell.props).some((prop) => prop.kind === 'city-wall'));
  assert.ok(scene.layout.filter((cell) => cell.road).every((cell) => cell.roads.length));
  const mountains = scene.layout.filter((cell) => cell.terrain === 'mountains');
  assert.equal(mountains.length, 3);
  assert.ok(mountains.every((cell) => cell.surface?.vertices.length));
});

test('scene plugin keeps the hero separate and leaves its seven-hex selection targets intact', () => {
  const plugin = heroScenePlugin();
  const hero = JSON.parse(plugin.load(plugin.resolveId('virtual:hero-scene')).slice(15, -1));
  const footer = JSON.parse(plugin.load(plugin.resolveId('virtual:footer-scene')).slice(15, -1));
  assert.equal(hero.hexes.length, 7);
  assert.equal(footer.hexes.length, 14);
  assert.ok(hero.hexes.some((hex) => hex.key === '1,0'));
  assert.equal(hero.hexes.find((hex) => hex.key === '0,0').label, 'Town of Far-Nahar');
  assert.equal(hero.layout.find((cell) => cell.key === '1,-1').forestType, 'spruce');
});
