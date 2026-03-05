import { describe, it, expect } from 'vitest';
import { squarify, validateGeometry } from '../src/index.js';
import type { TreemapContainer } from '../src/index.js';

const CONTAINER: TreemapContainer = {
  width: 1200,
  height: 700,
  outerPadding: 8,
  innerGutter: 4,
};

describe('validateGeometry', () => {
  it('passes for valid squarify output', () => {
    const tiles = squarify(
      [
        { entityId: 'A', layoutWeight: 0.5 },
        { entityId: 'B', layoutWeight: 0.3 },
        { entityId: 'C', layoutWeight: 0.2 },
      ],
      CONTAINER,
    );
    const result = validateGeometry(tiles, CONTAINER);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('passes for all-zero weight fallback output', () => {
    const tiles = squarify(
      [
        { entityId: 'A', layoutWeight: 0 },
        { entityId: 'B', layoutWeight: 0 },
        { entityId: 'C', layoutWeight: 0 },
      ],
      CONTAINER,
    );
    const result = validateGeometry(tiles, CONTAINER);
    expect(result.valid).toBe(true);
  });

  it('detects negative dimensions', () => {
    const tiles = [{ entityId: 'A', rect: { x: 8, y: 8, w: -10, h: 100 } }];
    const result = validateGeometry(tiles, CONTAINER);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('detects out-of-bounds rects', () => {
    const tiles = [{ entityId: 'A', rect: { x: 8, y: 8, w: 1200, h: 100 } }];
    const result = validateGeometry(tiles, CONTAINER);
    expect(result.valid).toBe(false);
  });

  it('detects overlapping rects', () => {
    const tiles = [
      { entityId: 'A', rect: { x: 8, y: 8, w: 100, h: 100 } },
      { entityId: 'B', rect: { x: 50, y: 50, w: 100, h: 100 } },
    ];
    const result = validateGeometry(tiles, CONTAINER);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('overlap'))).toBe(true);
  });

  it('passes for 20-tile squarify output', () => {
    const inputs = Array.from({ length: 20 }, (_, i) => ({
      entityId: `T${i}`,
      layoutWeight: (20 - i) * 0.05,
    }));
    const tiles = squarify(inputs, CONTAINER);
    const result = validateGeometry(tiles, CONTAINER);
    expect(result.valid).toBe(true);
  });

  it('passes for single tile', () => {
    const tiles = squarify([{ entityId: 'A', layoutWeight: 1 }], CONTAINER);
    const result = validateGeometry(tiles, CONTAINER);
    expect(result.valid).toBe(true);
  });
});
