export const Sport = {
  FOOTBALL: 'FOOTBALL',
} as const;
export type Sport = (typeof Sport)[keyof typeof Sport];

export const CompetitionFormat = {
  LEAGUE: 'LEAGUE',
  CUP: 'CUP',
  TOURNAMENT: 'TOURNAMENT',
} as const;
export type CompetitionFormat = (typeof CompetitionFormat)[keyof typeof CompetitionFormat];

export const EventStatus = {
  TBD: 'TBD',
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  FINISHED: 'FINISHED',
  POSTPONED: 'POSTPONED',
  CANCELED: 'CANCELED',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

export const MatchPeriod = {
  FIRST_HALF: 'FIRST_HALF',
  HALF_TIME: 'HALF_TIME',
  SECOND_HALF: 'SECOND_HALF',
  EXTRA_TIME: 'EXTRA_TIME',
  PENALTIES: 'PENALTIES',
} as const;
export type MatchPeriod = (typeof MatchPeriod)[keyof typeof MatchPeriod];

export const ParticipantRole = {
  HOME: 'HOME',
  AWAY: 'AWAY',
} as const;
export type ParticipantRole = (typeof ParticipantRole)[keyof typeof ParticipantRole];

// ── Tournament model enums ─────────────────────────────────────────────────────

export const FormatFamily = {
  LEAGUE_TABLE: 'LEAGUE_TABLE',
  GROUP_STAGE_PLUS_KNOCKOUT: 'GROUP_STAGE_PLUS_KNOCKOUT',
  GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS: 'GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS',
  LEAGUE_PHASE_PLUS_KNOCKOUT: 'LEAGUE_PHASE_PLUS_KNOCKOUT',
} as const;
export type FormatFamily = (typeof FormatFamily)[keyof typeof FormatFamily];

export const StageType = {
  LEAGUE: 'LEAGUE',
  GROUP_STAGE: 'GROUP_STAGE',
  ROUND_OF_32: 'ROUND_OF_32',
  ROUND_OF_16: 'ROUND_OF_16',
  QUARTER_FINALS: 'QUARTER_FINALS',
  SEMI_FINALS: 'SEMI_FINALS',
  FINAL: 'FINAL',
  PLAYOFF: 'PLAYOFF',
  CUSTOM: 'CUSTOM',
} as const;
export type StageType = (typeof StageType)[keyof typeof StageType];

export const StandingScope = {
  STAGE: 'STAGE',
  GROUP: 'GROUP',
} as const;
export type StandingScope = (typeof StandingScope)[keyof typeof StandingScope];

export const SlotRole = {
  A: 'A',
  B: 'B',
} as const;
export type SlotRole = (typeof SlotRole)[keyof typeof SlotRole];
