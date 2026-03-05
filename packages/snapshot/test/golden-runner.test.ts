import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { buildSnapshot } from '../src/index.js';
import type { DashboardSnapshotDTO } from '../src/index.js';
import { MVP_POLICY } from '@sportpulse/scoring';
import {
  assertSemanticMatch,
  assertContractMatch,
  assertGeometryMatch,
} from '../../../tools/fixtures/lib/compare.js';

const FIXTURES_DIR = resolve(__dirname, '../../../tools/fixtures/golden');
const SKIP_FIXTURES = ['F5_stale_fallback'];

function getFixtureDirs(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((d) => d.startsWith('F') && !SKIP_FIXTURES.includes(d))
    .sort();
}

function loadAndBuild(fixtureName: string): {
  actual: DashboardSnapshotDTO;
  expected: DashboardSnapshotDTO;
} {
  const dir = join(FIXTURES_DIR, fixtureName);
  const context = JSON.parse(readFileSync(join(dir, 'context.json'), 'utf-8'));
  const input = JSON.parse(readFileSync(join(dir, 'input.canonical.json'), 'utf-8'));

  const actual = buildSnapshot({
    competitionId: context.competitionId,
    seasonId: context.seasonId,
    buildNowUtc: context.buildNowUtc,
    timezone: context.timezone,
    teams: input.teams,
    matches: input.matches,
    policy: MVP_POLICY,
    container: context.layout.container,
  });

  const expectedRaw = JSON.parse(readFileSync(join(dir, 'expected.snapshot.json'), 'utf-8'));

  return { actual, expected: expectedRaw };
}

describe('Golden fixture runner', () => {
  for (const fixtureName of getFixtureDirs()) {
    describe(fixtureName, () => {
      const expectedPath = join(FIXTURES_DIR, fixtureName, 'expected.snapshot.json');

      if (!existsSync(expectedPath)) {
        it.skip('expected.snapshot.json not yet generated', () => {});
        return;
      }

      const { actual, expected } = loadAndBuild(fixtureName);

      it('semantic match', () => {
        const results = assertSemanticMatch(actual, expected);
        const failures = results.filter((r) => !r.pass);
        if (failures.length > 0) {
          throw new Error(
            'Semantic comparison failed:\n' + failures.map((f) => `  - ${f.message}`).join('\n'),
          );
        }
      });

      it('contract match', () => {
        const results = assertContractMatch(actual, expected);
        const failures = results.filter((r) => !r.pass);
        if (failures.length > 0) {
          throw new Error(
            'Contract comparison failed:\n' + failures.map((f) => `  - ${f.message}`).join('\n'),
          );
        }
      });

      it('geometry match', () => {
        const results = assertGeometryMatch(actual, expected);
        const failures = results.filter((r) => !r.pass);
        if (failures.length > 0) {
          throw new Error(
            'Geometry comparison failed:\n' + failures.map((f) => `  - ${f.message}`).join('\n'),
          );
        }
      });
    });
  }
});
