// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncrementalBuilds, partitionChunks } from '../src/rendering/incremental-builds.js';

/** @typedef {import('../src/rendering/incremental-builds.js').ChunkTile} Tile */
/** @typedef {{id: number, tiles: Tile[], style: string}} Record */

/** Deterministic scheduler; each build exhausts the budget. */
function harness() {
  let serial = 0,
    clock = 0,
    frame = 0;
  /** @type {Map<number, FrameRequestCallback>} */
  const frames = new Map();
  /** @type {Record[]} */
  const built = [];
  /** @type {Record[]} */
  const released = [];
  /** @type {import('../src/rendering/incremental-builds.js').ChunkEntry<Record>[]} */
  let displayed = [];
  /** @type {Tile[]} */
  let target = [];
  let pending = false;
  const controller = createIncrementalBuilds({
    /** @param {Tile[]} tiles @param {string} style */
    build(tiles, style) {
      const record = { id: ++serial, tiles, style };
      built.push(record);
      return record;
    },
    show(entries, layout, loading) {
      displayed = entries;
      target = layout;
      pending = loading;
    },
    release(record) {
      assert.ok(!released.includes(record), 'release records exactly once');
      assert.ok(!displayed.some((entry) => entry.record === record), 'detach before release');
      released.push(record);
    },
    schedule(callback) {
      frames.set(++frame, callback);
      return frame;
    },
    cancel: (handle) => {
      frames.delete(handle);
    },
    now: () => (clock += 10),
  });
  /** @returns {void} */
  function tick() {
    const next = frames.entries().next().value;
    assert.ok(next);
    const [handle, callback] = next;
    frames.delete(handle);
    callback(clock);
  }
  return {
    controller,
    frames,
    built,
    released,
    tick,
    view: () => ({ displayed, target, pending }),
  };
}

/** @param {number[]} coordinates @returns {Tile[]} */
const tiles = (coordinates) => coordinates.map((q) => ({ key: `${q},0`, q, r: 0 }));
/** @param {Tile[]} source @param {string} [state] @returns {Tile[]} */
const fog = (source, state = 'undiscovered') =>
  source.map((tile) => ({ ...tile, fogState: state }));

test('partition uses stable axial 4×4 ownership, including negative coordinates', () => {
  const source = tiles([-4, -1, 0, 3, 4]);
  assert.deepEqual(
    [...partitionChunks(source)].map(([id, cells]) => [id, cells.length]),
    [
      ['-1,0', 2],
      ['0,0', 2],
      ['1,0', 1],
    ],
  );
});

test('cold reveal yields between chunks and exposes complete projected metadata immediately', () => {
  const h = harness(),
    source = tiles([0, 4, 8]);
  h.controller.show(source, source, 'low-poly');
  assert.equal(h.built.length, 0);
  assert.equal(h.view().target, source);
  assert.equal(h.view().pending, true);
  h.tick();
  assert.equal(h.built.length, 1);
  assert.equal(h.view().displayed.length, 1);
  h.controller.flush();
  assert.equal(h.built.length, 3);
  assert.equal(h.view().pending, false);
  assert.equal(h.frames.size, 0);
});

test('fog conceals all stale objects synchronously, before any replacement build', () => {
  const h = harness(),
    source = tiles([0, 4, 8]);
  h.controller.show(source, source, 'pixelart');
  h.controller.flush();
  h.controller.show(fog(source), source, 'pixelart');
  assert.equal(h.view().displayed.length, 0);
  assert.equal(h.built.length, 3);
  h.tick();
  assert.equal(h.view().displayed.length, 1);
  assert.ok(
    h
      .view()
      .displayed.every(({ record }) =>
        record.tiles.every((tile) => tile.fogState === 'undiscovered'),
      ),
  );
});

test('warm toggles reuse both roles synchronously without new geometry or queued work', () => {
  const h = harness(),
    source = tiles([0, 4, 8]),
    projected = fog(source);
  h.controller.show(projected, source, 'low-poly');
  h.controller.flush();
  const projectedRecords = h.view().displayed.map((entry) => entry.record);
  h.controller.show(source, source, 'low-poly');
  h.controller.flush();
  const count = h.built.length;
  h.controller.show(projected, source, 'low-poly');
  assert.deepEqual(
    h.view().displayed.map((entry) => entry.record),
    projectedRecords,
  );
  h.controller.show(source, source, 'low-poly');
  assert.equal(h.built.length, count);
  assert.equal(h.released.length, 0);
  assert.equal(h.frames.size, 0);
});

test('neighbor visibility invalidates boundary geometry but retains unrelated chunks', () => {
  const h = harness(),
    source = tiles([-1, 0, 4, 8]),
    projected = fog(source);
  const original = structuredClone(source);
  h.controller.show(projected, source, 'low-poly');
  h.controller.flush();
  const changed = projected.map((tile) => (tile.q === 0 ? { ...tile, fogState: 'visited' } : tile));
  h.controller.show(changed, source, 'low-poly');
  assert.equal(h.view().displayed.length, 2);
  h.controller.flush();
  assert.equal(h.built.length, 6, 'only the changed hex and neighboring chunk rebuild');
  assert.equal(h.released.length, 2, 'keep only the latest projection per chunk');
  assert.deepEqual(source, original);
  h.controller.clear();
  assert.equal(h.released.length, h.built.length);
  h.controller.clear();
});

test('cancelled RAF callbacks cannot publish or release records from a newer request', () => {
  const h = harness(),
    source = tiles([0, 4, 8]);
  h.controller.show(source, source, 'low-poly');
  const stale = [...h.frames.values()][0];
  h.controller.show(fog(source), source, 'low-poly');
  stale(0);
  assert.equal(h.built.length, 0);
  h.controller.flush();
  assert.equal(h.built.length, 3);
  assert.ok(
    h.built.every((record) => record.tiles.every((tile) => tile.fogState === 'undiscovered')),
  );
});

test('source/style invalidation and clear detach, cancel and release every retained record', () => {
  const h = harness(),
    source = tiles([0, 4]);
  h.controller.show(source, source, 'low-poly');
  h.controller.flush();
  h.controller.show(fog(source), source, 'low-poly');
  h.controller.flush();
  h.controller.show(source, source, 'pixelart');
  assert.equal(h.released.length, 4);
  assert.equal(h.view().displayed.length, 0);
  h.tick();
  const stale = [...h.frames.values()][0];
  h.controller.show(tiles([0]), tiles([0]), 'pixelart');
  h.controller.clear();
  stale(0);
  assert.equal(h.frames.size, 0);
  assert.equal(h.view().displayed.length, 0);
  assert.equal(h.released.length, h.built.length);
});
