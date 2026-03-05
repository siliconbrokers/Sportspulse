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

export const ParticipantRole = {
  HOME: 'HOME',
  AWAY: 'AWAY',
} as const;
export type ParticipantRole = (typeof ParticipantRole)[keyof typeof ParticipantRole];
