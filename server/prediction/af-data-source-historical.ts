/**
 * af-data-source-historical.ts — Derives FinishedMatchRecord[] and team match
 * counts directly from the ApiFootballCanonicalSource DataSource.
 *
 * Purpose: enables forward validation for competitions without football-data.org
 * equivalents (URU / ARG) and for EU competitions in AF canonical mode where
 * team IDs are 'team:apifootball:*' rather than 'team:football-data:*'.
 *
 * The DataSource already holds the full current season (fetched at startup and
 * refreshed incrementally). We derive Elo history from those matches; past
 * seasons are not available via this path (one season only). This is sufficient
 * for forward validation: eligibility (completed_365d) is derived from
 * standings, and Elo converges from the default (1500) as matches are played.
 *
 * Usage:
 *   const records = buildFinishedRecordsFromDataSource(dataSource, competitionId);
 *   const state   = computePreMatchTeamState(records, homeId, awayId, kickoff);
 *
 * H11-AF — Forward Validation for AF Canonical Competitions
 */

import type { DataSource, StandingEntry } from '@sportpulse/snapshot';
import type { FinishedMatchRecord, PreMatchTeamState } from '@sportpulse/prediction';
import { computePreMatchTeamState } from '@sportpulse/prediction';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extracts FinishedMatchRecord[] from the DataSource for a given competition.
 * Only includes matches with status=FINISHED and non-null scores.
 *
 * The resulting array is sorted ascending by utcDate (chronological order
 * guaranteed by the anti-lookahead filter inside computePreMatchTeamState).
 */
export function buildFinishedRecordsFromDataSource(
  dataSource: DataSource,
  competitionId: string,
): FinishedMatchRecord[] {
  const seasonId = dataSource.getSeasonId(competitionId);
  if (!seasonId) return [];

  const matches = dataSource.getMatches(seasonId);
  const records: FinishedMatchRecord[] = [];

  for (const m of matches) {
    if (m.status !== 'FINISHED') continue;
    if (m.scoreHome === null || m.scoreAway === null) continue;
    if (!m.startTimeUtc) continue;

    records.push({
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      utcDate:    m.startTimeUtc,
      homeGoals:  m.scoreHome,
      awayGoals:  m.scoreAway,
    });
  }

  return records;
}

/**
 * Builds pre-match team state (Elo + match counts) using DataSource matches
 * instead of the FD historical loader.
 *
 * Equivalent to HistoricalStateService.getPreMatchTeamState() but backed by
 * the AF canonical source's already-fetched season data.
 */
export function getPreMatchTeamStateFromDataSource(
  dataSource: DataSource,
  competitionId: string,
  homeTeamId: string,
  awayTeamId: string,
  kickoffUtc: string,
): PreMatchTeamState {
  const records = buildFinishedRecordsFromDataSource(dataSource, competitionId);
  return computePreMatchTeamState(records, homeTeamId, awayTeamId, kickoffUtc);
}

/**
 * Derives completed match count for a team from standings (playedGames field).
 * Falls back to 0 if the team is not in the standings.
 *
 * Used to populate historical_context.completed_365d — standings.playedGames
 * reflects the true number of official matches played in the current season,
 * which approximates the 365-day window for seasons ≤ 12 months.
 */
export function getPlayedGamesFromStandings(
  dataSource: DataSource,
  competitionId: string,
  teamId: string,
): number {
  const getStandings = dataSource.getStandings?.bind(dataSource);
  if (!getStandings) return 0;

  const standings: StandingEntry[] = getStandings(competitionId);
  const entry = standings.find((s) => s.teamId === teamId);
  return entry?.playedGames ?? 0;
}
