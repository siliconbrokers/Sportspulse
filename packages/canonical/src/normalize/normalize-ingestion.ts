import type { Competition, Season, Team, Match } from '../model/entities.js';
import {
  PROVIDER_KEY,
  mapCompetition,
  mapSeason,
  mapTeam,
  mapMatch,
} from '../ingest/football-data-adapter.js';
import type {
  FDCompetitionResponse,
  FDTeamResponse,
  FDMatchResponse,
} from '../ingest/football-data-types.js';
import {
  competitionId,
  seasonId,
  teamId,
  matchId,
} from './canonical-id.js';

/**
 * Result of a normalization run.
 *
 * Contains all canonical entities produced from the provider batch,
 * plus diagnostics about skipped or partial data.
 *
 * Spec refs:
 * - Data Normalization Spec §12.2 (Core normalization responsibilities)
 * - Data Normalization Spec §13 (Validation Rules)
 * - Backend Architecture §8 (Ingestion Strategy)
 */
export interface NormalizationResult {
  competition: Competition;
  season: Season | null;
  teams: Team[];
  matches: Match[];
  skippedMatchIds: string[];
}

/**
 * Normalizes a batch of football-data.org responses into canonical entities.
 *
 * This is the entry point for the normalization pipeline. It:
 * 1. Generates deterministic canonical IDs from provider IDs
 * 2. Maps all entities through the provider adapter
 * 3. Builds the provider→canonical team ID map for match resolution
 * 4. Reports matches that couldn't be normalized (partial data)
 *
 * @param fdCompetition - Competition response from football-data.org
 * @param fdTeams - Teams list from football-data.org
 * @param fdMatches - Matches list from football-data.org
 * @param nowUtc - Current UTC timestamp for lastSeenUtc
 */
export function normalizeIngestion(
  fdCompetition: FDCompetitionResponse,
  fdTeams: readonly FDTeamResponse[],
  fdMatches: readonly FDMatchResponse[],
  nowUtc: string,
): NormalizationResult {
  // Generate canonical IDs
  const compId = competitionId(PROVIDER_KEY, fdCompetition.code);
  const seasId = fdCompetition.currentSeason
    ? seasonId(PROVIDER_KEY, fdCompetition.currentSeason.id)
    : null;

  // Map competition and season
  const competition = mapCompetition(fdCompetition, compId);
  const season = seasId ? mapSeason(fdCompetition, compId, seasId) : null;

  // Map teams and build provider→canonical ID map
  const teamIdMap = new Map<string, string>();
  const teams: Team[] = fdTeams.map(fd => {
    const tId = teamId(PROVIDER_KEY, fd.id);
    teamIdMap.set(String(fd.id), tId);
    return mapTeam(fd, tId);
  });

  // Map matches, tracking failures
  const matches: Match[] = [];
  const skippedMatchIds: string[] = [];

  for (const fd of fdMatches) {
    const mId = matchId(PROVIDER_KEY, fd.id);
    const match = seasId
      ? mapMatch(fd, mId, seasId, teamIdMap, nowUtc)
      : null;

    if (match) {
      matches.push(match);
    } else {
      skippedMatchIds.push(String(fd.id));
    }
  }

  return { competition, season, teams, matches, skippedMatchIds };
}
