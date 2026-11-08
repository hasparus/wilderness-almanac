import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapAction } from '../src/ui/map-action.js';

function fixture(t) {
  const frames = [];
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  t.after(() => {
    globalThis.requestAnimationFrame = original;
  });
  const attributes = new Map();
  const control = { disabled: true };
  const button = {
    disabled: false,
    childNodes: ['Apply changes'],
    textContent: 'Apply changes',
    classList: { add() {}, remove() {} },
    setAttribute: (key, value) => attributes.set(`button:${key}`, value),
    removeAttribute: (key) => attributes.delete(`button:${key}`),
  };
  const root = Object.assign(new EventTarget(), {
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
  });
  const announced = [];
  return {
    paint() {
      frames.shift()();
      frames.shift()();
    },
    attributes,
    control,
    button,
    root,
    announced,
    action: createMapAction(root, (text) => announced.push(text)),
  };
}

test('Apply paints local feedback without changing contents or disabled states', async (t) => {
  const { paint, attributes, control, button, announced, action } = fixture(t);
  const content = button.childNodes;
  let calls = 0;
  const pending = action.run(button, () => {
    calls++;
    assert.equal(action.isBusy(), true);
    assert.equal(attributes.get('aria-busy'), 'true');
    control.disabled = false;
    button.disabled = true;
    return true;
  });
  assert.equal(button.textContent, 'Apply changes');
  assert.equal(button.childNodes, content);
  assert.equal(button.disabled, false);
  assert.equal(control.disabled, true);
  assert.equal(attributes.get('button:aria-busy'), 'true');
  assert.equal(await action.run(button, () => calls++), false);
  assert.equal(calls, 0);
  paint();
  assert.equal(await pending, true);
  assert.equal(calls, 1);
  assert.equal(action.isBusy(), false);
  assert.equal(control.disabled, false);
  assert.equal(button.disabled, true);
  assert.equal(attributes.size, 0);
  assert.deepEqual(announced, ['Applying…']);
});

test('the paint yield blocks workspace input, then releases it', async (t) => {
  const { paint, root, button, action } = fixture(t);
  const pending = action.run(button, () => true);
  for (const type of ['pointerdown', 'click', 'keydown', 'beforeinput', 'submit']) {
    assert.equal(root.dispatchEvent(new Event(type, { cancelable: true })), false);
  }
  paint();
  await pending;
  assert.equal(root.dispatchEvent(new Event('click', { cancelable: true })), true);
});

test('disposing before the painted frame cancels work and releases input and feedback', async (t) => {
  const { paint, attributes, root, button, action } = fixture(t);
  let calls = 0;
  const pending = action.run(button, () => calls++);
  action.dispose();
  assert.equal(root.dispatchEvent(new Event('click', { cancelable: true })), true);
  assert.equal(attributes.size, 0);
  paint();
  assert.equal(await pending, false);
  assert.equal(calls, 0);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Apply changes');
  assert.equal(await action.run(button, () => calls++), false);
});

test('a failed action releases input and feedback without undoing control updates', async (t) => {
  const { paint, attributes, root, button, action } = fixture(t);
  const pending = action.run(button, () => {
    button.disabled = true;
    throw new Error('Action failed');
  });
  const rejected = assert.rejects(pending, /Action failed/);
  paint();
  await rejected;
  assert.equal(action.isBusy(), false);
  assert.equal(attributes.size, 0);
  assert.equal(button.disabled, true);
  assert.equal(root.dispatchEvent(new Event('click', { cancelable: true })), true);
});
