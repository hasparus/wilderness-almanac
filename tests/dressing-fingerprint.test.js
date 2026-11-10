// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { dressingFingerprint } from './dressing-fingerprint.js';

test('dressing fingerprints ignore last-bit math differences without mutating data', () => {
  const arm = { props: [{ x: -0.2881325206914405, kind: 'tree', locked: true }] };
  const x64 = { props: [{ x: -0.2881325206914406, kind: 'tree', locked: true }] };
  const original = structuredClone(arm);
  assert.equal(dressingFingerprint(arm), dressingFingerprint(x64));
  assert.deepEqual(arm, original);
  for (const changed of [
    { props: [{ x: arm.props[0].x + 1e-9, kind: 'tree', locked: true }] },
    { props: [{ x: arm.props[0].x, kind: 'rock', locked: true }] },
    { props: [{ x: arm.props[0].x, kind: 'tree', locked: false }] },
  ])
    assert.notEqual(dressingFingerprint(arm), dressingFingerprint(changed));
  assert.notEqual(dressingFingerprint([1, 2]), dressingFingerprint([2, 1]));
});

test('dressing fingerprints reject invalid numbers rather than serializing them as null', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => dressingFingerprint({ nested: [value] }), /nonfinite/);
  }
});
