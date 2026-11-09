// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/generation/world.js';
import { createCampaign } from '../src/application/campaigns.js';
import { createCampaignSession } from '../src/application/campaign-session.js';
import { prepareCampaignMap } from '../src/application/prepare-campaign-map.js';
import { prepareCampaignEntry } from '../src/ui/prepare-campaign-entry.js';

const world = generateWorld('heliotest');
const campaign = createCampaign(world, ['#cdab8f', '#0b365e', '#11b329'], 'Custom');
const saved = { campaignSaved: true, preferencesSaved: true };

/** @returns {{promise: Promise<void>, resolve: () => void, reject: (error: Error) => void}} */
function gate() {
  let resolve = () => {};
  let reject = (/** @type {Error} */ _error) => {};
  const promise = new Promise((yes, no) => {
    resolve = () => yes(undefined);
    reject = no;
  });
  return { promise, resolve, reject };
}

test('data preparation runs while the renderer promise is pending, without committing a session', async () => {
  let writes = 0;
  const session = createCampaignSession({
    persist: () => {
      writes++;
      return saved;
    },
  });
  const view = gate();
  let reads = 0;
  const baseWorld = new Proxy(world, {
    get(target, key, receiver) {
      if (key === 'cells') reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  let started = false;
  let finished = false;
  const entry = prepareCampaignEntry(
    campaign,
    () => {
      started = true;
      return view.promise;
    },
    { baseWorld },
  ).then((value) => {
    finished = true;
    return value;
  });
  assert.equal(started, true);
  await Promise.resolve();
  assert.ok(reads > 0, 'generation consumed the supplied world before import completion');
  assert.equal(finished, false);
  assert.equal(session.snapshot(), undefined);
  assert.equal(writes, 0);
  view.resolve();
  const prepared = await entry;
  assert.ok(prepared);
  assert.equal(prepared.baseWorld, baseWorld);
  session.openPrepared(campaign, prepared);
  assert.equal(writes, 1);
});

test('prepared commit matches synchronous open, including initial party visit and persistence', () => {
  const a = createCampaignSession({ persist: () => saved });
  const b = createCampaignSession({ persist: () => saved });
  a.open(campaign, world);
  const before = structuredClone(campaign);
  const prepared = prepareCampaignMap(campaign, world);
  assert.deepEqual(campaign, before);
  b.openPrepared(campaign, prepared);
  assert.deepEqual(b.snapshot(), a.snapshot());
});

test('import failure leaves an existing session unchanged', async () => {
  let writes = 0;
  const session = createCampaignSession({
    persist: () => {
      writes++;
      return saved;
    },
  });
  session.open(campaign, world);
  const before = session.snapshot();
  const error = new Error('renderer unavailable');
  const next = { ...campaign, id: 'next' };
  await assert.rejects(
    prepareCampaignEntry(next, () => Promise.reject(error)),
    error,
  );
  assert.deepEqual(session.snapshot(), before);
  assert.equal(writes, 1);
});

test('preparation failure observes a later import rejection as well', async () => {
  const view = gate();
  const entry = prepareCampaignEntry({ ...campaign, generatorVersion: 0 }, () => view.promise);
  await assert.rejects(entry, /unsupported map generator version/);
  view.reject(new Error('late import failure'));
  await new Promise((resolve) => setImmediate(resolve));
});

test('disposed entries skip preparation or discard completed data without a commit', async () => {
  let active = false;
  let imports = 0;
  assert.equal(
    await prepareCampaignEntry(
      campaign,
      async () => {
        imports++;
      },
      { active: () => active },
    ),
    undefined,
  );
  assert.equal(imports, 0);
  active = true;
  const view = gate();
  const entry = prepareCampaignEntry(campaign, () => view.promise, {
    baseWorld: world,
    active: () => active,
  });
  await Promise.resolve();
  active = false;
  view.resolve();
  assert.equal(await entry, undefined);
});
