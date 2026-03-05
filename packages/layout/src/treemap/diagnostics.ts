import type { TreemapInput } from './types.js';

/**
 * Detects whether all inputs have zero layoutWeight,
 * which triggers the equal-distribution fallback in squarify().
 * The snapshot layer uses this to emit LAYOUT_DEGRADED warning.
 */
export function isAllZeroWeights(inputs: readonly TreemapInput[]): boolean {
  return inputs.length > 0 && inputs.every(i => i.layoutWeight === 0);
}
