/**
 * Extracts the structural shape of an object as a sorted set of dot-path keys
 * with their value types. Used to detect DTO schema changes.
 */
export function extractShape(obj: unknown, prefix = ''): string[] {
  const paths: string[] = [];

  if (obj === null || obj === undefined) return paths;
  if (typeof obj !== 'object') return paths;

  if (Array.isArray(obj)) {
    if (obj.length > 0) {
      // Only inspect the first element to get array item shape
      const itemPaths = extractShape(obj[0], `${prefix}[]`);
      paths.push(...itemPaths);
    }
    return paths;
  }

  for (const key of Object.keys(obj).sort()) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const val = (obj as Record<string, unknown>)[key];

    if (val === null || val === undefined) {
      // Skip null/undefined — these are optional fields, not schema changes
      continue;
    } else if (Array.isArray(val)) {
      paths.push(`${fullKey}:array`);
      const itemPaths = extractShape(val, `${fullKey}[]`);
      paths.push(...itemPaths);
    } else if (typeof val === 'object') {
      paths.push(`${fullKey}:object`);
      const nested = extractShape(val, fullKey);
      paths.push(...nested);
    } else {
      paths.push(`${fullKey}:${typeof val}`);
    }
  }

  return paths.sort();
}
