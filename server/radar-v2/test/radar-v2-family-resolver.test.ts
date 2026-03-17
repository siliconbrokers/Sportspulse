import { describe, it, expect } from 'vitest';
import { resolveSecondaryBadges, resolveFamilies } from '../radar-v2-family-resolver.js';
import type { V2EvaluatedMatch } from '../radar-v2-candidate-evaluator.js';
import type { FamilyScore } from '../radar-v2-types.js';

function makeFamilyScore(overrides: Partial<FamilyScore>): FamilyScore {
  return {
    family: 'CONTEXT',
    score: 50,
    active: false,
    bestLabel: 'EN_LA_MIRA',
    bestLabelScore: 50,
    labels: [
      { label: 'EN_LA_MIRA', score: 50 },
      { label: 'BAJO_EL_RADAR', score: 30 },
    ],
    ...overrides,
  };
}

function makeV2Eval(overrides: Partial<V2EvaluatedMatch> = {}): V2EvaluatedMatch {
  return {
    matchId: 'match-1',
    v1Eval: {} as any,
    familyScores: [
      makeFamilyScore({ family: 'CONTEXT', score: 70, active: true, bestLabel: 'EN_LA_MIRA', bestLabelScore: 70 }),
      makeFamilyScore({ family: 'DYNAMICS', score: 40, active: false, bestLabel: 'PARTIDO_ABIERTO', bestLabelScore: 40 }),
      makeFamilyScore({ family: 'MISALIGNMENT', score: 30, active: false, bestLabel: 'SENAL_DE_ALERTA', bestLabelScore: 30 }),
    ],
    dominantFamily: 'CONTEXT',
    primaryLabel: 'EN_LA_MIRA',
    radarScore: 73,
    confidenceBand: 'MEDIUM',
    evidenceTier: 'STABLE',
    ...overrides,
  };
}

describe('RadarV2 Family Resolver', () => {
  describe('resolveSecondaryBadges', () => {
    it('returns no badges when no other family is active', () => {
      const ev = makeV2Eval();
      const badges = resolveSecondaryBadges(ev);
      expect(badges).toHaveLength(0);
    });

    it('returns badge from active non-dominant family', () => {
      const ev = makeV2Eval({
        familyScores: [
          makeFamilyScore({ family: 'CONTEXT', score: 70, active: true, bestLabel: 'EN_LA_MIRA', bestLabelScore: 70 }),
          makeFamilyScore({ family: 'DYNAMICS', score: 65, active: true, bestLabel: 'PARTIDO_ABIERTO', bestLabelScore: 65 }),
          makeFamilyScore({ family: 'MISALIGNMENT', score: 30, active: false, bestLabel: 'SENAL_DE_ALERTA', bestLabelScore: 30 }),
        ],
      });
      const badges = resolveSecondaryBadges(ev);
      expect(badges).toEqual(['PARTIDO_ABIERTO']);
    });

    it('returns up to 2 badges from 2 active non-dominant families', () => {
      const ev = makeV2Eval({
        familyScores: [
          makeFamilyScore({ family: 'CONTEXT', score: 70, active: true, bestLabel: 'EN_LA_MIRA', bestLabelScore: 70 }),
          makeFamilyScore({ family: 'DYNAMICS', score: 65, active: true, bestLabel: 'PARTIDO_ABIERTO', bestLabelScore: 65 }),
          makeFamilyScore({ family: 'MISALIGNMENT', score: 66, active: true, bestLabel: 'SENAL_DE_ALERTA', bestLabelScore: 66 }),
        ],
      });
      const badges = resolveSecondaryBadges(ev);
      expect(badges).toHaveLength(2);
      // MISALIGNMENT has higher score, so comes first
      expect(badges[0]).toBe('SENAL_DE_ALERTA');
      expect(badges[1]).toBe('PARTIDO_ABIERTO');
    });

    it('never returns more than 2 badges', () => {
      const ev = makeV2Eval({
        familyScores: [
          makeFamilyScore({ family: 'CONTEXT', score: 70, active: true, bestLabel: 'EN_LA_MIRA', bestLabelScore: 70 }),
          makeFamilyScore({ family: 'DYNAMICS', score: 65, active: true, bestLabel: 'PARTIDO_ABIERTO', bestLabelScore: 65 }),
          makeFamilyScore({ family: 'MISALIGNMENT', score: 66, active: true, bestLabel: 'SENAL_DE_ALERTA', bestLabelScore: 66 }),
        ],
      });
      const badges = resolveSecondaryBadges(ev);
      expect(badges.length).toBeLessThanOrEqual(2);
    });
  });

  describe('resolveFamilies', () => {
    it('returns correct dominant family', () => {
      const ev = makeV2Eval();
      const result = resolveFamilies(ev);
      expect(result.dominantFamily).toBe('CONTEXT');
      expect(result.primaryLabel).toBe('EN_LA_MIRA');
    });

    it('lists active families correctly', () => {
      const ev = makeV2Eval({
        familyScores: [
          makeFamilyScore({ family: 'CONTEXT', score: 70, active: true }),
          makeFamilyScore({ family: 'DYNAMICS', score: 65, active: true }),
          makeFamilyScore({ family: 'MISALIGNMENT', score: 30, active: false }),
        ],
      });
      const result = resolveFamilies(ev);
      expect(result.activeFamilies).toContain('CONTEXT');
      expect(result.activeFamilies).toContain('DYNAMICS');
      expect(result.activeFamilies).not.toContain('MISALIGNMENT');
    });
  });
});
