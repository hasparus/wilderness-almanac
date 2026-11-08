// @ts-check
import { riverSurface } from './river-surfaces.js';

/**
 * Capture only triangulation inputs, never a cell or its world.
 * @typedef {Pick<Parameters<typeof riverSurface>[0], 'wx' | 'wz' | 'river' | 'riverCorners' | 'bankBevel' | 'clipWater'>} RiverSurfaceInput
 * @typedef {ReturnType<typeof riverSurface>} RiverSurface
 * @typedef {{kind: 'deferred-river-surface', input: RiverSurfaceInput}} DeferredRiverSurface
 */

/** @type {WeakMap<DeferredRiverSurface, RiverSurface>} */
const surfaces = new WeakMap();

/**
 * A plain, cloneable descriptor owns its numeric inputs. Later preview recentering
 * or metadata edits cannot change the world-space field sampled on first use.
 * @param {RiverSurfaceInput} cell
 * @returns {DeferredRiverSurface}
 */
export function deferRiverSurface({ wx, wz, river, riverCorners, bankBevel, clipWater }) {
  return {
    kind: 'deferred-river-surface',
    input: structuredClone({ wx, wz, river, riverCorners, bankBevel, clipWater }),
  };
}

/**
 * Realize the exact existing triangulation once per descriptor. Shallow source,
 * fog and renderer metadata copies share the cache without mutating any input.
 * Weak keys allow retired maps and their computed surfaces to be collected.
 * @param {RiverSurface | DeferredRiverSurface | null | undefined} surface
 * @returns {RiverSurface | null | undefined}
 */
export function resolveRiverSurface(surface) {
  if (!surface || !isDeferredRiverSurface(surface)) return surface;
  let resolved = surfaces.get(surface);
  if (!resolved) {
    resolved = riverSurface(surface.input);
    surfaces.set(surface, resolved);
  }
  return resolved;
}

/**
 * @param {RiverSurface | DeferredRiverSurface} surface
 * @returns {surface is DeferredRiverSurface}
 */
function isDeferredRiverSurface(surface) {
  return 'kind' in surface && surface.kind === 'deferred-river-surface';
}
