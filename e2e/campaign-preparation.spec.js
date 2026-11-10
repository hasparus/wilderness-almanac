// @ts-check
import { test, expect, campaign } from './fixtures.js';
import { campaignMapBackground, campaignUITheme } from '../src/ui/campaign-theme.js';

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
      await expect(page.locator('#hp-loading')).toHaveText('Loading campaign map…');
      await expect(page.locator('#hp-loading svg')).toBeVisible();
      expect(await workspace.evaluate((element) => element.style.getPropertyValue('--hp-bg'))).toBe(
        campaignUITheme(campaign.colors).bg,
      );
      expect(
        await workspace.evaluate((element) => element.style.getPropertyValue('--hp-map-bg')),
      ).toBe(campaignMapBackground(campaign.colors));
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

for (const scheme of ['dark', 'light']) {
  test(`${scheme} entry fills the skeleton while keeping the canvas transparent`, async ({
    page,
  }) => {
    await page.addInitScript((theme) => localStorage.setItem('wilderness-theme', theme), scheme);
    await page.route(/\/src\/rendering\/map-renderer\.js(?:\?.*)?$/, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const anchor = 'builds.afterRender?.(performance.now());';
      expect(body.split(anchor)).toHaveLength(2);
      await route.fulfill({
        response,
        body: body.replace(
          anchor,
          `${anchor}
        if (hasLoadingBackdrop) {
          const frames = window.__backdropFrames ??= {};
          const state = renderer.domElement.dataset.renderState;
          if (!frames[state] && (state === 'ready' ||
              (state === 'building' && builds.active()?.map.root.children.length))) {
            const gl = renderer.getContext();
            const pixel = new Uint8Array(4);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            frames[state] = {
              alpha: pixel[3],
              gridVisible: !loading.hidden && getComputedStyle(loading).visibility !== 'hidden',
              transparent: scene.background === null,
              clearAlpha: renderer.getClearAlpha(),
              background: host.closest('#campaign-workspace').style.getPropertyValue('--hp-map-bg'),
            };
          }
        }
      `,
        ),
      });
    });
    await page.goto('/campaign/test-campaign');
    const canvas = page.getByRole('img', { name: /^Interactive isometric hex map/ });
    await expect(canvas).toHaveAttribute('data-render-state', 'ready');
    await expect(page.locator('#hp-loading')).toBeHidden();
    const frames = await page.evaluate(() => Reflect.get(window, '__backdropFrames'));
    const background = campaignMapBackground(campaign.colors, 'day', scheme);
    expect(frames.building).toEqual({
      alpha: 0,
      gridVisible: true,
      transparent: true,
      clearAlpha: 0,
      background,
    });
    expect(frames.ready.transparent).toBe(true);
    expect(frames.ready.clearAlpha).toBe(0);
    expect(frames.ready.background).toBe(background);
    const exported = await page.evaluate(async (background) => {
      const { createCampaignMapRenderer } = await import('../src/ui/map-view.js');
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;width:64px;height:64px;opacity:0;pointer-events:none';
      document.body.append(host);
      const map = createCampaignMapRenderer(host, { motion: false, background });
      if (!map) throw new Error('Missing snapshot renderer');
      try {
        map.setMap([]);
        const png = map.snapshot();
        const canvas = host.querySelector('canvas');
        const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
        if (!canvas || !gl) throw new Error('Missing live context');
        const live = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, live);
        const image = new Image();
        image.src = png;
        await image.decode();
        const copy = document.createElement('canvas');
        copy.width = image.width;
        copy.height = image.height;
        const context = copy.getContext('2d');
        if (!context) throw new Error('Missing snapshot context');
        context.drawImage(image, 0, 0);
        return {
          liveAlpha: live[3],
          pixel: [...context.getImageData(0, 0, 1, 1).data],
          sameSize: image.width === canvas.width && image.height === canvas.height,
        };
      } finally {
        map.dispose();
        host.remove();
      }
    }, background);
    expect(exported.liveAlpha).toBe(0);
    expect(exported.sameSize).toBe(true);
    expect(exported.pixel).toEqual([
      ...[1, 3, 5].map((offset) => parseInt(background.slice(offset, offset + 2), 16)),
      255,
    ]);
  });
}
