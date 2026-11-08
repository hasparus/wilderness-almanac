import { test, expect, library, openCampaign } from './fixtures.js';
import { partyDestinations } from '../src/application/party-navigation.js';
import { createTopology } from '../src/map-data.js';

test('fog toggles keep their label, framing, focus and unrelated controls stable', async ({
  page,
}) => {
  await openCampaign(page, { expandInspector: false });
  const fog = page.getByRole('switch', { name: 'Fog of war', exact: true });
  await fog.focus();
  await page.evaluate(() => {
    const fog = document.querySelector('#hp-fog');
    const controls = ['#hp-fog', '#hp-back-menu', '#hp-find-party', '#hp-time-of-day'].map(
      (selector) => document.querySelector(selector),
    );
    const content = [...fog.childNodes];
    const sample = () => ({
      label: fog.textContent.trim(),
      sameNodes: content.every((node, index) => fog.childNodes[index] === node),
      busy: fog.getAttribute('aria-busy'),
      controls: controls.map((control) => ({
        bounds: control.getBoundingClientRect().toJSON(),
        disabled: control.disabled,
        opacity: getComputedStyle(control).opacity,
      })),
    });
    window.fogFeedback = { before: sample(), samples: [] };
    const observer = new MutationObserver(() => {
      window.fogFeedback.samples.push(sample());
    });
    observer.observe(fog, { subtree: true, childList: true, attributes: true });
  });
  const canvas = page.locator('#hp-scene canvas');
  const zoom = await canvas.getAttribute('data-zoom');
  const announcement = await page.locator('#hp-announcement').textContent();
  for (const enabled of [true, false]) {
    await fog.press('Space');
    await expect(fog).toHaveAttribute('aria-checked', String(enabled));
    await expect(fog).not.toHaveAttribute('aria-busy');
    await expect(fog).toBeFocused();
    await expect(canvas).toHaveAttribute('data-zoom', zoom);
    await expect(page.locator('#hp-announcement')).toHaveText(announcement);
  }
  const { before, samples } = await page.evaluate(() => window.fogFeedback);
  expect(before.label).toBe('Fog of war');
  expect(samples.length).toBeGreaterThan(0);
  for (const sample of samples) {
    expect(sample.label).toBe(before.label);
    expect(sample.sameNodes).toBe(true);
    expect(sample.busy).toBeNull();
    expect(sample.controls).toEqual(before.controls);
  }
});

test('party shortcuts preserve framing, ignore editing and repeated keys, and retain Inspector navigation', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop keyboard controls');
  await openCampaign(page);
  await page.locator('#hp-find-party').click();
  const canvas = page.locator('#hp-scene canvas');
  const initial = (await library(page)).campaigns[0].partyToken.key;
  const destination = partyDestinations(initial, createTopology().cells)[0];
  const zoom = await canvas.getAttribute('data-zoom');
  await page.keyboard.press(destination.shortcut);
  await expect
    .poll(async () => (await library(page)).campaigns[0].partyToken.key)
    .toBe(destination.key);
  await expect(page.locator('#hp-selection')).toHaveValue('__party__');
  await expect(canvas).toHaveAttribute('data-zoom', zoom);
  expect((await library(page)).campaigns[0].hexEdits.cells[destination.key].visited).toBe(true);

  await page.locator('#hp-party-name').focus();
  await page.keyboard.press('w');
  await page.keyboard.press('Escape');
  await canvas.dispatchEvent('keydown', { key: 'w', repeat: true });
  await canvas.dispatchEvent('keydown', { key: 'w', ctrlKey: true });
  expect((await library(page)).campaigns[0].partyToken.key).toBe(destination.key);

  await page.locator('#hp-party-locate-position').click();
  await expect(page.locator('#hp-selection')).toHaveValue(destination.key);
  await expect(page.locator('#hp-announcement')).toContainText('Showing');
});

test('Find party retains the dirty-draft guard and viewport controls restore focus and layout', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop Inspector draft');
  await openCampaign(page);
  await page.locator('#hp-hex-edit').click();
  const terrain = page.getByRole('combobox', { name: 'Terrain', exact: true });
  await terrain.selectOption((await terrain.inputValue()) === 'meadow' ? 'wetlands' : 'meadow');
  const canvas = page.locator('#hp-scene canvas');
  const zoom = await canvas.getAttribute('data-zoom');
  await page.locator('#hp-find-party').click();
  const dialog = page.getByRole('dialog', { name: 'Unsaved edits', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('-');
  await expect(canvas).toHaveAttribute('data-zoom', zoom);
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.locator('#hp-selection')).toHaveValue('0,0');
  await page.locator('#hp-find-party').click();
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('#hp-selection')).toHaveValue('__party__');
  await expect(canvas).toBeFocused();

  const time = page.locator('#hp-time-of-day');
  await expect(page.locator('.hp-palette #hp-time-of-day')).toBeVisible();
  await time.focus();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.hp-palette #hp-time-of-day')).toBeVisible();
  await expect(time).toBeFocused();
  await page.locator('#hp-expand-map').click();
  await expect(page.locator('.hp-side-panels')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.hp-side-panels')).toBeVisible();
});

test('mobile party placement rejects the opening click, cancellation inspects, and keyboard confirmation moves once', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile party placement');
  await openCampaign(page, { expandInspector: false });
  const initial = (await library(page)).campaigns[0].partyToken.key;
  const canvas = page.locator('#hp-scene canvas');
  const dialog = page.locator('#hp-move-party-dialog');
  const tapDestination = async () => {
    await page.locator('#hp-find-party').click();
    const box = await canvas.boundingBox();
    await canvas.tap({ position: { x: box.width * 0.78, y: box.height / 2 } });
    await expect(dialog).toBeVisible();
  };
  await tapDestination();
  await page.locator('#hp-move-party-confirm').dispatchEvent('click', { detail: 1 });
  await expect(dialog).toBeVisible();
  expect((await library(page)).campaigns[0].partyToken.key).toBe(initial);
  await page.locator('#hp-move-party-cancel').click();
  await expect(dialog).toBeHidden();
  const destination = await page.locator('#hp-selection').inputValue();
  expect(destination).not.toBe(initial);
  expect(destination).not.toBe('__party__');
  expect((await library(page)).campaigns[0].partyToken.key).toBe(initial);

  await page.locator('#hp-fog').click();
  await tapDestination();
  await page.locator('#hp-move-party-confirm').focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await library(page)).campaigns[0].partyToken.key)
    .toBe(destination);
  expect((await library(page)).campaigns[0].hexEdits.cells[destination].visited).toBe(true);
  await expect(canvas).toBeFocused();
});
