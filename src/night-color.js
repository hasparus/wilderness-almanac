// @ts-check

export const NIGHT_TINT = '#8295d5';

/**
 * Apply the shared night tint in linear RGB, preserving the renderer's operation order.
 * @template {{r: number, g: number, b: number}} T
 * @param {T} color
 * @param {{r: number, g: number, b: number}} navy
 * @returns {T}
 */
export function applyNightTint(color, navy) {
  const gray = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  for (const channel of /** @type {const} */ (['r', 'g', 'b'])) {
    color[channel] += (gray - color[channel]) * 0.72;
    color[channel] *= navy[channel];
    color[channel] *= 0.72;
  }
  return color;
}
