// @ts-check
import { test, expect } from './fixtures.js';

/** A test-controlled pause for the renderer module. */
function gate() {
  let resolve = () => {};
  const promise = new Promise((release) => {
    resolve = () => release(undefined);
  });
  return { promise, resolve };
}

/** @param {import('@playwright/test').Page} page @returns {Promise<number>} */
async function campaignRevision(page) {
  return page.evaluate(async () => {
    /** @type {Promise<IDBDatabase>} */
    const opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('wilderness-almanac:campaigns', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const db = await opening;
    try {
      /** @type {Promise<number>} */
      const reading = new Promise((resolve, reject) => {
        const request = db.transaction('campaigns').objectStore('campaigns').get('test-campaign');
        request.onsuccess = () => resolve(request.result.revision);
        request.onerror = () => reject(request.error);
      });
      return await reading;
    } finally {
      db.close();
    }
  });
}

for (const entry of ['direct', 'menu']) {
  test(`${entry} entry prepares data during renderer loading and commits only after success`, async ({
    page,
  }) => {
    const source = await page.request.get('/src/application/prepare-campaign-map.js');
    test.skip(
      !source.ok() || !source.headers()['content-type']?.includes('javascript'),
      'Requires source-served instrumentation.',
    );
    const loading = gate();
    const requested = gate();
    let requests = 0;
    await page.addInitScript(() => {
      /** @type {Window & {preparedMaps?: number}} */ (window).preparedMaps = 0;
    });
    await page.route(/\/src\/application\/prepare-campaign-map\.js(?:\?.*)?$/, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const anchor = 'return { baseWorld, world, dressing };';
      expect(body.split(anchor)).toHaveLength(2);
      await route.fulfill({
        response,
        body: body.replace(anchor, `window.preparedMaps++; ${anchor}`),
      });
    });
    await page.route(/\/src\/ui\/map-view\.js(?:\?.*)?$/, async (route) => {
      requests++;
      if (requests > 1) return route.continue();
      requested.resolve();
      await loading.promise;
      await route.abort();
    });
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(entry === 'direct' ? '/campaign/test-campaign' : '/');
    if (entry === 'menu')
      await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
    const workspace = page.getByRole('region', { name: 'Campaign workspace' });
    try {
      await requested.promise;
      await expect
        .poll(() =>
          page.evaluate(
            () => /** @type {Window & {preparedMaps?: number}} */ (window).preparedMaps,
          ),
        )
        .toBe(1);
      await expect(workspace).toBeVisible();
      await expect(workspace.getByText('Preparing the landscape…', { exact: true })).toBeVisible();
      await expect(page.locator('#hp-scene canvas')).toHaveCount(0);
      expect(await campaignRevision(page)).toBe(1);
    } finally {
      loading.resolve();
    }
    await expect(
      page.getByRole('button', { name: 'Enter Test campaign', exact: true }),
    ).toBeVisible();
    expect(await campaignRevision(page)).toBe(1);
    await page.goto('/');
    await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
    await expect(page.locator('#hp-scene canvas')).toHaveAttribute('data-render-state', 'ready');
    await expect(workspace).not.toHaveAttribute('aria-busy');
    await expect.poll(() => campaignRevision(page)).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });
}
