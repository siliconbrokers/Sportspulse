import { describe, it, expect } from 'vitest';
import { squarify } from '../src/index.js';
import type { TreemapContainer, TreemapInput } from '../src/index.js';

const CONTAINER: TreemapContainer = {
  width: 1200,
  height: 700,
  outerPadding: 8,
  innerGutter: 4,
};

describe('squarify', () => {
  it('returns empty array for empty input', () => {
    expect(squarify([], CONTAINER)).toEqual([]);
  });

  it('single tile fills usable area', () => {
    const inputs: TreemapInput[] = [{ entityId: 'A', layoutWeight: 1 }];
    const tiles = squarify(inputs, CONTAINER);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].entityId).toBe('A');
    expect(tiles[0].rect.x).toBe(8);
    expect(tiles[0].rect.y).toBe(8);
    expect(tiles[0].rect.w).toBe(1184); // 1200 - 16
    expect(tiles[0].rect.h).toBe(684); // 700 - 16
  });

  it('produces deterministic output across repeated runs', () => {
    const inputs: TreemapInput[] = [
      { entityId: 'A', layoutWeight: 0.5 },
      { entityId: 'B', layoutWeight: 0.3 },
      { entityId: 'C', layoutWeight: 0.2 },
    ];
    const run1 = squarify(inputs, CONTAINER);
    const run2 = squarify(inputs, CONTAINER);
    expect(run1).toEqual(run2);
  });

  it('all rects have non-negative dimensions', () => {
    const inputs: TreemapInput[] = Array.from({ length: 20 }, (_, i) => ({
      entityId: `T${i}`,
      layoutWeight: Math.random() * 0.5 + 0.01,
    }));
    const tiles = squarify(inputs, CONTAINER);
    for (const tile of tiles) {
      expect(tile.rect.w).toBeGreaterThan(0);
      expect(tile.rect.h).toBeGreaterThan(0);
    }
  });

  it('all rects within container bounds', () => {
    const inputs: TreemapInput[] = [
      { entityId: 'A', layoutWeight: 0.6 },
      { entityId: 'B', layoutWeight: 0.25 },
      { entityId: 'C', layoutWeight: 0.1 },
      { entityId: 'D', layoutWeight: 0.05 },
    ];
    const tiles = squarify(inputs, CONTAINER);
    for (const tile of tiles) {
      expect(tile.rect.x).toBeGreaterThanOrEqual(CONTAINER.outerPadding);
      expect(tile.rect.y).toBeGreaterThanOrEqual(CONTAINER.outerPadding);
      expect(tile.rect.x + tile.rect.w).toBeLessThanOrEqual(CONTAINER.width - CONTAINER.outerPadding);
      expect(tile.rect.y + tile.rect.h).toBeLessThanOrEqual(CONTAINER.height - CONTAINER.outerPadding);
    }
  });

  it('handles all-zero weights with equal distribution', () => {
    const inputs: TreemapInput[] = [
      { entityId: 'A', layoutWeight: 0 },
      { entityId: 'B', layoutWeight: 0 },
      { entityId: 'C', layoutWeight: 0 },
    ];
    const tiles = squarify(inputs, CONTAINER);
    expect(tiles).toHaveLength(3);
    // All tiles should have non-zero dimensions
    for (const tile of tiles) {
      expect(tile.rect.w).toBeGreaterThan(0);
      expect(tile.rect.h).toBeGreaterThan(0);
    }
  });

  it('preserves entity order in output', () => {
    const inputs: TreemapInput[] = [
      { entityId: 'First', layoutWeight: 0.5 },
      { entityId: 'Second', layoutWeight: 0.3 },
      { entityId: 'Third', layoutWeight: 0.2 },
    ];
    const tiles = squarify(inputs, CONTAINER);
    expect(tiles.map(t => t.entityId)).toEqual(['First', 'Second', 'Third']);
  });
});
