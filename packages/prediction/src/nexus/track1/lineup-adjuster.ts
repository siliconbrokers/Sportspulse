/**
 * lineup-adjuster.ts — NEXUS Track 1 Phase 1B: Confirmed Lineup Strength Adjustment.
 *
 * Spec authority:
 *   - taxonomy spec S3.2 Extension 2: confirmed lineup used when available;
 *     lineup is NEVER inferred or predicted (NEXUS-0 S4.4, S6.2.4)
 *   - entity-identity S8.3: confirmed_lineup = null when not published at buildNowUtc
 *   - NEXUS-0 S6.1: MISSING sentinel for absent data
 *   - entity-identity S2.1: PositionEnum (including 'GK' for goalkeeper detection)
 *   - entity-identity S9.1: UNRESOLVED/CONFLICTED players excluded
 *
 * INVARIANTS:
 *   - Pure function. No Date.now(). No Math.random(). No IO.
 *   - If squad.confirmedLineup === null: strength_delta.value === MISSING. NEVER inferred.
 *   - Lineup is never predicted — only read from squad.confirmedLineup (NEXUS-0 S4.4).
 *   - Strength delta is always a number when lineup is available; MISSING otherwise.
 *
 * @module nexus/track1/lineup-adjuster
 */

import { MISSING } from '../feature-store/types.js';
import type { FeatureValue, FeatureProvenance } from '../feature-store/types.js';
import type { BaselineSquad, CanonicalPlayer } from '../entity-identity/types.js';

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Strength penalty when the starting goalkeeper is not in the confirmed lineup.
 * taxonomy spec S3.2 Extension 2: GK has the highest per-position importance weight.
 * This is the delta applied to Track1TeamStrength.eloRating-equivalent when the
 * baseline GK is absent from the confirmed lineup.
 *
 * Value aligned with DEFAULT_POSITION_IMPACT_WEIGHTS.GK = 0.18 from injury-impact.ts.
 */
const GK_MISSING_FROM_LINEUP_DELTA = -0.18;

/**
 * Strength delta when confirmed lineup matches baseline expectations (no key
 * absences detected). Neutral — the lineup is as expected.
 */
const NEUTRAL_LINEUP_DELTA = 0;

// ── Domain types ───────────────────────────────────────────────────────────

/**
 * Result of lineup-based strength adjustment for one team.
 *
 * taxonomy spec S3.2 Extension 2:
 * "When the feature store provides a confirmed lineup: use the confirmed
 * starting XI as the base for the absence adjustment."
 *
 * - lineup_available: true when squad.confirmedLineup is non-null.
 * - strength_delta: MISSING when lineup_available=false (NEXUS-0 S6.1).
 *   When available: a number representing the directional strength adjustment.
 *   0.0 = lineup matches baseline; negative = key player absent; positive = unusual strength.
 * - effective_squad_size: number of players in the effective lineup.
 */
export interface LineupAdjustmentResult {
  readonly lineup_available: boolean;
  readonly strength_delta: FeatureValue<number>;
  readonly effective_squad_size: number;
}

// ── Core function ─────────────────────────────────────────────────────────

/**
 * Compute lineup-based strength adjustment for a team.
 *
 * taxonomy spec S3.2 Extension 2: "When the confirmed lineup is NOT available:
 * use baseline squad minus confirmed absences. The confirmed lineup is never
 * predicted or inferred."
 *
 * When confirmedLineup is available, this function compares it against
 * the baseline to identify key positional absences. Currently implements
 * the GK presence check as Phase 1B baseline; additional positional analysis
 * is extensible.
 *
 * Algorithm:
 * 1. If squad.confirmedLineup === null: return MISSING (lineup not published yet).
 * 2. Identify baseline goalkeeper(s) from baselinePlayers.
 * 3. Check whether any baseline GK appears in the confirmed lineup.
 * 4. If no baseline GK is in the lineup: apply GK_MISSING_FROM_LINEUP_DELTA.
 * 5. Otherwise: NEUTRAL_LINEUP_DELTA (0.0).
 *
 * @param squad - BaselineSquad from entity-identity layer.
 *   squad.confirmedLineup === null means the lineup has not been published
 *   at the current buildNowUtc (NEXUS-0 S6.2.4).
 * @param buildNowUtc - ISO-8601 UTC anchor for provenance timestamps.
 * @returns LineupAdjustmentResult with MISSING when lineup not available.
 */
export function computeLineupAdjustment(
  squad: BaselineSquad,
  buildNowUtc: string,
): LineupAdjustmentResult {
  // taxonomy spec S3.2 Ext 2, NEXUS-0 S4.4:
  // Lineup is never inferred. If not published, return MISSING.
  if (squad.confirmedLineup === null) {
    const missingProvenance: FeatureProvenance = {
      source: 'api-football',
      ingestedAt: buildNowUtc,
      effectiveAt: buildNowUtc,
      confidence: 'UNKNOWN',
      freshness: 0,
    };
    return {
      lineup_available: false,
      strength_delta: {
        value: MISSING,
        provenance: missingProvenance,
      },
      // When lineup not available, report baseline squad size as effective size estimate.
      effective_squad_size: squad.baselinePlayers.length,
    };
  }

  // Confirmed lineup is available.
  const confirmedLineup = squad.confirmedLineup;
  const confirmedIds = new Set(
    confirmedLineup.map((p) => p.canonicalPlayerId),
  );

  // entity-identity S9.1: only RESOLVED/PARTIAL players are eligible.
  // We compare baseline GKs (primaryPosition === 'GK') against confirmed lineup.
  const baselineGkIds = squad.baselinePlayers
    .filter(isGkPlayer)
    .map((p) => p.canonicalPlayerId);

  const hasBaselineGkInLineup =
    baselineGkIds.length === 0 ||
    baselineGkIds.some((id) => confirmedIds.has(id));

  // Delta: negative when baseline GK is absent from the confirmed lineup,
  // neutral otherwise.
  // taxonomy spec S3.2 Extension 2: "compare confirmed lineup against habitual
  // starters to identify missing regulars".
  const delta = hasBaselineGkInLineup
    ? NEUTRAL_LINEUP_DELTA
    : GK_MISSING_FROM_LINEUP_DELTA;

  const provenance: FeatureProvenance = {
    source: 'api-football',
    ingestedAt: buildNowUtc,
    effectiveAt: buildNowUtc,
    confidence: 'HIGH',
    freshness: 0,
  };

  return {
    lineup_available: true,
    strength_delta: {
      value: delta,
      provenance,
    },
    effective_squad_size: confirmedLineup.length,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Determine if a canonical player's primary position is GK.
 * entity-identity S2.1: PositionEnum includes 'GK'.
 */
function isGkPlayer(player: CanonicalPlayer): boolean {
  return player.primaryPosition === 'GK';
}
