/**
 * injury-impact.ts — NEXUS Track 1 Phase 1B: Position-Differentiated Injury Impact.
 *
 * Spec authority:
 *   - taxonomy spec S3.2 Extension 2: Injury-Adjusted Team Strength
 *   - NEXUS-0 S6.1: MISSING sentinel for absent data (never null/0/undefined)
 *   - entity-identity S8.1: AvailabilityState exhaustive union
 *   - entity-identity S7.1: UNRESOLVED/CONFLICTED players excluded
 *   - entity-identity types.ts: PositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD'
 *   - entity-identity constants: DOUBT_WEIGHT = 0.5
 *
 * INVARIANTS:
 *   - Pure function. No Date.now(). No Math.random(). No IO.
 *   - If dataAvailable=false: injury_impact_score.value === MISSING. NEVER 0.0.
 *   - DOUBT applies 0.5 weight multiplier (taxonomy spec S3.2 Ext 2, entity-identity DOUBT_WEIGHT).
 *   - Cap at MAX_ABSENCE_ADJUSTMENT (taxonomy spec S3.2 Ext 2, default 0.20).
 *   - UNRESOLVED/CONFLICTED players: excluded (entity-identity S7.1, S9.1).
 *   - PositionGroup follows entity-identity types: 'GK' | 'DEF' | 'MID' | 'FWD'.
 *
 * @module nexus/track1/injury-impact
 */

import { MISSING } from '../feature-store/types.js';
import type { FeatureValue, FeatureProvenance } from '../feature-store/types.js';
import type { AvailabilityState, PositionGroup } from '../entity-identity/types.js';
import { DOUBT_WEIGHT } from '../entity-identity/types.js';

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Maximum absence adjustment per team.
 * taxonomy spec S3.2 Extension 2: "capped by MAX_ABSENCE_ADJUSTMENT (default 0.20)
 * -- a 20% maximum reduction in effective team strength".
 */
export const MAX_ABSENCE_ADJUSTMENT = 0.20;

/**
 * Default position impact weights per positional group.
 *
 * taxonomy spec S3.2 Extension 2: "importance weights per positional group are
 * configurable per league, determined offline through historical analysis".
 *
 * GK has the highest individual impact (single GK — absence is uniquely disruptive).
 * FWD has the lowest per-player weight (multiple interchangeable attackers).
 *
 * These align with V3 POSITION_IMPACT values used in absence-adjustment.ts.
 */
export const DEFAULT_POSITION_IMPACT_WEIGHTS: Record<PositionGroup, number> = {
  GK: 0.18,   // Goalkeeper absent = high individual impact
  DEF: 0.12,  // Key defender absent
  MID: 0.08,  // Midfielder absent
  FWD: 0.06,  // Forward absent (multiple rotational options)
};

// ── Domain types ───────────────────────────────────────────────────────────

/**
 * A single player absence record for injury impact computation.
 *
 * taxonomy spec S3.2 Extension 2, Step 4:
 * "For each confirmed absence with confidence >= MEDIUM:
 *   a. Retrieve the absent player's importance weight by positional group."
 *
 * Only CONFIRMED_ABSENT and DOUBT are actionable states.
 * CONFIRMED_AVAILABLE and UNKNOWN carry no adjustment.
 * UNRESOLVED/CONFLICTED are excluded before this function is called
 * (entity-identity S7.1, S9.1).
 */
export interface PlayerAbsence {
  readonly canonicalPlayerId: string;
  /** PositionGroup per entity-identity types: 'GK' | 'DEF' | 'MID' | 'FWD' */
  readonly position: PositionGroup;
  readonly availability: Extract<AvailabilityState, 'CONFIRMED_ABSENT' | 'DOUBT'>;
}

/**
 * Result of injury impact computation for one team.
 *
 * taxonomy spec S3.2 Extension 2 + taxonomy spec S3.5 (Track 3 features table):
 * - injury_data_available: binary indicator required by spec (S3.5, row 399)
 * - injury_impact_score: MISSING when dataAvailable=false (NEXUS-0 S6.1)
 * - absences_by_position: aggregate count by positional group for explainability
 * - doubt_weight_applied: whether any DOUBT-weighted absences were included
 */
export interface InjuryImpactResult {
  readonly injury_data_available: boolean;
  readonly injury_impact_score: FeatureValue<number>;
  readonly absences_by_position: Partial<Record<PositionGroup, number>>;
  readonly doubt_weight_applied: boolean;
}

// ── Core function ─────────────────────────────────────────────────────────

/**
 * Compute position-differentiated injury impact for a team.
 *
 * taxonomy spec S3.2 Extension 2: Injury-Adjusted Team Strength.
 *
 * Algorithm:
 * 1. If dataAvailable=false: return MISSING sentinel for injury_impact_score.
 *    Never return 0.0 — "no data" is distinct from "no absences" (NEXUS-0 S6.1).
 * 2. For each CONFIRMED_ABSENT: apply full position weight.
 * 3. For each DOUBT: apply position weight * DOUBT_WEIGHT (0.5).
 * 4. Sum all individual impacts; cap at MAX_ABSENCE_ADJUSTMENT (0.20).
 * 5. Build absences_by_position count map for explainability.
 *
 * @param absences - Pre-filtered list of CONFIRMED_ABSENT or DOUBT players.
 *   Caller must exclude UNRESOLVED/CONFLICTED players before passing here
 *   (entity-identity S7.1, S9.1).
 * @param dataAvailable - Whether injury data was obtained from the feature store.
 *   False means the lookup was attempted and returned no data (not zero absences).
 * @param buildNowUtc - ISO-8601 UTC anchor for provenance timestamps.
 * @param positionWeights - Optional override of per-position impact weights.
 *   When omitted, DEFAULT_POSITION_IMPACT_WEIGHTS is used.
 * @returns InjuryImpactResult with MISSING sentinel when dataAvailable=false.
 */
export function computeInjuryImpact(
  absences: readonly PlayerAbsence[],
  dataAvailable: boolean,
  buildNowUtc = new Date(0).toISOString(),
  positionWeights: Record<PositionGroup, number> = DEFAULT_POSITION_IMPACT_WEIGHTS,
): InjuryImpactResult {
  // NEXUS-0 S6.1: when data is unavailable, return MISSING — never 0.0.
  // The consuming model must treat "no data" as a distinct state from "no absences".
  if (!dataAvailable) {
    const missingProvenance: FeatureProvenance = {
      source: 'api-football',
      ingestedAt: buildNowUtc,
      effectiveAt: buildNowUtc,
      confidence: 'UNKNOWN',
      freshness: 0,
    };
    return {
      injury_data_available: false,
      injury_impact_score: {
        value: MISSING,
        provenance: missingProvenance,
      },
      absences_by_position: {},
      doubt_weight_applied: false,
    };
  }

  // taxonomy spec S3.2 Extension 2, Step 4:
  // Accumulate weighted sum of absent player impacts.
  let totalImpact = 0;
  let hasDoubt = false;
  const absencesByPosition: Partial<Record<PositionGroup, number>> = {};

  for (const absence of absences) {
    const baseWeight = positionWeights[absence.position];

    // DOUBT: apply half weight (entity-identity DOUBT_WEIGHT = 0.5).
    // taxonomy spec S3.2 Ext 2: "CONFIRMED_ABSENT with confidence >= MEDIUM"
    // applies full weight; DOUBT is treated with partial confidence.
    const effectiveWeight =
      absence.availability === 'DOUBT'
        ? baseWeight * DOUBT_WEIGHT
        : baseWeight;

    if (absence.availability === 'DOUBT') {
      hasDoubt = true;
    }

    totalImpact += effectiveWeight;

    // Build position-level count for explainability.
    absencesByPosition[absence.position] =
      (absencesByPosition[absence.position] ?? 0) + 1;
  }

  // taxonomy spec S3.2 Extension 2: "capped by MAX_ABSENCE_ADJUSTMENT (default 0.20)".
  const cappedImpact = Math.min(totalImpact, MAX_ABSENCE_ADJUSTMENT);

  const provenance: FeatureProvenance = {
    source: 'api-football',
    ingestedAt: buildNowUtc,
    effectiveAt: buildNowUtc,
    confidence: hasDoubt ? 'MEDIUM' : 'HIGH',
    freshness: 0,
  };

  return {
    injury_data_available: true,
    injury_impact_score: {
      value: cappedImpact,
      provenance,
    },
    absences_by_position: absencesByPosition,
    doubt_weight_applied: hasDoubt,
  };
}
