// @ts-check
import { DIRECTIONS } from '../generation/hex.js';

/** @typedef {{key: string, q: number, r: number, fogState?: string}} ChunkTile */
/** @template T @typedef {{id: string, record: T}} ChunkEntry */
/** @template T @typedef {{signature: string, record: T}} CachedChunk */
/**
 * @template {ChunkTile} Tile
 * @template Record
 * @typedef {object} IncrementalOptions
 * @property {(tiles: Tile[], style: string) => Record} build
 * @property {(entries: ChunkEntry<Record>[], layout: Tile[], pending: boolean) => void} show
 * @property {(record: Record) => void} release
 * @property {(tiles: Tile[]) => number} [priority]
 * @property {(callback: FrameRequestCallback) => number} [schedule]
 * @property {(handle: number) => void} [cancel]
 * @property {() => number} [now]
 * @property {number} [budgetMs]
 */

/** @template {ChunkTile} T @param {T[]} layout @returns {Map<string, T[]>} */
export function partitionChunks(layout) {
  /** @type {Map<string, T[]>} */
  const chunks = new Map();
  for (const tile of layout) {
    const id = `${Math.floor(tile.q / 4)},${Math.floor(tile.r / 4)}`;
    const chunk = chunks.get(id) ?? [];
    chunk.push(tile);
    chunks.set(id, chunk);
  }
  return chunks;
}

/**
 * Fog geometry also depends on neighboring visibility at chunk boundaries.
 * @param {ChunkTile[]} tiles
 * @param {Map<string, string | undefined>} states
 * @returns {string}
 */
export function chunkSignature(tiles, states) {
  return tiles
    .map(
      (tile) =>
        `${states.get(tile.key)}:${DIRECTIONS.reduce(
          (mask, [q, r], i) =>
            mask | (states.get(`${tile.q + q},${tile.r + r}`) !== 'undiscovered' ? 1 << i : 0),
          0,
        )}`,
    )
    .join('|');
}

/**
 * Owns at most a source and latest fog record per axial 4×4 chunk. Builders run
 * outside React; a bounded RAF slice publishes retained objects to scene owners.
 * @template {ChunkTile} Tile
 * @template Record
 * @param {IncrementalOptions<Tile, Record>} options
 */
export function createIncrementalBuilds({
  build,
  show,
  release,
  priority = () => 0,
  schedule = requestAnimationFrame,
  cancel = cancelAnimationFrame,
  now = () => performance.now(),
  budgetMs = 8,
}) {
  /** @type {Map<string, {tiles: Tile[], source?: CachedChunk<Record>, fog?: CachedChunk<Record>}>} */
  const caches = new Map();
  /** @type {Map<string, Record>} */
  const displayed = new Map();
  /** @type {Tile[] | undefined} */
  let origin;
  /** @type {Tile[]} */
  let target = [];
  let style = '',
    frame = 0,
    epoch = 0;
  /** @type {Array<{id: string, tiles: Tile[], signature: string, role: 'source' | 'fog'}>} */
  let jobs = [];

  /** Publish one atomic batch, including synchronous concealment. @returns {void} */
  function publish() {
    show(
      [...displayed].map(([id, record]) => ({ id, record })),
      target,
      jobs.length > 0,
    );
  }
  /** Cancel stale work before releasing any record it could reference. @returns {void} */
  function clear() {
    epoch++;
    cancel(frame);
    frame = 0;
    jobs = [];
    displayed.clear();
    target = [];
    publish();
    for (const cache of caches.values()) {
      if (cache.source) release(cache.source.record);
      if (cache.fog) release(cache.fog.record);
    }
    caches.clear();
    origin = undefined;
  }
  /** @param {number} revision @returns {void} */
  function slice(revision) {
    if (revision !== epoch) return;
    frame = 0;
    const start = now();
    /** @type {Record[]} */
    const retired = [];
    do {
      const job = jobs.shift();
      if (!job) break;
      const cache = caches.get(job.id);
      if (!cache) throw new Error('Missing incremental chunk cache');
      const record = build(job.tiles, style);
      const previous = cache[job.role];
      cache[job.role] = { signature: job.signature, record };
      displayed.set(job.id, record);
      if (previous) retired.push(previous.record);
    } while (jobs.length && now() - start < budgetMs);
    publish();
    for (const record of retired) release(record);
    if (jobs.length) frame = schedule(() => slice(revision));
  }
  return {
    clear,
    /** Finish pending work for explicit snapshots, never for ordinary input. @returns {void} */
    flush() {
      cancel(frame);
      frame = 0;
      while (jobs.length) {
        slice(epoch);
        cancel(frame);
        frame = 0;
      }
    },
    /** @param {Tile[]} layout @param {Tile[]} source @param {string} nextStyle @returns {void} */
    show(layout, source, nextStyle) {
      if (source !== origin || nextStyle !== style) {
        clear();
        origin = source;
        style = nextStyle;
        for (const [id, tiles] of partitionChunks(source)) caches.set(id, { tiles });
      }
      cancel(frame);
      frame = 0;
      const revision = ++epoch;
      target = layout;
      jobs = [];
      const projected = layout !== source;
      const role = projected ? 'fog' : 'source';
      const byKey = new Map(layout.map((tile) => [tile.key, tile]));
      const states = new Map(layout.map((tile) => [tile.key, tile.fogState]));
      for (const [id, cache] of caches) {
        const signature = projected ? chunkSignature(cache.tiles, states) : 'source';
        const cached = cache[role];
        if (cached?.signature === signature) displayed.set(id, cached.record);
        else {
          const tiles = cache.tiles.map((tile) => {
            const projectedTile = byKey.get(tile.key);
            if (!projectedTile) throw new Error(`Missing projected tile ${tile.key}`);
            return projectedTile;
          });
          jobs.push({ id, tiles, signature, role });
          if (projected) displayed.delete(id);
        }
      }
      jobs.sort((a, b) => priority(a.tiles) - priority(b.tiles));
      publish();
      if (jobs.length) frame = schedule(() => slice(revision));
    },
  };
}
