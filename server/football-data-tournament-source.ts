/**
 * FootballDataTournamentSource — adaptador para torneos con grupos + eliminatorias.
 * Diseñado para Copa del Mundo 2026 vía football-data.org API v4.
 *
 * Obtiene equipos, partidos y standings, los normaliza en memoria y expone:
 *   - DataSource interface → para que el scheduler monitoree partidos WC
 *   - getGroupView()       → datos de fase de grupos para el API route
 *   - getBracketView()     → datos de eliminatorias para el API route
 */
import { teamId as canonicalTeamId, matchId as canonicalMatchId, seasonId as canonicalSeasonId, competitionId as canonicalCompId } from '@sportpulse/canonical';
import type { Team, Match, StageType } from '@sportpulse/canonical';
import type { DataSource, StandingEntry } from '@sportpulse/snapshot';

export const WC_PROVIDER_KEY = 'football-data-wc';
const FD_PROVIDER_KEY = 'football-data'; // mismo API, distinto identificador de liga

// ── football-data.org response types (WC-specific) ──────────────────────────

interface FDWCTeam {
  id: number;
  name: string;
  shortName: string;
  tla: string;
  crest?: string;
  venue?: string;
}

interface FDWCMatch {
  id: number;
  season: { id: number; startDate: string; endDate: string };
  matchday?: number | null;
  utcDate: string;
  status: string;
  stage: string;   // 'GROUP_STAGE' | 'ROUND_OF_32' | 'ROUND_OF_16' | 'QUARTER_FINALS' | 'SEMI_FINALS' | 'FINAL' | ...
  group?: string | null; // 'GROUP_A' ... 'GROUP_L'
  homeTeam: { id: number | null; name: string | null };
  awayTeam: { id: number | null; name: string | null };
  score: {
    winner?: string | null; // 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
    fullTime: { home: number | null; away: number | null };
    extraTime?: { home: number | null; away: number | null } | null;
    penalties?: { home: number | null; away: number | null } | null;
  };
}

interface FDWCStandingRow {
  position: number;
  team: { id: number; name: string; crest?: string };
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

interface FDWCStandingsResponse {
  standings: Array<{
    stage: string;
    type: string;   // 'GROUP_A' ... 'GROUP_L'
    group: string;
    table: FDWCStandingRow[];
  }>;
}

// ── Stage metadata tables ─────────────────────────────────────────────────────

const STAGE_ORDER: Record<string, number> = {
  GROUP_STAGE: 0,
  LAST_32: 1, ROUND_OF_32: 1,
  LAST_16: 2, ROUND_OF_16: 2,
  QUARTER_FINALS: 3,
  SEMI_FINALS: 4,
  THIRD_PLACE: 5, PLAY_OFF_FOR_THIRD_PLACE: 5,
  FINAL: 6,
};

const STAGE_NAME_ES: Record<string, string> = {
  GROUP_STAGE: 'Fase de grupos',
  LAST_32: 'Ronda de 32',    ROUND_OF_32: 'Ronda de 32',
  LAST_16: 'Ronda de 16',    ROUND_OF_16: 'Ronda de 16',
  QUARTER_FINALS: 'Cuartos de final',
  SEMI_FINALS: 'Semifinales',
  THIRD_PLACE: 'Tercer puesto', PLAY_OFF_FOR_THIRD_PLACE: 'Tercer puesto',
  FINAL: 'Final',
};

const STAGE_ROUND_LABEL: Record<string, string> = {
  GROUP_STAGE: 'GS',
  LAST_32: 'R32', ROUND_OF_32: 'R32',
  LAST_16: 'R16', ROUND_OF_16: 'R16',
  QUARTER_FINALS: 'QF',
  SEMI_FINALS: 'SF',
  THIRD_PLACE: '3P', PLAY_OFF_FOR_THIRD_PLACE: '3P',
  FINAL: 'F',
};

const STAGE_TYPE_MAP: Record<string, StageType> = {
  GROUP_STAGE: 'GROUP_STAGE',
  LAST_32: 'ROUND_OF_32',    ROUND_OF_32: 'ROUND_OF_32',
  LAST_16: 'ROUND_OF_16',    ROUND_OF_16: 'ROUND_OF_16',
  QUARTER_FINALS: 'QUARTER_FINALS',
  SEMI_FINALS: 'SEMI_FINALS',
  THIRD_PLACE: 'PLAYOFF',    PLAY_OFF_FOR_THIRD_PLACE: 'PLAYOFF',
  FINAL: 'FINAL',
};

// ── DTO shapes (exactamente los que consumen los hooks del frontend) ───────────

export interface TieSlotBlock {
  slotId: string;
  slotRole: 'A' | 'B';
  participantId: string | null;
  placeholderText: string | null;
  teamName?: string;
  crestUrl?: string;
}

export interface TieBlock {
  tieId: string;
  name: string;
  roundLabel: string;
  orderIndex: number;
  slotA: TieSlotBlock;
  slotB: TieSlotBlock;
  scoreA?: number | null;
  scoreB?: number | null;
  scoreAExtraTime?: number | null;
  scoreBExtraTime?: number | null;
  scoreAPenalties?: number | null;
  scoreBPenalties?: number | null;
  winnerId?: string | null;
}

export interface RoundBlock {
  stageId: string;
  name: string;
  stageType: StageType;
  orderIndex: number;
  ties: TieBlock[];
}

export interface GroupStandingsBlock {
  group: { groupId: string; name: string; orderIndex: number };
  standings: StandingEntry[];
}

export interface TournamentGroupView {
  formatFamily: string;
  groups: GroupStandingsBlock[];
  /** Cuántos mejores terceros califican (para WC 2026 = 8) */
  bestThirdsCount: number;
}

export interface TournamentBracketView {
  rounds: RoundBlock[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeStatus(fdStatus: string): Match['status'] {
  switch (fdStatus.toUpperCase()) {
    case 'FINISHED':                          return 'FINISHED';
    case 'IN_PLAY': case 'PAUSED':            return 'IN_PROGRESS';
    case 'SCHEDULED': case 'TIMED':           return 'SCHEDULED';
    case 'POSTPONED':                         return 'POSTPONED';
    case 'CANCELLED': case 'SUSPENDED':       return 'CANCELED';
    default:                                  return 'TBD';
  }
}

/** Devuelve true si el type es un grupo válido tipo "GROUP_A", "GROUP_B", etc. */
function isGroupType(fdType: string): boolean {
  return /^GROUP_[A-Z]$/.test(fdType);
}

function groupLetter(fdGroupType: string): string {
  // 'GROUP_A' → 'A', asume que isGroupType() ya validó el formato
  return fdGroupType[fdGroupType.length - 1];
}

function groupOrderIndex(fdGroupType: string): number {
  return groupLetter(fdGroupType).charCodeAt(0) - 'A'.charCodeAt(0);
}

function groupNameEs(fdGroupType: string): string {
  return `Grupo ${groupLetter(fdGroupType)}`;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60_000; // 30 minutos

interface TournamentCache {
  teams: Map<string, Team>;
  matches: Match[];
  seasonId: string;
  /** groupId → standings entries, ordered by position */
  standingsByGroupId: Map<string, StandingEntry[]>;
  /** groupId → { groupId, name, orderIndex } */
  groupMeta: Map<string, { groupId: string; name: string; orderIndex: number }>;
  /** stageId → TieBlock[] (knockout phases only) */
  tiesByStageId: Map<string, TieBlock[]>;
  /** stageId → { name, stageType, orderIndex } */
  stageMeta: Map<string, { name: string; stageType: StageType; orderIndex: number }>;
  fetchedAt: number;
}

// ── Main class ────────────────────────────────────────────────────────────────

export class FootballDataTournamentSource implements DataSource {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly competitionCode: string;
  /** competitionId canónico que identifica esta fuente (usando WC_PROVIDER_KEY) */
  readonly competitionId: string;

  private cache: TournamentCache | null = null;

  constructor(apiToken: string, competitionCode: string, baseUrl = 'https://api.football-data.org/v4') {
    this.apiToken = apiToken;
    this.competitionCode = competitionCode;
    this.baseUrl = baseUrl;
    this.competitionId = canonicalCompId(WC_PROVIDER_KEY, competitionCode);
  }

  // ── DataSource interface (requerido por RoutingDataSource + scheduler) ────────

  getTeams(_competitionId: string): Team[] {
    return this.cache ? [...this.cache.teams.values()] : [];
  }

  getMatches(_seasonId: string): Match[] {
    return this.cache?.matches ?? [];
  }

  getSeasonId(_competitionId: string): string | undefined {
    return this.cache?.seasonId;
  }

  getStandings(_competitionId: string, groupId?: string): StandingEntry[] {
    if (!this.cache) return [];
    if (groupId) return this.cache.standingsByGroupId.get(groupId) ?? [];
    // Sin groupId → todos los standings concatenados
    const all: StandingEntry[] = [];
    for (const entries of this.cache.standingsByGroupId.values()) {
      all.push(...entries);
    }
    return all;
  }

  // ── Vistas de torneo para las API routes ──────────────────────────────────

  getGroupView(_competitionId: string): TournamentGroupView | null {
    if (!this.cache) return null;

    const groups: GroupStandingsBlock[] = [];
    for (const [groupId, standings] of this.cache.standingsByGroupId) {
      const meta = this.cache.groupMeta.get(groupId);
      if (!meta) continue;
      groups.push({ group: meta, standings });
    }
    groups.sort((a, b) => a.group.orderIndex - b.group.orderIndex);

    return {
      formatFamily: 'GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS',
      groups,
      bestThirdsCount: 8, // WC 2026: 8 mejores terceros de 12 grupos
    };
  }

  getBracketView(_competitionId: string): TournamentBracketView | null {
    if (!this.cache) return null;

    const rounds: RoundBlock[] = [];
    for (const [stageId, ties] of this.cache.tiesByStageId) {
      const meta = this.cache.stageMeta.get(stageId);
      if (!meta) continue;
      rounds.push({
        stageId,
        name: meta.name,
        stageType: meta.stageType,
        orderIndex: meta.orderIndex,
        ties: [...ties].sort((a, b) => a.orderIndex - b.orderIndex),
      });
    }
    rounds.sort((a, b) => a.orderIndex - b.orderIndex);

    return { rounds };
  }

  // ── Fetch & derivación ────────────────────────────────────────────────────

  async fetchTournament(): Promise<void> {
    const nowMs = Date.now();
    if (this.cache && nowMs - this.cache.fetchedAt < CACHE_TTL_MS) {
      return; // datos frescos
    }

    const [teamsResp, matchesResp, standingsResp] = await Promise.all([
      this.apiGet<{ teams: FDWCTeam[] }>(`/competitions/${this.competitionCode}/teams`),
      this.apiGet<{ matches: FDWCMatch[] }>(`/competitions/${this.competitionCode}/matches`),
      this.apiGet<FDWCStandingsResponse>(`/competitions/${this.competitionCode}/standings`),
    ]);

    // SeasonId desde el primer partido
    const firstMatch = matchesResp.matches[0];
    const fdSeasonId = firstMatch?.season?.id;
    const seasonId = canonicalSeasonId(WC_PROVIDER_KEY, String(fdSeasonId ?? 'wc'));

    // ── Equipos ─────────────────────────────────────────────────────────────
    const teams = new Map<string, Team>();
    for (const t of teamsResp.teams) {
      const teamId = canonicalTeamId(FD_PROVIDER_KEY, String(t.id));
      teams.set(teamId, {
        teamId,
        sportId: 'FOOTBALL',
        name: t.name,
        shortName: t.shortName || t.tla || t.name,
        crestUrl: t.crest || undefined,
        venueName: t.venue || undefined,
        providerKey: FD_PROVIDER_KEY,
        providerTeamId: String(t.id),
      });
    }

    // ── Stages (derivados de los nombres únicos en partidos) ─────────────────
    const fdStageNames = new Set(matchesResp.matches.map((m) => m.stage));
    // stageMeta: stageId → { name, stageType, orderIndex }
    const stageMeta = new Map<string, { name: string; stageType: StageType; orderIndex: number }>();
    // fdName → stageId
    const stageIdByFdName = new Map<string, string>();

    for (const fdName of fdStageNames) {
      const orderIndex = STAGE_ORDER[fdName] ?? 99;
      const stageId = `stage:${seasonId}:${orderIndex}`;
      stageMeta.set(stageId, {
        name: STAGE_NAME_ES[fdName] ?? fdName,
        stageType: STAGE_TYPE_MAP[fdName] ?? 'CUSTOM',
        orderIndex,
      });
      stageIdByFdName.set(fdName, stageId);
    }

    // stageId del grupo
    const groupStageId = stageIdByFdName.get('GROUP_STAGE') ?? `stage:${seasonId}:0`;

    // ── Grupos y standings ────────────────────────────────────────────────────
    const groupMeta = new Map<string, { groupId: string; name: string; orderIndex: number }>();
    const standingsByGroupId = new Map<string, StandingEntry[]>();

    // Intento 1: standings per-grupo desde la API (torneo en curso o con sorteo ya realizado)
    const perGroupStandings = standingsResp.standings.filter(
      (gs) => isGroupType(gs.type) && gs.table && gs.table.length > 0,
    );

    if (perGroupStandings.length > 0) {
      for (const gs of perGroupStandings) {
        const orderIndex = groupOrderIndex(gs.type);
        const groupId = `group:${groupStageId}:${orderIndex}`;
        groupMeta.set(groupId, { groupId, name: groupNameEs(gs.type), orderIndex });
        standingsByGroupId.set(groupId, gs.table.map((row) => ({
          position: row.position,
          teamId: canonicalTeamId(FD_PROVIDER_KEY, String(row.team.id)),
          teamName: row.team.name,
          crestUrl: row.team.crest || undefined,
          playedGames: row.playedGames,
          won: row.won, draw: row.draw, lost: row.lost,
          goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst,
          goalDifference: row.goalDifference, points: row.points,
          groupId, statusBadge: null,
        })));
      }
    } else {
      // Intento 2: construir grupos desde los partidos de fase de grupos
      // (caso pre-torneo cuando standings devuelve TOTAL o nada por grupo)
      const groupTeamIds = new Map<string, Map<string, { name: string; crestUrl?: string }>>(); // fdGroupName → Map<fdTeamId → info>
      for (const m of matchesResp.matches) {
        if (m.stage !== 'GROUP_STAGE' || !m.group || !isGroupType(m.group)) continue;
        if (!groupTeamIds.has(m.group)) groupTeamIds.set(m.group, new Map());
        const grp = groupTeamIds.get(m.group)!;
        if (m.homeTeam.id != null) {
          const homeCanId = canonicalTeamId(FD_PROVIDER_KEY, String(m.homeTeam.id));
          const homeTeam = teams.get(homeCanId);
          grp.set(String(m.homeTeam.id), { name: homeTeam?.name ?? m.homeTeam.name ?? String(m.homeTeam.id), crestUrl: homeTeam?.crestUrl });
        }
        if (m.awayTeam.id != null) {
          const awayCanId = canonicalTeamId(FD_PROVIDER_KEY, String(m.awayTeam.id));
          const awayTeam = teams.get(awayCanId);
          grp.set(String(m.awayTeam.id), { name: awayTeam?.name ?? m.awayTeam.name ?? String(m.awayTeam.id), crestUrl: awayTeam?.crestUrl });
        }
      }
      for (const [fdGroupName, fdTeamMap] of groupTeamIds) {
        const orderIndex = groupOrderIndex(fdGroupName);
        const groupId = `group:${groupStageId}:${orderIndex}`;
        groupMeta.set(groupId, { groupId, name: groupNameEs(fdGroupName), orderIndex });
        const entries: StandingEntry[] = [...fdTeamMap.entries()].map(([fdId, info], pos) => ({
          position: pos + 1,
          teamId: canonicalTeamId(FD_PROVIDER_KEY, fdId),
          teamName: info.name,
          crestUrl: info.crestUrl,
          playedGames: 0, won: 0, draw: 0, lost: 0,
          goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0,
          groupId, statusBadge: null,
        }));
        standingsByGroupId.set(groupId, entries);
      }
    }

    // ── Partidos y ties (desde la respuesta de matches) ──────────────────────
    const matches: Match[] = [];
    const tiesByStageId = new Map<string, TieBlock[]>();
    const tieCountByStage = new Map<string, number>();

    for (const m of matchesResp.matches) {
      const stageId = stageIdByFdName.get(m.stage);
      if (!stageId) continue;

      const meta = stageMeta.get(stageId);
      if (!meta) continue;

      const matchId = canonicalMatchId(FD_PROVIDER_KEY, String(m.id));
      const homeTeamId = m.homeTeam.id != null
        ? canonicalTeamId(FD_PROVIDER_KEY, String(m.homeTeam.id))
        : null;
      const awayTeamId = m.awayTeam.id != null
        ? canonicalTeamId(FD_PROVIDER_KEY, String(m.awayTeam.id))
        : null;

      // Canonical Match (para scheduler — solo si tenemos ambos equipos)
      if (homeTeamId && awayTeamId) {
        const matchGroupId: string | null = m.group
          ? `group:${groupStageId}:${groupOrderIndex(m.group)}`
          : null;

        matches.push({
          matchId,
          seasonId,
          matchday: m.matchday ?? undefined,
          startTimeUtc: m.utcDate || null,
          status: normalizeStatus(m.status),
          homeTeamId,
          awayTeamId,
          scoreHome: m.score.fullTime.home,
          scoreAway: m.score.fullTime.away,
          providerKey: FD_PROVIDER_KEY,
          providerMatchId: String(m.id),
          lastSeenUtc: new Date(nowMs).toISOString(),
          stageId,
          groupId: matchGroupId,
          scoreHomeExtraTime: m.score.extraTime?.home ?? null,
          scoreAwayExtraTime: m.score.extraTime?.away ?? null,
          scoreHomePenalties: m.score.penalties?.home ?? null,
          scoreAwayPenalties: m.score.penalties?.away ?? null,
          winnerTeamId: m.score.winner === 'HOME_TEAM' ? homeTeamId
            : m.score.winner === 'AWAY_TEAM' ? awayTeamId
            : null,
        });
      }

      // Knockout Tie block (solo fases eliminatorias)
      if (meta.stageType !== 'GROUP_STAGE') {
        const idx = tieCountByStage.get(stageId) ?? 0;
        tieCountByStage.set(stageId, idx + 1);
        const tieId = `tie:${stageId}:${idx}`;

        const homeTeam = homeTeamId ? teams.get(homeTeamId) : undefined;
        const awayTeam = awayTeamId ? teams.get(awayTeamId) : undefined;

        const winnerId = m.score.winner === 'HOME_TEAM' ? homeTeamId
          : m.score.winner === 'AWAY_TEAM' ? awayTeamId
          : null;

        const slotA: TieSlotBlock = {
          slotId: `slot:${tieId}:A`,
          slotRole: 'A',
          participantId: homeTeamId,
          placeholderText: homeTeamId ? null : (m.homeTeam.name || 'Por definir'),
          teamName: homeTeam?.name,
          crestUrl: homeTeam?.crestUrl,
        };

        const slotB: TieSlotBlock = {
          slotId: `slot:${tieId}:B`,
          slotRole: 'B',
          participantId: awayTeamId,
          placeholderText: awayTeamId ? null : (m.awayTeam.name || 'Por definir'),
          teamName: awayTeam?.name,
          crestUrl: awayTeam?.crestUrl,
        };

        const tie: TieBlock = {
          tieId,
          name: `${STAGE_NAME_ES[m.stage] ?? m.stage} ${idx + 1}`,
          roundLabel: STAGE_ROUND_LABEL[m.stage] ?? m.stage.slice(0, 3),
          orderIndex: idx,
          slotA,
          slotB,
          scoreA: m.score.fullTime.home,
          scoreB: m.score.fullTime.away,
          scoreAExtraTime: m.score.extraTime?.home ?? null,
          scoreBExtraTime: m.score.extraTime?.away ?? null,
          scoreAPenalties: m.score.penalties?.home ?? null,
          scoreBPenalties: m.score.penalties?.away ?? null,
          winnerId,
        };

        if (!tiesByStageId.has(stageId)) tiesByStageId.set(stageId, []);
        tiesByStageId.get(stageId)!.push(tie);
      }
    }

    this.cache = {
      teams,
      matches,
      seasonId,
      standingsByGroupId,
      groupMeta,
      tiesByStageId,
      stageMeta,
      fetchedAt: nowMs,
    };

    console.log(
      `[FootballDataTournamentSource] Fetched ${this.competitionCode}: ` +
      `${teams.size} equipos, ${matches.length} partidos, ` +
      `${groupMeta.size} grupos, ${tiesByStageId.size} fases eliminatorias`,
    );
  }

  // ── HTTP helper ───────────────────────────────────────────────────────────

  private async apiGet<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: { 'X-Auth-Token': this.apiToken },
    });
    if (!res.ok) {
      throw new Error(`football-data.org ${res.status}: ${url}`);
    }
    return res.json() as Promise<T>;
  }
}
