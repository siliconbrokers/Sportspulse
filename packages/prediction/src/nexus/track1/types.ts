/**
 * types.ts — NEXUS Track 1: tipos de dominio.
 *
 * Spec authority:
 *   - master spec S5.1: Track 1 purpose and output contract
 *   - taxonomy spec S3.2: Dynamic Home Advantage + Adaptive K + Injury Adj
 *   - taxonomy spec S3.4: Track1Output interface
 *
 * Track 1 does NOT produce 1X2 probabilities.
 * It produces team strength estimates consumed by Track 2 and Track 3.
 *
 * @module nexus/track1/types
 */

// ── Historical match input ─────────────────────────────────────────────────

/**
 * One completed match used as input for Track 1 strength estimation.
 * Only FINISHED matches with complete scores must be included.
 *
 * Reuses the same structure as V3MatchRecord (taxonomy spec S1.3: NEXUS
 * inherits canonical base inputs from V3).
 */
export interface HistoricalMatch {
  homeTeamId: string;
  awayTeamId: string;
  /** ISO-8601 UTC kickoff timestamp */
  utcDate: string;
  homeGoals: number;
  awayGoals: number;
  /**
   * Whether the match was played at a neutral venue.
   * MUST come from canonical match data — never inferred.
   * taxonomy spec S3.2 Extension 1: neutral venue → home advantage = 1.0.
   */
  isNeutralVenue: boolean;
}

// ── League Home Advantage ──────────────────────────────────────────────────

/**
 * Estimated home advantage configuration for a specific league.
 *
 * taxonomy spec S3.2 Extension 1: dynamic home advantage per team per season,
 * blended with league-wide shrinkage.
 * Phase 1A implements the league-wide baseline (team-level trending is Phase 1B).
 */
export interface LeagueHomeAdvantageConfig {
  /** League code, e.g. 'PD', 'PL', 'BL1'. */
  leagueId: string;
  /**
   * Estimated home advantage as a goal offset (goals_home_avg - goals_away_avg).
   * Positive means home teams score more on average.
   */
  homeAdvantage: number;
  /** Number of finished, non-neutral-venue matches used to estimate homeAdvantage. */
  sampleSize: number;
  /** ISO 8601 timestamp when this config was computed. */
  computedAt: string;
}

// ── Adaptive K-factor ──────────────────────────────────────────────────────

/**
 * Configuration parameters for the adaptive K-factor.
 *
 * taxonomy spec S3.2 Extension 3: K-factor adapts to competitive importance
 * and season phase (matchday 1 vs mid-season vs final 8).
 * Phase 1A implements the decay-by-matches-observed baseline.
 */
export interface AdaptiveKConfig {
  /** K-factor at the start of the season (match 0 for a team — high uncertainty). */
  k_initial: number;
  /** Minimum K-factor floor — once enough matches are observed, K stabilises. */
  k_floor: number;
  /**
   * Decay rate per observed match.
   * Formula: k = max(k_floor, k_initial * exp(-decay_rate * matchesObserved))
   */
  decay_rate: number;
}

// ── Team strength output ───────────────────────────────────────────────────

/**
 * Effective team strength estimate produced by Track 1.
 *
 * taxonomy spec S3.4: Track1Output interface.
 * This is the output shape for one team's half of the pair.
 * The full per-match output is Track1Output below.
 *
 * Phase 1B additions:
 *   - injuryImpact: optional InjuryImpactResult (taxonomy spec S3.2 Extension 2)
 *   - lineupAdjustment: optional LineupAdjustmentResult (taxonomy spec S3.2 Ext 2)
 *   Both are undefined when Phase 1B inputs were not provided to computeTrack1.
 *   When undefined, the Fase 1A baseline is used unchanged (backward-compatible).
 */
export interface Track1TeamStrength {
  teamId: string;
  /** Effective Elo rating (adjusted for absences when available). */
  eloRating: number;
  /**
   * Attack strength relative to league average.
   * Derived from historical scoring rate (home or away context, per role).
   */
  attackStrength: number;
  /**
   * Defense strength relative to league average.
   * Derived from historical conceding rate.
   */
  defenseStrength: number;
  /**
   * Lambda offset applied from dynamic home advantage.
   * 0.0 when isNeutralVenue = true or for the away team in standard matches.
   */
  homeAdvantageAdjusted: number;
  /** Number of completed matches observed for this team in the current season. */
  matchesObserved: number;
  /** Adaptive K-factor that was used (or would be used) for Elo updates. */
  currentK: number;
  /**
   * Injury impact result for this team.
   * undefined when Phase 1B injury inputs were not provided.
   * injury_impact_score.value === MISSING when injury data is unavailable
   * (NEXUS-0 S6.1 — never null/0/undefined for absent data).
   *
   * taxonomy spec S3.2 Extension 2: injury-adjusted team strength.
   */
  injuryImpact?: import('./injury-impact.js').InjuryImpactResult;
  /**
   * Lineup adjustment result for this team.
   * undefined when Phase 1B squad inputs were not provided.
   * strength_delta.value === MISSING when confirmed lineup is not published
   * (NEXUS-0 S4.4, S6.2.4 — lineup never inferred).
   *
   * taxonomy spec S3.2 Extension 2: confirmed lineup used when available.
   */
  lineupAdjustment?: import('./lineup-adjuster.js').LineupAdjustmentResult;
}

/**
 * Full output of Track 1 for a single match prediction.
 *
 * taxonomy spec S3.4: canonical Track1Output interface.
 * This feeds directly into Track 2 (Goals Model) and Track 3 (Tabular).
 */
export interface Track1Output {
  /** Strength estimate for the home team. */
  homeStrength: Track1TeamStrength;
  /** Strength estimate for the away team. */
  awayStrength: Track1TeamStrength;
  /**
   * Whether this is a neutral-venue match.
   * MUST be passed in from canonical match data — never inferred.
   * master spec S8.5: canonical data is shared with V3; neutral_venue is part of it.
   */
  isNeutralVenue: boolean;
  /**
   * Dynamic home advantage config used for this match.
   * Exposed for explainability (taxonomy spec S3.4: homeAdvantage field).
   */
  leagueHomeAdvantage: LeagueHomeAdvantageConfig;
}
