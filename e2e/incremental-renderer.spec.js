// @ts-check
import { test, expect, campaign, openCampaign } from './fixtures.js';
import { seedCampaigns } from './data.js';

/** Isolate WebGL pixels from tooltips, map labels and controls overlapping the canvas. */
const screenshotOptions = {
  style:
    'body * { visibility: hidden !important; } #hp-scene canvas { visibility: visible !important; }',
};

/**
 * Observe in-page so even a synchronous warm swap or a 120 ms arrival is captured.
 * @param {import('@playwright/test').Locator} canvas
 * @param {import('@playwright/test').Locator} fog
 * @param {boolean} [interrupt]
 */
async function observeFogSwap(canvas, fog, interrupt = false) {
  await expect(fog).toBeEnabled();
  const toggle = await fog.elementHandle();
  return canvas.evaluate(
    (canvas, { toggle, interrupt }) =>
      new Promise((resolve, reject) => {
        if (!(toggle instanceof HTMLButtonElement)) throw new Error('Missing fog switch');
        /** @type {(string | null)[]} */
        const states = [];
        /** @type {{state: string | null, busy: string | null, enabled: boolean} | null} */
        let interrupted = null;
        let grace = 0;
        const timeout = window.setTimeout(() => {
          observer.disconnect();
          clearTimeout(grace);
          reject(new Error(`Fog swap did not finish: ${states.join(' -> ')}`));
        }, 15000);
        const observer = new MutationObserver((records) => {
          for (let i = 0; i < records.length; i++) {
            const state =
              i + 1 < records.length
                ? records[i + 1].oldValue
                : canvas.getAttribute('data-render-state');
            if (states.at(-1) !== state) states.push(state);
          }
          if (
            interrupt &&
            !interrupted &&
            canvas.getAttribute('data-render-state') === 'settling'
          ) {
            interrupted = {
              state: canvas.getAttribute('data-render-state'),
              busy: canvas.getAttribute('aria-busy'),
              enabled: !toggle.disabled && !toggle.closest('[inert]'),
            };
            toggle.click();
          }
          if (!grace && canvas.getAttribute('data-render-state') === 'ready') {
            grace = window.setTimeout(() => {
              observer.disconnect();
              clearTimeout(timeout);
              resolve({ states, interrupted, immediate, immediateChecked });
            }, 250);
          }
        });
        observer.observe(canvas, {
          attributes: true,
          attributeFilter: ['data-render-state'],
          attributeOldValue: true,
        });
        toggle.click();
        const immediate = canvas.getAttribute('data-render-state');
        const immediateChecked = toggle.getAttribute('aria-checked');
      }),
    { toggle, interrupt },
  );
}

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

  test(`motion-enabled ${artStyle} arrivals cancel while settling and cached hexes replay without rebuilding`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    /** An existing token avoids the automatic first visit; fully concealed fog has no sway. */
    await seedCampaigns(page, [
      {
        ...campaign,
        artStyle,
        fogOfWar: true,
        partyToken: { key: '0,0', style: 'cairn' },
      },
    ]);
    await openCampaign(page, { expandInspector: false });
    const canvas = page.getByRole('img', { name: /^Interactive isometric hex map\./ });
    const fog = page.getByRole('switch', { name: 'Fog of war', exact: true });
    await expect(canvas).toHaveAttribute('data-motion', 'ambient');
    await expect(canvas).toHaveAttribute('data-render-state', 'ready');
    await expect(fog).toBeChecked();
    const concealed = await canvas.screenshot(screenshotOptions);

    const cold = await observeFogSwap(canvas, fog, true);
    expect(cold.immediateChecked, 'fog state changes before yielding to a frame').toBe('false');
    expect(cold.immediate).toBe('building');
    expect(cold.states).toEqual(['building', 'settling', 'ready']);
    expect(cold.interrupted).toEqual({ state: 'settling', busy: 'true', enabled: true });
    await expect(fog).toBeChecked();
    await expect(canvas).toHaveAttribute('data-render-state', 'ready');
    await expect(canvas).toHaveAttribute('aria-busy', 'false');
    expect(
      (await canvas.screenshot(screenshotOptions)).equals(concealed),
      'concealment survives beyond the cancelled arrival',
    ).toBe(true);

    for (const concealedAgain of [false, true]) {
      const warm = await observeFogSwap(canvas, fog);
      expect(warm.immediateChecked, 'cached toggles also apply in the same task').toBe(
        String(concealedAgain),
      );
      expect(warm.immediate).toBe(concealedAgain ? 'ready' : 'settling');
      expect(
        warm.states,
        'cached reveals animate without rebuilding; concealment is instant',
      ).toEqual(concealedAgain ? ['ready'] : ['settling', 'ready']);
      await expect(fog).toBeChecked({ checked: concealedAgain });
      await expect(canvas).toHaveAttribute('aria-busy', 'false');
      expect((await canvas.screenshot(screenshotOptions)).equals(concealed)).toBe(concealedAgain);
    }
    await expect(canvas).toHaveAttribute('data-motion', 'ambient');
    const selection = page.getByRole('combobox', { name: 'Select hex or party' });
    await selection.selectOption('0,0');
    await expect(selection).toHaveValue('0,0');
    await expect(page.getByRole('button', { name: 'Find party', exact: true })).toBeEnabled();
  });
}

test('the retained canvas follows the map area after a resize so picking stays aligned', async ({
  page,
}) => {
  await openCampaign(page, { expandInspector: false });
  const canvas = page.getByRole('img', { name: /^Interactive isometric hex map\./ });
  await expect(canvas).toHaveAttribute('data-renderer', 'fiber-retained');
  await expect(canvas).toHaveAttribute('data-render-state', 'ready');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Missing viewport');
  await page.setViewportSize({ width: viewport.width - 120, height: viewport.height - 120 });
  const sizes = () =>
    canvas.evaluate((element) => {
      const host = /** @type {HTMLElement} */ (element.parentElement);
      return {
        canvas: [element.clientWidth, element.clientHeight],
        host: [host.clientWidth, host.clientHeight],
      };
    });
  await expect
    .poll(async () => {
      const { canvas, host } = await sizes();
      return canvas.join('x') === host.join('x');
    })
    .toBe(true);
});
