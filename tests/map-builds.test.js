import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapBuilds } from '../src/rendering/map-builds.js';

// Records are plain tokens; the policy under test is which ones are kept.
function harness() {
  const log = [];
  let id = 0;
  const builds = createMapBuilds({
    build: (layout) => ({ id: ++id, layout }),
    attach: (record) => log.push(`attach ${record.id}`),
    detach: (record) => log.push(`detach ${record.id}`),
    release: (record) => log.push(`release ${record.id}`),
  });
  return { builds, log, take: () => log.splice(0) };
}

test('toggling between a source layout and its projection reattaches retained builds', () => {
  const { builds, take } = harness();
  const source = [{ key: 'a' }],
    fog = [{ key: 'a', fogState: 'undiscovered' }];
  assert.equal(builds.show(source, source, 'low-poly'), true);
  assert.deepEqual(take(), ['attach 1']);
  assert.equal(builds.show(fog, source, 'low-poly'), true);
  assert.deepEqual(take(), ['detach 1', 'attach 2'], 'the source build is kept');
  assert.equal(builds.show(source, source, 'low-poly'), true);
  assert.deepEqual(take(), ['detach 2', 'attach 1'], 'fog off restores it without a build');
  assert.equal(builds.show(source, source, 'low-poly'), false);
  assert.deepEqual(take(), []);
  assert.equal(builds.show(fog, source, 'low-poly'), true);
  assert.deepEqual(take(), ['detach 1', 'attach 2'], 'the projection is kept as well');
  assert.equal(builds.active().id, 2);
});

test('a projection shown first keeps working when its source is built later', () => {
  const { builds, take } = harness();
  const source = [{ key: 'a' }],
    fog = [{ key: 'a', fogState: 'undiscovered' }];
  builds.show(fog, source, 'low-poly');
  builds.show(source, source, 'low-poly');
  assert.deepEqual(take(), ['attach 1', 'detach 1', 'attach 2']);
  builds.show(fog, source, 'low-poly');
  assert.deepEqual(take(), ['detach 2', 'attach 1']);
});

test('a new projection of the same source releases only the previous projection', () => {
  const { builds, take } = harness();
  const source = [{ key: 'a' }];
  builds.show(source, source, 'low-poly');
  builds.show([{ key: 'a', fogState: 'unvisited' }], source, 'low-poly');
  take();
  builds.show([{ key: 'a', fogState: 'visited' }], source, 'low-poly');
  assert.deepEqual(take(), ['detach 2', 'release 2', 'attach 3']);
  builds.show(source, source, 'low-poly');
  assert.deepEqual(take(), ['detach 3', 'attach 1']);
});

test('a new source layout or style releases every build before building again', () => {
  const { builds, take } = harness();
  const source = [{ key: 'a' }],
    fog = [{ key: 'a', fogState: 'undiscovered' }];
  builds.show(source, source, 'low-poly');
  builds.show(fog, source, 'low-poly');
  take();
  const edited = [{ key: 'a' }];
  builds.show(edited, edited, 'low-poly');
  assert.deepEqual(take(), ['detach 2', 'release 1', 'release 2', 'attach 3']);
  builds.show(edited, edited, 'pixelart');
  assert.deepEqual(take(), ['detach 3', 'release 3', 'attach 4'], 'style keys builds too');
  builds.clear();
  assert.deepEqual(take(), ['detach 4', 'release 4']);
  assert.equal(builds.active(), null);
});
