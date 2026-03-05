import { describe, it, expect } from 'vitest';
import { canonicalStringify, canonicalEquals } from '../src/utils/canonical-json.js';

describe('canonicalStringify', () => {
  it('sorts keys alphabetically', () => {
    const result = canonicalStringify({ z: 1, a: 2, m: 3 });
    const parsed = JSON.parse(result);
    expect(Object.keys(parsed)).toEqual(['a', 'm', 'z']);
  });

  it('sorts nested keys', () => {
    const result = canonicalStringify({ b: { z: 1, a: 2 }, a: 1 });
    expect(result).toBe('{\n  "a": 1,\n  "b": {\n    "a": 2,\n    "z": 1\n  }\n}');
  });

  it('preserves array order', () => {
    const result = canonicalStringify([3, 1, 2]);
    expect(JSON.parse(result)).toEqual([3, 1, 2]);
  });

  it('sorts keys inside array elements', () => {
    const result = canonicalStringify([{ b: 1, a: 2 }]);
    const parsed = JSON.parse(result);
    expect(Object.keys(parsed[0])).toEqual(['a', 'b']);
  });

  it('handles null and undefined', () => {
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify(undefined)).toBeUndefined();
  });

  it('produces deterministic output for same data', () => {
    const a = { z: 1, a: { c: 3, b: 2 } };
    const b = { a: { b: 2, c: 3 }, z: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });
});

describe('canonicalEquals', () => {
  it('returns true for same data with different key order', () => {
    expect(canonicalEquals({ b: 1, a: 2 }, { a: 2, b: 1 })).toBe(true);
  });

  it('returns false for different data', () => {
    expect(canonicalEquals({ a: 1 }, { a: 2 })).toBe(false);
  });
});
