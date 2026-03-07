import type { Match, Team } from '@sportpulse/canonical';
import { EventStatus } from '@sportpulse/canonical';
import type { TeamScoreDTO } from '../dto/team-score.js';
import type { DisplayChipDTO, ExplainLineDTO } from './display-hints-mapper.js';

// ─── MatchTileHintsDTO (match-map-visual-encoding §3) ─────────────────────────

export type SizeBucket = 'S' | 'M' | 'L' | 'XL';
export type UrgencyColorKey = 'LIVE' | 'TODAY' | 'TOMORROW' | 'D2_3' | 'D4_7' | 'LATER' | 'UNKNOWN';
export type HeatBorderKey = 'NONE' | 'ONE_HOT' | 'BOTH_HOT' | 'DATA_MISSING';
export type FeaturedRank = 'NONE' | 'FEATURED';

export interface MatchTileHintsDTO {
  sizeBucket: SizeBucket;
  urgencyColorKey: UrgencyColorKey;
  heatBorderKey: HeatBorderKey;
  featuredRank: FeaturedRank;
}

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
  scoreHome?: number | null;
  scoreAway?: number | null;
  timeChip: DisplayChipDTO;
  home: MatchCardTeam;
  away: MatchCardTeam;
  rankScore?: number;
  explainLine?: ExplainLineDTO;
  tileHints: MatchTileHintsDTO;
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

// ─── tileHints helpers (§4, §5, §6, §7) ──────────────────────────────────────

function computeUrgencyColorKey(hours: number | null, isLive: boolean): UrgencyColorKey {
  if (isLive) return 'LIVE';
  if (hours === null) return 'UNKNOWN';
  if (hours < 24) return 'TODAY';
  if (hours < 48) return 'TOMORROW';
  if (hours < 96) return 'D2_3';
  if (hours <= 168) return 'D4_7';
  return 'LATER';
}

function computeHeatBorderKey(
  homeFormKind: string | undefined,
  awayFormKind: string | undefined,
): HeatBorderKey {
  const homeHot = homeFormKind === 'FORM_HOT';
  const awayHot = awayFormKind === 'FORM_HOT';
  const homeMissing = homeFormKind === undefined || homeFormKind === 'FORM_UNKNOWN';
  const awayMissing = awayFormKind === undefined || awayFormKind === 'FORM_UNKNOWN';
  if (homeHot && awayHot) return 'BOTH_HOT';
  if (homeHot || awayHot) return 'ONE_HOT';
  if (homeMissing || awayMissing) return 'DATA_MISSING';
  return 'NONE';
}

function assignSizeBuckets(sortedCards: { rankScore?: number }[]): SizeBucket[] {
  const n = sortedCards.length;
  if (n === 0) return [];
  const xlEnd = Math.ceil(0.1 * n);
  const lEnd = Math.ceil(0.3 * n);
  const mEnd = Math.ceil(0.7 * n);
  return sortedCards.map((_, i) => {
    if (i < xlEnd) return 'XL';
    if (i < lEnd) return 'L';
    if (i < mEnd) return 'M';
    return 'S';
  });
}

function computeFeaturedRank(
  sizeBucket: SizeBucket,
  heatBorderKey: HeatBorderKey,
  urgencyColorKey: UrgencyColorKey,
): FeaturedRank {
  if (sizeBucket === 'XL') return 'FEATURED';
  if (
    heatBorderKey === 'BOTH_HOT' &&
    (urgencyColorKey === 'LIVE' || urgencyColorKey === 'TODAY' || urgencyColorKey === 'TOMORROW')
  ) {
    return 'FEATURED';
  }
  return 'NONE';
}

// ─── Builder (§8) ────────────────────────────────────────────────────────────

/**
 * Builds deduplicated match-first cards from canonical matches and team truth.
 * §8.1: exactly 1 card per matchId.
 * §8.2: rankScore = 1 - (1 - home.displayScore) * (1 - away.displayScore).
 * Two-pass: first build cards without sizeBucket, then assign sizeBucket by
 * percentile (§4.2), then compute tileHints, sorted by kickoffUtc asc for display.
 */
export function buildMatchCards(
  matches: readonly Match[],
  allTeams: readonly Team[],
  teamScores: readonly Omit<TeamScoreDTO, 'rect'>[],
  buildNowUtc: string,
  matchday?: number,
): MatchCardDTO[] {
  const scoreMap = new Map<string, Omit<TeamScoreDTO, 'rect'>>(
    teamScores.map((t) => [t.teamId, t]),
  );
  const teamMap = new Map<string, Team>(allTeams.map((t) => [t.teamId, t]));

  // When a matchday is given: show all matches of that matchday (any status).
  // Otherwise: show LIVE, future SCHEDULED, or heuristically-live SCHEDULED
  // (kickoff in the past within 110 min — API may lag behind real status).
  const relevant =
    matchday !== undefined
      ? matches.filter((m) => m.matchday === matchday)
      : matches.filter((m) => {
          if (m.status === EventStatus.IN_PROGRESS) return true;
          if (m.status === EventStatus.SCHEDULED && m.startTimeUtc !== null) {
            const diffMs = new Date(m.startTimeUtc).getTime() - new Date(buildNowUtc).getTime();
            // Future match OR kickoff within last 110 min (heuristically live)
            return diffMs > 0 || diffMs >= -(110 * 60 * 1000);
          }
          return false;
        });

  // ── Pass 1: build intermediate cards (without tileHints) ──────────────────

  type IntermediateCard = Omit<MatchCardDTO, 'tileHints'> & {
    hours: number | null;
    isLive: boolean;
    homeFormKind: string | undefined;
    awayFormKind: string | undefined;
  };

  const seen = new Set<string>();
  const intermediate: IntermediateCard[] = [];

  for (const match of relevant) {
    if (seen.has(match.matchId)) continue;
    seen.add(match.matchId);

    const isLive = match.status === EventStatus.IN_PROGRESS;
    let hours: number | null = null;
    if (match.startTimeUtc !== null) {
      const diffMs = new Date(match.startTimeUtc).getTime() - new Date(buildNowUtc).getTime();
      hours = diffMs / (1000 * 60 * 60);
    }

    const isFinished = match.status === EventStatus.FINISHED;
    // Heurístico: si el kickoff ya pasó y no han pasado más de 110 min, el partido
    // probablemente está en juego aunque la API aún no actualizó el status.
    const isHeuristicallyLive =
      !isLive && !isFinished && hours !== null && hours < 0 && hours > -110 / 60;
    const timeChip = isFinished
      ? { icon: '✅', label: 'Finalizado', level: 'INFO' as const, kind: 'TIME_FINISHED' }
      : mapTimeChipFromHours(hours, isLive);

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

    intermediate.push({
      matchId: match.matchId,
      kickoffUtc: match.startTimeUtc ?? undefined,
      status: toCardStatus(match.status),
      scoreHome: isFinished || isLive || isHeuristicallyLive ? match.scoreHome : undefined,
      scoreAway: isFinished || isLive || isHeuristicallyLive ? match.scoreAway : undefined,
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
      hours,
      isLive,
      homeFormKind: homeFormChip?.kind,
      awayFormKind: awayFormChip?.kind,
    });
  }

  // ── Pass 2: assign sizeBuckets by percentile (§4.2) ───────────────────────

  // Sort by rankScore desc, matchId asc (tie-break)
  const sorted = [...intermediate].sort((a, b) => {
    const diff = (b.rankScore ?? 0) - (a.rankScore ?? 0);
    if (diff !== 0) return diff;
    return a.matchId.localeCompare(b.matchId);
  });

  const buckets = assignSizeBuckets(sorted);

  // Build index: matchId → sizeBucket
  const bucketMap = new Map<string, SizeBucket>();
  sorted.forEach((c, i) => bucketMap.set(c.matchId, buckets[i]));

  // ── Assemble final MatchCardDTO[] sorted by kickoffUtc asc ────────────────

  const cards: MatchCardDTO[] = intermediate.map((c) => {
    const sizeBucket = bucketMap.get(c.matchId) ?? 'S';
    const urgencyColorKey = computeUrgencyColorKey(c.hours, c.isLive);
    const heatBorderKey = computeHeatBorderKey(c.homeFormKind, c.awayFormKind);
    const featuredRank = computeFeaturedRank(sizeBucket, heatBorderKey, urgencyColorKey);

    const { hours: _h, isLive: _l, homeFormKind: _hfk, awayFormKind: _afk, ...rest } = c;
    return {
      ...rest,
      tileHints: { sizeBucket, urgencyColorKey, heatBorderKey, featuredRank },
    };
  });

  return cards.sort((a, b) => {
    const ta = a.kickoffUtc ?? '';
    const tb = b.kickoffUtc ?? '';
    if (tb !== ta) return ta.localeCompare(tb); // más cercano primero
    return a.matchId.localeCompare(b.matchId);
  });
}
