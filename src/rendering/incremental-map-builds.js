// @ts-check
import { Group, Vector2, Vector3 } from 'three';
import { createIncrementalBuilds } from './incremental-builds.js';
import { createRetainedChunkScene } from './retained-chunk-scene.js';
import { createMapPicker } from './map-picking.js';

/** @typedef {import('./incremental-builds.js').ChunkTile & {wx: number, wz: number, top: number, props: {kind: string, angle?: number}[]}} Tile */
/** @typedef {{root: Group, cells: unknown[], lightSources: unknown[], wave: Vector2 | null}} MeshRecord */
/** @typedef {ReturnType<ReturnType<typeof import('./feature-lighting.js').createFeatureLighting>['build']>} LightingRecord */
/** @typedef {(raycaster: import('three').Raycaster) => import('three').Intersection | null} Picker */
/** @typedef {{map: MeshRecord, lighting: LightingRecord, lightingLayout: Tile[] | null, picker: Picker | null}} Record */
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
  /** @type {Presentation | null} */
  let active = null;
  /** @type {Tile[] | null} */
  let shownLayout = null;
  /** @type {Array<Tile & {g: Group}>} */
  let cells = [];
  let style = 'low-poly';

  const controller = createIncrementalBuilds({
    /** @param {Tile[]} tiles @param {string} nextStyle @returns {Record} */
    build(tiles, nextStyle) {
      const built = context.build(tiles, nextStyle, shownLayout ?? tiles);
      return { ...built, lightingLayout: shownLayout, picker: null };
    },
    release: context.release,
    /** @param {Tile[]} tiles @returns {number} */
    priority(tiles) {
      point.set(0, 0, 0);
      for (const tile of tiles) point.add(new Vector3(tile.wx, tile.top, tile.wz));
      point.multiplyScalar(1 / tiles.length).project(camera);
      return (
        (Math.abs(point.x) > 1 || Math.abs(point.y) > 1 ? 10 : 0) + point.x ** 2 + point.y ** 2
      );
    },
    /** @param {import('./incremental-builds.js').ChunkEntry<Record>[]} entries @param {Tile[]} layout @param {boolean} pending @returns {void} */
    show(entries, layout, pending) {
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
        retired.push(record.lighting);
        record.lighting = featureLighting.build(record.map.lightSources, layout, {
          artStyle: style,
        });
        record.lightingLayout = layout;
      }
      owner.commit(entries.map(({ id, record }) => ({ id, root: record.map.root })));
      container.updateWorldMatrix(true, true);
      const pickers = entries.map(
        ({ record }) => (record.picker ??= createMapPicker([record.map.root])),
      );
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
      renderer.domElement.dataset.renderState = pending ? 'building' : 'ready';
      renderer.domElement.setAttribute('aria-busy', String(pending));
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
    flush: controller.flush,
    /** @param {Tile[]} layout @param {Tile[]} source @param {string} nextStyle @returns {void} */
    show(layout, source, nextStyle) {
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
