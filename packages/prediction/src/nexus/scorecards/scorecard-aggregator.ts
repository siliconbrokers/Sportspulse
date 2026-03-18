/**
 * scorecard-aggregator.ts — NEXUS Scorecard Aggregator.
 *
 * Spec authority:
 *   - evaluation-and-promotion spec S5.2.7: combined = disjoint union of HWF + LS
 *   - evaluation-and-promotion spec S12.8: no-double-counting across origin slices
 *
 * The combined scorecard is built as the disjoint union of:
 *   - historical_walk_forward
 *   - live_shadow
 *
 * INVARIANT (S12.8):
 *   - No matchId may appear in both HWF and LS source scorecards.
 *   - combined.n must equal hwf.n + ls.n.
 *   - Violation → throw Error (disjoint invariant breach).
 *
 * @module nexus/scorecards/scorecard-aggregator
 */

import type { NexusScorecard, ScorecardEntry } from './types.js';

/**
 * Build the combined scorecard as a disjoint union of HWF and live_shadow.
 *
 * Weighted average RPS: weighted by sample size n, not simple average.
 *   rps_combined = (n_hwf * rps_hwf + n_ls * rps_ls) / (n_hwf + n_ls)
 *
 * Throws if any matchId appears in both source scorecards (disjoint invariant).
 *
 * @param hwf  historical_walk_forward scorecard.
 * @param ls   live_shadow scorecard.
 * @returns    combined scorecard with merged entries and weighted-average metrics.
 * @throws     Error if disjoint invariant is violated (overlap in matchIds).
 */
export function buildCombinedScorecard(
  hwf: NexusScorecard,
  ls: NexusScorecard,
): NexusScorecard {
  // Disjoint invariant check (evaluation-and-promotion spec S12.8)
  const hwfMatchIds = new Set(hwf.entries.map((e) => e.matchId));
  const overlapping = ls.entries.filter((e) => hwfMatchIds.has(e.matchId));

  if (overlapping.length > 0) {
    const sampleIds = overlapping
      .slice(0, 3)
      .map((e) => e.matchId)
      .join(', ');
    throw new Error(
      `[NexusScorecardAggregator] Disjoint invariant violated: ` +
      `${overlapping.length} matchId(s) appear in both historical_walk_forward and live_shadow. ` +
      `Sample matchIds: ${sampleIds}. ` +
      `Spec ref: evaluation-and-promotion S12.8.`,
    );
  }

  // Merge entries
  const allEntries: ScorecardEntry[] = [
    ...hwf.entries.map((e) => ({ ...e, scorecardType: 'combined' as const })),
    ...ls.entries.map((e) => ({ ...e, scorecardType: 'combined' as const })),
  ];

  const totalN = hwf.n + ls.n;

  // Weighted average RPS (weighted by sample size)
  let rps_mean = 0;
  if (totalN > 0) {
    rps_mean = (hwf.n * hwf.rps_mean + ls.n * ls.rps_mean) / totalN;
  }

  // Merge per-league breakdowns
  const allLeagueKeys = new Set([
    ...Object.keys(hwf.leagues),
    ...Object.keys(ls.leagues),
  ]);

  const leagues: Record<string, { n: number; rps_mean: number }> = {};
  for (const leagueKey of allLeagueKeys) {
    const h = hwf.leagues[leagueKey] ?? { n: 0, rps_mean: 0 };
    const l = ls.leagues[leagueKey] ?? { n: 0, rps_mean: 0 };
    const n = h.n + l.n;
    const leagueRps = n > 0 ? (h.n * h.rps_mean + l.n * l.rps_mean) / n : 0;
    leagues[leagueKey] = { n, rps_mean: leagueRps };
  }

  return {
    type: 'combined',
    entries: allEntries,
    rps_mean,
    n: totalN,
    leagues,
  };
}
