import { EventStatus, MatchPeriod } from '../model/enums.js';

/**
 * Maps provider status strings to canonical EventStatus.
 *
 * Sources:
 * - Data Normalization Spec §6 (Status Normalization)
 * - Backend Architecture §11.2 (Event status mapping)
 * - Event Lifecycle Spec §2 (Canonical Event Statuses)
 *
 * Unknown or unmapped statuses default to TBD.
 */
const STATUS_MAP: Record<string, EventStatus> = {
  // Canonical pass-through
  SCHEDULED: EventStatus.SCHEDULED,
  IN_PROGRESS: EventStatus.IN_PROGRESS,
  FINISHED: EventStatus.FINISHED,
  POSTPONED: EventStatus.POSTPONED,
  CANCELED: EventStatus.CANCELED,
  TBD: EventStatus.TBD,

  // football-data.org specific
  TIMED: EventStatus.SCHEDULED,
  IN_PLAY: EventStatus.IN_PROGRESS,
  LIVE: EventStatus.IN_PROGRESS,
  PAUSED: EventStatus.IN_PROGRESS,
  AWARDED: EventStatus.FINISHED,
  SUSPENDED: EventStatus.POSTPONED,
  CANCELLED: EventStatus.CANCELED,

  // Common alternative names from other providers
  NOT_STARTED: EventStatus.SCHEDULED,
  FT: EventStatus.FINISHED,
  FINAL: EventStatus.FINISHED,

  // TheSportsDB specific
  'MATCH FINISHED': EventStatus.FINISHED,
  'NOT STARTED': EventStatus.SCHEDULED,
  'IN PROGRESS': EventStatus.IN_PROGRESS,
  'MATCH POSTPONED': EventStatus.POSTPONED,
  'MATCH CANCELLED': EventStatus.CANCELED,
  'MATCH ABANDONED': EventStatus.POSTPONED,
  // TheSportsDB live match period statuses
  '1H': EventStatus.IN_PROGRESS, // First Half
  '2H': EventStatus.IN_PROGRESS, // Second Half
  HT: EventStatus.IN_PROGRESS, // Half Time
  ET: EventStatus.IN_PROGRESS, // Extra Time
  'EXTRA TIME': EventStatus.IN_PROGRESS,
  PEN: EventStatus.IN_PROGRESS, // Penalty shootout
  PENALTIES: EventStatus.IN_PROGRESS,
  'POST.': EventStatus.POSTPONED,
};

export function classifyStatus(providerStatus: string): EventStatus {
  const normalized = providerStatus.toUpperCase().trim();
  return STATUS_MAP[normalized] ?? EventStatus.TBD;
}

/**
 * Maps provider status strings to MatchPeriod.
 * Returns undefined when the period cannot be determined from the status string.
 *
 * Sources:
 * - TheSportsDB: '1H' / 'HT' / '2H' / 'ET' / 'PEN'
 * - football-data.org: 'PAUSED' = half-time; 'IN_PLAY' = ambiguous (no 1H/2H distinction)
 */
export function classifyPeriod(providerStatus: string): MatchPeriod | undefined {
  const s = providerStatus.toUpperCase().trim();
  if (s === '1H') return MatchPeriod.FIRST_HALF;
  if (s === 'HT' || s === 'PAUSED') return MatchPeriod.HALF_TIME;
  if (s === '2H') return MatchPeriod.SECOND_HALF;
  if (s === 'ET' || s === 'EXTRA TIME') return MatchPeriod.EXTRA_TIME;
  if (s === 'PEN' || s === 'PENALTIES') return MatchPeriod.PENALTIES;
  return undefined;
}
