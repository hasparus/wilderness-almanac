import { test, expect, library, openCampaign } from './fixtures.js';

const mapModule = /\/(?:assets\/map-view-[^/]+|src\/ui\/map-view)\.js(?:\?.*)?$/;

test.use({ reducedMotion: 'no-preference' });

test('new campaign previews before saving, paints loading feedback, and slides both ways', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.transitionDirections = [];
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => {
      const transition = start(update);
      const direction = document.documentElement.dataset.viewDirection;
      transition.ready.then(() => window.transitionDirections.push(direction)).catch(() => {});
      return transition;
    };
  });
  let release;
  const loading = new Promise((resolve) => (release = resolve));
  await page.route(mapModule, async (route) => {
    await loading;
    await route.continue();
  });
  await page.goto('/');
  const button = page.locator('#new-campaign');
  const generate = page.locator('#cc-generate');
  const create = page.locator('#cc-create');
  try {
    await button.click();
    await page.evaluate(() => {
      const button = document.getElementById('new-campaign');
      button.click();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(page.locator('#create-campaign-dialog')).toBeVisible();
    await expect(generate).toHaveAttribute('aria-busy', 'true');
    await expect(generate).toBeDisabled();
    await expect(generate).toHaveText(/Generating…/);
    await expect(create).toBeDisabled();
    expect((await library(page)).campaigns).toHaveLength(1);
    const painted = await generate.evaluate((element) => ({
      animation: getComputedStyle(element, '::after').animationName,
      width: getComputedStyle(element, '::after').width,
    }));
    expect(painted.animation).toBe('campaign-loading');
    expect(parseFloat(painted.width)).toBeGreaterThan(0);
    const screenshot = testInfo.outputPath('campaign-loading.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('Campaign creation feedback', {
      path: screenshot,
      contentType: 'image/png',
    });
  } finally {
    release();
  }
  await expect(page.locator('#cc-scene canvas')).toBeVisible();
  await expect(create).toBeEnabled();
  await create.click();
  await page.evaluate(() => {
    const button = document.getElementById('cc-create');
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.locator('#campaign-menu')).toBeHidden();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.transitionDirections)).toEqual(['forward']);
  await page.locator('#hp-back-menu').click();
  await expect(page.locator('#campaign-menu')).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute('aria-busy');
  await expect(button).toHaveText(/New campaign/);
  await expect(button).toBeFocused();
  await expect(page.locator('.campaign-card')).toHaveCount(2);
  await expect
    .poll(() => page.evaluate(() => window.transitionDirections))
    .toEqual(['forward', 'back']);
});

test('failed map loading restores the menu controls and preserves the campaign', async ({
  page,
}) => {
  await page.route(mapModule, (route) => route.abort());
  await page.goto('/');
  await page.locator('.campaign-enter').click();
  await expect(page.locator('#campaign-message')).toContainText('Could not open the map.');
  await expect(page.locator('#campaign-workspace')).toBeHidden();
  await expect(page.locator('.campaign-enter')).toBeEnabled();
  await expect(page.locator('.campaign-enter')).not.toHaveAttribute('aria-busy');
  await expect(page.locator('#new-campaign')).toBeEnabled();
  expect((await library(page)).campaigns).toHaveLength(1);
  await page.unroute(mapModule);
  await page.reload();
  await openCampaign(page);
});

for (const mode of ['reduced motion', 'unsupported transitions'])
  test(`campaign navigation remains usable with ${mode}`, async ({ page }) => {
    if (mode === 'reduced motion') {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => {
        document.startViewTransition = () => {
          throw new Error('Reduced motion must bypass transitions');
        };
      });
    } else
      await page.addInitScript(() => {
        document.startViewTransition = undefined;
      });
    await openCampaign(page);
    await page.locator('#hp-back-menu').click();
    await expect(page.locator('#new-campaign')).toBeVisible();
    await expect(page.locator('#new-campaign')).toBeEnabled();
    await expect(page.locator('html')).not.toHaveAttribute('data-view-direction');
  });

test('unsupported and unversioned map links show an error without creating a campaign', async ({
  page,
}) => {
  for (const query of ['seed=7', 'seed=7&generator=6', 'seed=7&generator=9']) {
    await page.goto(`/?${query}`);
    await expect(page.locator('#campaign-message')).toContainText('unsupported generator version');
    await expect(page.locator('.campaign-card')).toHaveCount(1);
    expect((await library(page)).campaigns[0].generatorVersion).toBe(10);
    await expect(page.locator('#hp-scene canvas')).toHaveCount(0);
  }
});
