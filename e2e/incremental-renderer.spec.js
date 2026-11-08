// @ts-check
import { test, expect, campaign, openCampaign } from './fixtures.js';
import { seedCampaigns } from './data.js';

/** Isolate WebGL pixels from tooltips, map labels and controls overlapping the canvas. */
const screenshotOptions = {
  style:
    'body * { visibility: hidden !important; } #hp-scene canvas { visibility: visible !important; }',
};

for (const artStyle of ['low-poly', 'pixelart']) {
  test(`retained ${artStyle} chunks survive interrupted reveals and warm fog toggles`, async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await seedCampaigns(page, [{ ...campaign, artStyle, fogOfWar: true }]);
    await openCampaign(page, { expandInspector: false });
    const canvas = page.getByRole('img', { name: /^Interactive isometric hex map\./ });
    const fog = page.getByRole('switch', { name: 'Fog of war', exact: true });
    await expect(canvas).toHaveAttribute('data-renderer', 'fiber-retained');
    await expect(canvas).toHaveAttribute('data-render-state', 'ready');
    await expect(canvas).toHaveAttribute('aria-busy', 'false');
    const zoom = await canvas.getAttribute('data-zoom');
    const selection = page.getByRole('combobox', { name: 'Select hex or party' });
    const selected = await selection.inputValue();
    const concealed = await canvas.screenshot({
      ...screenshotOptions,
      path: testInfo.outputPath('fog-initial.png'),
    });

    await fog.click();
    await expect(fog).not.toBeChecked();
    await fog.click();
    await expect(fog).toBeChecked();
    await expect(canvas).toHaveAttribute('data-render-state', 'ready');
    const restored = await canvas.screenshot({
      ...screenshotOptions,
      path: testInfo.outputPath('fog-restored.png'),
    });
    expect(restored.equals(concealed), 'cancelled work cannot reappear over fog').toBe(true);

    await fog.click();
    await expect(canvas).toHaveAttribute('data-render-state', 'ready');
    expect(
      (await canvas.screenshot(screenshotOptions)).equals(concealed),
      'the full map actually becomes visible',
    ).toBe(false);
    await fog.click();
    await expect(canvas).toHaveAttribute('aria-busy', 'false');
    expect(
      (await canvas.screenshot(screenshotOptions)).equals(concealed),
      'warm restoration preserves the fog scene',
    ).toBe(true);
    await expect(canvas).toHaveAttribute('data-zoom', zoom ?? '');
    await expect(selection).toHaveValue(selected);
    await expect(fog).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Find party', exact: true })).toBeEnabled();
  });
}
