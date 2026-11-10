// @ts-check
import { createHash } from 'node:crypto';

/**
 * Test-only precision: native transcendental math differs at the last double bit
 * across CPUs. Round dressing fingerprints to 12 decimal places, never world data.
 * @param {unknown} dressing
 * @returns {string}
 */
export function dressingFingerprint(dressing) {
  const json = JSON.stringify(dressing, (_key, value) => {
    if (typeof value !== 'number') return value;
    if (!Number.isFinite(value)) throw new Error('Dressing contains a nonfinite number');
    return Number.isInteger(value) ? value : Number(value.toFixed(12));
  });
  return createHash('sha256').update(json).digest('hex');
}
