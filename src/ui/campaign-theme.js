// @ts-check
import { createColorScale, hexToOklch, paletteTheme } from '../palette.js';
import { applyNightTint, NIGHT_TINT } from '../night-color.js';

/** UI schemes never change map palette seeds. @param {string[]} seeds @param {string} [scheme] */
export function campaignUITheme(seeds, scheme = 'dark') {
  const color = createColorScale(seeds);
  const theme =
    scheme === 'light'
      ? {
          bg: color(0, 0.96, 0.24),
          text: color(2, 0.23, 0.2),
          muted: color(0, 0.4, 0.2),
          line: color(0, 0.6, 0.2),
        }
      : paletteTheme(seeds);
  return {
    ...theme,
    panel: createColorScale([theme.bg])(0, hexToOklch(theme.bg)[0], 0.925),
  };
}

/** Decode sRGB for the renderer's linear-light night tint. @param {string} hex */
function linearRGB(hex) {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return { r, g, b };
}

/** Match the map background before Three.js loads. @param {string[]} seeds @param {string} [mode] @param {string} [scheme] */
export function campaignMapBackground(seeds, mode = 'day', scheme = 'dark') {
  const background = campaignUITheme(seeds, scheme).bg;
  if (scheme === 'light' || mode !== 'night') return background;
  const channels = applyNightTint(linearRGB(background), linearRGB(NIGHT_TINT));
  return (
    '#' +
    Object.values(channels)
      .map((tinted) => {
        const encoded = tinted <= 0.0031308 ? 12.92 * tinted : 1.055 * tinted ** (1 / 2.4) - 0.055;
        return Math.round(encoded * 255)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}
