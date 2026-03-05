import type { SignalDTO } from '@sportpulse/signals';
import type { PolicyDefinition } from '../policies/policy-identity.js';
import type { ContributionDTO } from '../policies/contribution.js';
import { sortContributions } from '../policies/contribution.js';

/**
 * Result of executing a scoring policy for a single entity.
 *
 * Spec refs:
 * - Signals Spec §5.3 (AttentionScoreDTO)
 * - Scoring Policy Spec (weighted_sum formula)
 * - Acceptance Matrix C-01, C-02, C-03
 */
export interface ScoringResult {
  entityId: string;
  entityKind: 'TEAM' | 'MATCH';
  policyKey: string;
  policyVersion: number;
  rawScore: number;
  attentionScore: number;
  displayScore: number;
  layoutWeight: number;
  topContributions: ContributionDTO[];
}

/**
 * Executes a scoring policy against a set of signals for a single entity.
 *
 * MVP v1 rules:
 * - rawScoreFormula = 'weighted_sum': rawScore = sum(normValue * weight)
 * - attentionScore = rawScore (MVP identity)
 * - displayScore = rawScore (MVP identity)
 * - layoutWeight = max(0, rawScore) (MVP — non-negative)
 * - Missing signals contribute 0 and are excluded from topContributions
 *
 * @param entityId - canonical entity ID
 * @param signals - SignalDTOs for this entity
 * @param policy - policy definition to apply
 */
export function executePolicy(
  entityId: string,
  signals: readonly SignalDTO[],
  policy: PolicyDefinition,
): ScoringResult {
  // Build signal lookup by key
  const signalMap = new Map<string, SignalDTO>();
  for (const s of signals) {
    signalMap.set(s.key, s);
  }

  const contributions: ContributionDTO[] = [];
  let rawScore = 0;

  for (const weightEntry of policy.weights) {
    const signal = signalMap.get(weightEntry.signalKey);

    if (!signal || signal.quality.missing) {
      // Missing signal → contributes 0, excluded from topContributions
      continue;
    }

    const contribution = signal.value * weightEntry.weight;
    rawScore += contribution;

    contributions.push({
      signalKey: weightEntry.signalKey,
      rawValue: typeof signal.params?.rawPoints === 'number'
        ? signal.params.rawPoints as number
        : typeof signal.params?.hours === 'number'
          ? signal.params.hours as number
          : undefined,
      normValue: signal.value,
      weight: weightEntry.weight,
      contribution,
    });
  }

  // MVP v1: identity mappings
  const attentionScore = rawScore;
  const displayScore = rawScore;
  const layoutWeight = Math.max(0, rawScore);

  return {
    entityId,
    entityKind: policy.entityKind,
    policyKey: policy.policyKey,
    policyVersion: policy.policyVersion,
    rawScore,
    attentionScore,
    displayScore,
    layoutWeight,
    topContributions: sortContributions(contributions),
  };
}
