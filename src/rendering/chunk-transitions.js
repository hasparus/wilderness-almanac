// @ts-check
import { Mesh, MeshDepthMaterial, RGBADepthPacking, ShaderChunk, Vector3 } from 'three';
import { ensureRevealSlots, revealKey } from './hex-reveal-geometry.js';

export const HEX_REVEAL_MS = 120;
export const HEX_STAGGER_MS = 8;
/** Keep a long chunk build from consuming the whole rise between rendered frames. */
export const MAX_REVEAL_FRAME_MS = 32;
const MAX_HEXES = 16;
const defaultDepth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
/** @typedef {import('three').Group} Group */
/** @typedef {import('three').Material} Material */
/** @typedef {Mesh & {boundingSphere?: import('three').Sphere | null}} RevealMesh */
/** @typedef {{offset: number, visible: boolean, opacity: number}} HexPresentation */
/**
 * @typedef {object} Transition
 * @property {number | null} previousFrame
 * @property {boolean} awaitingFirstFrame
 * @property {number} duration
 * @property {{value: number}} time
 * @property {{value: number}} distance
 * @property {number[]} delays
 * @property {Map<string, HexPresentation>} hexes
 * @property {Array<{mesh: RevealMesh, material: Material | Material[], depth: Material | undefined, sphere: import('three').Sphere | null | undefined}>} meshes
 */

/** @param {number} progress @returns {number} */
export function hexRevealProgress(progress) {
  return 1 - (1 - Math.max(0, Math.min(1, progress))) ** 4;
}

/**
 * Keep chunk geometry/batches intact; independently animate each hex in shaders.
 * Temporary materials belong here; the one-byte batch attribute belongs to the
 * geometry cache. No extra render loop or per-hex draw calls.
 * @param {{enabled: () => boolean, distance: () => number}} options
 */
export function createChunkTransitions({ enabled, distance }) {
  /** @type {Map<Group, Transition>} */
  const transitions = new Map();
  /** @type {Map<Group, {time: {value: number}, distance: {value: number}, delays: {value: Float32Array}, materials: Map<string, Material>}>} */
  const caches = new Map();
  const scale = new Vector3();

  /** @param {Transition} transition @param {number} elapsed @returns {void} */
  function apply(transition, elapsed) {
    transition.time.value = elapsed;
    let index = 0;
    for (const state of transition.hexes.values()) {
      const age = elapsed - transition.delays[index++];
      state.visible = age >= 0;
      const progress = hexRevealProgress(age / HEX_REVEAL_MS);
      state.offset = -transition.distance.value * (1 - progress);
      state.opacity = state.visible ? 0.18 + 0.82 * progress : 0;
    }
  }

  /** @param {Group} root @returns {void} */
  function finish(root) {
    const transition = transitions.get(root);
    if (!transition) return;
    for (const { mesh, material, depth, sphere } of transition.meshes) {
      mesh.material = material;
      mesh.customDepthMaterial = depth;
      if (sphere === undefined) delete mesh.boundingSphere;
      else mesh.boundingSphere = sphere;
    }
    transition.meshes.length = 0;
    transition.hexes.clear();
    transitions.delete(root);
  }

  return {
    /** @returns {boolean} */
    active: () => transitions.size > 0,
    /** @param {Group} root @returns {boolean} */
    has: (root) => transitions.has(root),
    /** @param {Group} root @param {string} key @returns {HexPresentation | undefined} */
    presentation: (root, key) => transitions.get(root)?.hexes.get(key),
    finish,
    /** Release wrappers with their geometry record, keeping shader programs warm until then.
     * @param {Group} root @returns {void}
     */
    release(root) {
      finish(root);
      const cache = caches.get(root);
      if (cache) for (const material of cache.materials.values()) material.dispose();
      caches.delete(root);
    },
    /** @returns {void} */
    finishAll() {
      for (const root of transitions.keys()) finish(root);
    },
    /** @param {Set<Group>} roots @returns {void} */
    retain(roots) {
      for (const root of transitions.keys()) if (!roots.has(root)) finish(root);
    },
    /**
     * Keys arrive in desired reveal order. Canonical slots stay stable on replay.
     * @param {Group} root
     * @param {string[]} order
     * @param {import('three').Object3D[]} [lights]
     * @param {Group} [underlay]
     * @returns {void}
     */
    enter(root, order, lights = [], underlay) {
      if (!enabled() || transitions.has(root) || !order.length) return;
      if (order.length > MAX_HEXES) throw new Error('Hex reveals require 4×4 chunks');
      const keys = [...order].sort();
      const delays = keys.map((key) => order.indexOf(key) * HEX_STAGGER_MS);
      const cache = caches.get(root) ?? {
        time: { value: 0 },
        distance: { value: 0 },
        delays: { value: new Float32Array(MAX_HEXES) },
        materials: /** @type {Map<string, Material>} */ (new Map()),
      };
      caches.set(root, cache);
      cache.distance.value = distance();
      cache.delays.value.set(delays);
      /** @type {Set<string>} */
      const used = new Set();
      /** @type {Transition} */
      const transition = {
        previousFrame: null,
        awaitingFirstFrame: true,
        duration: HEX_REVEAL_MS + Math.max(...delays),
        time: cache.time,
        distance: cache.distance,
        delays,
        hexes: new Map(keys.map((key) => [key, { offset: 0, visible: false, opacity: 0 }])),
        meshes: [],
      };
      /** @param {Material} base @param {number | null} slot @param {boolean} outgoing @param {boolean} shadow @returns {Material} */
      function temporary(base, slot, outgoing, shadow) {
        const variant = `${slot === null ? 'batch' : slot}:${outgoing}:${shadow}`;
        const key = `${base.uuid}:${variant}`;
        const cached = cache.materials.get(key);
        if (used.has(key) && cached) return cached;
        used.add(key);
        const material = cached ? cached.copy(base) : base.clone();
        material.needsUpdate = true;
        if (!outgoing && !shadow) material.transparent = true;
        material.forceSinglePass = true;
        material.customProgramCacheKey = () =>
          `${base.customProgramCacheKey()}:hex-rise-v1:${slot === null}:${outgoing}:${shadow}`;
        material.onBeforeCompile = (shader, renderer) => {
          base.onBeforeCompile(shader, renderer);
          shader.uniforms.hexRevealTime = cache.time;
          shader.uniforms.hexRevealDistance = cache.distance;
          shader.uniforms.hexRevealDelays = cache.delays;
          shader.uniforms.hexRevealSlot = { value: slot ?? 0 };
          shader.vertexShader =
            `
            ${slot === null ? 'attribute' : 'uniform'} float hexRevealSlot;
            uniform float hexRevealTime;
            uniform float hexRevealDistance;
            uniform float hexRevealDelays[16];
            varying float hexRevealAlpha;
          ` + shader.vertexShader;
          shader.vertexShader = shader.vertexShader
            .replace(
              '#include <begin_vertex>',
              `
            #include <begin_vertex>
            float hexAge = hexRevealTime - hexRevealDelays[int(hexRevealSlot)];
            float hexRemaining = 1.0 - clamp(hexAge / 120.0, 0.0, 1.0);
            float hexEase = 1.0 - hexRemaining * hexRemaining * hexRemaining * hexRemaining;
            hexRevealAlpha = hexAge < 0.0 ? 0.0 : mix(0.18, 1.0, hexEase);
            float hexOffset = ${outgoing ? '0.0' : '-hexRevealDistance * (1.0 - hexEase)'};
          `,
            )
            .replace(
              '#include <project_vertex>',
              `
            #include <project_vertex>
            mvPosition.xyz += mat3(viewMatrix) * vec3(0.0, hexOffset, 0.0);
            gl_Position = projectionMatrix * mvPosition;
            ${outgoing && !shadow ? 'gl_Position.z += 0.1 * gl_Position.w;' : ''}
          `,
            )
            .replace(
              '#include <worldpos_vertex>',
              ShaderChunk.worldpos_vertex.replace(
                'worldPosition = modelMatrix * worldPosition;',
                'worldPosition = modelMatrix * worldPosition; worldPosition.y += hexOffset;',
              ),
            );
          shader.fragmentShader = 'varying float hexRevealAlpha;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <alphatest_fragment>',
            `
            #include <alphatest_fragment>
            ${
              outgoing
                ? 'if (hexRevealAlpha >= 1.0) discard;'
                : `
              if (hexRevealAlpha <= 0.0) discard;
              ${shadow ? 'if (hexRevealAlpha < 1.0 && hexRevealAlpha < fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453)) discard;' : 'diffuseColor.a *= hexRevealAlpha;'}
            `
            }
          `,
          );
        };
        cache.materials.set(key, material);
        return material;
      }
      for (const node of [root, ...lights, ...(underlay ? [underlay] : [])]) {
        const outgoing = node === underlay;
        node.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          const mesh = /** @type {RevealMesh} */ (object);
          const slot = mesh.userData.faceRanges
            ? null
            : Math.max(0, keys.indexOf(revealKey(mesh) ?? ''));
          if (slot === null) ensureRevealSlots(mesh, keys);
          const material = mesh.material,
            depth = mesh.customDepthMaterial,
            sphere = mesh.boundingSphere;
          transition.meshes.push({ mesh, material, depth, sphere });
          mesh.material = Array.isArray(material)
            ? material.map((base) => temporary(base, slot, outgoing, false))
            : temporary(material, slot, outgoing, false);
          if (mesh.castShadow)
            mesh.customDepthMaterial = temporary(depth ?? defaultDepth, slot, outgoing, true);
          if (!outgoing) {
            if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
            const expanded = (sphere ?? mesh.geometry.boundingSphere)?.clone();
            if (expanded) {
              mesh.getWorldScale(scale);
              expanded.radius +=
                transition.distance.value /
                Math.max(0.001, Math.min(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)));
              mesh.boundingSphere = expanded;
            }
          }
        });
      }
      for (const [key, material] of cache.materials) {
        if (used.has(key)) continue;
        material.dispose();
        cache.materials.delete(key);
      }
      transitions.set(root, transition);
      apply(transition, 0);
    },
    /** Anchor new arrivals after their first frame's submission cost. @param {number} time */
    afterRender(time) {
      for (const transition of transitions.values()) {
        if (!transition.awaitingFirstFrame) continue;
        transition.previousFrame = time;
        transition.awaitingFirstFrame = false;
      }
    },
    /** @param {number} time @returns {boolean} */
    tick(time) {
      const changed = transitions.size > 0;
      for (const [root, transition] of transitions) {
        const delta = Math.max(0, time - (transition.previousFrame ?? time));
        transition.previousFrame = time;
        const elapsed = transition.time.value + Math.min(MAX_REVEAL_FRAME_MS, delta);
        if (!enabled() || elapsed >= transition.duration) finish(root);
        else apply(transition, elapsed);
      }
      return changed;
    },
  };
}
