/**
 * track1-engine.ts — NEXUS Track 1: Structural/Ratings Engine.
 *
 * Spec authority:
 *   - master spec S5.1: Track 1 purpose — estimate long-run team strength
 *   - taxonomy spec S3.1–S3.5: full Track 1 specification
 *   - taxonomy spec S3.2: Dynamic Home Advantage + Adaptive K + Injury Adj
 *   - taxonomy spec S3.4: Track1Output interface
 *   - master spec S8.5: no shared mutable state with V3
 *
 * Phase 1A scope:
 *   - Dynamic home advantage (league-wide baseline, taxonomy spec S3.2 Ext 1)
 *   - Adaptive K-factor (decay baseline, taxonomy spec S3.2 Ext 3)
 *   - Elo-based team strength from historical match results
 *   - Neutral venue: isNeutralVenue from canonical input — never inferred
 *
 * Phase 1B scope (this file, added):
 *   - Position-differentiated injury impact (taxonomy spec S3.2 Extension 2)
 *   - Confirmed lineup strength adjustment (taxonomy spec S3.2 Extension 2)
 *   - Missingness-explicit: undefined inputs → MISSING sentinel in output
 *   - Backward-compatible: all Phase 1B params are optional
 *
 * INVARIANTS:
 *   - Pure function. No Date.now(). No Math.random(). No IO.
 *   - isNeutralVenue MUST come from the input parameter — never inferred
 *     from match location, team name, or any other signal.
 *   - homeAdvantageAdjusted = 0.0 when isNeutralVenue = true.
 *   - Track 1 does NOT produce 1X2 probabilities.
 *
 * @module nexus/track1/track1-engine
 */

import type { HistoricalMatch, Track1Output, Track1TeamStrength } from './types.js';
import { estimateHomeAdvantage } from './home-advantage.js';
import { computeAdaptiveK, DEFAULT_ADAPTIVE_K_CONFIG } from './adaptive-k.js';
import type { AdaptiveKConfig } from './types.js';
import { computeInjuryImpact } from './injury-impact.js';
import type { PlayerAbsence } from './injury-impact.js';
import { computeLineupAdjustment } from './lineup-adjuster.js';
import type { BaselineSquad } from '../entity-identity/types.js';

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Default Elo rating for a team with no history.
 * Aligned with V3's DEFAULT_ELO_RATING = 1500 (standard Elo origin).
 * master spec S1.3: "NEXUS inherits several components from V3" — Elo origin is one.
 */
const DEFAULT_ELO = 1500;

/**
 * Elo scale factor (standard: 400).
 * P(win) = 1 / (1 + 10^(-diff/ELO_SCALE)).
 * Aligned with V3's ELO_SCALE = 400.
 */
const ELO_SCALE = 400;

/**
 * Elo delta for home advantage — applied when isNeutralVenue = false.
 * 100 Elo points ≈ 64% win probability for home team when equally matched.
 * Aligned with V3's HOME_ADVANTAGE_ELO_DELTA = 100.
 */
const HOME_ADVANTAGE_ELO_DELTA = 100;

// ── Internal types ─────────────────────────────────────────────────────────

/** Per-team mutable rating state accumulated during replay. */
interface TeamState {
  rating: number;
  /** Attack efficiency: sum of goals scored / sum of expected goals (home or away role). */
  totalGoalsScored: number;
  totalGoalsConceded: number;
  matchesObserved: number;
}

/** Minimal Elo pool for replay — isolated from V3 pools (master spec S8.5). */
type EloPool = Map<string, TeamState>;

// ── Phase 1B input options ─────────────────────────────────────────────────

/**
 * Optional Phase 1B inputs to computeTrack1.
 *
 * taxonomy spec S3.2 Extension 2: Injury-Adjusted Team Strength.
 * All fields are optional. When absent, explicit missingness is reported
 * in Track1TeamStrength.injuryImpact and Track1TeamStrength.lineupAdjustment
 * (NEXUS-0 S6.1 — never silent 0.0/null).
 */
export interface Phase1bOptions {
  /**
   * Pre-filtered absences for the home team.
   * Caller is responsible for excluding UNRESOLVED/CONFLICTED players
   * (entity-identity S7.1, S9.1) before passing here.
   */
  homeAbsences?: readonly PlayerAbsence[];
  /**
   * Pre-filtered absences for the away team.
   */
  awayAbsences?: readonly PlayerAbsence[];
  /**
   * Whether injury data was available at all for this prediction.
   * False means the feature store returned no injury data (not zero absences).
   * When false: injury_impact_score.value === MISSING for both teams.
   * Default: false (data unavailable = explicit missingness).
   */
  injuryDataAvailable?: boolean;
  /**
   * Baseline squad for the home team.
   * When provided, used to compute lineup-based strength adjustment.
   * When undefined: lineupAdjustment is not computed (undefined in output).
   */
  homeSquad?: BaselineSquad;
  /**
   * Baseline squad for the away team.
   */
  awaySquad?: BaselineSquad;
}

// ── Core engine function ───────────────────────────────────────────────────

/**
 * Compute Track 1 strength estimates for a single match.
 *
 * taxonomy spec S3.1: "Track 1 does NOT produce match probabilities directly.
 * Its output is a structured strength assessment."
 *
 * taxonomy spec S3.2: Integrates dynamic home advantage + adaptive K-factor.
 * taxonomy spec S3.4: Returns Track1Output.
 *
 * @param homeTeamId - Canonical home team ID.
 * @param awayTeamId - Canonical away team ID.
 * @param matchHistory - All FINISHED matches available up to and including
 *   buildNowUtc (anti-lookahead is the CALLER's responsibility).
 * @param isNeutralVenue - From canonical match data. NEVER inferred.
 * @param leagueId - League code for home advantage defaults.
 * @param buildNowUtc - ISO-8601 UTC anchor for provenance. Passed to
 *   estimateHomeAdvantage for computedAt timestamp.
 * @param adaptiveKConfig - Optional override for K-factor config.
 * @param phase1bOptions - Optional Phase 1B inputs. When undefined or empty,
 *   injury_data_available=false and lineup_available=false (NEXUS-0 S6.1).
 * @returns Track1Output with strength estimates for both teams.
 */
export function computeTrack1(
  homeTeamId: string,
  awayTeamId: string,
  matchHistory: readonly HistoricalMatch[],
  isNeutralVenue: boolean,
  leagueId: string,
  buildNowUtc: string,
  adaptiveKConfig?: AdaptiveKConfig,
  phase1bOptions?: Phase1bOptions,
): Track1Output {
  const kConfig = adaptiveKConfig ?? DEFAULT_ADAPTIVE_K_CONFIG;

  // Step 1: Estimate league-wide dynamic home advantage.
  // taxonomy spec S3.2 Extension 1: computed from historical non-neutral matches.
  const leagueHomeAdvantage = estimateHomeAdvantage(
    matchHistory,
    leagueId,
    buildNowUtc,
  );

  // Step 2: Replay match history to build Elo ratings and team stats.
  // Separate pool from V3 — master spec S8.5: "no shared mutable state".
  const pool: EloPool = new Map();

  for (const match of matchHistory) {
    replayMatch(match, pool, kConfig);
  }

  // Step 3: Derive team strength for home team.
  const homeState = getOrDefault(pool, homeTeamId);
  const awayState = getOrDefault(pool, awayTeamId);

  // Step 4: Compute effective attack/defense strengths (league-relative).
  // Phase 1A: simple ratio of goals scored to goals conceded, normalised
  // around 1.0 (the league average team scores as many as it concedes in expectation).
  const { attackHome, defenseHome, attackAway, defenseAway } =
    computeStrengths(homeState, awayState);

  // Step 5: Apply home advantage.
  // taxonomy spec S3.2 Ext 1: neutral venue → homeAdvantageAdjusted = 0.
  const homeAdvOffset = isNeutralVenue ? 0 : leagueHomeAdvantage.homeAdvantage;

  // Step 6: Adaptive K for current season position.
  const homeCurrentK = computeAdaptiveK(homeState.matchesObserved, kConfig);
  const awayCurrentK = computeAdaptiveK(awayState.matchesObserved, kConfig);

  // Step 7 (Phase 1B): Compute injury impact for both teams.
  // taxonomy spec S3.2 Extension 2: injury-adjusted team strength.
  // When phase1bOptions is absent, injuryDataAvailable defaults to false →
  // MISSING sentinel reported in both team outputs (NEXUS-0 S6.1).
  const injuryDataAvailable = phase1bOptions?.injuryDataAvailable ?? false;

  const injuryImpactHome = computeInjuryImpact(
    phase1bOptions?.homeAbsences ?? [],
    injuryDataAvailable,
    buildNowUtc,
  );
  const injuryImpactAway = computeInjuryImpact(
    phase1bOptions?.awayAbsences ?? [],
    injuryDataAvailable,
    buildNowUtc,
  );

  // Step 8 (Phase 1B): Compute lineup adjustment when squad data is provided.
  // taxonomy spec S3.2 Extension 2, NEXUS-0 S4.4: lineup never inferred.
  // When squad is not provided, lineupAdjustment is undefined (not in output).
  const lineupAdjHome = phase1bOptions?.homeSquad !== undefined
    ? computeLineupAdjustment(phase1bOptions.homeSquad, buildNowUtc)
    : undefined;
  const lineupAdjAway = phase1bOptions?.awaySquad !== undefined
    ? computeLineupAdjustment(phase1bOptions.awaySquad, buildNowUtc)
    : undefined;

  const homeStrength: Track1TeamStrength = {
    teamId: homeTeamId,
    eloRating: homeState.rating,
    attackStrength: attackHome,
    defenseStrength: defenseHome,
    homeAdvantageAdjusted: homeAdvOffset,
    matchesObserved: homeState.matchesObserved,
    currentK: homeCurrentK,
    injuryImpact: injuryImpactHome,
    lineupAdjustment: lineupAdjHome,
  };

  const awayStrength: Track1TeamStrength = {
    teamId: awayTeamId,
    eloRating: awayState.rating,
    attackStrength: attackAway,
    defenseStrength: defenseAway,
    // Away team carries no home advantage offset.
    homeAdvantageAdjusted: 0,
    matchesObserved: awayState.matchesObserved,
    currentK: awayCurrentK,
    injuryImpact: injuryImpactAway,
    lineupAdjustment: lineupAdjAway,
  };

  return {
    homeStrength,
    awayStrength,
    isNeutralVenue,
    leagueHomeAdvantage,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────

/** Get team state from pool, or initialise with defaults. */
function getOrDefault(pool: EloPool, teamId: string): TeamState {
  const existing = pool.get(teamId);
  if (existing !== undefined) return existing;
  return {
    rating: DEFAULT_ELO,
    totalGoalsScored: 0,
    totalGoalsConceded: 0,
    matchesObserved: 0,
  };
}

/**
 * Replay one historical match: update both teams' Elo ratings and goal tallies.
 *
 * taxonomy spec S3.2: "Modified Elo system with ... Adaptive K-factor".
 * taxonomy spec S3.2 Ext 1: neutral venue → home advantage delta = 0.
 * taxonomy spec S3.2 Ext 3: K-factor adapts per matchesObserved.
 */
function replayMatch(
  match: HistoricalMatch,
  pool: EloPool,
  kConfig: AdaptiveKConfig,
): void {
  const homeState = getOrDefault(pool, match.homeTeamId);
  const awayState = getOrDefault(pool, match.awayTeamId);

  // Home advantage delta: 0 for neutral venue.
  // taxonomy spec S3.2 Ext 1: neutral_venue flag from canonical data.
  const homeAdvDelta = match.isNeutralVenue ? 0 : HOME_ADVANTAGE_ELO_DELTA;

  // Expected score for home team.
  const diff = homeState.rating + homeAdvDelta - awayState.rating;
  const expectedHome = 1 / (1 + Math.pow(10, -diff / ELO_SCALE));
  const expectedAway = 1 - expectedHome;

  // Actual score from home team's perspective.
  const actualHome =
    match.homeGoals > match.awayGoals ? 1 :
    match.homeGoals === match.awayGoals ? 0.5 : 0;
  const actualAway = 1 - actualHome;

  // Adaptive K for each team at this point in their season.
  const kHome = computeAdaptiveK(homeState.matchesObserved, kConfig);
  const kAway = computeAdaptiveK(awayState.matchesObserved, kConfig);

  // Rating updates.
  const deltaHome = kHome * (actualHome - expectedHome);
  const deltaAway = kAway * (actualAway - expectedAway);

  // Update pool with new states.
  pool.set(match.homeTeamId, {
    rating: homeState.rating + deltaHome,
    totalGoalsScored: homeState.totalGoalsScored + match.homeGoals,
    totalGoalsConceded: homeState.totalGoalsConceded + match.awayGoals,
    matchesObserved: homeState.matchesObserved + 1,
  });

  pool.set(match.awayTeamId, {
    rating: awayState.rating + deltaAway,
    totalGoalsScored: awayState.totalGoalsScored + match.awayGoals,
    totalGoalsConceded: awayState.totalGoalsConceded + match.homeGoals,
    matchesObserved: awayState.matchesObserved + 1,
  });
}

/**
 * Derive attack and defense strengths relative to league average.
 *
 * Phase 1A: simple per-match averages, normalised so that a "league average"
 * team has attackStrength = 1.0 and defenseStrength = 1.0.
 *
 * When a team has no history (matchesObserved = 0), default to 1.0
 * (assume league-average strength — the prior).
 */
function computeStrengths(
  homeState: TeamState,
  awayState: TeamState,
): {
  attackHome: number;
  defenseHome: number;
  attackAway: number;
  defenseAway: number;
} {
  const homeGamesPlayed = homeState.matchesObserved;
  const awayGamesPlayed = awayState.matchesObserved;

  // Attack: average goals scored per match.
  // Defense: average goals conceded per match (lower = stronger defense).
  const attackHome =
    homeGamesPlayed > 0 ? homeState.totalGoalsScored / homeGamesPlayed : 1.0;
  const defenseHome =
    homeGamesPlayed > 0 ? homeState.totalGoalsConceded / homeGamesPlayed : 1.0;

  const attackAway =
    awayGamesPlayed > 0 ? awayState.totalGoalsScored / awayGamesPlayed : 1.0;
  const defenseAway =
    awayGamesPlayed > 0 ? awayState.totalGoalsConceded / awayGamesPlayed : 1.0;

  return { attackHome, defenseHome, attackAway, defenseAway };
}
