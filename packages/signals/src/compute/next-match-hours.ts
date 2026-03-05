import type { Match } from '@sportpulse/canonical';
import { EventStatus } from '@sportpulse/canonical';
import { SignalKey, SignalEntityKind } from '../registry/signal-keys.js';
import type { SignalDTO } from '../registry/signal-dto.js';

/**
 * Computes NEXT_MATCH_HOURS signal for a team.
 *
 * Spec refs:
 * - Signals Spec §7.1.2 (NEXT_MATCH_HOURS)
 * - Acceptance Matrix B-04, B-05
 *
 * Rules:
 * - Raw value: hours from buildNowUtc to next scheduled/TBD match
 * - Normalization: inverse min-max with horizon [0, 168h]
 *   norm = 1 - clamp((hours - 0) / (168 - 0), 0, 1)
 * - If no next match: quality.missing=true, value=0
 */

const MIN_HOURS = 0;
const MAX_HOURS = 168; // 7 days

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

export function computeNextMatchHours(
  teamId: string,
  matches: readonly Match[],
  buildNowUtc: string,
): SignalDTO {
  // Find next scheduled/TBD match after buildNowUtc
  const upcomingMatches = matches
    .filter(m =>
      (m.status === EventStatus.SCHEDULED || m.status === EventStatus.TBD) &&
      m.startTimeUtc !== null &&
      m.startTimeUtc > buildNowUtc &&
      (m.homeTeamId === teamId || m.awayTeamId === teamId),
    )
    .sort((a, b) => {
      // Sort by startTimeUtc asc to get soonest first
      if (a.startTimeUtc! < b.startTimeUtc!) return -1;
      if (a.startTimeUtc! > b.startTimeUtc!) return 1;
      // Deterministic tie-break by matchId
      return a.matchId < b.matchId ? -1 : 1;
    });

  // No upcoming match → missing signal
  if (upcomingMatches.length === 0) {
    return {
      key: SignalKey.NEXT_MATCH_HOURS,
      entityKind: SignalEntityKind.TEAM,
      entityId: teamId,
      value: 0,
      unit: 'hours',
      params: {
        hours: null,
        minHours: MIN_HOURS,
        maxHours: MAX_HOURS,
        nextMatchId: null,
        reason: 'no_next_match',
      },
      quality: {
        source: 'canonical_derived',
        missing: true,
      },
      explain: 'No upcoming scheduled match found.',
    };
  }

  const nextMatch = upcomingMatches[0];
  const buildTime = new Date(buildNowUtc).getTime();
  const matchTime = new Date(nextMatch.startTimeUtc!).getTime();
  const hours = Math.max(0, (matchTime - buildTime) / (1000 * 60 * 60));

  // Inverse normalization: sooner match → higher value
  const norm = 1 - clamp((hours - MIN_HOURS) / (MAX_HOURS - MIN_HOURS), 0, 1);

  return {
    key: SignalKey.NEXT_MATCH_HOURS,
    entityKind: SignalEntityKind.TEAM,
    entityId: teamId,
    value: norm,
    unit: 'hours',
    params: {
      hours,
      minHours: MIN_HOURS,
      maxHours: MAX_HOURS,
      nextMatchId: nextMatch.matchId,
    },
    quality: {
      source: 'canonical_derived',
      missing: false,
    },
    explain: 'Sooner next match => higher attention; normalized inverse hours within horizon.',
  };
}
