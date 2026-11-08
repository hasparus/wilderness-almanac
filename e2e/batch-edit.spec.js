import { test, expect, library, openCampaign, revealInspector } from './fixtures.js';

async function enableMultiEdit(page) {
  await openCampaign(page);
  await page.getByRole('button', { name: 'Multiselect', exact: true }).click();
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-multi-edit', 'true');
  return page.locator('#hp-batch-off');
}

async function finishMapAction(page, button) {
  await button.click();
  await expect(page.locator('#campaign-workspace')).not.toHaveAttribute('aria-busy', 'true');
}

test('multi edit applies only chosen fields, persists, and undoes the entire selection', async ({
  page,
}, testInfo) => {
  const toggle = await enableMultiEdit(page);
  const initial = (await library(page)).campaigns[0];
  await expect(page.locator('#hp-batch-count')).toHaveText('1 hex selected');
  await expect(toggle).toBeVisible();
  await page.locator('#hp-selection').selectOption('1,0');
  await expect(page.locator('#hp-batch-count')).toHaveText('2 hexes selected');
  await page.locator('#hp-batch-terrain').selectOption('meadow');
  await page.locator('#hp-batch-elevation').selectOption('1');
  await finishMapAction(page, page.locator('#hp-batch-apply'));
  const edited = (await library(page)).campaigns[0];
  for (const key of ['0,0', '1,0'])
    expect(edited.hexEdits.cells[key]).toEqual({ terrain: 'meadow', elevation: 1, crossing: null });
  await expect(page.locator('#hp-batch-count')).toHaveText('2 hexes selected');
  await expect(page.locator('#hp-batch-terrain')).toHaveValue('__keep__');
  await expect(page.locator('#hp-batch-apply')).toBeDisabled();
  const screenshot = testInfo.outputPath('multi-edit.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('Multi edit workspace', { path: screenshot, contentType: 'image/png' });
  await finishMapAction(page, page.locator('#hp-batch-undo'));
  expect((await library(page)).campaigns[0].hexEdits).toEqual(initial.hexEdits);
  await expect(page.locator('#hp-batch-undo')).toBeDisabled();
  await toggle.click();
  await expect(page.locator('#hp-hex-edit')).toBeVisible();
  await page.reload();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-multi-edit', 'false');
});

test('multi edit protects drafts, supports all/clear and rejects incompatible targets atomically', async ({
  page,
}) => {
  const toggle = await enableMultiEdit(page);
  await page.locator('#hp-batch-terrain').selectOption('meadow');
  await toggle.click();
  const dialog = page.getByRole('dialog', { name: 'Unsaved edits', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-multi-edit', 'true');
  await page.locator('#hp-selection').selectOption('1,0');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.locator('#hp-batch-count')).toHaveText('2 hexes selected');
  expect((await library(page)).campaigns[0].hexEdits.cells['0,0'].terrain).toBe('meadow');
  await page.locator('#hp-batch-all').click();
  await expect(page.locator('#hp-batch-count')).toHaveText('469 hexes selected');
  await expect(page.locator('#hp-batch-terrain option').first()).toHaveText('Keep mixed values');
  const before = (await library(page)).campaigns[0];
  await page.locator('#hp-batch-settlement').selectOption('village');
  await finishMapAction(page, page.locator('#hp-batch-apply'));
  await expect(page.locator('#hp-batch-feedback')).toContainText(
    'Water cannot contain settlements',
  );
  expect((await library(page)).campaigns[0]).toEqual(before);
  await page.locator('#hp-batch-cancel').click();
  await page.locator('#hp-batch-clear').click();
  await expect(page.locator('#hp-batch-count')).toHaveText('0 hexes selected');
  await expect(page.locator('#hp-batch-terrain')).toBeDisabled();
  await expect(page.locator('#hp-batch-apply')).toBeDisabled();
  // A plain map click selects one hex; Ctrl+click toggles it. Dragging still pans.
  await page.locator('#hp-scene canvas').scrollIntoViewIfNeeded();
  const bounds = await page.locator('#hp-scene canvas').boundingBox();
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await page.mouse.click(x, y);
  await expect(page.locator('#hp-batch-count')).toHaveText('1 hex selected');
  await page.keyboard.down('Control');
  await page.mouse.click(x, y);
  await page.keyboard.up('Control');
  await expect(page.locator('#hp-batch-count')).toHaveText('0 hexes selected');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y + 15, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('#hp-batch-count')).toHaveText('0 hexes selected');
});

test('whole-map batch edits survive reload and preserve the mobile map footprint', async ({
  page,
}, testInfo) => {
  await enableMultiEdit(page);
  const initialHeight = await page
    .locator('.hp-map-panel')
    .evaluate((el) => el.getBoundingClientRect().height);
  await page.locator('#hp-batch-all').click();
  await page.locator('#hp-batch-terrain').selectOption('meadow');
  await page.locator('#hp-batch-elevation').selectOption('0');
  await page.locator('#hp-batch-settlement').selectOption('');
  await page.locator('#hp-batch-poi').selectOption('');
  await finishMapAction(page, page.locator('#hp-batch-apply'));
  expect(Object.keys((await library(page)).campaigns[0].hexEdits.cells)).toHaveLength(469);
  const dimensions = await page.evaluate(() => ({
    height: document.querySelector('.hp-map-panel').getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  expect(dimensions.overflow).toBe(false);
  if (testInfo.project.name === 'mobile') expect(dimensions.height).toBeCloseTo(initialHeight, 0);
  await page.reload();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  const terrains = await page
    .locator('#hp-selection option')
    .evaluateAll((options) =>
      options.filter((option) => option.dataset.terrain).map((option) => option.dataset.terrain),
    );
  expect(new Set(terrains)).toEqual(new Set(['meadow']));
  await page.locator('#hp-selection').selectOption('0,0');
  await revealInspector(page);
  await expect(page.locator('#hp-hex-edit')).toBeVisible();
});

test('settlement joining, addressed errors and painted Apply feedback work together', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await enableMultiEdit(page);
  await page.locator('#hp-selection').selectOption('1,0');
  await expect(page.locator('#hp-batch-join')).toBeHidden();
  await page.evaluate(() => {
    window.batchWorking = [];
    const workspace = document.querySelector('#campaign-workspace');
    new MutationObserver(() => {
      const button = workspace.querySelector('button[aria-busy="true"]');
      if (!button) return;
      const sample = { label: button.textContent, painted: false };
      window.batchWorking.push(sample);
      requestAnimationFrame(() => {
        sample.painted = button.getAttribute('aria-busy') === 'true';
      });
    }).observe(workspace, { subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
  });
  await page.locator('#hp-batch-terrain').selectOption('meadow');
  await page.locator('#hp-batch-elevation').selectOption('1');
  await page.locator('#hp-batch-settlement').selectOption('city');
  await page.locator('#hp-batch-poi').selectOption('');
  await finishMapAction(page, page.locator('#hp-batch-apply'));
  const join = page.locator('#hp-batch-join');
  await expect(join).toHaveText('Join city');
  await expect(join).toBeEnabled();
  expect(
    await page.evaluate(() =>
      window.batchWorking.some((sample) => sample.label === 'Apply to 2 hexes' && sample.painted),
    ),
  ).toBe(true);
  const joinBounds = await join.boundingBox();
  const fieldsBounds = await page.locator('#hp-batch-fields').boundingBox();
  expect(joinBounds.x).toBeGreaterThanOrEqual(fieldsBounds.x);
  expect(joinBounds.x + joinBounds.width).toBeLessThanOrEqual(fieldsBounds.x + fieldsBounds.width);
  await finishMapAction(page, join);
  await expect(join).toBeDisabled();
  const joined = (await library(page)).campaigns[0];
  expect(joined.hexEdits.cells['0,0'].settlementGroup).toBe(
    joined.hexEdits.cells['1,0'].settlementGroup,
  );
  const screenshot = testInfo.outputPath('joined-city.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('Joined city', { path: screenshot, contentType: 'image/png' });
  await finishMapAction(page, page.locator('#hp-batch-undo'));
  await expect(join).toBeEnabled();
  await page.locator('#hp-batch-settlement').selectOption('town');
  await finishMapAction(page, page.locator('#hp-batch-apply'));
  await expect(page.getByRole('button', { name: 'Join town', exact: true })).toBeEnabled();
  await page.locator('#hp-batch-settlement').selectOption('village');
  await finishMapAction(page, page.locator('#hp-batch-apply'));
  await expect(page.locator('#hp-batch-join')).toBeHidden();
  const villages = (await library(page)).campaigns[0];
  expect(villages.hexEdits.cells['0,0'].settlementGroup).toBeUndefined();
  expect(villages.hexEdits.cells['1,0'].settlementGroup).toBeUndefined();
  await page.locator('#hp-batch-all').click();
  await page.locator('#hp-batch-settlement').selectOption('city');
  await finishMapAction(page, page.locator('#hp-batch-apply'));
  const error = page.locator('#hp-batch-feedback');
  await expect(error).toContainText(/Region #\d+ · -?\d+, -?\d+:/);
  expect(
    await error.evaluate((node) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--c-error)';
      node.append(probe);
      const matches = getComputedStyle(node).color === getComputedStyle(probe).color;
      probe.remove();
      return matches;
    }),
  ).toBe(true);
  expect((await library(page)).campaigns[0]).toEqual(villages);
});
