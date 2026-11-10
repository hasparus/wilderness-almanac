// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignMapBackground, campaignUITheme } from '../src/ui/campaign-theme.js';
import { Color } from 'three';
import { applyNightColor } from '../src/rendering/daylight.js';
import { readUITheme, UI_THEME_KEY } from '../src/ui/theme.js';
import {
  palettes,
  paletteTheme,
  contrastRatio,
  createColorScale,
  hexToOklch,
} from '../src/palette.js';

test('dark UI keeps the established campaign colours and panel chroma', () => {
  for (const seeds of Object.values(palettes)) {
    const original = paletteTheme(seeds);
    const { panel, ...theme } = campaignUITheme(seeds, 'dark');
    assert.deepEqual(theme, original);
    assert.equal(panel, createColorScale([original.bg])(0, hexToOklch(original.bg)[0], 0.925));
  }
});

test('both UI schemes keep text readable across bundled and extreme custom palettes', () => {
  const extremes = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  const seeds = [
    ...Object.values(palettes),
    ...extremes.flatMap((a) => extremes.flatMap((b) => extremes.map((c) => [a, b, c]))),
  ];
  for (const palette of seeds) {
    const copy = [...palette];
    for (const scheme of ['light', 'dark']) {
      const theme = campaignUITheme(palette, scheme);
      for (const bg of [theme.bg, theme.panel]) {
        assert.ok(contrastRatio(bg, theme.text) >= 4.5, `${palette}/${scheme}: text`);
        assert.ok(contrastRatio(bg, theme.muted) >= 4.5, `${palette}/${scheme}: muted`);
      }
      if (scheme === 'light') {
        assert.ok(hexToOklch(theme.bg)[0] >= 0.95);
        assert.ok(contrastRatio(theme.bg, theme.line) >= 3);
      }
    }
    assert.deepEqual(palette, copy);
  }
});

test('the shared numeric night tint exactly preserves the original Three.js calculation', () => {
  const navy = new Color('#8295d5');
  for (const hex of Object.values(palettes).flat()) {
    const expected = new Color(hex);
    const gray = expected.r * 0.2126 + expected.g * 0.7152 + expected.b * 0.0722;
    expected
      .lerp(new Color().setRGB(gray, gray, gray), 0.72)
      .multiply(navy)
      .multiplyScalar(0.72);
    assert.deepEqual(applyNightColor(new Color(hex), 'night'), expected);
  }
});

test('pre-render background matches the renderer in every lighting mode and UI scheme', () => {
  const extremes = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff'];
  const palettesToCheck = [
    ...Object.values(palettes),
    ...extremes.map((color) => [color, color, color]),
  ];
  for (const seeds of palettesToCheck) {
    for (const mode of ['dawn', 'day', 'dusk', 'night']) {
      assert.equal(
        campaignMapBackground(seeds, mode, 'dark'),
        '#' + applyNightColor(new Color(createColorScale(seeds).background()), mode).getHexString(),
      );
      assert.equal(campaignMapBackground(seeds, mode, 'light'), campaignUITheme(seeds, 'light').bg);
    }
  }
});

test('UI theme defaults to dark, validates choices and tolerates unavailable storage', () => {
  for (const saved of ['light', 'dark', 'system', '', null]) {
    const storage = {
      getItem: (/** @type {string} */ key) => {
        assert.equal(key, UI_THEME_KEY);
        return saved;
      },
    };
    assert.equal(readUITheme(storage), saved === 'light' ? 'light' : 'dark');
  }
  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(readUITheme(blocked), 'dark');
  assert.equal(readUITheme(blocked, 'light'), 'light');
  assert.equal(readUITheme(undefined, 'light'), 'light');
});
