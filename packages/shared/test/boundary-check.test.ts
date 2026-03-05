import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { FORBIDDEN_IMPORTS } from '../src/utils/boundary-check.js';

function getTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...getTypeScriptFiles(fullPath));
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.spec.ts')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist yet
  }
  return files;
}

const PACKAGES_ROOT = resolve(__dirname, '../../');

describe('Boundary enforcement', () => {
  for (const [pkg, forbidden] of Object.entries(FORBIDDEN_IMPORTS)) {
    describe(`packages/${pkg}`, () => {
      const pkgSrcDir = join(PACKAGES_ROOT, pkg, 'src');
      const files = getTypeScriptFiles(pkgSrcDir);

      for (const forbiddenImport of forbidden) {
        it(`must not import from ${forbiddenImport}`, () => {
          for (const file of files) {
            const content = readFileSync(file, 'utf-8');
            const hasImport = content.includes(`from '${forbiddenImport}`) ||
                              content.includes(`from "${forbiddenImport}`) ||
                              content.includes(`require('${forbiddenImport}`) ||
                              content.includes(`require("${forbiddenImport}`);
            expect(hasImport, `${file} imports ${forbiddenImport}`).toBe(false);
          }
        });
      }
    });
  }
});
