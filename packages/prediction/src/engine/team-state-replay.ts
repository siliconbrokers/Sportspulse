/**
 * team-state-replay.ts — Pure Elo replay for historical pre-match team state.
 *
 * Given a list of historical finished matches and a target kickoff timestamp,
 * computes the exact pre-match Elo rating and 365-day match count for
 * any two teams — with a hard anti-lookahead guarantee.
 *
 * ANTI-LOOKAHEAD INVARIANT (verified by test):
 *   Only matches with utcDate STRICTLY LESS THAN kickoffUtc are processed.
 *   The target match itself (same utcDate) is always excluded.
 *
 * Determinism guarantee:
 *   Same matches array + same teamIds + same kickoffUtc → same output.
 *   Internal sort is stable (ISO-8601 lexicographic order = chronological).
 *
 * No IO. No side effects. No timestamps from the environment.
 *
 * H2 — Historical Team State Backbone
 */

import { createClubRatingPool, DEFAULT_ELO_RATING } from '../store/rating-pool.js';
import { updateEloRating } from './elo-rating.js';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * A single completed match record used for Elo replay.
 * Minimal shape — only the fields needed for rating computation.
 */
export interface FinishedMatchRecord {
  homeTeamId: string;
  awayTeamId: string;
  /** ISO-8601 UTC kickoff timestamp of the completed match. */
  utcDate: string;
  homeGoals: number;
  awayGoals: number;
}

/**
 * Pre-match historical state for a single team.
 */
export interface TeamHistoricalState {
  teamId: string;
  /**
   * Elo rating immediately before the target match.
   * DEFAULT_ELO_RATING (1500) if no historical matches were found.
   */
  eloRating: number;
  /**
   * Number of Elo updates applied to this team's record.
   * 0 means no history — team is in bootstrap mode.
   */
  updateCount: number;
  /**
   * Number of completed official matches in the 365 days before kickoffUtc.
   * Used for §7.4 eligibility gate (CLUB domain requires ≥ 5).
   */
  completedMatches365d: number;
  /** ISO-8601 UTC timestamp of the last Elo update, or null if no history. */
  lastUpdatedUtc: string | null;
}

/**
 * Pre-match state for both teams in a fixture.
 */
export interface PreMatchTeamState {
  homeTeam: TeamHistoricalState;
  awayTeam: TeamHistoricalState;
  /**
   * Quality classification of the historical dataset used:
   * - FULL:      ≥ 300 eligible matches (≈ 1 full season across all competitions)
   * - PARTIAL:   1–299 eligible matches
   * - BOOTSTRAP: 0 eligible matches
   */
  dataCompleteness: 'FULL' | 'PARTIAL' | 'BOOTSTRAP';
  /** UTC date of the oldest match in the dataset, or null if empty. */
  earliestMatchUtc: string | null;
  /** Total number of eligible matches (after anti-lookahead filter). */
  totalHistoricalMatches: number;
}

// ── Core function ───────────────────────────────────────────────────────────

/**
 * Compute pre-match team state using chronological Elo replay.
 *
 * @param matches    All available historical finished match records (any order).
 * @param homeTeamId Canonical ID of the home team.
 * @param awayTeamId Canonical ID of the away team.
 * @param kickoffUtc ISO-8601 UTC kickoff of the target match.
 * @returns          Pre-match state for both teams with quality metadata.
 */
export function computePreMatchTeamState(
  matches: FinishedMatchRecord[],
  homeTeamId: string,
  awayTeamId: string,
  kickoffUtc: string,
): PreMatchTeamState {
  // ── Anti-lookahead filter: strict less-than ─────────────────────────────
  // This is the single most important invariant. Even if the match list
  // accidentally contains the target match itself, it must not be replayed.
  const eligible = matches
    .filter((m) => m.utcDate < kickoffUtc)
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate)); // chronological, deterministic

  // ── Elo replay ──────────────────────────────────────────────────────────
  const pool = createClubRatingPool();

  for (const m of eligible) {
    const actualScore: 0 | 0.5 | 1 =
      m.homeGoals > m.awayGoals ? 1 : m.homeGoals < m.awayGoals ? 0 : 0.5;

    updateEloRating(
      {
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        actualScore,
        neutralVenue: false, // domestic league assumption
        competitionWeightCategory: 'DOMESTIC_LEAGUE',
        matchUtc: m.utcDate,
      },
      pool,
    );
  }

  // ── 365-day match count ─────────────────────────────────────────────────
  // Cutoff = kickoff minus 365 days. Only matches in [cutoff, kickoff) count.
  const kickoffMs = new Date(kickoffUtc).getTime();
  const cutoff365 = new Date(kickoffMs - 365 * 24 * 3600_000).toISOString();

  const within365 = eligible.filter((m) => m.utcDate >= cutoff365);
  const home365 = within365.filter(
    (m) => m.homeTeamId === homeTeamId || m.awayTeamId === homeTeamId,
  ).length;
  const away365 = within365.filter(
    (m) => m.homeTeamId === awayTeamId || m.awayTeamId === awayTeamId,
  ).length;

  // ── Read team records ───────────────────────────────────────────────────
  const homeRecord = pool.get(homeTeamId);
  const awayRecord = pool.get(awayTeamId);

  const earliestMatchUtc = eligible.length > 0 ? eligible[0].utcDate : null;

  const dataCompleteness: 'FULL' | 'PARTIAL' | 'BOOTSTRAP' =
    eligible.length === 0 ? 'BOOTSTRAP' : eligible.length >= 300 ? 'FULL' : 'PARTIAL';

  return {
    homeTeam: {
      teamId: homeTeamId,
      eloRating: homeRecord?.rating ?? DEFAULT_ELO_RATING,
      updateCount: homeRecord?.updateCount ?? 0,
      completedMatches365d: home365,
      lastUpdatedUtc: homeRecord?.lastUpdatedUtc ?? null,
    },
    awayTeam: {
      teamId: awayTeamId,
      eloRating: awayRecord?.rating ?? DEFAULT_ELO_RATING,
      updateCount: awayRecord?.updateCount ?? 0,
      completedMatches365d: away365,
      lastUpdatedUtc: awayRecord?.lastUpdatedUtc ?? null,
    },
    dataCompleteness,
    earliestMatchUtc,
    totalHistoricalMatches: eligible.length,
  };
}
