// @ts-check
import { generateWorld } from '../generation/world.js';
import { campaignWorld, campaignDressing } from '../generation/campaign-world.js';

/**
 * @typedef {object} CampaignMapInput
 * @property {string} seed
 * @property {number} generatorVersion
 * @property {number} variant
 * @property {NonNullable<Parameters<typeof generateWorld>[1]>['preferences']} [preferences]
 * @property {ReturnType<typeof import('../generation/hex-edits.js').validateHexEdits>} [hexEdits]
 */

/**
 * Prepare deterministic data without changing a session or writing persistence.
 * A supplied base world can be reused when a replay link just generated it.
 * @param {CampaignMapInput} campaign
 * @param {ReturnType<typeof generateWorld>} [baseWorld]
 */
export function prepareCampaignMap(
  campaign,
  baseWorld = generateWorld(campaign.seed, {
    preferences: campaign.preferences,
    generatorVersion: campaign.generatorVersion,
  }),
) {
  const world = campaignWorld(campaign, baseWorld);
  const dressing = campaignDressing(campaign, world);
  return { baseWorld, world, dressing };
}
