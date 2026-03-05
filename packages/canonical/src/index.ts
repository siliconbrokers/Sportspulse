export { Sport, CompetitionFormat, EventStatus, ParticipantRole } from './model/enums.js';
export type { Competition, Season, Team, Match, MatchParticipant } from './model/entities.js';

// Lifecycle
export { classifyStatus } from './lifecycle/classify-status.js';
export { validateTransition } from './lifecycle/transitions.js';
export type { TransitionResult } from './lifecycle/transitions.js';

// Provider adapter: football-data.org
export {
  PROVIDER_KEY,
  mapCompetition,
  mapSeason,
  mapTeam,
  mapMatch,
} from './ingest/football-data-adapter.js';
export type {
  FDCompetitionResponse,
  FDTeamResponse,
  FDTeamsListResponse,
  FDMatchResponse,
  FDMatchesListResponse,
} from './ingest/football-data-types.js';

// Normalization
export {
  canonicalId,
  competitionId,
  seasonId,
  teamId,
  matchId,
} from './normalize/canonical-id.js';
export { normalizeIngestion } from './normalize/normalize-ingestion.js';
export type { NormalizationResult } from './normalize/normalize-ingestion.js';
