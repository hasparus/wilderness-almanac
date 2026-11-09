// @ts-check
import { Group, Vector2, Vector3 } from 'three';
import { createIncrementalBuilds } from './incremental-builds.js';
import { createRetainedChunkScene } from './retained-chunk-scene.js';
import { createMapPicker } from './map-picking.js';
import { createChunkTransitions } from './chunk-transitions.js';
import { chunkPriorityBounds, viewportPriority } from './viewport-priority.js';

/** @typedef {import('./incremental-builds.js').ChunkTile & {wx: number, wz: number, top: number, props: {kind: string, angle?: number}[]}} Tile */
/** @typedef {{root: Group, cells: unknown[], lightSources: unknown[], wave: Vector2 | null}} MeshRecord */
/** @typedef {ReturnType<ReturnType<typeof import('./feature-lighting.js').createFeatureLighting>['build']>} LightingRecord */
/** @typedef {(raycaster: import('three').Raycaster) => import('three').Intersection | null} Picker */
/** @typedef {{map: MeshRecord, lighting: LightingRecord, lightingLayout: Tile[] | null, picker: Picker | null, tiles: Tile[]}} Record */
/** @typedef {{map: MeshRecord, lighting: LightingRecord, picker: ReturnType<typeof import('./map-picking.js').createMapPicker> | null}} Presentation */
/**
 * @typedef {object} BuildContext
 * @property {import('three').WebGLRenderer} renderer
 * @property {import('three').Scene} scene
 * @property {import('three').OrthographicCamera} camera
 * @property {(layout: Tile[], style: string, context?: Tile[]) => {map: MeshRecord, lighting: LightingRecord}} build
 * @property {(record: Presentation | null) => void} show
 * @property {(record: {map: MeshRecord, lighting: LightingRecord}) => void} release
 * @property {ReturnType<typeof import('./feature-lighting.js').createFeatureLighting>} featureLighting
 * @property {() => void} onCommit
 * @property {() => void} draw
 */

/**
 * Adapts retained chunks to the existing controls/materials/lighting owners.
 * Full projected metadata is available immediately for party and camera framing;
 * picking only includes objects actually mounted in the scene.
 * @param {BuildContext} context
 */
export function createIncrementalMapBuilds(context) {
  const { renderer, scene, camera, featureLighting, onCommit, draw } = context;
  const container = new Group();
  container.name = 'incremental-map';
  const owner = createRetainedChunkScene({ renderer, scene, camera, container, draw });
  const point = new Vector3();
  /** @type {WeakMap<Tile[], import('./viewport-priority.js').ChunkBounds>} */
  const priorityBounds = new WeakMap();
  /** @type {Presentation | null} */
  let active = null;
  /** @type {Tile[] | null} */
  let shownLayout = null;
  /** @type {Array<Tile & {g: Group}>} */
  let cells = [];
  /** @type {import('./incremental-builds.js').ChunkEntry<Record>[]} */
  let shownEntries = [];
  /** @type {Map<Group, import('./incremental-builds.js').ChunkEntry<Record>>} */
  const underlays = new Map();
  let style = 'low-poly';
  let animateRequest = true,
    building = false,
    flushing = false;
  const transitions = createChunkTransitions({
    enabled: () => renderer.domElement.dataset.motion === 'ambient',
    distance() {
      camera.updateMatrixWorld();
      return (
        (6 * (camera.top - camera.bottom)) /
        (Math.max(1, renderer.domElement.clientHeight) *
          camera.zoom *
          Math.max(0.1, Math.abs(camera.matrixWorld.elements[5])))
      );
    },
  });
  /** Detach expired underlays before releasing retired geometry. @returns {void} */
  function commitScene() {
    owner.commit(
      [...shownEntries, ...underlays.values()].map(({ record }) => ({
        id: record.map.root.uuid,
        root: record.map.root,
      })),
    );
  }
  /** @returns {boolean} */
  function trimUnderlays() {
    let changed = false;
    for (const root of underlays.keys()) {
      if (transitions.has(root)) continue;
      underlays.delete(root);
      changed = true;
    }
    return changed;
  }
  /** @returns {void} */
  function updateStatus() {
    const pending = building || transitions.active();
    renderer.domElement.dataset.renderState = building
      ? 'building'
      : transitions.active()
        ? 'settling'
        : 'ready';
    renderer.domElement.setAttribute('aria-busy', String(pending));
  }
  /** @returns {void} */
  function updateLightReveals() {
    for (const { record } of shownEntries)
      for (const source of record.lighting.sources)
        source.reveal.value = transitions.presentation(record.map.root, source.key)?.opacity ?? 1;
  }
  /** @returns {void} */
  function finishTransitions() {
    transitions.finishAll();
    if (trimUnderlays()) commitScene();
    updateLightReveals();
    container.updateWorldMatrix(true, true);
    updateStatus();
  }

  const controller = createIncrementalBuilds({
    /** @param {Tile[]} tiles @param {string} nextStyle @returns {Record} */
    build(tiles, nextStyle) {
      const built = context.build(tiles, nextStyle, shownLayout ?? tiles);
      return {
        ...built,
        lightingLayout: shownLayout,
        picker: null,
        tiles,
      };
    },
    release(record) {
      transitions.finish(record.map.root);
      for (const [incoming, before] of underlays)
        if (before.record === record) transitions.finish(incoming);
      if (trimUnderlays()) {
        commitScene();
        container.updateWorldMatrix(true, true);
        updateStatus();
      }
      transitions.release(record.map.root);
      context.release(record);
    },
    preparePriority() {
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
    },
    /** @param {Tile[]} tiles @returns {number} */
    priority(tiles) {
      let bounds = priorityBounds.get(tiles);
      if (!bounds) {
        bounds = chunkPriorityBounds(tiles);
        priorityBounds.set(tiles, bounds);
      }
      return viewportPriority(bounds, (x, y, z) => point.set(x, y, z).project(camera));
    },
    /** @param {import('./incremental-builds.js').ChunkEntry<Record>[]} entries @param {Tile[]} layout @param {boolean} pending @returns {void} */
    show(entries, layout, pending) {
      building = pending;
      const previous = new Map(shownEntries.map((entry) => [entry.id, entry]));
      shownEntries = entries;
      transitions.retain(new Set(entries.map(({ record }) => record.map.root)));
      if (shownLayout !== layout) {
        shownLayout = layout;
        cells = layout.map((tile) => {
          const g = new Group();
          g.position.set(tile.wx, 0, tile.wz);
          return { ...tile, g };
        });
      }
      /** @type {LightingRecord[]} */
      const retired = [];
      for (const { record } of entries) {
        if (record.lightingLayout === layout) continue;
        transitions.finish(record.map.root);
        retired.push(record.lighting);
        record.lighting = featureLighting.build(record.map.lightSources, layout, {
          artStyle: style,
        });
        record.lightingLayout = layout;
      }
      const pickers = entries.map(({ record }) => {
        if (!record.picker) {
          record.map.root.updateWorldMatrix(true, true);
          record.picker = createMapPicker([record.map.root], {
            reveal: (key) => transitions.presentation(record.map.root, key),
          });
        }
        return record.picker;
      });
      for (const { id, record } of entries) {
        const before = previous.get(id);
        if (before?.record !== record && animateRequest && !flushing) {
          const order = record.tiles
            .map((tile) => {
              point.set(tile.wx, tile.top, tile.wz).project(camera);
              return { key: tile.key, distance: point.x ** 2 + point.y ** 2 };
            })
            .sort((a, b) => a.distance - b.distance)
            .map((tile) => tile.key);
          transitions.enter(
            record.map.root,
            order,
            [...record.lighting.glow, ...record.lighting.beams],
            before?.record.map.root,
          );
          if (before && transitions.has(record.map.root)) underlays.set(record.map.root, before);
        }
      }
      trimUnderlays();
      updateLightReveals();
      commitScene();
      container.updateWorldMatrix(true, true);
      const wave = layout.flatMap((tile) => tile.props).find((prop) => prop.kind === 'wave');
      active = layout.length
        ? {
            map: {
              root: container,
              cells,
              lightSources: entries.flatMap(({ record }) => record.map.lightSources),
              wave: wave ? new Vector2(Math.cos(wave.angle ?? 0), Math.sin(wave.angle ?? 0)) : null,
            },
            lighting: {
              glow: entries.flatMap(({ record }) => record.lighting.glow),
              beams: entries.flatMap(({ record }) => record.lighting.beams),
              sources: entries.flatMap(({ record }) => record.lighting.sources),
              lighthouses: entries.flatMap(({ record }) => record.lighting.lighthouses),
            },
            /** @param {import('three').Raycaster} raycaster @returns {import('three').Intersection | null} */
            picker(raycaster) {
              /** @type {import('three').Intersection | null} */
              let nearest = null;
              for (const pick of pickers) {
                const hit = pick(raycaster);
                if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
              }
              return nearest;
            },
          }
        : null;
      context.show(active);
      for (const lighting of retired) featureLighting.release(lighting);
      renderer.domElement.dataset.renderer = 'fiber-retained';
      updateStatus();
      onCommit();
    },
  });
  owner.initialized.catch((error) => {
    renderer.domElement.dataset.renderState = 'error';
    console.error('Unable to initialize the incremental scene', error);
  });
  return {
    active: () => active,
    clear: controller.clear,
    finishTransitions,
    animating: transitions.active,
    afterRender: transitions.afterRender,
    /** @param {number} time @returns {boolean} */
    tick(time) {
      const changed = transitions.tick(time);
      if (changed) {
        if (trimUnderlays()) commitScene();
        updateLightReveals();
        container.updateWorldMatrix(true, true);
        updateStatus();
      }
      return changed;
    },
    /** Snapshots complete both queued geometry and its presentation. @returns {void} */
    flush() {
      flushing = true;
      try {
        controller.flush();
      } finally {
        flushing = false;
        finishTransitions();
      }
    },
    /** @param {Tile[]} layout @param {Tile[]} source @param {string} nextStyle @returns {void} */
    show(layout, source, nextStyle) {
      const previous = new Map((shownLayout ?? []).map((tile) => [tile.key, tile]));
      /** @param {Tile} tile */
      const visibility = (tile) =>
        tile.fogState === 'undiscovered' ? 0 : tile.fogState === 'unvisited' ? 1 : 2;
      animateRequest = !layout.some((tile) => {
        const before = previous.get(tile.key);
        return before && visibility(tile) < visibility(before);
      });
      if (!animateRequest) finishTransitions();
      style = nextStyle;
      controller.show(layout, source, nextStyle);
    },
    /** @returns {void} */
    dispose() {
      controller.clear();
      owner.dispose();
    },
  };
}
