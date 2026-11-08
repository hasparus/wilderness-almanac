// @ts-check
import { createElement, memo } from 'react';
import { createPortal, createRoot, flushSync } from '@react-three/fiber';

/** @typedef {{id: string, root: import('three').Group}} SceneChunk */
/**
 * Geometry and materials belong to the build cache, never the reconciler.
 * @param {{root: import('three').Group}} props
 */
function ChunkView({ root }) {
  return createElement('primitive', { object: root, dispose: null });
}
const Chunk = memo(ChunkView);

/**
 * React owns keyed chunk attachments inside a portal, not the app's controls,
 * renderer, frame loop, lights or party overlay. No second canvas/context.
 * @param {object} options
 * @param {import('three').WebGLRenderer} options.renderer
 * @param {import('three').Scene} options.scene
 * @param {import('three').OrthographicCamera} options.camera
 * @param {import('three').Group} options.container
 * @param {() => void} options.draw
 */
export function createRetainedChunkScene({ renderer, scene, camera, container, draw }) {
  /** @type {SceneChunk[]} */
  let chunks = [];
  let ready = false,
    disposed = false;
  const root = createRoot(renderer.domElement);
  Object.assign(camera, { manual: true });

  /** Commit retained references without rebuilding descendant Object3Ds. @returns {void} */
  function render() {
    if (disposed) return;
    if (!ready) {
      container.clear();
      container.add(...chunks.map((chunk) => chunk.root));
      return;
    }
    flushSync(() =>
      root.render(
        createPortal(
          chunks.map(({ id, root }) => createElement(Chunk, { key: id, root })),
          container,
        ),
      ),
    );
  }
  const initialized = root
    .configure({
      gl: renderer,
      scene,
      camera,
      frameloop: 'never',
      flat: true,
      dpr: renderer.getPixelRatio(),
      shadows: { enabled: true, type: renderer.shadowMap.type },
      size: {
        width: renderer.domElement.clientWidth || 1,
        height: renderer.domElement.clientHeight || 1,
        top: 0,
        left: 0,
      },
    })
    .then(() => {
      if (disposed) return;
      ready = true;
      render();
      draw();
    });

  return {
    initialized,
    /** @param {SceneChunk[]} entries @returns {void} */
    commit(entries) {
      chunks = entries;
      render();
    },
    /** Detach before the caller releases geometries and its WebGL renderer. @returns {void} */
    dispose() {
      if (disposed) return;
      chunks = [];
      render();
      disposed = true;
      root.unmount();
    },
  };
}
