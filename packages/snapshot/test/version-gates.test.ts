/**
 * SP-0903: Version Bump Regression Gates
 *
 * Detects when scoring/layout/schema semantics change WITHOUT
 * a corresponding version bump. Prevents silent drift.
 *
 * Acceptance: I-02, I-03, I-04
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { buildSnapshot } from '../src/index.js';
import { MVP_POLICY } from '@sportpulse/scoring';
import { extractShape } from '../../../tools/fixtures/lib/shape-check.js';

const GOLDEN_DIR = resolve(__dirname, '../../../tools/fixtures/golden');
const FIXTURE = 'F1_baseline_normal';

function loadFixture() {
  const dir = join(GOLDEN_DIR, FIXTURE);
  const context = JSON.parse(readFileSync(join(dir, 'context.json'), 'utf-8'));
  const input = JSON.parse(readFileSync(join(dir, 'input.canonical.json'), 'utf-8'));
  const expected = JSON.parse(readFileSync(join(dir, 'expected.snapshot.json'), 'utf-8'));
  const versions = JSON.parse(readFileSync(join(GOLDEN_DIR, 'version-expectations.json'), 'utf-8'));

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

  return { actual, expected, versions };
}

describe('Version bump regression gates', () => {
  const { actual, expected, versions } = loadFixture();

  describe('I-02: Scoring version gate', () => {
    it('scoring output matches expected OR policyVersion bumped', () => {
      const scoringChanged = actual.teams.some((team, i) => {
        const exp = expected.teams[i];
        if (!exp) return true;
        return (
          team.rawScore !== exp.rawScore ||
          team.attentionScore !== exp.attentionScore ||
          team.displayScore !== exp.displayScore ||
          team.layoutWeight !== exp.layoutWeight
        );
      });

      if (scoringChanged) {
        expect(
          actual.header.policyVersion,
          'Scoring changed without policyVersion bump — update policyVersion in MVP_POLICY',
        ).not.toBe(versions.policyVersion);
      }
    });
  });

  describe('I-03: Layout version gate', () => {
    it('geometry output matches expected OR layoutAlgorithmVersion bumped', () => {
      const geometryChanged = actual.teams.some((team, i) => {
        const exp = expected.teams[i];
        if (!exp) return true;
        return (
          team.rect.x !== exp.rect.x ||
          team.rect.y !== exp.rect.y ||
          team.rect.w !== exp.rect.w ||
          team.rect.h !== exp.rect.h
        );
      });

      if (geometryChanged) {
        expect(
          actual.layout.algorithmVersion,
          'Geometry changed without layoutAlgorithmVersion bump — update algorithmVersion in layout',
        ).not.toBe(versions.layoutAlgorithmVersion);
      }
    });
  });

  describe('I-04: Schema version gate', () => {
    it('DTO shape matches expected OR snapshotSchemaVersion bumped', () => {
      // Normalize computedAtUtc (excluded in golden expected files)
      const normalizedActual = {
        ...actual,
        header: { ...actual.header, computedAtUtc: '<<EXCLUDED>>' },
      };
      const actualShape = extractShape(normalizedActual);
      const expectedShape = extractShape(expected);

      const shapeChanged = JSON.stringify(actualShape) !== JSON.stringify(expectedShape);

      if (shapeChanged) {
        expect(
          actual.header.snapshotSchemaVersion,
          'DTO shape changed without snapshotSchemaVersion bump — update snapshotSchemaVersion',
        ).not.toBe(versions.snapshotSchemaVersion);
      }
    });
  });
});
