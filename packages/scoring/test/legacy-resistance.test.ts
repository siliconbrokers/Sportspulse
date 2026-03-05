import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

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

const FORBIDDEN_LEGACY_TERMS = [
  'SIZE_SCORE',
  'PROXIMITY_BONUS',
  'HOT_MATCH_SCORE',
  'scoreVersion',
  'sizeScore',
  'proximityBonus',
];

const SCANNED_PACKAGES = ['scoring', 'signals', 'snapshot'];

describe('Legacy resistance guards', () => {
  for (const pkg of SCANNED_PACKAGES) {
    describe(`packages/${pkg}/src`, () => {
      const pkgSrcDir = join(PACKAGES_ROOT, pkg, 'src');
      const files = getTypeScriptFiles(pkgSrcDir);

      for (const term of FORBIDDEN_LEGACY_TERMS) {
        it(`must not contain forbidden legacy term '${term}'`, () => {
          for (const file of files) {
            const content = readFileSync(file, 'utf-8');
            const hasTerm = content.includes(term);
            expect(hasTerm, `${file} contains forbidden legacy term '${term}'`).toBe(false);
          }
        });
      }
    });
  }
});
