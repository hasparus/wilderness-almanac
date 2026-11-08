// @ts-check
import { createMapRenderer } from '../rendering/map-renderer.js';
import { createIncrementalMapBuilds } from '../rendering/incremental-map-builds.js';

export { createMapRenderer };

/**
 * Campaign scenes use retained incremental chunks; still previews stay synchronous.
 * @param {Parameters<typeof createMapRenderer>[0]} host
 * @param {Parameters<typeof createMapRenderer>[1]} [options]
 */
export function createCampaignMapRenderer(host, options) {
  return createMapRenderer(host, { ...options, createBuilds: createIncrementalMapBuilds });
}
export { tilePreview, partyPreview, disposeTilePreview } from './tile-preview.js';
export { partyColor } from '../rendering/party-color.js';
