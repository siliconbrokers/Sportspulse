/**
 * League Strength Bridging — §10.2, §10.3, §10.4, §10.5
 *
 * Applies the inter-league/inter-country Elo adjustment for INTERNATIONAL_CLUB
 * competitions only. This adjusts a club's domestic Elo to a comparable
 * international scale.
 *
 * §10.2 formula:
 *   effective_elo_team = team_elo + league_strength_factor(team_domain_id)
 *
 * §10.4: If league_strength_factor is MISSING for INTERNATIONAL_CLUB:
 *   - Cannot operate in FULL_MODE
 *   - Must degrade to at least LIMITED_MODE
 *   - applicability_level cannot be STRONG
 *
 * §10.5: For NATIONAL_TEAM_TOURNAMENT — bridging does NOT apply.
 *
 * All functions are PURE. No IO, no hidden state.
 */

import type { LeagueStrengthFactorRecord } from '../contracts/index.js';

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Result of a successful bridging application.
 */
export interface BridgingResultSuccess {
  readonly canBeFull: true;
  /** Adjusted Elo including league strength factor. §10.2 */
  readonly effectiveElo: number;
  /** The raw adjustment value applied. */
  readonly leagueStrengthValue: number;
  /** Version of the factor record used. §10.3 */
  readonly factorVersion: string;
  /** Confidence level of the applied factor. §10.3 */
  readonly confidenceLevel: LeagueStrengthFactorRecord['confidence_level'];
}

/**
 * Result when bridging cannot be applied (factor missing or not applicable).
 * §10.4: when factor is missing, canBeFull = false.
 */
export interface BridgingResultDegraded {
  readonly canBeFull: false;
  /**
   * Reason for degradation.
   * - MISSING_LEAGUE_STRENGTH: §10.4 — factor record absent
   * - NOT_APPLICABLE: §10.5 — not an INTERNATIONAL_CLUB match
   * - FACTOR_EXPIRED: the factor's effective_to_utc is in the past
   * - DOMAIN_MISMATCH: factor's team_domain_id does not match the team's domain
   */
  readonly reason:
    | 'MISSING_LEAGUE_STRENGTH'
    | 'NOT_APPLICABLE'
    | 'FACTOR_EXPIRED'
    | 'DOMAIN_MISMATCH';
  /** The unmodified base Elo when bridging is not applied. */
  readonly effectiveElo: number;
}

/** Discriminated union result type for bridging. */
export type BridgingResult = BridgingResultSuccess | BridgingResultDegraded;

// ── Implementation ────────────────────────────────────────────────────────

/**
 * Apply league strength bridging for an INTERNATIONAL_CLUB match.
 *
 * §10.2: effective_elo_team = team_elo + league_strength_factor(team_domain_id)
 * §10.3: factor must be versioned, persisted, temporally bounded.
 * §10.4: absence → canBeFull = false, reason = MISSING_LEAGUE_STRENGTH.
 *
 * @param teamElo - Base Elo from the domestic pool
 * @param teamDomainId - The team's league/country/association domain ID
 * @param factorRecord - The applicable LeagueStrengthFactorRecord, or null
 * @param kickoffUtc - Match kickoff time for temporal validation
 * @returns BridgingResult
 */
export function applyLeagueStrengthBridging(
  teamElo: number,
  teamDomainId: string,
  factorRecord: LeagueStrengthFactorRecord | null | undefined,
  kickoffUtc: string,
): BridgingResult {
  // §10.4: missing factor → cannot be FULL_MODE
  if (factorRecord == null) {
    return {
      canBeFull: false,
      reason: 'MISSING_LEAGUE_STRENGTH',
      effectiveElo: teamElo,
    };
  }

  // Domain must match §10.3
  if (factorRecord.team_domain_id !== teamDomainId) {
    return {
      canBeFull: false,
      reason: 'DOMAIN_MISMATCH',
      effectiveElo: teamElo,
    };
  }

  // Temporal validity: factor must be in effect at kickoff time
  // §10.3: "debe tener vigencia temporal"
  if (factorRecord.effective_to_utc !== null) {
    const kickoffMs = new Date(kickoffUtc).getTime();
    const expiryMs = new Date(factorRecord.effective_to_utc).getTime();
    if (kickoffMs > expiryMs) {
      return {
        canBeFull: false,
        reason: 'FACTOR_EXPIRED',
        effectiveElo: teamElo,
      };
    }
  }

  // §10.2: effective_elo_team = team_elo + league_strength_factor
  const effectiveElo = teamElo + factorRecord.value;

  return {
    canBeFull: true,
    effectiveElo,
    leagueStrengthValue: factorRecord.value,
    factorVersion: factorRecord.league_strength_factor_version,
    confidenceLevel: factorRecord.confidence_level,
  };
}

/**
 * Determine whether bridging is applicable for a given competition family.
 *
 * §10.5: national team tournaments do NOT use bridging.
 * Only INTERNATIONAL_CLUB uses bridging.
 *
 * Pure function — no side effects.
 */
export function isBridgingApplicable(
  competitionFamily:
    | 'DOMESTIC_LEAGUE'
    | 'DOMESTIC_CUP'
    | 'INTERNATIONAL_CLUB'
    | 'NATIONAL_TEAM_TOURNAMENT',
): boolean {
  return competitionFamily === 'INTERNATIONAL_CLUB';
}

/**
 * Apply bridging for a national team match.
 * §10.5: bridging is NOT applied — returns the base Elo unchanged.
 *
 * This is a convenience function to be explicit about the §10.5 rule.
 */
export function applyNationalTeamBridging(teamElo: number): BridgingResultDegraded {
  return {
    canBeFull: false,
    reason: 'NOT_APPLICABLE',
    effectiveElo: teamElo,
  };
}
