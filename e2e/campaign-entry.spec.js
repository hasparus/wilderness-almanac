// @ts-check
import { test, expect } from './fixtures.js';
import { CAMPAIGN_HEXES_WIDE } from '../src/map-framing.js';

test.use({ reducedMotion: 'no-preference' });

/** A test-controlled pause for the lazy module request. */
function gate() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
  const promise = new Promise((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

test('direct campaign URLs start in the workspace rather than flashing the library', async ({
  page,
}) => {
  const script = gate(),
    module = gate(),
    requested = gate();
  await page.route(/\/(?:src\/main|assets\/app-[^/]+)\.js(?:\?.*)?$/, async (route) => {
    await script.promise;
    await route.continue();
  });
  await page.route(
    /\/(?:assets\/map-view-[^/]+|src\/ui\/map-view)\.js(?:\?.*)?$/,
    async (route) => {
      requested.resolve();
      await module.promise;
      await route.continue();
    },
  );
  const navigating = page.goto('/campaign/test-campaign', { waitUntil: 'commit' });
  try {
    await navigating;
    await page.locator('#campaign-menu').waitFor({ state: 'attached' });
    await expect(page.locator('#campaign-menu')).toBeHidden();
    script.resolve();
    await requested.promise;
    await expect(page.locator('#campaign-workspace')).toBeVisible();
    await expect(page.locator('#campaign-workspace')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#hp-loading')).toHaveText('Loading campaign map…');
    await expect(page.locator('#hp-loading svg')).toBeVisible();
    await expect(page.locator('#campaign-menu')).toBeHidden();
  } finally {
    script.resolve();
    module.resolve();
  }
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-workspace')).not.toHaveAttribute('inert');
  await page.reload();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-menu')).toBeHidden();
});

test('existing campaign paints a sized workspace before its map module loads', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'wilderness-almanac:ui-v1',
      JSON.stringify({
        version: 1,
        campaignPanels: {
          'test-campaign': { mapSplit: 0.55, panelSplit: 0.4 },
        },
      }),
    );
  });
  const loading = gate();
  const requested = gate();
  await page.route(
    /\/(?:assets\/map-view-[^/]+|src\/ui\/map-view)\.js(?:\?.*)?$/,
    async (route) => {
      requested.resolve(undefined);
      await loading.promise;
      await route.continue();
    },
  );
  await page.goto('/');
  const workspace = page.getByRole('region', { name: 'Campaign workspace', includeHidden: true });
  const map = page.getByRole('region', { name: 'Map', exact: true, includeHidden: true });
  let shellBox;
  try {
    await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
    await requested.promise;
    await expect(workspace).toBeVisible();
    await expect(page.locator('#campaign-menu')).toBeHidden();
    await expect(workspace).toHaveAttribute('aria-busy', 'true');
    await expect(workspace.getByText('Test campaign', { exact: true })).toBeVisible();
    await expect(page.locator('#hp-loading')).toHaveText('Loading campaign map…');
    await expect(page.locator('#hp-loading svg')).toBeVisible();
    await expect(page.locator('#hp-scene canvas')).toHaveCount(0);
    const projection = await page.locator('.hp-map-skeleton').evaluate((element) => {
      if (!(element instanceof SVGSVGElement)) throw new Error('Missing skeleton SVG');
      const matrix = element.getScreenCTM();
      if (!matrix) throw new Error('Missing skeleton projection');
      const box = element.getBoundingClientRect();
      return {
        scaleX: matrix.a,
        scaleY: matrix.d,
        width: box.width,
        centerX: matrix.e - box.x - box.width / 2,
        centerY: matrix.f - box.y - box.height / 2,
      };
    });
    expect(projection.scaleX).toBeCloseTo(projection.width / (CAMPAIGN_HEXES_WIDE * 2), 5);
    expect(projection.scaleY).toBeCloseTo(projection.scaleX, 5);
    expect(projection.centerX).toBeCloseTo(0, 5);
    expect(projection.centerY).toBeCloseTo(0, 5);
    shellBox = await map.boundingBox();
    expect(shellBox).not.toBeNull();
    expect(shellBox?.y).toBeLessThan(20);
    expect(shellBox?.height).toBeGreaterThan(600);
    if (testInfo.project.name === 'desktop') {
      const width = await workspace.evaluate(
        (element) => element.clientWidth - parseFloat(getComputedStyle(element).columnGap),
      );
      expect((shellBox?.width ?? 0) / width).toBeCloseTo(0.55, 2);
    }
    await page.evaluate(() => {
      document
        .querySelector('button[data-action="enter"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const screenshot = testInfo.outputPath('campaign-entry-shell.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('Campaign workspace while module is pending', {
      path: screenshot,
      contentType: 'image/png',
    });
  } finally {
    loading.resolve();
  }
  await expect(workspace).not.toHaveAttribute('aria-busy');
  await expect(workspace).not.toHaveAttribute('inert');
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  const readyBox = await map.boundingBox();
  expect(readyBox?.x).toBeCloseTo(shellBox?.x ?? 0, 0);
  expect(readyBox?.y).toBeCloseTo(shellBox?.y ?? 0, 0);
  expect(readyBox?.width).toBeCloseTo(shellBox?.width ?? 0, 0);
  expect(readyBox?.height).toBeCloseTo(shellBox?.height ?? 0, 0);
  await page.getByRole('button', { name: 'Return to main menu' }).click();
  await expect(page.getByRole('button', { name: /^New campaign/ })).toBeFocused();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    const nativeFrame = window.requestAnimationFrame.bind(window);
    /** @type {FrameRequestCallback[]} */
    const callbacks = [];
    let held = true;
    window.requestAnimationFrame = (callback) =>
      nativeFrame((time) => {
        if (held && document.querySelector('#campaign-workspace[data-loading]'))
          callbacks.push(callback);
        else callback(time);
      });
    const state = /** @type {Window & { releaseShell?: () => void }} */ (window);
    state.releaseShell = () => {
      held = false;
      window.requestAnimationFrame = nativeFrame;
      for (const callback of callbacks) nativeFrame(callback);
    };
  });
  try {
    await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
    await expect(page.locator('#hp-loading')).toHaveText('Loading campaign map…');
    await expect(page.locator('#hp-loading svg')).toBeVisible();
    await expect(page.locator('#campaign-menu')).toBeHidden();
    await expect(page.locator('#hp-scene canvas')).toHaveCount(1);
    await expect(page.locator('#hp-scene canvas')).toBeHidden();
    await expect(page.locator('#hp-inspector-body')).toBeHidden();
  } finally {
    await page.evaluate(() => {
      const state = /** @type {Window & { releaseShell?: () => void }} */ (window);
      state.releaseShell?.();
    });
  }
  await expect(workspace).not.toHaveAttribute('aria-busy');
  await expect(workspace).not.toHaveAttribute('inert');
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
});
