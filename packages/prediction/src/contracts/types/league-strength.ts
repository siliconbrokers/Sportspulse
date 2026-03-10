/**
 * League strength factor types for inter-league bridging.
 *
 * Spec authority: §10.3 (Gobernanza del league_strength_factor)
 *
 * DESIGN NOTES:
 * - `LeagueStrengthFactorRecord` is ONLY applicable to INTERNATIONAL_CLUB
 *   competitions (§10.3, §10.5). It must never be applied to NATIONAL_TEAM_TOURNAMENT.
 * - The record is versioned, time-bounded, and auditable per spec §10.3.
 * - `confidence_level` uses the same three-tier string as spec §10.3.
 * - `effective_to_utc` is nullable (null = currently in effect with no expiry).
 */

/**
 * Confidence tier for a league strength factor value.
 *
 * STRONG applicability requires HIGH or MEDIUM confidence. §4.3, §13.1
 * Spec §10.3
 */
export type LeagueStrengthConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * A versioned, time-bounded league strength factor record.
 *
 * Governs effective ELO adjustment for a team's domain (league/country/association)
 * in international club competitions:
 *   effective_elo_team = team_elo + league_strength_factor(team_domain_id)
 *
 * Must be:
 * - versioned (league_strength_factor_version)
 * - persisted
 * - auditable
 * - temporally bounded (effective_from_utc / effective_to_utc)
 * - applied ONLY to INTERNATIONAL_CLUB matches
 *
 * Spec §10.2, §10.3
 */
export interface LeagueStrengthFactorRecord {
  /**
   * Version identifier for this factor record.
   * Must match the `league_strength_factor_version` referenced in
   * PredictionResponse. §10.3, §21
   */
  league_strength_factor_version: string;

  /**
   * Canonical domain identifier (league/country/association).
   * Maps to home_team_domain_id or away_team_domain_id in MatchInput. §10.3
   */
  team_domain_id: string;

  /**
   * The Elo adjustment value to add to the team's base rating
   * when competing in an INTERNATIONAL_CLUB context. §10.2
   */
  value: number;

  /**
   * ISO-8601 UTC timestamp when this factor value became effective. §10.3
   */
  effective_from_utc: string;

  /**
   * ISO-8601 UTC timestamp when this factor value expires.
   * Null means the record is still in effect. §10.3
   */
  effective_to_utc: string | null;

  /**
   * Data source or methodology description for auditability. §10.3
   */
  source: string;

  /**
   * Confidence in this factor's accuracy.
   * STRONG applicability requires HIGH or MEDIUM. §10.3, §13.1
   */
  confidence_level: LeagueStrengthConfidenceLevel;
}
