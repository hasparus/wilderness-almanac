// @ts-check
import * as THREE from 'three';
import { generateWorld, generateDressing } from '../../../src/generation.js';
import { prepareMap } from '../../../src/generation/presentation.js';
import { computeFogOfWar } from '../../../src/application/fog-of-war.js';
import { createFogView } from '../../../src/application/fog-view.js';
import { createMapMeshes } from '../../../src/rendering/map-meshes.js';
import { createMapMaterials } from '../../../src/rendering/map-materials.js';
import { createDaylight } from '../../../src/rendering/daylight.js';
import { createFeatureLighting } from '../../../src/rendering/feature-lighting.js';
import { partition, fogSignature, geometryStats } from './chunks.js';
/** @returns {number} */
const now = () => performance.now();
/** @returns {Promise<number>} */
const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
let used = false;

/** @param {import('./types.js').RunOptions} [options]
 * @returns {Promise<import('./types.js').CompletedRunResult>}
 */
async function run(options = {}) {
  if (used) throw new Error('Reload between trials');
  used = true;
  const {
    mode = 'native',
    style = 'low-poly',
    seed = '7',
    chunkSize = 4,
    budgetMs = 6,
    maxChunks = 4,
    dpr = 1,
    verification = false,
    visitRadius = 0,
  } = options;
  if (
    !['native', 'fiber', 'fiber-retained', 'monolithic'].includes(mode) ||
    ![1, 4, 8].includes(chunkSize) ||
    !['low-poly', 'pixelart'].includes(style)
  )
    throw new Error('Unsupported configuration');
  /** @type {import('./types.js').RunResult} */
  const result = {
    mode,
    style,
    seed,
    visitRadius,
    verification,
    timingValid: !verification,
    chunkSize: mode === 'monolithic' ? 0 : chunkSize,
    budgetMs,
    maxChunks,
    threeRevision: THREE.REVISION,
    protocol:
      'repository renderer; one chunk minimum per RAF, independent commits, render between bounded batches; geometry build outside React; first visible = changed mesh onBeforeRender; two RAF after final render; no GPU finish',
    phases: {},
  };
  const importStart = now();
  const fiber = mode.startsWith('fiber') ? await import('./fiber.js') : null;
  result.importMs = now() - importStart;
  const dataStart = now();
  /** @type {import('./types.js').World} */
  let world = generateWorld(seed, { generatorVersion: 10 });
  /** @type {import('./types.js').Tile[]} */
  let layout = prepareMap(world, generateDressing(world, 0));
  let activeStyle = style;
  let chunks = partition(layout, result.chunkSize);
  result.generationAndPartitionMs = now() - dataStart;
  const origin = world.cells.find((cell) => cell.key === '0,0') ?? world.cells[0];
  const visits = Object.fromEntries(
    world.cells
      .filter(
        (cell) =>
          Math.max(
            Math.abs(cell.q - origin.q),
            Math.abs(cell.r - origin.r),
            Math.abs(cell.q + cell.r - origin.q - origin.r),
          ) <= visitRadius,
      )
      .map((cell) => [cell.key, { visited: true }]),
  );
  result.initialVisitedCount = Object.keys(visits).length;
  /** @type {import('./types.js').FogStates} */
  const initialStates = computeFogOfWar(world, { cells: visits });
  const next =
    world.cells.find((cell) => initialStates.get(cell.key) === 'unvisited' && !cell.water) ??
    world.cells.find((cell) => initialStates.get(cell.key) === 'unvisited');
  if (!next) throw new Error('No reveal candidate');
  result.visited = origin.key;
  result.reveal = next.key;
  const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas'));
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'default',
  });
  renderer.setSize(960, 720, false);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  const scene = new THREE.Scene(),
    camera = new THREE.OrthographicCamera(-32, 32, 24, -24, 0.1, 180);
  /** @type {THREE.OrthographicCamera & {manual?: boolean}} */ (camera).manual = true;
  camera.position.set(24, 30, 37);
  camera.lookAt(0, 0.3, 0);
  camera.updateMatrixWorld();
  const palette = createMapMaterials();
  scene.background = new THREE.Color(palette.background());
  const meshes = createMapMeshes(palette, { artStyle: style });
  const daylight = createDaylight(scene);
  daylight.sun.shadow.autoUpdate = false;
  const lights = createFeatureLighting(scene);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.ShadowMaterial({ opacity: 0.17 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.001;
  floor.receiveShadow = true;
  scene.add(floor);
  const gl = renderer.getContext(),
    debug = gl.getExtension('WEBGL_debug_renderer_info');
  result.gpu = debug
    ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  let renderCpu = 0;
  /** @type {Set<import('./types.js').ChunkRecord>} */
  let visibleRecords = new Set();
  /** @returns {void} */
  function renderFrame() {
    lights.update(0, camera);
    daylight.sun.shadow.needsUpdate = true;
    const start = now();
    renderer.clear();
    renderer.render(scene, camera);
    renderCpu = now() - start;
  }
  /** @type {Map<string, THREE.Group>} */
  const nativeOwners = new Map();
  /** @type {import('./types.js').Driver} */
  const driver = fiber
    ? await fiber.createFiberDriver({
        ids: [...chunks.keys()],
        canvas,
        renderer,
        camera,
        scene,
        width: 960,
        height: 720,
        dpr,
        renderFrame,
        retainedTrees: mode === 'fiber-retained',
      })
    : {
        set(id, record) {
          if (!nativeOwners.has(id)) {
            const group = new THREE.Group();
            group.name = `chunk:${id}`;
            scene.add(group);
            nativeOwners.set(id, group);
          }
          const group = /** @type {THREE.Group} */ (nativeOwners.get(id));
          group.clear();
          if (record) group.add(record.root);
        },
        frame() {
          renderFrame();
        },
        diagnostics() {
          return null;
        },
      };
  /** @type {Map<string, import('./types.js').ChunkRecord>} */
  const shown = new Map();
  /** @type {Map<string, import('./types.js').ChunkCache>} */
  const caches = new Map();
  let epoch = 0,
    disposed = false,
    captureIndex = 0;
  /** @type {Record<'plain' | 'projected', {signature: string, record: ReturnType<typeof lights.build>} | null>} */
  const lightingCache = { plain: null, projected: null };
  /** @param {import('./types.js').ChunkRecord | null} record */
  function disposeRecord(record) {
    if (record) meshes.release(record);
  }
  /** @param {string} id
   * @param {import('./types.js').Tile[]} tiles
   * @returns {import('./types.js').ChunkRecord}
   */
  function taggedBuild(id, tiles) {
    const record = /** @type {import('./types.js').MeshRecord & {chunkId?: string}} */ (
      meshes.build(tiles, { artStyle: activeStyle })
    );
    record.chunkId = id;
    const tagged = /** @type {import('./types.js').ChunkRecord} */ (record);
    record.root.traverse((object) => {
      if (!(/** @type {THREE.Mesh} */ (object).isMesh)) return;
      const before = object.onBeforeRender;
      object.onBeforeRender = function (...args) {
        visibleRecords.add(tagged);
        return before.apply(this, args);
      };
    });
    return tagged;
  }
  /** @returns {void} */
  function clearLighting() {
    lights.show(null);
  }
  /** @param {string} id
   * @param {import('./types.js').ChunkRecord | null} record
   */
  function commit(id, record) {
    driver.set(id, record);
    if (record) shown.set(id, record);
    else shown.delete(id);
  }
  /** @returns {import('./types.js').FrameMetric} */
  function frame() {
    const start = now();
    visibleRecords = new Set();
    scene.updateMatrixWorld(true);
    driver.frame(start);
    return { frameCpuMs: now() - start, renderCpuMs: renderCpu, draw: { ...renderer.info.render } };
  }
  /** @param {string} id
   * @param {import('./types.js').Tile[]} source
   * @returns {import('./types.js').ChunkCache}
   */
  function cacheFor(id, source) {
    let cache = caches.get(id);
    if (!cache) {
      cache = { source, plain: null, projected: null, signature: null };
      caches.set(id, cache);
    }
    if (cache.source.length !== source.length || source.some((tile, i) => tile !== cache.source[i]))
      throw new Error('Source changed without reset');
    return cache;
  }
  /** @type {import('./types.js').Transition} */
  async function transition(fog, visitData = visits, hooks = {}) {
    if (disposed) throw new Error('Disposed');
    const token = ++epoch,
      start = now();
    /** @type {import('./types.js').TransitionMetric} */
    const metric = {
      rebuiltChunks: 0,
      reusedChunks: 0,
      unchangedChunks: 0,
      changedChunks: 0,
      concealedChunks: 0,
      meshBuildCpuMs: 0,
      commitCpuMs: 0,
      featureBuildCpuMs: 0,
      preprocessingCpuMs: 0,
      slices: [],
      frames: [],
      firstVisibleChangedMs: null,
      firstVisibleChangedChunk: null,
      cancelled: false,
    };
    /** @type {import('./types.js').FogStates | null} */
    const states = fog ? computeFogOfWar(world, { cells: visitData }) : null;
    /** @type {import('./types.js').Tile[]} */
    const targetLayout = createFogView(world, layout, states).layout;
    const projectedByKey = new Map(targetLayout.map((tile) => [tile.key, tile]));
    /** @type {import('./types.js').Job[]} */
    const jobs = [];
    /** @type {import('./types.js').Job[]} */
    const cachedJobs = [];
    /** @type {Set<import('./types.js').ChunkRecord | null>} */
    const changedRecords = new Set();
    for (const [id, source] of chunks) {
      const cache = cacheFor(id, source),
        signature = fogSignature(source, states);
      const cached = fog ? (cache.signature === signature ? cache.projected : null) : cache.plain;
      if (cached && shown.get(id) === cached) {
        metric.unchangedChunks++;
        continue;
      }
      (cached ? cachedJobs : jobs).push({ id, source, cache, signature, cached });
      if (fog && shown.has(id)) {
        commit(id, null);
        metric.concealedChunks++;
      }
    }
    const centre = new THREE.Vector3();
    /** @param {import('./types.js').Job} job
     * @returns {number}
     */
    const priority = (job) => {
      centre.set(0, 0, 0);
      for (const tile of job.source) centre.add(new THREE.Vector3(tile.wx, tile.top, tile.wz));
      centre.multiplyScalar(1 / job.source.length).project(camera);
      return (
        (Math.abs(centre.x) > 1 || Math.abs(centre.y) > 1 ? 10 : 0) + centre.x ** 2 + centre.y ** 2
      );
    };
    const priorities = new Map(jobs.map((job) => [job.id, priority(job)]));
    jobs.sort(
      (a, b) =>
        /** @type {number} */ (priorities.get(a.id)) - /** @type {number} */ (priorities.get(b.id)),
    );
    metric.changedChunks = jobs.length + cachedJobs.length;
    clearLighting();
    const wave = targetLayout.flatMap((tile) => tile.props).find((prop) => prop.kind === 'wave');
    if (wave) palette.waveDirection.value.set(Math.cos(wave.angle), Math.sin(wave.angle));
    metric.preprocessingCpuMs = now() - start;
    for (const { id, cached } of cachedJobs) {
      const commitStart = now();
      commit(id, cached);
      metric.commitCpuMs += now() - commitStart;
      metric.reusedChunks++;
      changedRecords.add(cached);
    }
    if (metric.concealedChunks || cachedJobs.length) {
      const update = frame();
      if (metric.concealedChunks) metric.concealFrame = update;
      if (cachedJobs.length) {
        metric.frames.push(update);
        const actual = [...visibleRecords].find((record) => changedRecords.has(record));
        if (actual) {
          metric.firstVisibleChangedMs = now() - start;
          metric.firstVisibleChangedChunk = actual.chunkId;
        }
      }
    }
    metric.slices.push(now() - start);
    let index = 0,
      batches = 0;
    /** @returns {import('./types.js').TransitionMetric} */
    function cancelled() {
      metric.cancelled = true;
      metric.elapsedMs = now() - start;
      metric.longestSliceMs = Math.max(...metric.slices);
      metric.unstartedChunks = jobs.length - index;
      return metric;
    }
    while (index < jobs.length) {
      await raf();
      if (token !== epoch || disposed) return cancelled();
      const sliceStart = now();
      let count = 0;
      do {
        const { id, source, cache, signature, cached } = jobs[index++];
        let record = cached;
        if (record) metric.reusedChunks++;
        else {
          const buildStart = now();
          record = taggedBuild(
            id,
            fog
              ? source.map(
                  (tile) => /** @type {import('./types.js').Tile} */ (projectedByKey.get(tile.key)),
                )
              : source,
          );
          metric.meshBuildCpuMs += now() - buildStart;
          metric.rebuiltChunks++;
        }
        const retired = fog ? cache.projected : null;
        if (fog) {
          cache.projected = record;
          cache.signature = signature;
        } else cache.plain = record;
        const commitStart = now();
        commit(id, record);
        metric.commitCpuMs += now() - commitStart;
        changedRecords.add(record);
        if (retired && retired !== record) disposeRecord(retired);
        count++;
      } while (index < jobs.length && count < maxChunks && now() - sliceStart < budgetMs);
      metric.frames.push(frame());
      let firstActual = false;
      if (metric.firstVisibleChangedMs === null) {
        const actual = [...visibleRecords].find((record) => changedRecords.has(record));
        if (actual) {
          metric.firstVisibleChangedMs = now() - start;
          metric.firstVisibleChangedChunk = actual.chunkId;
          firstActual = true;
        }
      }
      metric.slices.push(now() - sliceStart);
      if (firstActual && verification) await hooksScreenshot(`progress-${captureIndex++}`);
      batches++;
      hooks.afterBatch?.({ batches, metric });
    }
    if (token !== epoch || disposed) return cancelled();
    const finalStart = now();
    const lightRole = fog ? 'projected' : 'plain';
    const signature = fog
      ? [.../** @type {import('./types.js').FogStates} */ (states).values()].join('|')
      : 'source';
    let lighting = lightingCache[lightRole];
    if (!lighting || lighting.signature !== signature) {
      const entries = [...shown.values()].flatMap((record) => record.lightSources);
      const record = lights.build(entries, targetLayout, { artStyle: activeStyle });
      if (lighting) lights.release(lighting.record);
      lighting = lightingCache[lightRole] = { signature, record };
    }
    lights.show(lighting.record);
    metric.featureBuildCpuMs = now() - finalStart;
    metric.frames.push(frame());
    metric.slices.push(now() - finalStart);
    metric.allChunksRenderReturnMs = now() - start;
    await raf();
    await raf();
    if (token !== epoch || disposed) metric.cancelled = true;
    metric.allChunksTwoRafMs = now() - start;
    metric.longestSliceMs = Math.max(...metric.slices);
    metric.draw = /** @type {import('./types.js').FrameMetric} */ (metric.frames.at(-1)).draw;
    metric.displayed = geometryStats([...shown.values()].map((record) => record.root));
    metric.retained = geometryStats(
      [...caches.values()]
        .flatMap((cache) =>
          [cache.plain, cache.projected].filter(
            /** @returns {record is import('./types.js').ChunkRecord} */ (record) =>
              Boolean(record),
          ),
        )
        .map((record) => record.root),
    );
    metric.sceneObjects = geometryStats([scene]).objects;
    metric.retainedRecords = [...caches.values()].reduce(
      (n, cache) => n + Number(!!cache.plain) + Number(!!cache.projected),
      0,
    );
    return metric;
  }
  /** @param {import('./types.js').World} nextWorld
   * @param {import('./types.js').Tile[]} nextLayout
   * @param {import('./types.js').ArtStyle} nextStyle
   */
  function reset(nextWorld, nextLayout, nextStyle) {
    ++epoch;
    for (const id of chunks.keys()) commit(id, null);
    clearLighting();
    for (const role of /** @type {const} */ (['plain', 'projected'])) {
      if (lightingCache[role]) lights.release(lightingCache[role].record);
      lightingCache[role] = null;
    }
    for (const cache of caches.values()) {
      disposeRecord(cache.plain);
      disposeRecord(cache.projected);
    }
    caches.clear();
    world = nextWorld;
    layout = nextLayout;
    activeStyle = nextStyle;
    const nextChunks = partition(layout, result.chunkSize);
    if ([...nextChunks.keys()].join('|') !== [...chunks.keys()].join('|'))
      throw new Error('Footprint changes require a fresh harness root');
    chunks = nextChunks;
  }
  window.spike.transition = transition;
  window.spike.reset = (nextStyle = activeStyle) => reset(world, layout, nextStyle);
  window.spike.replaceSource = (nextWorld, nextLayout, nextStyle = activeStyle) =>
    reset(nextWorld, nextLayout, nextStyle);
  window.spike.dispose = () => {
    if (disposed) return;
    reset(world, layout, activeStyle);
    disposed = true;
    driver.unmount?.();
    scene.clear();
    lights.dispose();
    daylight.dispose();
    palette.dispose();
    floor.geometry.dispose();
    floor.material.dispose();
    renderer.dispose();
  };
  result.chunks = chunks.size;
  result.phases.fogEntry = await transition(true);
  await hooksScreenshot('before-cold');
  result.phases.coldFogOff = await transition(false);
  await hooksScreenshot('full');
  result.phases.warmFogOn = await transition(true);
  result.phases.warmFogOff = await transition(false);
  result.phases.restoreFog = await transition(true);
  const expanded = { ...visits, [next.key]: { visited: true } };
  result.phases.singleVisit = await transition(true, expanded);
  await hooksScreenshot('single-visit');
  result.phases.beforeCancel = await transition(true, visits);
  /** @type {Promise<import('./types.js').TransitionMetric> | undefined} */
  let replacement;
  result.phases.cancelledReveal = await transition(true, expanded, {
    afterBatch({ batches }) {
      if (batches === 1) replacement = transition(true, visits);
    },
  });
  result.phases.cancelReplacement = await replacement;
  if (!result.phases.cancelledReveal.cancelled) throw new Error('Cancellation was not observed');
  result.phases.finalFull = await transition(false);
  result.steadyFrames = [];
  for (let i = 0; i < 12; i++) {
    await raf();
    result.steadyFrames.push(frame());
  }
  result.topology = geometryStats([...shown.values()].map((record) => record.root));
  result.reactChunkRenders = driver.diagnostics();
  result.lightSources = [...shown.values()].reduce(
    (n, record) => n + record.lightSources.length,
    0,
  );
  result.rendererMemory = { ...renderer.info.memory };
  result.resources = performance
    .getEntriesByType('resource')
    .map((entry) => /** @type {PerformanceResourceTiming} */ (entry))
    .filter((e) => e.initiatorType === 'script')
    .map((e) => ({
      name: e.name,
      duration: e.duration,
      transferSize: e.transferSize,
      encodedBodySize: e.encodedBodySize,
    }));
  if (
    renderer.outputColorSpace !== THREE.SRGBColorSpace ||
    renderer.toneMapping !== THREE.NoToneMapping ||
    renderer.shadowMap.type !== THREE.PCFSoftShadowMap ||
    camera.left !== -32 ||
    camera.right !== 32
  )
    throw new Error('Settings drift');
  return /** @type {import('./types.js').CompletedRunResult} */ (result);
  /** @param {string} name */
  async function hooksScreenshot(name) {
    if (verification && window.captureSpike) await window.captureSpike(name);
  }
}
window.spike = { run };
/** @type {HTMLButtonElement} */ (document.querySelector('#run')).onclick = async () => {
  /** @type {HTMLButtonElement} */ (document.querySelector('#run')).disabled = true;
  try {
    /** @type {HTMLElement} */ (document.querySelector('#out')).textContent = JSON.stringify(
      await run({
        mode: /** @type {import('./types.js').Mode} */ (
          /** @type {HTMLSelectElement} */ (document.querySelector('#mode')).value
        ),
        style: /** @type {import('./types.js').ArtStyle} */ (
          /** @type {HTMLSelectElement} */ (document.querySelector('#style')).value
        ),
        chunkSize: Number(/** @type {HTMLSelectElement} */ (document.querySelector('#size')).value),
      }),
      null,
      2,
    );
  } catch (error) {
    /** @type {HTMLElement} */ (document.querySelector('#out')).textContent =
      /** @type {string} */ (/** @type {Error} */ (error).stack);
    throw error;
  }
};
