// @ts-check
/**
 * Harness-facing views of unchecked production data. Extra world, tile and
 * lighting payload fields are passed through untouched; this is not a migration
 * of the generator or mesh builders.
 *
 * @typedef {'monolithic' | 'native' | 'fiber' | 'fiber-retained'} Mode
 * @typedef {'low-poly' | 'pixelart'} ArtStyle
 * @typedef {'visited' | 'unvisited' | 'undiscovered'} FogState
 * @typedef {{key: string, q: number, r: number, water?: string | null}} WorldCell
 * @typedef {{cells: WorldCell[]}} World
 * @typedef {WorldCell & {wx: number, wz: number, top: number, props: {kind: string, angle: number}[]}} Tile
 * @typedef {Map<string, FogState>} FogStates
 * @typedef {Record<string, {visited: boolean}>} Visits
 * @typedef {{root: import('three').Group, cells: unknown[], lightSources: unknown[], wave: import('three').Vector2 | null}} MeshRecord
 * @typedef {MeshRecord & {chunkId: string}} ChunkRecord
 * @typedef {{source: Tile[], plain: ChunkRecord | null, projected: ChunkRecord | null, signature: string | null}} ChunkCache
 * @typedef {{id: string, source: Tile[], cache: ChunkCache, signature: string, cached: ChunkRecord | null}} Job
 * @typedef {{set: (id: string, record: ChunkRecord | null) => void, frame: (time: number) => void, diagnostics: () => Record<string, number> | null, unmount?: () => void}} Driver
 * @typedef {{id: string, value: ChunkRecord | null, renders: number, subscribe: (fn: () => void) => () => void, snapshot: () => ChunkRecord | null, set: (value: ChunkRecord | null) => void}} ChunkStore
 * @typedef {{ids: string[], canvas: HTMLCanvasElement, renderer: import('three').WebGLRenderer, camera: import('three').OrthographicCamera, scene: import('three').Scene, width: number, height: number, dpr: number, renderFrame: () => void, retainedTrees?: boolean}} FiberOptions
 * @typedef {{objects: number, meshes: number, vertices: number, triangles: number, attributeBytes: number}} GeometryStats
 * @typedef {{frame: number, calls: number, triangles: number, points: number, lines: number}} DrawStats
 * @typedef {{frameCpuMs: number, renderCpuMs: number, draw: DrawStats}} FrameMetric
 * @typedef {object} TransitionMetric
 * @property {number} rebuiltChunks
 * @property {number} reusedChunks
 * @property {number} unchangedChunks
 * @property {number} changedChunks
 * @property {number} concealedChunks
 * @property {number} meshBuildCpuMs
 * @property {number} commitCpuMs
 * @property {number} featureBuildCpuMs
 * @property {number} preprocessingCpuMs
 * @property {number[]} slices
 * @property {FrameMetric[]} frames
 * @property {number | null} firstVisibleChangedMs
 * @property {string | null} firstVisibleChangedChunk
 * @property {boolean} cancelled
 * @property {FrameMetric} [concealFrame]
 * @property {number} [elapsedMs]
 * @property {number} [longestSliceMs]
 * @property {number} [unstartedChunks]
 * @property {number} [allChunksRenderReturnMs]
 * @property {number} [allChunksTwoRafMs]
 * @property {DrawStats} [draw]
 * @property {GeometryStats} [displayed]
 * @property {GeometryStats} [retained]
 * @property {number} [sceneObjects]
 * @property {number} [retainedRecords]
 *
 * @typedef {{afterBatch?: (batch: {batches: number, metric: TransitionMetric}) => void}} TransitionHooks
 * @typedef {(fog: boolean, visits?: Visits, hooks?: TransitionHooks) => Promise<TransitionMetric>} Transition
 * @typedef {{mode?: Mode, style?: ArtStyle, seed?: string, chunkSize?: number, budgetMs?: number, maxChunks?: number, dpr?: number, verification?: boolean, visitRadius?: number}} RunOptions
 * @typedef {object} RunResult
 * @property {Mode} mode
 * @property {ArtStyle} style
 * @property {string} seed
 * @property {number} visitRadius
 * @property {boolean} verification
 * @property {boolean} timingValid
 * @property {number} chunkSize
 * @property {number} budgetMs
 * @property {number} maxChunks
 * @property {string} threeRevision
 * @property {string} protocol
 * @property {Record<string, TransitionMetric | undefined>} phases
 * @property {number} [importMs]
 * @property {number} [generationAndPartitionMs]
 * @property {number} [initialVisitedCount]
 * @property {string} [visited]
 * @property {string} [reveal]
 * @property {unknown} [gpu] WebGL's vendor-defined renderer string.
 * @property {number} [chunks]
 * @property {FrameMetric[]} [steadyFrames]
 * @property {GeometryStats} [topology]
 * @property {Record<string, number> | null} [reactChunkRenders]
 * @property {number} [lightSources]
 * @property {{geometries: number, textures: number}} [rendererMemory]
 * @property {{name: string, duration: number, transferSize: number, encodedBodySize: number}[]} [resources]
 *
 * @typedef {TransitionMetric & {draw: DrawStats, displayed: GeometryStats, retained: GeometryStats, allChunksTwoRafMs: number}} CompletedMetric
 * @typedef {'fogEntry' | 'coldFogOff' | 'warmFogOn' | 'warmFogOff' | 'restoreFog' | 'singleVisit' | 'beforeCancel' | 'finalFull'} CompletedPhase
 * @typedef {RunResult & {topology: GeometryStats, phases: Record<CompletedPhase, CompletedMetric> & {cancelledReveal: TransitionMetric, cancelReplacement: TransitionMetric | undefined}}} CompletedRunResult
 * @typedef {{run: (options?: RunOptions) => Promise<CompletedRunResult>, transition?: Transition, reset?: (style?: ArtStyle) => void, replaceSource?: (world: World, layout: Tile[], style?: ArtStyle) => void, dispose?: () => void}} Spike
 * @typedef {CompletedRunResult & {versions: Record<string, string>, round: number, warmup: boolean, browser: string, args: string[], warnings: string[]}} Trial
 */
export {};
