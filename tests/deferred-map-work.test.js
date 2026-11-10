// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredMapWork, observeDeferredMapWork } from '../src/ui/deferred-map-work.js';

function harness() {
  let ready = false;
  let serial = 0;
  let disconnected = false;
  let changed = () => {};
  /** @type {Map<number, () => void>} */
  const callbacks = new Map();
  const queue = createDeferredMapWork({
    ready: () => ready,
    observe(callback) {
      changed = callback;
      return () => {
        disconnected = true;
      };
    },
    schedule(callback) {
      callbacks.set(++serial, callback);
      return serial;
    },
    cancel(handle) {
      callbacks.delete(handle);
    },
  });
  return {
    queue,
    callbacks,
    disconnected: () => disconnected,
    gate(value = true) {
      ready = value;
      changed();
    },
    tick() {
      const entry = callbacks.entries().next().value;
      assert.ok(entry);
      callbacks.delete(entry[0]);
      entry[1]();
    },
  };
}

test('blocked work has no polling; ready runs one job per opportunity', async () => {
  const h = harness();
  /** @type {string[]} */
  const ran = [];
  const a = h.queue.enqueue('a', () => ran.push('a'));
  const b = h.queue.enqueue('b', () => ran.push('b'));
  assert.equal(h.callbacks.size, 0);
  h.gate();
  h.tick();
  assert.deepEqual(ran, ['a']);
  h.tick();
  await Promise.all([a, b]);
  assert.deepEqual(ran, ['a', 'b']);
  assert.equal(h.callbacks.size, 0);
});

test('replace, cancel, clear and dispose settle promises and invalidate stale callbacks', async () => {
  const h = harness();
  const old = h.queue.enqueue('same', () => 'old');
  const next = h.queue.enqueue('same', () => 'new');
  assert.equal(await old, undefined);
  h.gate();
  const stale = [...h.callbacks.values()][0];
  h.queue.cancel('same');
  assert.equal(await next, undefined);
  const clear = h.queue.enqueue('clear', () => 'clear');
  h.queue.clear();
  stale();
  assert.equal(await clear, undefined);
  const disposed = h.queue.enqueue('dispose', () => 'dispose');
  h.queue.dispose();
  assert.equal(await disposed, undefined);
  assert.equal(await h.queue.enqueue('late', () => 'late'), undefined);
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.disconnected(), true);
});

test('gate closing cancels the opportunity, preserves latest jobs, and reopens without polling', async () => {
  const h = harness();
  h.gate();
  let data = 'before';
  const result = h.queue.enqueue('latest', () => data);
  const stale = [...h.callbacks.values()][0];
  h.gate(false);
  data = 'after';
  stale();
  assert.equal(h.callbacks.size, 0);
  h.gate();
  h.tick();
  assert.equal(await result, 'after');
});

test('preview bridge renders only the latest data, refreshes once and consumes cached results', () => {
  const h = harness();
  /** @type {string[]} */
  const rendered = [];
  let refreshes = 0;
  const preview = (value = 'old') =>
    h.queue.preview(
      'inspector',
      [value],
      () => {
        rendered.push(value);
        return value;
      },
      () => {
        refreshes++;
      },
    );
  assert.equal(preview(), '');
  assert.equal(preview('new'), '');
  h.gate();
  h.tick();
  assert.deepEqual(rendered, ['new']);
  assert.equal(preview('new'), 'new');
  assert.equal(refreshes, 1);
  assert.equal(h.callbacks.size, 0);
});

test('a continuation can enqueue the next tile without a reentrant queue deadlock', async () => {
  const h = harness();
  h.gate();
  const gallery = (async () => {
    const first = await h.queue.enqueue('tile', () => 1);
    const second = await h.queue.enqueue('tile', () => 2);
    return [first, second];
  })();
  h.tick();
  await Promise.resolve();
  h.tick();
  assert.deepEqual(await gallery, [1, 2]);
});

test('DOM gate requires a ready canvas, visible workspace and no loading shell', () => {
  /** @type {MutationCallback | undefined} */
  let changed;
  const original = globalThis.MutationObserver;
  let connected = true;
  class Observer {
    /** @param {MutationCallback} callback */
    constructor(callback) {
      changed = callback;
    }
    observe() {}
    disconnect() {
      connected = false;
    }
    takeRecords() {
      return [];
    }
  }
  globalThis.MutationObserver = Observer;
  const workspace = { hidden: true, hasAttribute: () => loading };
  let loading = true;
  let state = 'building';
  const scene = { querySelector: () => ({ getAttribute: () => state }) };
  let opened = 0;
  try {
    const queue = observeDeferredMapWork(
      /** @type {HTMLElement} */ (/** @type {unknown} */ (workspace)),
      /** @type {HTMLElement} */ (/** @type {unknown} */ (scene)),
      () => {
        opened++;
      },
    );
    const notify = () => changed?.([], /** @type {MutationObserver} */ ({}));
    notify();
    workspace.hidden = false;
    notify();
    state = 'ready';
    notify();
    assert.equal(opened, 0);
    loading = false;
    notify();
    assert.equal(opened, 1);
    state = 'building';
    notify();
    state = 'ready';
    notify();
    assert.equal(opened, 2);
    queue.dispose();
    assert.equal(connected, false);
  } finally {
    globalThis.MutationObserver = original;
  }
});
