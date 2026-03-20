/**
 * match-input-adapter.ts — converts a canonical Match into a MatchInput
 * suitable for the prediction engine.
 *
 * Package boundary: server/ may import from packages/canonical and
 * packages/prediction freely. Must NOT import from packages/scoring,
 * packages/signals, or packages/layout.
 *
 * Design notes:
 * - Never throws — any unrecoverable condition returns { ok: false, reason }.
 * - Deterministic: same canonical inputs → same MatchInput output.
 * - In bootstrapping mode, home/away_team_domain_id === home/away_team_id.
 * - historical_context defaults to 0/false (no historical data yet).
 */

import type { Match, Competition, Season } from '@sportpulse/canonical';
import type {
  MatchInput,
  CompetitionProfile,
} from '@sportpulse/prediction';

// ── Result type ────────────────────────────────────────────────────────────

export type AdapterResult =
  | { ok: true; input: MatchInput }
  | { ok: false; reason: string };

// ── Static competition profile registry ───────────────────────────────────

/**
 * Standard domestic league profile (reused by all four portal competitions).
 *
 * §8.3 consistency rule: GROUP_STAGE must use GROUP_CLASSIC (not ROUND_ROBIN).
 * GROUP_CLASSIC additionally requires group_ranking_rules, qualification_rules,
 * and tie_break_rules (§7.3, §8.3).
 *
 * For a single-table domestic league, the whole season is modelled as one
 * "group" where all teams play each other. Standard 3-1-0 scoring applies.
 *
 * Spec authority: §8.1 (CompetitionProfile), §8.3 (consistency rules)
 */
const DOMESTIC_LEAGUE_PROFILE: CompetitionProfile = {
  competition_profile_version: '1.0',
  team_domain: 'CLUB',
  competition_family: 'DOMESTIC_LEAGUE',
  stage_type: 'GROUP_STAGE',
  format_type: 'GROUP_CLASSIC',
  leg_type: 'SINGLE',
  neutral_venue: false,
  // §8.3: required for GROUP_CLASSIC
  group_ranking_rules: {
    points_win: 3,
    points_draw: 1,
    points_loss: 0,
    rank_by: ['POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR', 'HEAD_TO_HEAD_POINTS', 'DRAW_LOT'],
  },
  qualification_rules: {
    allow_cross_group_third_ranking: false,
  },
  tie_break_rules: {
    use_head_to_head: false,
    use_goal_difference: true,
    use_goals_for: true,
    use_fair_play: false,
    final_fallback: 'DRAW_LOT',
  },
};

/**
 * Known competition profiles, keyed by canonical competitionId.
 * All four active SportPulse competitions are standard domestic leagues.
 */
const KNOWN_PROFILES: Record<string, CompetitionProfile> = {
  // Legacy IDs
  'comp:football-data:PD':  DOMESTIC_LEAGUE_PROFILE,
  'comp:football-data:PL':  DOMESTIC_LEAGUE_PROFILE,
  'comp:football-data:BL1': DOMESTIC_LEAGUE_PROFILE,
  'comp:football-data:SA':  DOMESTIC_LEAGUE_PROFILE,
  'comp:football-data:FL1': DOMESTIC_LEAGUE_PROFILE,
  'comp:football-data:DED': DOMESTIC_LEAGUE_PROFILE,
  'comp:football-data:PPL': DOMESTIC_LEAGUE_PROFILE,
  'comp:thesportsdb:4432':  DOMESTIC_LEAGUE_PROFILE,
  'comp:sportsdb-ar:4406':  DOMESTIC_LEAGUE_PROFILE,
  'comp:openligadb:bl1':    DOMESTIC_LEAGUE_PROFILE,
  // API-Football canonical IDs (AF_CANONICAL_ENABLED=true)
  'comp:apifootball:140':   DOMESTIC_LEAGUE_PROFILE,  // LaLiga
  'comp:apifootball:39':    DOMESTIC_LEAGUE_PROFILE,  // Premier League
  'comp:apifootball:78':    DOMESTIC_LEAGUE_PROFILE,  // Bundesliga
  'comp:apifootball:268':   DOMESTIC_LEAGUE_PROFILE,  // Liga Uruguaya
  'comp:apifootball:128':   DOMESTIC_LEAGUE_PROFILE,  // Liga Argentina
  'comp:apifootball:262':   DOMESTIC_LEAGUE_PROFILE,  // Liga MX
  'comp:apifootball:71':    DOMESTIC_LEAGUE_PROFILE,  // Brasileirão Série A
  'comp:apifootball:135':   DOMESTIC_LEAGUE_PROFILE,  // Serie A (Italy)
  'comp:apifootball:94':    DOMESTIC_LEAGUE_PROFILE,  // Primeira Liga (Portugal)
  'comp:apifootball:265':   DOMESTIC_LEAGUE_PROFILE,  // Primera División (Chile)
  // International tournaments (AF_CANONICAL_ENABLED=true)
  'comp:apifootball:13': {
    competition_profile_version: '1.0',
    team_domain:        'CLUB',
    competition_family: 'INTERNATIONAL_CLUB',
    stage_type:         'GROUP_STAGE',
    format_type:        'GROUP_CLASSIC',
    leg_type:           'SINGLE',
    neutral_venue:      false,
    group_ranking_rules: {
      points_win: 3, points_draw: 1, points_loss: 0,
      rank_by: ['POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR', 'HEAD_TO_HEAD_POINTS', 'DRAW_LOT'],
    },
    qualification_rules: { allow_cross_group_third_ranking: false },
    tie_break_rules: {
      use_head_to_head: true, use_goal_difference: true,
      use_goals_for: true, use_fair_play: false, final_fallback: 'DRAW_LOT',
    },
  } as CompetitionProfile,
  'comp:apifootball:1': {
    competition_profile_version: '1.0',
    team_domain:        'NATIONAL_TEAM',
    competition_family: 'NATIONAL_TEAM_TOURNAMENT',
    stage_type:         'GROUP_STAGE',
    format_type:        'GROUP_CLASSIC',
    leg_type:           'SINGLE',
    neutral_venue:      true,
    group_ranking_rules: {
      points_win: 3, points_draw: 1, points_loss: 0,
      rank_by: ['POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR', 'HEAD_TO_HEAD_POINTS', 'DRAW_LOT'],
    },
    qualification_rules: { allow_cross_group_third_ranking: false },
    tie_break_rules: {
      use_head_to_head: true, use_goal_difference: true,
      use_goals_for: true, use_fair_play: true, final_fallback: 'DRAW_LOT',
    },
  } as CompetitionProfile,
};

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Derives the CompetitionProfile for a given Competition.
 * Returns null (with a reason string) when the competitionId is not recognized.
 */
function deriveCompetitionProfile(
  competition: Competition,
): { ok: true; profile: CompetitionProfile } | { ok: false; reason: string } {
  const profile = KNOWN_PROFILES[competition.competitionId];
  if (profile === undefined) {
    return {
      ok: false,
      reason: `unknown competition: ${competition.competitionId}`,
    };
  }
  return { ok: true, profile };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Per-team match count context derived from standings data.
 *
 * `completed_365d` — completed official matches in the last 365 days.
 * For a domestic league season starting ≤ 7 months ago, this equals
 * the team's played-games count in the current season.
 *
 * Only `completed_365d` is needed for CLUB domain eligibility (§7.4).
 * Pass `completed_730d` when NATIONAL_TEAM domain data is available.
 */
export interface TeamMatchCounts {
  completed_365d: number;
  completed_730d?: number;
}

/**
 * Converts a canonical Match + Competition + Season into a MatchInput
 * ready for the prediction engine.
 *
 * Returns { ok: false, reason } instead of throwing for any invalid input.
 *
 * Determinism guarantee: given the same Match, Competition, and Season
 * objects (structurally equal), and the same matchCounts, this function
 * always returns the same MatchInput — no randomness, no I/O, no timestamps.
 *
 * Spec authority: §7.1 (MatchInput fields), §7.2 (critical fields),
 *                 §8.1 (CompetitionProfile), §7.4 (history requirements)
 *
 * @param matchCounts  Optional per-team history counts from standings.
 *   When provided, populates historical_context.{home,away}_completed_official_matches_*.
 *   When absent, defaults to 0 (bootstrapping mode — all matches NOT_ELIGIBLE).
 */
export function buildMatchInput(
  match: Match,
  competition: Competition,
  season: Season,
  matchCounts?: { home: TeamMatchCounts; away: TeamMatchCounts },
): AdapterResult {
  try {
    // ── §7.2 critical field: kickoff_utc ──────────────────────────────
    if (match.startTimeUtc === null) {
      return { ok: false, reason: 'missing kickoff_utc' };
    }

    // ── CompetitionProfile derivation ─────────────────────────────────
    const profileResult = deriveCompetitionProfile(competition);
    if (!profileResult.ok) {
      return { ok: false, reason: profileResult.reason };
    }

    const input: MatchInput = {
      schemaVersion: 1,

      // ── §7.1 — identity fields ──────────────────────────────────────
      match_id: match.matchId,
      kickoff_utc: match.startTimeUtc,
      competition_id: competition.competitionId,
      season_id: match.seasonId,

      // ── §7.1 — team fields ─────────────────────────────────────────
      home_team_id: match.homeTeamId,
      away_team_id: match.awayTeamId,

      // In bootstrapping mode, the domain ID equals the canonical team ID.
      // §10.1: pool separation is enforced by domain_id, not team_id.
      home_team_domain_id: match.homeTeamId,
      away_team_domain_id: match.awayTeamId,

      // ── §7.1 — optional stage/group fields ─────────────────────────
      stage_id: match.stageId ?? null,
      group_id: match.groupId ?? null,

      // ── §8.1 — competition profile ─────────────────────────────────
      competition_profile: profileResult.profile,

      // ── §7.1 — historical context ───────────────────────────────────
      // When matchCounts are provided (via standings lookup in shadow-runner),
      // actual played-game counts are used for history eligibility (§7.4).
      // When absent (bootstrapping), all counts default to 0 → NOT_ELIGIBLE.
      historical_context: {
        home_completed_official_matches_last_365d: matchCounts?.home.completed_365d ?? 0,
        away_completed_official_matches_last_365d: matchCounts?.away.completed_365d ?? 0,
        home_completed_official_matches_last_730d: matchCounts?.home.completed_730d ?? 0,
        away_completed_official_matches_last_730d: matchCounts?.away.completed_730d ?? 0,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    };

    // Suppress unused variable warning for season — it is accepted as a
    // parameter so callers can pass it naturally; future fields (e.g.
    // season label, date range for age-of-data checks) may use it.
    void season;

    return { ok: true, input };
  } catch (err: unknown) {
    // Defensive catch: the body above should never throw, but we guarantee
    // no exceptions escape this function per the adapter contract.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `unexpected error: ${message}` };
  }
}
