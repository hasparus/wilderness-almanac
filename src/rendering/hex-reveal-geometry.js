// @ts-check
import { Uint8BufferAttribute } from 'three';

/** @typedef {{end: number, key: string}} FaceRange */
/** @param {import('three').BufferGeometry} geometry @param {string} key @returns {void} */
export function tagRevealGeometry(geometry, key) {
  geometry.userData.revealKey = key;
}

/** Preserve source-hex ownership when merging light meshes. @param {import('three').BufferGeometry[]} geometries @returns {FaceRange[]} */
export function lightRevealRanges(geometries) {
  let end = 0;
  return geometries.map((geometry) => ({
    end: (end += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3),
    key: geometry.userData.revealKey,
  }));
}

/**
 * One byte per batched vertex; retained with the cached geometry so replay only
 * updates sixteen delay uniforms, not vertex buffers or draw calls.
 * @param {import('three').Mesh} mesh
 * @param {string[]} keys Stable canonical order for this record.
 * @returns {void}
 */
export function ensureRevealSlots(mesh, keys) {
  const geometry = mesh.geometry;
  if (geometry.hasAttribute('hexRevealSlot')) return;
  const slots = new Uint8Array(geometry.getAttribute('position').count);
  const byKey = new Map(keys.map((key, index) => [key, index]));
  const ranges = /** @type {FaceRange[]} */ (mesh.userData.faceRanges);
  let start = 0;
  for (const { key, end } of ranges) {
    const slot = byKey.get(key) ?? 0;
    if (geometry.index) {
      for (let index = start; index < end * 3; index++) slots[geometry.index.getX(index)] = slot;
    } else slots.fill(slot, start, end * 3);
    start = end * 3;
  }
  geometry.setAttribute('hexRevealSlot', new Uint8BufferAttribute(slots, 1));
}

/** @param {import('three').Object3D} object @returns {string | undefined} */
export function revealKey(object) {
  /** @type {import('three').Object3D | null} */
  let current = object;
  while (current) {
    if (typeof current.userData.key === 'string') return current.userData.key;
    current = current.parent;
  }
  return undefined;
}
