import type { Match } from '@sportpulse/canonical';
import { EventStatus } from '@sportpulse/canonical';
import { SignalKey, SignalEntityKind } from '../registry/signal-keys.js';
import type { SignalDTO } from '../registry/signal-dto.js';

/**
 * Computes FORM_POINTS_LAST_5 signal for a team.
 *
 * Spec refs:
 * - Signals Spec §7.1.1 (FORM_POINTS_LAST_5)
 * - Acceptance Matrix B-01, B-02, B-03
 *
 * Rules:
 * - Points: W=3, D=1, L=0
 * - Window: last 5 finished matches before buildNowUtc
 * - Normalization: rawPoints / (3 * matchesUsed)
 * - If zero finished matches: quality.missing=true, value=0
 */

const WINDOW_SIZE = 5;
const WIN_POINTS = 3;
const DRAW_POINTS = 1;

export function computeFormPointsLast5(
  teamId: string,
  matches: readonly Match[],
  buildNowUtc: string,
): SignalDTO {
  // Filter to finished matches before buildNowUtc where this team participates
  const finishedMatches = matches
    .filter(m =>
      m.status === EventStatus.FINISHED &&
      m.startTimeUtc !== null &&
      m.startTimeUtc < buildNowUtc &&
      (m.homeTeamId === teamId || m.awayTeamId === teamId),
    )
    .sort((a, b) => {
      // Sort by startTimeUtc desc to get most recent first
      if (a.startTimeUtc! > b.startTimeUtc!) return -1;
      if (a.startTimeUtc! < b.startTimeUtc!) return 1;
      // Deterministic tie-break by matchId
      return a.matchId < b.matchId ? -1 : 1;
    })
    .slice(0, WINDOW_SIZE);

  const matchesUsed = finishedMatches.length;

  // Zero history → missing signal
  if (matchesUsed === 0) {
    return {
      key: SignalKey.FORM_POINTS_LAST_5,
      entityKind: SignalEntityKind.TEAM,
      entityId: teamId,
      value: 0,
      unit: 'points',
      params: {
        windowSize: WINDOW_SIZE,
        matchesUsed: 0,
        rawPoints: 0,
        maxPoints: 0,
        reason: 'no_finished_matches',
      },
      quality: {
        source: 'canonical_derived',
        missing: true,
      },
      explain: 'No finished matches available for form computation.',
    };
  }

  // Compute points
  let rawPoints = 0;
  const matchIds: string[] = [];

  for (const match of finishedMatches) {
    matchIds.push(match.matchId);
    const isHome = match.homeTeamId === teamId;
    const teamScore = isHome ? match.scoreHome : match.scoreAway;
    const opponentScore = isHome ? match.scoreAway : match.scoreHome;

    if (teamScore !== null && opponentScore !== null) {
      if (teamScore > opponentScore) rawPoints += WIN_POINTS;
      else if (teamScore === opponentScore) rawPoints += DRAW_POINTS;
      // loss: 0 points
    }
  }

  const maxPoints = WIN_POINTS * matchesUsed;
  const value = maxPoints > 0 ? rawPoints / maxPoints : 0;

  return {
    key: SignalKey.FORM_POINTS_LAST_5,
    entityKind: SignalEntityKind.TEAM,
    entityId: teamId,
    value,
    unit: 'points',
    params: {
      windowSize: WINDOW_SIZE,
      matchesUsed,
      rawPoints,
      maxPoints,
      matchIds,
    },
    quality: {
      source: 'canonical_derived',
      missing: false,
    },
    explain: 'Points in last 5 finished matches normalized by maximum possible in that window.',
  };
}
