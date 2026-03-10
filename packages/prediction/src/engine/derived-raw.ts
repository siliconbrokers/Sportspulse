/**
 * Derived Raw Outputs — §16.5–§16.10, §16.11
 *
 * Computes all market outputs derived from raw_match_distribution.
 *
 * §19.5 invariant: ALL of these outputs come from raw_match_distribution.
 * NONE of them come from calibrated_1x2_probs.
 *
 * §16.5: Totals (over_2_5, under_2_5, over_1_5, under_3_5)
 * §16.6: BTTS (btts_yes, btts_no)
 * §16.7: Team goal totals (team_home_over_0_5, team_away_over_0_5, etc.)
 * §16.8: Clean sheets (clean_sheet_home, clean_sheet_away)
 * §16.9: Win to nil (win_to_nil_home, win_to_nil_away)
 * §16.10: Low scoring risk
 * §16.11: Scoreline explainability (most_likely_scoreline, top_scorelines)
 *
 * §19.3 invariants:
 *   abs((btts_yes + btts_no) - 1) <= epsilon_probability
 *   abs((over_2_5 + under_2_5) - 1) <= epsilon_probability
 *
 * All functions are PURE. Same distribution → same outputs. Deterministic.
 */

import { EPSILON_PROBABILITY, MATRIX_MAX_GOAL_DEFAULT } from '../contracts/index.js';
import type {
  RawMatchDistribution,
  DerivedRawOutputs,
  TopScorelinesOutput,
  ScorelineProbability,
  ScorelineKey,
} from '../contracts/index.js';

// ── Implementation ────────────────────────────────────────────────────────

/**
 * Compute all derived raw outputs from a RawMatchDistribution.
 *
 * §16.5–§16.11 combined computation.
 * Pure function — deterministic.
 *
 * @param distribution - The (possibly renormalized) raw match distribution
 * @param maxGoal - Maximum goal index (default: MATRIX_MAX_GOAL_DEFAULT = 7)
 * @param topN - Number of top scorelines to include (default: 5 per §15.3)
 * @returns DerivedRawOutputs
 */
export function computeDerivedRaw(
  distribution: RawMatchDistribution,
  maxGoal: number = MATRIX_MAX_GOAL_DEFAULT,
  topN: number = 5,
): DerivedRawOutputs {
  // Accumulators for all markets
  let over_2_5 = 0; // P(i + j >= 3)
  let under_2_5 = 0; // P(i + j <= 2)
  let over_1_5 = 0; // P(i + j >= 2)
  let under_3_5 = 0; // P(i + j <= 3)
  let btts_yes = 0; // P(i >= 1 and j >= 1)
  let team_home_over_0_5 = 0; // P(i >= 1)
  let team_away_over_0_5 = 0; // P(j >= 1)
  let team_home_over_1_5 = 0; // P(i >= 2)
  let team_away_over_1_5 = 0; // P(j >= 2)
  let clean_sheet_home = 0; // P(j = 0)
  let clean_sheet_away = 0; // P(i = 0)
  let win_to_nil_home = 0; // Σ P(i,j) where i > j and j = 0
  let win_to_nil_away = 0; // Σ P(i,j) where j > i and i = 0

  // Scoreline candidates for top_scorelines
  const scorelineCandidates: Array<ScorelineProbability> = [];

  for (let i = 0; i <= maxGoal; i++) {
    for (let j = 0; j <= maxGoal; j++) {
      const key: ScorelineKey = `${i}-${j}`;
      const p = (distribution as Record<ScorelineKey, number>)[key] ?? 0;
      const totalGoals = i + j;

      // §16.5 Totals
      if (totalGoals >= 3) over_2_5 += p;
      if (totalGoals <= 2) under_2_5 += p;
      if (totalGoals >= 2) over_1_5 += p;
      if (totalGoals <= 3) under_3_5 += p;

      // §16.6 BTTS
      if (i >= 1 && j >= 1) btts_yes += p;

      // §16.7 Team totals
      if (i >= 1) team_home_over_0_5 += p;
      if (j >= 1) team_away_over_0_5 += p;
      if (i >= 2) team_home_over_1_5 += p;
      if (j >= 2) team_away_over_1_5 += p;

      // §16.8 Clean sheets
      if (j === 0) clean_sheet_home += p;
      if (i === 0) clean_sheet_away += p;

      // §16.9 Win to nil
      // §16.9: win_to_nil_home = Σ P(i,j) where i > j and j = 0
      if (i > j && j === 0) win_to_nil_home += p;
      // §16.9: win_to_nil_away = Σ P(i,j) where j > i and i = 0
      if (j > i && i === 0) win_to_nil_away += p;

      // Collect for §16.11 scoreline explainability
      scorelineCandidates.push({ score: key, p });
    }
  }

  // §16.6 BTTS: btts_no = 1 - btts_yes
  const btts_no = 1 - btts_yes;

  // §16.10 Low scoring risk: P(0,0) + P(1,0) + P(0,1) + P(1,1)
  const p00 = (distribution as Record<ScorelineKey, number>)['0-0'] ?? 0;
  const p10 = (distribution as Record<ScorelineKey, number>)['1-0'] ?? 0;
  const p01 = (distribution as Record<ScorelineKey, number>)['0-1'] ?? 0;
  const p11 = (distribution as Record<ScorelineKey, number>)['1-1'] ?? 0;
  const low_scoring_risk = p00 + p10 + p01 + p11;

  // §16.11 Scoreline explainability
  // Sort descending by probability — deterministic (tie-break by score string)
  scorelineCandidates.sort((a, b) => {
    const diff = b.p - a.p;
    if (Math.abs(diff) > EPSILON_PROBABILITY) return diff;
    // Deterministic tie-break: lexicographic by score string
    return a.score.localeCompare(b.score);
  });

  // §15.3: top_scorelines = top 5 ordered by probability descending
  const top_scorelines: TopScorelinesOutput = scorelineCandidates
    .slice(0, topN)
    .map((s) => ({ score: s.score, p: s.p }));

  // §16.11: most_likely_scoreline = scoreline with highest P(i,j)
  const most_likely_scoreline = scorelineCandidates[0]?.score ?? '0-0';

  return {
    // §16.5
    over_2_5,
    under_2_5,
    over_1_5,
    under_3_5,

    // §16.6
    btts_yes,
    btts_no,

    // §16.7
    team_home_over_0_5,
    team_away_over_0_5,
    team_home_over_1_5,
    team_away_over_1_5,

    // §16.8
    clean_sheet_home,
    clean_sheet_away,

    // §16.9
    win_to_nil_home,
    win_to_nil_away,

    // §16.10
    low_scoring_risk,

    // §16.11
    most_likely_scoreline,
    top_scorelines,
  };
}

/**
 * Verify the BTTS invariant.
 * §19.3: abs((btts_yes + btts_no) - 1) <= epsilon_probability
 */
export function verifyBttsInvariant(derived: DerivedRawOutputs): boolean {
  return Math.abs(derived.btts_yes + derived.btts_no - 1.0) <= EPSILON_PROBABILITY;
}

/**
 * Verify the over/under 2.5 invariant.
 * §19.3: abs((over_2_5 + under_2_5) - 1) <= epsilon_probability
 *
 * Note: this holds for RENORMALIZED distributions. For raw distributions,
 * over_2_5 + under_2_5 = 1 - tail_mass_raw.
 */
export function verifyOverUnderInvariant(derived: DerivedRawOutputs): boolean {
  return Math.abs(derived.over_2_5 + derived.under_2_5 - 1.0) <= EPSILON_PROBABILITY;
}
