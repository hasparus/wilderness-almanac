// @ts-check
import { Mesh } from 'three';

export const CHUNK_REVEAL_MS = 120;
/** @typedef {import('three').Group} Group */
/** @typedef {import('three').Object3D} Object3D */
/** @typedef {import('three').Material} Material */
/**
 * @typedef {object} Transition
 * @property {number | null} start
 * @property {number} distance
 * @property {Array<{node: Object3D, y: number}>} positions
 * @property {Array<{mesh: Mesh, original: Material | Material[]}>} meshes
 * @property {Map<Material, Material>} materials
 */

/** Quartic ease-out: 94% settled halfway through the short arrival. @param {number} progress */
export function chunkRevealProgress(progress) {
  return 1 - (1 - Math.max(0, Math.min(1, progress))) ** 4;
}

/**
 * Own only temporary material wrappers and transforms, never geometry or shared
 * materials. The renderer's existing frame loop drives these 120 ms arrivals.
 * @param {{enabled: () => boolean, distance: () => number}} options
 */
export function createChunkTransitions({ enabled, distance }) {
  /** @type {Map<Group, Transition>} */
  const transitions = new Map();

  /** @param {Transition} transition @param {number} progress @returns {void} */
  function apply(transition, progress) {
    const settled = chunkRevealProgress(progress);
    for (const { node, y } of transition.positions)
      node.position.y = y + transition.distance * (1 - settled);
    for (const [base, temporary] of transition.materials)
      temporary.opacity = base.opacity * (0.18 + 0.82 * settled);
  }

  /** Restore before the geometry owner disposes a record or reuses it. @param {Group} root @returns {void} */
  function finish(root) {
    const transition = transitions.get(root);
    if (!transition) return;
    for (const { node, y } of transition.positions) node.position.y = y;
    for (const { mesh, original } of transition.meshes) mesh.material = original;
    for (const temporary of transition.materials.values()) temporary.dispose();
    transitions.delete(root);
  }

  return {
    /** @returns {boolean} */
    active: () => transitions.size > 0,
    /** @param {Group} root @returns {boolean} */
    has: (root) => transitions.has(root),
    finish,
    /** @returns {void} */
    finishAll() {
      for (const root of transitions.keys()) finish(root);
    },
    /** Concealed/replaced chunks stop synchronously, without an exit animation.
     * @param {Set<Group>} roots @returns {void}
     */
    retain(roots) {
      for (const root of transitions.keys()) if (!roots.has(root)) finish(root);
    },
    /** @param {Group} root @param {Object3D[]} [lights] @returns {void} */
    enter(root, lights = []) {
      if (!enabled() || transitions.has(root)) return;
      /** @type {Transition} */
      const transition = {
        start: null,
        distance: distance(),
        positions: [root, ...lights].map((node) => ({ node, y: node.position.y })),
        meshes: [],
        materials: new Map(),
      };
      /** @param {Material} base @returns {Material} */
      function temporary(base) {
        const cached = transition.materials.get(base);
        if (cached) return cached;
        const material = base.clone();
        material.transparent = true;
        material.forceSinglePass = true;
        material.onBeforeCompile = (shader, renderer) => base.onBeforeCompile(shader, renderer);
        material.customProgramCacheKey = () => base.customProgramCacheKey();
        transition.materials.set(base, material);
        return material;
      }
      for (const { node } of transition.positions)
        node.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          const original = object.material;
          transition.meshes.push({ mesh: object, original });
          object.material = Array.isArray(original) ? original.map(temporary) : temporary(original);
        });
      transitions.set(root, transition);
      apply(transition, 0);
    },
    /** Start the clock on the first render opportunity, not during mesh building.
     * @param {number} time @returns {boolean} Whether a frame changed, including final restoration.
     */
    tick(time) {
      const changed = transitions.size > 0;
      for (const [root, transition] of transitions) {
        transition.start ??= time;
        const progress = (time - transition.start) / CHUNK_REVEAL_MS;
        if (!enabled() || progress >= 1) finish(root);
        else apply(transition, progress);
      }
      return changed;
    },
  };
}
