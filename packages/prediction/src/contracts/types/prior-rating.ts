/**
 * PriorRating and PriorRatingConditions types.
 *
 * Spec authority: §20 (Política de equipos nuevos o poca historia),
 *                 §20.2 (Regla operativa para prior_rating)
 *
 * DESIGN NOTES:
 * - `PriorRatingConditions` captures the hard conditions that must ALL be true
 *   for a prior rating to be considered "utilizable" per §20.2.
 * - These are not inputs to the engine; they are computed facts about a team's
 *   rating that the Validation Layer uses to determine eligibility.
 * - `team_domain` in PriorRating must match the competition's team_domain.
 *   If they differ, prior_rating_domain_mismatch = true and the match is
 *   NOT_ELIGIBLE (§19.6, §20.2).
 */

import type { TeamDomain } from './competition-profile.js';

/**
 * Evaluated utilizable conditions for a prior rating.
 *
 * All five conditions must be true for the prior rating to be considered
 * utilizable. Any false condition means the rating cannot be used.
 * §20.2
 */
export interface PriorRatingConditions {
  /**
   * The prior rating belongs to the same team_domain as the current match.
   * False => prior_rating_domain_mismatch => NOT_ELIGIBLE. §20.2, §19.6
   */
  domain_matches: boolean;

  /**
   * The age of the prior rating (days since last update to kickoff_utc)
   * does not exceed prior_rating_max_age_days (400 days). §20.2
   */
  age_within_limit: boolean;

  /**
   * The team has at least prior_rating_min_updates_last_730d (3) official
   * matches that were used to build or update this rating within the
   * applicable historical window. §20.2
   */
  sufficient_updates_in_window: boolean;

  /**
   * Cross-season carry is either not needed or is permitted by
   * prior_rating_cross_season_carry_allowed. §20.2
   */
  cross_season_carry_valid: boolean;

  /**
   * Computed summary: all four conditions above are true. This is the
   * authoritative "is_utilizable" flag consumed by the Validation Layer.
   * §20.2
   */
  is_utilizable: boolean;
}

/**
 * Prior rating record for a team, with provenance metadata.
 *
 * Used by the Match Prediction Engine as the base rating when a team
 * lacks sufficient recent match history. §20.1, §20.2
 */
export interface PriorRating {
  /** Canonical team identifier. */
  team_id: string;

  /**
   * Domain of this rating record.
   * Must match the competition's team_domain for utilizable status. §20.2
   */
  team_domain: TeamDomain;

  /** The Elo (or extended Elo) rating value. */
  rating_value: number;

  /**
   * ISO-8601 UTC timestamp of the most recent update that contributed to
   * this rating. Used to compute age against kickoff_utc. §20.2
   */
  last_updated_utc: string;

  /**
   * Number of official matches used to construct or update this rating
   * within the historical window. Must be >= prior_rating_min_updates_last_730d. §20.2
   */
  updates_in_last_730d: number;

  /**
   * If this rating was carried across a season boundary, records the
   * season from which it was carried. §20.2
   */
  carried_from_season_id?: string | null;

  /**
   * Evaluated hard conditions for this specific (team + match) combination.
   * Computed by the Validation Layer against kickoff_utc. §20.2
   */
  conditions?: PriorRatingConditions | null;
}
