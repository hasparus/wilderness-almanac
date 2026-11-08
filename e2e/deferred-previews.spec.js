// @ts-check
import { test, expect, revealInspector } from './fixtures.js';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {{id: number, key: string, ran: boolean, cancelled: boolean}} Job */
/** @typedef {{kind: string, key: string | null, job: string | null, src: string, ready: boolean, state: string | null, loading: boolean, hidden: boolean}} Preview */
/**
 * @typedef {object} Probe
 * @property {boolean} holdBuilds
 * @property {Map<number, FrameRequestCallback>} held
 * @property {Job[]} jobs
 * @property {Preview[]} calls
 * @property {string | null} currentJob
 * @property {(callback: FrameRequestCallback) => number} schedule
 * @property {(handle: number) => void} cancel
 * @property {() => void} release
 * @property {(kind: string, key: string | null, src: string) => string} record
 */
/** @typedef {typeof window & { __deferredPreviewProbe: Probe }} ProbeWindow */

/**
 * Source-served only: assert each instrumentation anchor before replacing it.
 * The preview wrappers return the original strings unchanged, so neither image
 * identity nor the real thumbnail cache is contaminated by test markers.
 * Only chunk scheduling is held; no readiness attributes or queue predicates
 * are replaced. Optional jobs still use the application's idle scheduler.
 * @param {Page} page
 */
async function instrument(page) {
  const source = await page.request.get('/src/ui/map-view.js');
  test.skip(
    !source.ok() || !source.headers()['content-type']?.includes('javascript'),
    'Route instrumentation requires the source-served workspace, not a production bundle.',
  );
  await page.addInitScript(() => {
    const nativeFrame = window.requestAnimationFrame.bind(window);
    const nativeCancel = window.cancelAnimationFrame.bind(window);
    /** @type {Probe} */
    const probe = {
      holdBuilds: true,
      held: new Map(),
      jobs: [],
      calls: [],
      currentJob: null,
      schedule(callback) {
        const handle = nativeFrame((time) => {
          if (probe.holdBuilds) probe.held.set(handle, callback);
          else callback(time);
        });
        return handle;
      },
      cancel(handle) {
        nativeCancel(handle);
        probe.held.delete(handle);
      },
      release() {
        probe.holdBuilds = false;
        for (const callback of probe.held.values()) nativeFrame(callback);
        probe.held.clear();
      },
      record(kind, key, src) {
        const workspace = document.querySelector('#campaign-workspace');
        const hidden = !(workspace instanceof HTMLElement) || workspace.hidden;
        const loading = workspace?.hasAttribute('data-loading') ?? true;
        const state =
          document.querySelector('#hp-scene canvas')?.getAttribute('data-render-state') ?? null;
        probe.calls.push({
          kind,
          key,
          job: probe.currentJob,
          src,
          state,
          loading,
          hidden,
          ready: !hidden && !loading && state === 'ready',
        });
        return src;
      },
    };
    /** @type {ProbeWindow} */ (window).__deferredPreviewProbe = probe;
  });
  /** @type {Record<string, Array<[string, string]>>} */
  const replacements = {
    'rendering/incremental-builds': [
      [
        'schedule = requestAnimationFrame,',
        'schedule = (callback) => window.__deferredPreviewProbe.schedule(callback),',
      ],
      [
        'cancel = cancelAnimationFrame,',
        'cancel = (handle) => window.__deferredPreviewProbe.cancel(handle),',
      ],
    ],
    'ui/deferred-map-work': [
      [
        'function enqueue(key, run) {',
        `function enqueue(key, run) {
        const probe = window.__deferredPreviewProbe;
        const job = { id: probe.jobs.length, key, ran: false, cancelled: false };
        probe.jobs.push(job);
        const originalRun = run;
        run = () => {
          job.ran = true;
          probe.currentJob = key;
          try { return originalRun(); } finally { probe.currentJob = null; }
        };`,
      ],
      [
        'cancel: () => resolve(undefined),',
        'cancel: () => { job.cancelled = true; resolve(undefined); },',
      ],
    ],
    'ui/map-view': [
      [
        'export { tilePreview, partyPreview, disposeTilePreview } from "/src/ui/tile-preview.js";',
        `import { tilePreview as realTilePreview, partyPreview as realPartyPreview } from './tile-preview.js';
      export { disposeTilePreview } from './tile-preview.js';
      export function tilePreview(...args) {
        return window.__deferredPreviewProbe.record('tile', args[0]?.key ?? null, realTilePreview(...args));
      }
      export function partyPreview(...args) {
        return window.__deferredPreviewProbe.record('party', null, realPartyPreview(...args));
      }`,
      ],
    ],
  };
  for (const [module, edits] of Object.entries(replacements)) {
    await page.route(new RegExp(`/src/${module}\\.js(?:\\?.*)?$`), async (route) => {
      const response = await route.fetch();
      expect(response.ok(), module).toBe(true);
      let body = await response.text();
      for (const [before, after] of edits) {
        expect(body.split(before).length, `${module}: unique instrumentation anchor`).toBe(2);
        body = body.replace(before, after);
      }
      await route.fulfill({ response, body });
    });
  }
}

/** @param {Page} page */
async function state(page) {
  return page.evaluate(() => {
    const probe = /** @type {ProbeWindow} */ (window).__deferredPreviewProbe;
    return { jobs: probe.jobs, calls: probe.calls, held: probe.held.size };
  });
}
/** @param {Page} page */
async function release(page) {
  await page.evaluate(() => /** @type {ProbeWindow} */ (window).__deferredPreviewProbe.release());
}
/** @param {Page} page */
async function expectBuilding(page) {
  await expect(page.getByRole('region', { name: 'Campaign workspace' })).not.toHaveAttribute(
    'data-loading',
  );
  await expect(page.locator('#hp-scene canvas')).toHaveAttribute('data-render-state', 'building');
  await expect.poll(async () => (await state(page)).held).toBeGreaterThan(0);
  expect((await state(page)).calls).toEqual([]);
}
/** @param {Page} page @param {string} key */
async function selectPending(page, key) {
  const before = (await state(page)).jobs.length;
  await page.getByRole('combobox', { name: 'Select hex or party' }).selectOption(key);
  await revealInspector(page);
  await expect
    .poll(async () =>
      (await state(page)).jobs.slice(before).some((job) => job.key === 'hex-inspector'),
    )
    .toBe(true);
  await expect(page.locator('#hp-hex-preview')).toBeHidden();
}
/** @param {Page} page @param {string} key */
async function expectInspectorImage(page, key) {
  const image = page.locator('#hp-hex-preview');
  await expect(image).toBeVisible();
  await expect
    .poll(async () => image.evaluate((node) => /** @type {HTMLImageElement} */ (node).naturalWidth))
    .toBeGreaterThan(0);
  const name = await page.locator('#hp-hex-name').textContent();
  await expect(image).toHaveAttribute('alt', `Isometric view of ${name}`);
  const calls = (await state(page)).calls.filter((call) => call.job === 'hex-inspector');
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.at(-1)?.key).toBe(key);
  await expect(image).toHaveAttribute('src', calls.at(-1)?.src ?? 'missing');
}
/** @param {Page} page @param {import('@playwright/test').TestInfo} info @param {string} name */
async function screenshot(page, info, name) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

test('optional previews wait for actual main-map readiness, then populate party and Inspector', async ({
  page,
}, info) => {
  await instrument(page);
  await page.goto('/campaign/test-campaign');
  await expectBuilding(page);
  await expect(
    page.getByRole('button', { name: 'Find party', exact: true }).locator('svg'),
  ).toBeVisible();
  await expect(page.locator('#hp-find-party-preview')).toBeHidden();
  await selectPending(page, '0,0');
  expect((await state(page)).jobs.some((job) => job.key === 'party-button')).toBe(true);
  expect((await state(page)).jobs.some((job) => job.key === 'gallery-start')).toBe(true);
  await page.locator('#hp-inspector-body').scrollIntoViewIfNeeded();
  await screenshot(page, info, 'previews-pending');
  expect((await state(page)).calls).toEqual([]);

  await release(page);
  await expect(page.locator('#hp-scene canvas')).toHaveAttribute('data-render-state', 'ready');
  await expect(page.locator('#hp-find-party-preview')).toBeVisible();
  await expectInspectorImage(page, '0,0');
  await screenshot(page, info, 'inspector-ready');
  await page.getByRole('button', { name: 'Find party', exact: true }).click();
  const openParty = page.getByRole('button', { name: 'Open Party', exact: true });
  if (await openParty.isVisible()) await openParty.click();
  const party = page.locator('#hp-party-preview');
  await expect(party).toBeVisible();
  await expect
    .poll(async () => party.evaluate((node) => /** @type {HTMLImageElement} */ (node).naturalWidth))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await state(page)).calls.some((call) => call.job === 'gallery-tile'))
    .toBe(true);
  const calls = (await state(page)).calls;
  expect(calls.some((call) => call.job === 'party-button')).toBe(true);
  expect(calls.some((call) => call.job === 'party-inspector')).toBe(true);
  expect(
    calls.every((call) => call.ready),
    'every synchronous preview starts after the real readiness gate',
  ).toBe(true);
  expect(
    calls.every((call) => typeof call.src === 'string' && call.src.startsWith('data:image/')),
    'preview APIs still return real image strings synchronously',
  ).toBe(true);
  await party.scrollIntoViewIfNeeded();
  await screenshot(page, info, 'party-ready');
});

test('selection and Back/reopen churn cancel obsolete preview jobs and display only the latest hex', async ({
  page,
}, info) => {
  await instrument(page);
  await page.goto('/campaign/test-campaign');
  await expectBuilding(page);
  await selectPending(page, '0,0');
  await selectPending(page, '1,0');
  const oldJobs = (await state(page)).jobs.map((job) => job.id);
  await page.getByRole('button', { name: 'Return to main menu' }).click();
  await expect(
    page.getByRole('button', { name: 'Enter Test campaign', exact: true }),
  ).toBeVisible();
  expect((await state(page)).calls).toEqual([]);
  expect(
    (await state(page)).jobs
      .filter((job) => oldJobs.includes(job.id))
      .every((job) => job.cancelled && !job.ran),
  ).toBe(true);

  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expectBuilding(page);
  await selectPending(page, '0,-1');
  await selectPending(page, '-1,0');
  const beforeRelease = await state(page);
  expect(beforeRelease.calls).toEqual([]);
  const cancelled = beforeRelease.jobs.filter((job) => job.cancelled).map((job) => job.id);
  await release(page);
  await expect(page.locator('#hp-scene canvas')).toHaveAttribute('data-render-state', 'ready');
  await expectInspectorImage(page, '-1,0');
  await expect
    .poll(async () => (await state(page)).calls.some((call) => call.job === 'gallery-tile'))
    .toBe(true);
  const after = await state(page);
  expect(after.jobs.filter((job) => cancelled.includes(job.id)).every((job) => !job.ran)).toBe(
    true,
  );
  expect(
    after.calls.filter((call) => call.job === 'hex-inspector').map((call) => call.key),
  ).toEqual(['-1,0']);
  expect(after.calls.every((call) => call.ready)).toBe(true);
  await page.locator('#hp-hex-preview').scrollIntoViewIfNeeded();
  await screenshot(page, info, 'latest-selection-after-reopen');
});

test('warm reopen hides the previous Inspector image while its replacement is queued', async ({
  page,
}, info) => {
  await instrument(page);
  await page.goto('/campaign/test-campaign');
  await expectBuilding(page);
  await selectPending(page, '0,0');
  await release(page);
  await expectInspectorImage(page, '0,0');
  const previous = await page.locator('#hp-hex-preview').getAttribute('src');
  await page.getByRole('button', { name: 'Return to main menu' }).click();
  await expect(
    page.getByRole('button', { name: 'Enter Test campaign', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    /** @type {ProbeWindow} */ (window).__deferredPreviewProbe.holdBuilds = true;
  });
  const count = (await state(page)).calls.length;
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Campaign workspace' })).not.toHaveAttribute(
    'data-loading',
  );
  await expect(page.locator('#hp-scene canvas')).toHaveAttribute('data-render-state', 'building');
  await selectPending(page, '1,0');
  await selectPending(page, '-1,0');
  expect((await state(page)).calls).toHaveLength(count);
  await page.locator('#hp-inspector-body').scrollIntoViewIfNeeded();
  await screenshot(page, info, 'warm-reopen-pending');
  await release(page);
  await expectInspectorImage(page, '-1,0');
  await expect(page.locator('#hp-hex-preview')).not.toHaveAttribute('src', previous ?? 'missing');
  const calls = (await state(page)).calls.slice(count);
  expect(calls.filter((call) => call.job === 'hex-inspector').map((call) => call.key)).toEqual([
    '-1,0',
  ]);
  expect(calls.every((call) => call.ready)).toBe(true);
  await screenshot(page, info, 'warm-reopen-ready');
});
