// @ts-check
import { prepareCampaignMap } from '../application/prepare-campaign-map.js';

/**
 * Start the renderer import before synchronous data preparation. Call only after
 * the workspace has had a paint opportunity. Import fetching can overlap CPU
 * work; this does not move generation off the main thread.
 *
 * Observe both failures immediately and leave session commit to the caller, so
 * a failed import or disposed entry cannot save a half-open campaign.
 * @param {import('../application/prepare-campaign-map.js').CampaignMapInput} campaign
 * @param {() => Promise<unknown>} loadView
 * @param {{baseWorld?: ReturnType<typeof import('../generation/world.js').generateWorld>, active?: () => boolean}} [options]
 */
export async function prepareCampaignEntry(
  campaign,
  loadView,
  { baseWorld, active = () => true } = {},
) {
  if (!active()) return undefined;
  const [, prepared] = await Promise.all([
    loadView(),
    Promise.resolve().then(() => (active() ? prepareCampaignMap(campaign, baseWorld) : undefined)),
  ]);
  return active() ? prepared : undefined;
}
