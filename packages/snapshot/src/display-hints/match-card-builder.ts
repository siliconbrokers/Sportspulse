import type { Match, Team } from '@sportpulse/canonical';
import { EventStatus } from '@sportpulse/canonical';
import type { TeamScoreDTO } from '../dto/team-score.js';
import type { DisplayChipDTO, ExplainLineDTO } from './display-hints-mapper.js';

// ─── MatchCardDTO ─────────────────────────────────────────────────────────────

export interface MatchCardTeam {
  teamId: string;
  name: string;
  crestUrl?: string;
  formChip?: DisplayChipDTO;
}

export interface MatchCardDTO {
  matchId: string;
  kickoffUtc?: string;
  status?: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'UNKNOWN';
  timeChip: DisplayChipDTO;
  home: MatchCardTeam;
  away: MatchCardTeam;
  rankScore?: number;
  explainLine?: ExplainLineDTO;
}

// ─── Time chip (match-level, §9.2) ───────────────────────────────────────────

/** Maps hours to a time chip directly (not via signal lookup). */
export function mapTimeChipFromHours(hours: number | null, isLive: boolean): DisplayChipDTO {
  if (isLive) {
    return { icon: '🔴', label: 'En juego', level: 'HOT', kind: 'TIME_LIVE' };
  }
  if (hours === null) {
    return { icon: '⚠️', label: 'Sin fecha', level: 'UNKNOWN', kind: 'TIME_UNKNOWN' };
  }
  if (hours <= 0) {
    return { icon: '⏱️', label: 'Ya empezó', level: 'WARN', kind: 'TIME_STARTED' };
  }
  if (hours < 24) {
    return {
      icon: '⏳',
      label: `Hoy · en ${Math.ceil(hours)} h`,
      level: 'HOT',
      kind: 'TIME_TODAY_HOURS',
    };
  }
  if (hours < 48) {
    return {
      icon: '⏳',
      label: `Mañana · en ${Math.ceil(hours)} h`,
      level: 'OK',
      kind: 'TIME_TOMORROW_HOURS',
    };
  }
  if (hours <= 168) {
    return {
      icon: '📅',
      label: `En ${Math.round(hours / 24)} días`,
      level: 'INFO',
      kind: 'TIME_DAYS',
    };
  }
  return {
    icon: '🗓️',
    label: `En ${Math.round(hours / 24)} días`,
    level: 'INFO',
    kind: 'TIME_LATER_DAYS',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toCardStatus(status: string): 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'UNKNOWN' {
  switch (status) {
    case EventStatus.SCHEDULED:
      return 'SCHEDULED';
    case EventStatus.IN_PROGRESS:
      return 'LIVE';
    case EventStatus.FINISHED:
      return 'FINISHED';
    default:
      return 'UNKNOWN';
  }
}

function formShortLabel(kind: string | undefined, isHome: boolean): string {
  const prefix = isHome ? 'local' : 'visita';
  switch (kind) {
    case 'FORM_HOT':
      return `${prefix} picante`;
    case 'FORM_GOOD':
      return `${prefix} viene bien`;
    case 'FORM_NORMAL':
      return `${prefix} normal`;
    case 'FORM_BAD':
      return `${prefix} viene mal`;
    default:
      return `${prefix} sin datos`;
  }
}

// ─── Builder (§8) ────────────────────────────────────────────────────────────

/**
 * Builds deduplicated match-first cards from canonical matches and team truth.
 * §8.1: exactly 1 card per matchId.
 * §8.2: rankScore = 1 - (1 - home.displayScore) * (1 - away.displayScore).
 * Sorted: rankScore desc, matchId asc.
 */
export function buildMatchCards(
  matches: readonly Match[],
  allTeams: readonly Team[],
  teamScores: readonly Omit<TeamScoreDTO, 'rect'>[],
  buildNowUtc: string,
): MatchCardDTO[] {
  const scoreMap = new Map<string, Omit<TeamScoreDTO, 'rect'>>(
    teamScores.map((t) => [t.teamId, t]),
  );
  const teamMap = new Map<string, Team>(allTeams.map((t) => [t.teamId, t]));

  // Include LIVE and future SCHEDULED matches only
  const relevant = matches.filter(
    (m) =>
      m.status === EventStatus.IN_PROGRESS ||
      (m.status === EventStatus.SCHEDULED &&
        m.startTimeUtc !== null &&
        m.startTimeUtc > buildNowUtc),
  );

  const cardMap = new Map<string, MatchCardDTO>();

  for (const match of relevant) {
    if (cardMap.has(match.matchId)) continue;

    const isLive = match.status === EventStatus.IN_PROGRESS;
    let hours: number | null = null;
    if (match.startTimeUtc !== null) {
      const diffMs = new Date(match.startTimeUtc).getTime() - new Date(buildNowUtc).getTime();
      hours = diffMs / (1000 * 60 * 60);
    }

    const timeChip = mapTimeChipFromHours(hours, isLive);

    const homeScore = scoreMap.get(match.homeTeamId);
    const awayScore = scoreMap.get(match.awayTeamId);
    const homeTeam = teamMap.get(match.homeTeamId);
    const awayTeam = teamMap.get(match.awayTeamId);

    const homeFormChip = homeScore?.displayHints?.formChip;
    const awayFormChip = awayScore?.displayHints?.formChip;

    // §8.2 rankScore
    let rankScore: number;
    if (homeScore !== undefined && awayScore !== undefined) {
      rankScore = 1 - (1 - homeScore.displayScore) * (1 - awayScore.displayScore);
    } else if (homeScore !== undefined) {
      rankScore = homeScore.displayScore;
    } else if (awayScore !== undefined) {
      rankScore = awayScore.displayScore;
    } else {
      rankScore = 0;
    }

    const homeShort = formShortLabel(homeFormChip?.kind, true);
    const awayShort = formShortLabel(awayFormChip?.kind, false);
    const explainLine: ExplainLineDTO = {
      text: `Porque: ${timeChip.label} + ${homeShort} / ${awayShort}`,
      kind: 'WHY_MATCH_SIMPLE',
    };

    cardMap.set(match.matchId, {
      matchId: match.matchId,
      kickoffUtc: match.startTimeUtc ?? undefined,
      status: toCardStatus(match.status),
      timeChip,
      home: {
        teamId: match.homeTeamId,
        name: homeTeam?.name ?? match.homeTeamId,
        crestUrl: homeTeam?.crestUrl,
        formChip: homeFormChip,
      },
      away: {
        teamId: match.awayTeamId,
        name: awayTeam?.name ?? match.awayTeamId,
        crestUrl: awayTeam?.crestUrl,
        formChip: awayFormChip,
      },
      rankScore,
      explainLine,
    });
  }

  return [...cardMap.values()].sort((a, b) => {
    const ra = a.rankScore ?? 0;
    const rb = b.rankScore ?? 0;
    if (rb !== ra) return rb - ra;
    return a.matchId.localeCompare(b.matchId);
  });
}
