import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapBuilds } from '../src/rendering/map-builds.js';

// Records are plain tokens; the policy under test is which ones are kept.
function harness() {
  const log = [];
  let id = 0;
  const builds = createMapBuilds({
    build: (layout) => ({ id: ++id, layout }),
    show: (record) => log.push(record ? `show ${record.id}` : 'show none'),
    release: (record) => log.push(`release ${record.id}`),
  });
  return { builds, take: () => log.splice(0) };
}

test('toggling between a source layout and its projection shows retained builds', () => {
  const { builds, take } = harness();
  const source = [{ key: 'a' }],
    fog = [{ key: 'a', fogState: 'undiscovered' }];
  builds.show(source, source, 'low-poly');
  assert.deepEqual(take(), ['show 1']);
  builds.show(fog, source, 'low-poly');
  assert.deepEqual(take(), ['show 2'], 'the source build is kept');
  builds.show(source, source, 'low-poly');
  assert.deepEqual(take(), ['show 1'], 'fog off restores it without a build');
  builds.show(source, source, 'low-poly');
  assert.deepEqual(take(), []);
  builds.show(fog, source, 'low-poly');
  assert.deepEqual(take(), ['show 2'], 'the projection is kept as well');
  assert.equal(builds.active().id, 2);
});

test('a projection shown first keeps working when its source is built later', () => {
  const { builds, take } = harness();
  const source = [{ key: 'a' }],
    fog = [{ key: 'a', fogState: 'undiscovered' }];
  builds.show(fog, source, 'low-poly');
  builds.show(source, source, 'low-poly');
  assert.deepEqual(take(), ['show 1', 'show 2']);
  builds.show(fog, source, 'low-poly');
  assert.deepEqual(take(), ['show 1']);
});

test('a new projection of the same source releases only the previous projection', () => {
  const { builds, take } = harness();
  const source = [{ key: 'a' }];
  builds.show(source, source, 'low-poly');
  builds.show([{ key: 'a', fogState: 'unvisited' }], source, 'low-poly');
  take();
  builds.show([{ key: 'a', fogState: 'visited' }], source, 'low-poly');
  assert.deepEqual(take(), ['show 3', 'release 2'], 'the stale projection goes after the swap');
  builds.show(source, source, 'low-poly');
  assert.deepEqual(take(), ['show 1']);
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
  assert.deepEqual(take(), ['show none', 'release 1', 'release 2', 'show 3']);
  builds.show(edited, edited, 'pixelart');
  assert.deepEqual(take(), ['show none', 'release 3', 'show 4'], 'style keys builds too');
  builds.clear();
  assert.deepEqual(take(), ['show none', 'release 4']);
  assert.equal(builds.active(), null);
});
