import type { Competition, Season, Team, Match } from '../model/entities.js';
import { Sport, CompetitionFormat } from '../model/enums.js';
import { classifyStatus, classifyPeriod } from '../lifecycle/classify-status.js';
import type {
  FDCompetitionResponse,
  FDTeamResponse,
  FDMatchResponse,
} from './football-data-types.js';

/**
 * football-data.org adapter — maps provider responses to canonical entities.
 *
 * Spec refs:
 * - Data Normalization Spec §12.1 (Provider adapter responsibilities)
 * - Backend Architecture §11 (Normalization Rules)
 * - Constitution §4.5 (Provider isolation)
 *
 * PROVIDER_KEY is the stable identifier for this provider across all mappings.
 */

export const PROVIDER_KEY = 'football-data';

const FORMAT_MAP: Record<string, CompetitionFormat> = {
  LEAGUE: CompetitionFormat.LEAGUE,
  CUP: CompetitionFormat.CUP,
  TOURNAMENT: CompetitionFormat.TOURNAMENT,
};

export function mapCompetition(fd: FDCompetitionResponse, competitionId: string): Competition {
  return {
    competitionId,
    sportId: Sport.FOOTBALL,
    providerKey: PROVIDER_KEY,
    providerCompetitionCode: fd.code,
    name: fd.name,
    formatType: FORMAT_MAP[fd.type] ?? CompetitionFormat.LEAGUE,
    isEnabled: true,
  };
}

export function mapSeason(
  fd: FDCompetitionResponse,
  competitionId: string,
  seasonId: string,
): Season | null {
  if (!fd.currentSeason) return null;
  const cs = fd.currentSeason;
  const startYear = cs.startDate.slice(0, 4);
  const endYear = cs.endDate.slice(0, 4);
  const label = startYear === endYear ? startYear : `${startYear}/${endYear.slice(2)}`;
  return {
    seasonId,
    competitionId,
    label,
    startDate: cs.startDate,
    endDate: cs.endDate,
  };
}

export function mapTeam(fd: FDTeamResponse, teamId: string): Team {
  return {
    teamId,
    sportId: Sport.FOOTBALL,
    name: fd.name,
    shortName: fd.shortName || fd.tla || fd.name.slice(0, 3).toUpperCase(),
    tla: fd.tla || undefined,
    crestUrl: fd.crest || undefined,
    venueName: fd.venue || undefined,
    coachName: fd.coach?.name || undefined,
    providerKey: PROVIDER_KEY,
    providerTeamId: String(fd.id),
  };
}

/**
 * Maps a football-data.org match to a canonical Match.
 *
 * @param teamIdMap - Map from provider team ID (string) to canonical teamId.
 *   If a participant can't be resolved, returns null (partial data).
 */
export function mapMatch(
  fd: FDMatchResponse,
  matchId: string,
  seasonId: string,
  teamIdMap: ReadonlyMap<string, string>,
  nowUtc: string,
): Match | null {
  const homeTeamId = teamIdMap.get(String(fd.homeTeam.id));
  const awayTeamId = teamIdMap.get(String(fd.awayTeam.id));
  if (!homeTeamId || !awayTeamId) return null;

  return {
    matchId,
    seasonId,
    matchday: fd.matchday ?? undefined,
    startTimeUtc: fd.utcDate || null,
    status: classifyStatus(fd.status),
    matchPeriod: classifyPeriod(fd.status),
    homeTeamId,
    awayTeamId,
    scoreHome: fd.score.fullTime.home,
    scoreAway: fd.score.fullTime.away,
    providerKey: PROVIDER_KEY,
    providerMatchId: String(fd.id),
    lastSeenUtc: nowUtc,
  };
}
