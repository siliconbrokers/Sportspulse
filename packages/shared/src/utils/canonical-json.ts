/**
 * Canonical JSON serializer for deterministic output.
 * Used by golden fixtures and snapshot comparison.
 *
 * Rules:
 * - Keys sorted alphabetically (deep)
 * - No trailing whitespace
 * - 2-space indentation
 * - Numbers: no unnecessary precision loss
 */

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

export function canonicalEquals(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}
