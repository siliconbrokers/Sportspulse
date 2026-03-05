/**
 * Generates expected.snapshot.json for each golden fixture.
 * Run: npx vitest run tools/scripts/update-golden-fixtures.test.ts
 *
 * WARNING: Only run this when intentionally updating golden expectations.
 * Per Golden_Snapshot_Fixtures spec §10, fixture updates require explicit justification.
 */
import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { buildSnapshot } from '../src/index.js';
import { MVP_POLICY } from '@sportpulse/scoring';

const FIXTURES_DIR = resolve(__dirname, '../../../tools/fixtures/golden');
const SKIP_FIXTURES = ['F5_stale_fallback'];

describe('update golden fixtures', () => {
  const fixtures = readdirSync(FIXTURES_DIR).filter(
    (d) => d.startsWith('F') && !SKIP_FIXTURES.includes(d),
  );

  for (const fixtureName of fixtures) {
    it(`generates ${fixtureName}/expected.snapshot.json`, () => {
      const dir = join(FIXTURES_DIR, fixtureName);
      const contextPath = join(dir, 'context.json');
      const inputPath = join(dir, 'input.canonical.json');

      if (!existsSync(contextPath) || !existsSync(inputPath)) return;

      const context = JSON.parse(readFileSync(contextPath, 'utf-8'));
      const input = JSON.parse(readFileSync(inputPath, 'utf-8'));

      const snapshot = buildSnapshot({
        competitionId: context.competitionId,
        seasonId: context.seasonId,
        buildNowUtc: context.buildNowUtc,
        timezone: context.timezone,
        teams: input.teams,
        matches: input.matches,
        policy: MVP_POLICY,
        container: context.layout.container,
      });

      const frozen = {
        ...snapshot,
        header: { ...snapshot.header, computedAtUtc: '<<EXCLUDED>>' },
      };

      const outputPath = join(dir, 'expected.snapshot.json');
      writeFileSync(outputPath, JSON.stringify(frozen, null, 2) + '\n');
    });
  }
});
