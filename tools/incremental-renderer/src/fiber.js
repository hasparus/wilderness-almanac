// @ts-check
import React, { memo, useSyncExternalStore } from 'react';
import { createRoot, useFrame, flushSync, extend } from '@react-three/fiber';
import { Group, Mesh } from 'three';

/** @param {import('three').Object3D} object
 * @param {React.Key} key
 * @returns {React.ReactElement} Declarative copy; the builder retains resource ownership.
 */
function node(object, key) {
  const mesh = /** @type {Mesh} */ (object);
  if (!(/** @type {Group} */ (object).isGroup) && !mesh.isMesh)
    throw new Error(`Unsupported declarative object ${object.type}`);
  return React.createElement(
    mesh.isMesh ? 'mesh' : 'group',
    {
      key,
      dispose: null,
      name: object.name,
      position: object.position,
      quaternion: object.quaternion,
      scale: object.scale,
      matrixAutoUpdate: object.matrixAutoUpdate,
      matrix: object.matrix,
      visible: object.visible,
      renderOrder: object.renderOrder,
      frustumCulled: object.frustumCulled,
      castShadow: object.castShadow,
      receiveShadow: object.receiveShadow,
      userData: object.userData,
      geometry: mesh.geometry,
      material: mesh.material,
      customDepthMaterial: mesh.customDepthMaterial,
      customDistanceMaterial: mesh.customDistanceMaterial,
      onBeforeRender: object.onBeforeRender,
      onAfterRender: object.onAfterRender,
      onBeforeShadow: object.onBeforeShadow,
      onAfterShadow: object.onAfterShadow,
    },
    object.children.map((child, i) => node(child, i)),
  );
}
const Chunk = memo(
  /** @param {{store: import('./types.js').ChunkStore, retainedTrees: boolean}} props */ function Chunk({
    store,
    retainedTrees,
  }) {
    const record = useSyncExternalStore(store.subscribe, store.snapshot);
    store.renders++;
    return React.createElement(
      'group',
      { name: `chunk:${store.id}`, dispose: null },
      record
        ? retainedTrees
          ? React.createElement('primitive', { object: record.root, dispose: null })
          : node(record.root, record.root.uuid)
        : null,
    );
  },
);
/** @param {import('./types.js').FiberOptions} options
 * @returns {Promise<import('./types.js').Driver>}
 */
export async function createFiberDriver({
  ids,
  canvas,
  renderer,
  camera,
  scene,
  width,
  height,
  dpr,
  renderFrame,
  retainedTrees = false,
}) {
  extend({ Group, Mesh });
  /** @type {import('@react-three/fiber').RootState | undefined} */
  let state;
  const stores = new Map(
    ids.map((id) => {
      /** @type {Set<() => void>} */
      const listeners = new Set();
      /** @type {import('./types.js').ChunkStore} */
      const store = {
        id,
        value: null,
        renders: 0,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        snapshot: () => store.value,
        set(value) {
          store.value = value;
          for (const fn of listeners) fn();
        },
      };
      return [id, store];
    }),
  );
  const root = createRoot(canvas);
  await root.configure({
    gl: renderer,
    scene,
    camera,
    dpr,
    frameloop: 'never',
    flat: true,
    shadows: { enabled: true, type: renderer.shadowMap.type },
    size: { width, height, top: 0, left: 0 },
    onCreated: (value) => {
      state = value;
    },
  });
  /** @returns {null} Uses the existing render protocol rather than Fiber's default render. */
  function Frame() {
    useFrame(renderFrame, 1);
    return null;
  }
  flushSync(() =>
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Frame),
        ...[...stores.values()].map((store) =>
          React.createElement(Chunk, { key: store.id, store, retainedTrees }),
        ),
      ),
    ),
  );
  if (!state) throw new Error('Fiber root not initialized');
  return {
    set(id, record) {
      flushSync(() => /** @type {import('./types.js').ChunkStore} */ (stores.get(id)).set(record));
    },
    frame(time) {
      /** @type {import('@react-three/fiber').RootState} */ (state).advance(time / 1000, false);
    },
    diagnostics() {
      return Object.fromEntries([...stores].map(([id, store]) => [id, store.renders]));
    },
    unmount() {
      root.unmount();
    },
  };
}
