export {
  Sport,
  CompetitionFormat,
  EventStatus,
  MatchPeriod,
  ParticipantRole,
  FormatFamily,
  StageType,
  StandingScope,
  SlotRole,
} from './model/enums.js';
export type {
  Competition,
  Season,
  Team,
  Match,
  MatchParticipant,
  Stage,
  Group,
  StandingTable,
  Tie,
  TieSlot,
} from './model/entities.js';

// Lifecycle
export { classifyStatus, classifyPeriod } from './lifecycle/classify-status.js';
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
export { canonicalId, competitionId, seasonId, teamId, matchId } from './normalize/canonical-id.js';
export { normalizeIngestion } from './normalize/normalize-ingestion.js';
export type { NormalizationResult } from './normalize/normalize-ingestion.js';
