import type { TreemapTile, TreemapContainer, Rect } from './types.js';

export interface GeometryValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates treemap geometry output:
 * - All rects have positive dimensions (w > 0, h > 0)
 * - All rects are within container bounds (respecting outerPadding)
 * - No overlapping rects (allowing shared boundaries from gutter)
 */
export function validateGeometry(
  tiles: readonly TreemapTile[],
  container: TreemapContainer,
): GeometryValidationResult {
  const errors: string[] = [];
  const pad = container.outerPadding;

  for (const tile of tiles) {
    const { rect, entityId } = tile;

    if (rect.w <= 0) errors.push(`${entityId}: width ${rect.w} <= 0`);
    if (rect.h <= 0) errors.push(`${entityId}: height ${rect.h} <= 0`);
    if (rect.x < pad) errors.push(`${entityId}: x ${rect.x} < padding ${pad}`);
    if (rect.y < pad) errors.push(`${entityId}: y ${rect.y} < padding ${pad}`);
    if (rect.x + rect.w > container.width - pad) {
      errors.push(`${entityId}: right edge ${rect.x + rect.w} > ${container.width - pad}`);
    }
    if (rect.y + rect.h > container.height - pad) {
      errors.push(`${entityId}: bottom edge ${rect.y + rect.h} > ${container.height - pad}`);
    }
  }

  // Check for overlaps (rects must not have positive-area intersection)
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i].rect;
      const b = tiles[j].rect;
      const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (overlapX > 0 && overlapY > 0) {
        errors.push(`overlap: ${tiles[i].entityId} and ${tiles[j].entityId} (${overlapX}x${overlapY})`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
