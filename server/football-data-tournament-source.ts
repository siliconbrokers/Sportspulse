/**
 * FootballDataTournamentSource — adaptador genérico para torneos con grupos + eliminatorias.
 * Soporta cualquier competición de football-data.org API v4 mediante TournamentConfig.
 *
 * Obtiene equipos, partidos y standings, los normaliza en memoria y expone:
 *   - DataSource interface → para que el scheduler monitoree partidos del torneo
 *   - getGroupView()       → datos de fase de grupos para el API route
 *   - getBracketView()     → datos de eliminatorias para el API route
 *
 * Torneos registrados:
 *   - WC (Copa del Mundo 2026): usePERanking=false, usa standings API
 *   - CA (Copa América 2027):   usePERanking=true, usa PE competition engine
 */
import { teamId as canonicalTeamId, matchId as canonicalMatchId, seasonId as canonicalSeasonId, competitionId as canonicalCompId } from '@sportpulse/canonical';
import type { Team, Match, StageType } from '@sportpulse/canonical';
import type { DataSource, StandingEntry } from '@sportpulse/snapshot';
import type { TournamentConfig } from './tournament-config.js';
import { rankGroup } from '@sportpulse/prediction';
import type { GroupData, MatchResult as PEMatchResult } from '@sportpulse/prediction';
import { readRawCache, writeRawCache } from './raw-response-cache.js';
import { CrestCache } from './crest-cache.js';
import type { ApiFootballCLIOverlay } from './api-football-cli-overlay.js';

/** @deprecated Usar TournamentConfig.providerKey directamente. Mantenido para compatibilidad. */
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
  homeTeam: { id: number | null; name: string | null; shortName?: string | null; tla?: string | null; crest?: string | null };
  awayTeam: { id: number | null; name: string | null; shortName?: string | null; tla?: string | null; crest?: string | null };
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
  // Fases previas / clasificatorias (Copa Libertadores, Copa Sudamericana, etc.)
  ROUND_1: -3, PRELIMINARY_ROUND_1: -3,
  ROUND_2: -2, PRELIMINARY_ROUND_2: -2,
  ROUND_3: -1, PRELIMINARY_ROUND_3: -1,
  // Fases principales
  GROUP_STAGE: 0,
  LAST_32: 1, ROUND_OF_32: 1,
  LAST_16: 2, ROUND_OF_16: 2,
  QUARTER_FINALS: 3,
  SEMI_FINALS: 4,
  THIRD_PLACE: 5, PLAY_OFF_FOR_THIRD_PLACE: 5,
  FINAL: 6,
};

const STAGE_NAME_ES: Record<string, string> = {
  ROUND_1: 'Fase previa 1',   PRELIMINARY_ROUND_1: 'Fase previa 1',
  ROUND_2: 'Fase previa 2',   PRELIMINARY_ROUND_2: 'Fase previa 2',
  ROUND_3: 'Fase previa 3',   PRELIMINARY_ROUND_3: 'Fase previa 3',
  GROUP_STAGE: 'Fase de grupos',
  LAST_32: 'Ronda de 32',     ROUND_OF_32: 'Ronda de 32',
  LAST_16: 'Ronda de 16',     ROUND_OF_16: 'Ronda de 16',
  QUARTER_FINALS: 'Cuartos de final',
  SEMI_FINALS: 'Semifinales',
  THIRD_PLACE: 'Tercer puesto', PLAY_OFF_FOR_THIRD_PLACE: 'Tercer puesto',
  FINAL: 'Final',
};

const STAGE_ROUND_LABEL: Record<string, string> = {
  ROUND_1: 'R1', PRELIMINARY_ROUND_1: 'R1',
  ROUND_2: 'R2', PRELIMINARY_ROUND_2: 'R2',
  ROUND_3: 'R3', PRELIMINARY_ROUND_3: 'R3',
  GROUP_STAGE: 'GS',
  LAST_32: 'R32', ROUND_OF_32: 'R32',
  LAST_16: 'R16', ROUND_OF_16: 'R16',
  QUARTER_FINALS: 'QF',
  SEMI_FINALS: 'SF',
  THIRD_PLACE: '3P', PLAY_OFF_FOR_THIRD_PLACE: '3P',
  FINAL: 'F',
};

const STAGE_TYPE_MAP: Record<string, StageType> = {
  ROUND_1: 'ROUND_OF_32',    PRELIMINARY_ROUND_1: 'ROUND_OF_32',
  ROUND_2: 'ROUND_OF_32',    PRELIMINARY_ROUND_2: 'ROUND_OF_32',
  ROUND_3: 'ROUND_OF_16',    PRELIMINARY_ROUND_3: 'ROUND_OF_16',
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

/**
 * Resultado de una pierna individual (ida o vuelta) desde la perspectiva de los slots del cruce.
 * scoreA = goles del slotA en este partido; scoreB = goles del slotB.
 * En leg1, slotA juega de local. En leg2, slotB juega de local.
 */
export interface LegBlock {
  legNumber: 1 | 2;
  utcDate: string;
  /** Goles del slotA en esta pierna. */
  scoreA: number | null;
  /** Goles del slotB en esta pierna. */
  scoreB: number | null;
  /** Penales del slotA (solo leg2 si el cruce se definió por penales). */
  penA?: number | null;
  /** Penales del slotB (solo leg2 si el cruce se definió por penales). */
  penB?: number | null;
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
  /** Fecha/hora UTC del partido (pierna única) o de la pierna más próxima (dos piernas). */
  utcDate?: string;
  /** Piernas del cruce. Solo presente cuando hay 2 partidos (ida + vuelta). */
  legs?: LegBlock[];
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
  /** Rondas previas a la fase de grupos (ROUND_1/2/3 — clasificación). */
  preliminaryRounds: RoundBlock[];
  /** Rondas eliminatorias post-grupos (R16, QF, SF, FINAL). */
  knockoutRounds: RoundBlock[];
}

export interface TournamentMatchItem {
  matchId: string;
  kickoffUtc: string | null;
  status: string;
  homeTeam: { teamId: string; name: string; crestUrl?: string };
  awayTeam: { teamId: string; name: string; crestUrl?: string };
  scoreHome: number | null;
  scoreAway: number | null;
  scoreHomeExtraTime?: number | null;
  scoreAwayExtraTime?: number | null;
  scoreHomePenalties?: number | null;
  scoreAwayPenalties?: number | null;
}

export interface TournamentRoundMatchesBlock {
  stageId: string;
  name: string;
  orderIndex: number;
  matches: TournamentMatchItem[];
}

export interface TournamentGroupMatchesBlock {
  groupId: string;
  name: string;
  orderIndex: number;
  matches: TournamentMatchItem[];
}

export interface TournamentMatchesView {
  rounds: TournamentRoundMatchesBlock[];
  groups: TournamentGroupMatchesBlock[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Umbrales de detección LIVE — espejados de packages/web/src/utils/match-status.ts.
 * Ambos lados deben mantenerse sincronizados: el servidor no puede importar del frontend.
 */
const ZOMBIE_THRESHOLD_MIN  = 180; // min: partido confirma zombie (pendiente de score)
const AUTOFINISH_THRESHOLD_MIN = 240; // min: partido se auto-termina si el API no actualiza

/**
 * Heurística temporal para detectar si una pierna está en juego.
 * Espeja la lógica de match-status.ts (frontend).
 * Aplica a cualquier proveedor que no actualice status en tiempo real.
 */
function isLegLiveByTime(utcDate: string | null | undefined): boolean {
  if (!utcDate) return false;
  const elapsed = (Date.now() - new Date(utcDate).getTime()) / 60_000;
  return elapsed >= 0 && elapsed <= AUTOFINISH_THRESHOLD_MIN;
}

function normalizeStatus(fdStatus: string, utcDate?: string): Match['status'] {
  // Zombie guard: football-data.org free tier a veces deja partidos atascados como IN_PLAY
  // sin actualizar el status final. Si pasaron más de AUTOFINISH_THRESHOLD_MIN, asumimos FINISHED.
  if ((fdStatus === 'IN_PLAY' || fdStatus === 'PAUSED') && utcDate) {
    const elapsed = (Date.now() - new Date(utcDate).getTime()) / 60_000;
    if (elapsed > AUTOFINISH_THRESHOLD_MIN) return 'FINISHED';
  }
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

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS      = 30 * 60_000;          // 30 min — in-memory (sin partidos en vivo)
const DISK_CACHE_TTL_MS = 5 * 60_000;            // 5 min — disco (sin partidos en vivo)
const LIVE_CACHE_TTL_MS = 2 * 60_000;            // 2 min — in-memory cuando hay partido en vivo
const LIVE_DISK_TTL_MS  = 2 * 60_000;            // 2 min — disco cuando hay partido en vivo

interface TournamentRawCache {
  teams: { teams: FDWCTeam[] };
  matches: { matches: FDWCMatch[] };
  standings: FDWCStandingsResponse;
}

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
  private readonly config: TournamentConfig;
  /** competitionId canónico que identifica esta fuente. */
  readonly competitionId: string;

  private cache: TournamentCache | null = null;
  private readonly crestCache = new CrestCache();
  private cliOverlay: ApiFootballCLIOverlay | null = null;

  constructor(apiToken: string, config: TournamentConfig, baseUrl = 'https://api.football-data.org/v4') {
    this.apiToken = apiToken;
    this.config = config;
    this.baseUrl = baseUrl;
    this.competitionId = canonicalCompId(config.providerKey, config.competitionCode);
  }

  /** Registra un overlay de scores de API-Football (solo para Copa Libertadores). */
  setScoreOverlay(overlay: ApiFootballCLIOverlay): void {
    this.cliOverlay = overlay;
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
      formatFamily: this.config.formatFamily,
      groups,
      bestThirdsCount: this.config.bestThirdsCount,
    };
  }

  getTournamentMatches(_competitionId: string): TournamentMatchesView | null {
    if (!this.cache) return null;

    // ── Por ronda: agrupar todos los matches por stageId ────────────────────
    const matchesByStage = new Map<string, TournamentMatchItem[]>();
    for (const m of this.cache.matches) {
      if (!m.stageId) continue;
      const homeTeam = m.homeTeamId ? this.cache.teams.get(m.homeTeamId) : undefined;
      const awayTeam = m.awayTeamId ? this.cache.teams.get(m.awayTeamId) : undefined;
      if (!homeTeam || !awayTeam) continue;
      const item: TournamentMatchItem = {
        matchId: m.matchId,
        kickoffUtc: m.startTimeUtc,
        status: m.status,
        homeTeam: { teamId: m.homeTeamId!, name: homeTeam.name, crestUrl: homeTeam.crestUrl },
        awayTeam: { teamId: m.awayTeamId!, name: awayTeam.name, crestUrl: awayTeam.crestUrl },
        scoreHome: m.scoreHome ?? null,
        scoreAway: m.scoreAway ?? null,
        scoreHomeExtraTime: m.scoreHomeExtraTime ?? null,
        scoreAwayExtraTime: m.scoreAwayExtraTime ?? null,
        scoreHomePenalties: m.scoreHomePenalties ?? null,
        scoreAwayPenalties: m.scoreAwayPenalties ?? null,
      };
      const list = matchesByStage.get(m.stageId) ?? [];
      list.push(item);
      matchesByStage.set(m.stageId, list);
    }

    const rounds: TournamentRoundMatchesBlock[] = [];
    for (const [stageId, matches] of matchesByStage) {
      const meta = this.cache.stageMeta.get(stageId);
      if (!meta) continue;
      rounds.push({
        stageId,
        name: meta.name,
        orderIndex: meta.orderIndex,
        matches: matches.sort((a, b) => (a.kickoffUtc ?? '') < (b.kickoffUtc ?? '') ? -1 : 1),
      });
    }

    // Completar con fases eliminatorias desde tiesByStageId —
    // cubre etapas cuyos cruces aún no tienen equipos confirmados (TBD).
    // Sin esto, R16/QF/SF/Final no aparecen en el tab "Por ronda" hasta que
    // los equipos sean conocidos.
    const TBD_TEAM = { teamId: 'tbd', name: 'Por definir', crestUrl: undefined };
    for (const [stageId, ties] of this.cache.tiesByStageId) {
      if (matchesByStage.has(stageId)) continue; // ya fue cubierto arriba
      const meta = this.cache.stageMeta.get(stageId);
      if (!meta || meta.orderIndex <= 0) continue; // solo knockout (orderIndex > 0)

      const items: TournamentMatchItem[] = ties.map((tie) => {
        const homeTeam = tie.slotA.participantId
          ? (this.cache!.teams.get(tie.slotA.participantId) ?? { ...TBD_TEAM, teamId: tie.slotA.participantId, name: tie.slotA.teamName ?? 'Por definir', crestUrl: tie.slotA.crestUrl })
          : { ...TBD_TEAM, name: tie.slotA.placeholderText ?? 'Por definir' };
        const awayTeam = tie.slotB.participantId
          ? (this.cache!.teams.get(tie.slotB.participantId) ?? { ...TBD_TEAM, teamId: tie.slotB.participantId, name: tie.slotB.teamName ?? 'Por definir', crestUrl: tie.slotB.crestUrl })
          : { ...TBD_TEAM, name: tie.slotB.placeholderText ?? 'Por definir' };

        return {
          matchId: tie.tieId,
          kickoffUtc: tie.utcDate ?? null,
          status: tie.winnerId ? 'FINISHED' : 'SCHEDULED',
          homeTeam: { teamId: homeTeam.teamId, name: homeTeam.name, crestUrl: homeTeam.crestUrl },
          awayTeam: { teamId: awayTeam.teamId, name: awayTeam.name, crestUrl: awayTeam.crestUrl },
          scoreHome: tie.scoreA ?? null,
          scoreAway: tie.scoreB ?? null,
          scoreHomeExtraTime: tie.scoreAExtraTime ?? null,
          scoreAwayExtraTime: tie.scoreBExtraTime ?? null,
          scoreHomePenalties: tie.scoreAPenalties ?? null,
          scoreAwayPenalties: tie.scoreBPenalties ?? null,
        };
      });

      rounds.push({
        stageId,
        name: meta.name,
        orderIndex: meta.orderIndex,
        matches: items.sort((a, b) => (a.kickoffUtc ?? '') < (b.kickoffUtc ?? '') ? -1 : 1),
      });
    }

    rounds.sort((a, b) => a.orderIndex - b.orderIndex);

    // ── Por grupo: solo matches de GROUP_STAGE ───────────────────────────────
    const matchesByGroup = new Map<string, TournamentMatchItem[]>();
    for (const stageRound of rounds) {
      if (stageRound.orderIndex !== 0) continue; // solo GROUP_STAGE (orderIndex=0)
      for (const m of stageRound.matches) {
        const canonMatch = this.cache.matches.find((cm) => cm.matchId === m.matchId);
        if (!canonMatch?.groupId) continue;
        const list = matchesByGroup.get(canonMatch.groupId) ?? [];
        list.push(m);
        matchesByGroup.set(canonMatch.groupId, list);
      }
    }

    const groups: TournamentGroupMatchesBlock[] = [];
    for (const [groupId, matches] of matchesByGroup) {
      const meta = this.cache.groupMeta.get(groupId);
      if (!meta) continue;
      groups.push({
        groupId,
        name: meta.name,
        orderIndex: meta.orderIndex,
        matches,
      });
    }
    groups.sort((a, b) => a.orderIndex - b.orderIndex);

    return { rounds, groups };
  }

  getBracketView(_competitionId: string): TournamentBracketView | null {
    if (!this.cache) return null;

    const allRounds: RoundBlock[] = [];
    for (const [stageId, ties] of this.cache.tiesByStageId) {
      const meta = this.cache.stageMeta.get(stageId);
      if (!meta) continue;
      allRounds.push({
        stageId,
        name: meta.name,
        stageType: meta.stageType,
        orderIndex: meta.orderIndex,
        ties: [...ties].sort((a, b) => a.orderIndex - b.orderIndex),
      });
    }
    allRounds.sort((a, b) => a.orderIndex - b.orderIndex);

    return {
      // orderIndex < 0: fases previas (ROUND_1/2/3 — clasificación al grupo stage)
      preliminaryRounds: allRounds.filter((r) => r.orderIndex < 0),
      // orderIndex > 0: eliminatorias post-grupos (R16, QF, SF, FINAL)
      knockoutRounds:    allRounds.filter((r) => r.orderIndex > 0),
    };
  }

  // ── Fetch & derivación ────────────────────────────────────────────────────

  async fetchTournament(): Promise<void> {
    const nowMs = Date.now();

    // TTL adaptativo: si el caché anterior tenía partidos en vivo, usar TTL corto
    // para reflejar cambios de score lo antes posible.
    const hadLive = this.cache?.matches.some((m) => m.status === 'IN_PROGRESS');
    const effectiveCacheTtl = hadLive ? LIVE_CACHE_TTL_MS : CACHE_TTL_MS;
    const effectiveDiskTtl  = hadLive ? LIVE_DISK_TTL_MS  : DISK_CACHE_TTL_MS;

    if (this.cache && nowMs - this.cache.fetchedAt < effectiveCacheTtl) {
      return; // datos frescos en memoria
    }

    const diskKey = `tournament-fd-${this.config.competitionCode}`;
    let teamsResp: { teams: FDWCTeam[] };
    let matchesResp: { matches: FDWCMatch[] };
    let standingsResp: FDWCStandingsResponse = { standings: [] };

    // Intentar leer desde caché de disco
    const diskHit = await readRawCache<TournamentRawCache>(diskKey, effectiveDiskTtl);
    if (diskHit) {
      console.log(`[TournamentSource] DISK_HIT ${this.config.competitionCode}`);
      teamsResp = diskHit.teams;
      matchesResp = diskHit.matches;
      standingsResp = diskHit.standings;
    } else {
      // Caché de disco expirado o inexistente — llamar API
      console.log(`[TournamentSource] DISK_MISS ${this.config.competitionCode} — fetching from API`);
      [teamsResp, matchesResp] = await Promise.all([
        this.apiGet<{ teams: FDWCTeam[] }>(`/competitions/${this.config.competitionCode}/teams`),
        this.apiGet<{ matches: FDWCMatch[] }>(`/competitions/${this.config.competitionCode}/matches`),
      ]);

      // standings es opcional: no disponible durante fases preliminares o cuando la API lo restringe
      if (!this.config.usePERanking) {
        try {
          standingsResp = await this.apiGet<FDWCStandingsResponse>(`/competitions/${this.config.competitionCode}/standings`);
        } catch (err) {
          console.warn(`[TournamentSource] ${this.config.competitionCode}: standings no disponibles — ${String(err).slice(0, 80)}`);
        }
      }

      // Persistir en disco (atómico)
      await writeRawCache<TournamentRawCache>(diskKey, { teams: teamsResp, matches: matchesResp, standings: standingsResp });
    }

    // SeasonId desde el primer partido
    const firstMatch = matchesResp.matches[0];
    const fdSeasonId = firstMatch?.season?.id;
    const seasonId = canonicalSeasonId(this.config.providerKey, String(fdSeasonId ?? this.config.competitionCode.toLowerCase()));

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

    if (this.config.usePERanking) {
      // ── PE-native: derivar standings usando PE competition engine ──────────
      // Agrupa partidos de fase de grupos por grupo y llama a rankGroup().
      // Fuente de verdad: resultados de partidos, no standings API.

      // fdGroupName → { teams: Map<fdId, info>, matches: PEMatchResult[] }
      const groupRawData = new Map<string, {
        teams: Map<string, { name: string; crestUrl?: string }>;
        matches: PEMatchResult[];
      }>();

      for (const m of matchesResp.matches) {
        if (m.stage !== 'GROUP_STAGE' || !m.group || !isGroupType(m.group)) continue;
        if (!groupRawData.has(m.group)) groupRawData.set(m.group, { teams: new Map(), matches: [] });
        const grp = groupRawData.get(m.group)!;

        const homeCanId = m.homeTeam.id != null ? canonicalTeamId(FD_PROVIDER_KEY, String(m.homeTeam.id)) : null;
        const awayCanId = m.awayTeam.id != null ? canonicalTeamId(FD_PROVIDER_KEY, String(m.awayTeam.id)) : null;

        if (homeCanId) {
          const homeTeam = teams.get(homeCanId);
          grp.teams.set(homeCanId, { name: homeTeam?.name ?? m.homeTeam.name ?? homeCanId, crestUrl: homeTeam?.crestUrl });
        }
        if (awayCanId) {
          const awayTeam = teams.get(awayCanId);
          grp.teams.set(awayCanId, { name: awayTeam?.name ?? m.awayTeam.name ?? awayCanId, crestUrl: awayTeam?.crestUrl });
        }
        if (homeCanId && awayCanId) {
          grp.matches.push({
            match_id: canonicalMatchId(FD_PROVIDER_KEY, String(m.id)),
            home_team_id: homeCanId,
            away_team_id: awayCanId,
            home_score: m.score.fullTime.home,
            away_score: m.score.fullTime.away,
          });
        }
      }

      for (const [fdGroupName, raw] of groupRawData) {
        const orderIndex = groupOrderIndex(fdGroupName);
        const groupId = `group:${groupStageId}:${orderIndex}`;
        groupMeta.set(groupId, { groupId, name: groupNameEs(fdGroupName), orderIndex });

        const groupData: GroupData = {
          group_id: groupId,
          team_ids: [...raw.teams.keys()],
          matches: raw.matches,
        };

        const rankingRules = this.config.groupRankingRules;
        if (!rankingRules) {
          console.error(`[TournamentSource] ${this.config.nameEs}: groupRankingRules no definido en TournamentConfig. Grupo ${groupId} omitido.`);
          continue;
        }
        const rankResult = rankGroup(groupData, rankingRules);
        const ranked = rankResult.status !== 'BLOCKED' ? rankResult.data : [];

        const entries: StandingEntry[] = ranked.map((rt) => {
          const s = rt.standing;
          const teamInfo = raw.teams.get(rt.team_id);
          return {
            position: rt.rank,
            teamId: rt.team_id,
            teamName: teamInfo?.name ?? rt.team_id,
            crestUrl: teamInfo?.crestUrl,
            playedGames: s.played,
            won: s.wins,
            draw: s.draws,
            lost: s.losses,
            goalsFor: s.goals_for,
            goalsAgainst: s.goals_against,
            goalDifference: s.goal_difference,
            points: s.points,
            groupId,
            statusBadge: null,
          };
        });

        // Si no hay partidos jugados aún, poblar con equipos en 0
        if (entries.length === 0) {
          let pos = 1;
          for (const [teamId, info] of raw.teams) {
            entries.push({
              position: pos++,
              teamId,
              teamName: info.name,
              crestUrl: info.crestUrl,
              playedGames: 0, won: 0, draw: 0, lost: 0,
              goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0,
              groupId,
              statusBadge: null,
            });
          }
        }

        standingsByGroupId.set(groupId, entries);
      }
    } else {
      // ── Legado (WC/CLI): standings API de football-data.org ───────────────────

      // Intento 1: standings per-grupo desde la API
      // Acepta grupos aunque la tabla esté vacía (sorteo realizado pero fase no iniciada)
      const perGroupStandings = standingsResp.standings.filter(
        (gs) => isGroupType(gs.type) && gs.table,
      );

      for (const gs of perGroupStandings) {
        const orderIndex = groupOrderIndex(gs.type);
        const groupId = `group:${groupStageId}:${orderIndex}`;
        groupMeta.set(groupId, { groupId, name: groupNameEs(gs.type), orderIndex });
        if (gs.table.length > 0) {
          standingsByGroupId.set(groupId, gs.table.map((row) => {
            // Equipos TBD: football-data.org puede devolver id=null para slots
            // pendientes de clasificación (ej: ganador de fase previa aún no definido)
            const hasTeam = row.team.id != null;
            return {
              position: row.position,
              teamId: hasTeam
                ? canonicalTeamId(FD_PROVIDER_KEY, String(row.team.id))
                : `tbd:${groupId}:${row.position}`,
              teamName: row.team.name || 'Por definir',
              crestUrl: hasTeam ? (row.team.crest || undefined) : undefined,
              playedGames: row.playedGames,
              won: row.won, draw: row.draw, lost: row.lost,
              goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst,
              goalDifference: row.goalDifference, points: row.points,
              groupId, statusBadge: null,
            };
          }));
        }
        // Si la tabla está vacía (fase no iniciada), Intento 2 la completará desde partidos
      }

      // Intento 2: completar/construir grupos desde partidos de fase de grupos
      // Cubre dos casos: grupos con tabla vacía del API y grupos no retornados por el API
      // No sobreescribe grupos ya populados con datos reales de Intento 1
      const groupTeamIds = new Map<string, Map<string, { name: string; crestUrl?: string }>>();
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
        // No sobreescribir grupos ya populados por Intento 1 con datos reales
        if (standingsByGroupId.has(groupId)) continue;
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

    // ── Partidos y ties ───────────────────────────────────────────────────────
    //
    // Ties eliminatorios se construyen agrupando partidos por PAR DE EQUIPOS
    // dentro del mismo stage. Dos partidos entre los mismos equipos = dos piernas
    // de una misma llave (ida + vuelta). Un solo partido = llave de pierna única.
    //
    // Clave del acumulador: `${stageId}|${[teamA, teamB].sort().join('|')}`

    interface LegData {
      homeId: string | null;
      awayId: string | null;
      utcDate: string;
      scoreHome: number | null;
      scoreAway: number | null;
      penHome: number | null;
      penAway: number | null;
      winner: string | null;
      homeTeamFdName: string | null;
      awayTeamFdName: string | null;
      homeTeamCrest: string | null;
      awayTeamCrest: string | null;
    }
    interface TieAccumulator {
      legs: LegData[];
      stageId: string;
      stageFdName: string;
    }

    const matches: Match[] = [];
    const tieAccumulators = new Map<string, TieAccumulator>();

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

      // Cuando hay penales, football-data.org incluye los goles de tanda en score.fullTime.
      // Calculamos el score real (sin penales) aquí para usarlo tanto en CanonicalMatch como en LegData.
      const hasPenalties = m.score.penalties?.home != null && m.score.penalties?.away != null;
      const canonicalScoreHome = hasPenalties
        ? (m.score.extraTime?.home != null
            ? m.score.extraTime.home
            : ((m.score.fullTime.home ?? 0) - (m.score.penalties!.home ?? 0)))
        : m.score.fullTime.home;
      const canonicalScoreAway = hasPenalties
        ? (m.score.extraTime?.away != null
            ? m.score.extraTime.away
            : ((m.score.fullTime.away ?? 0) - (m.score.penalties!.away ?? 0)))
        : m.score.fullTime.away;

      // ── Canonical Match (para scheduler) ──
      if (homeTeamId && awayTeamId) {
        const matchGroupId: string | null = m.group
          ? `group:${groupStageId}:${groupOrderIndex(m.group)}`
          : null;

        matches.push({
          matchId, seasonId,
          matchday: m.matchday ?? undefined,
          startTimeUtc: m.utcDate || null,
          status: normalizeStatus(m.status, m.utcDate),
          homeTeamId, awayTeamId,
          scoreHome: canonicalScoreHome,
          scoreAway: canonicalScoreAway,
          providerKey: FD_PROVIDER_KEY,
          providerMatchId: String(m.id),
          lastSeenUtc: new Date(nowMs).toISOString(),
          stageId, groupId: matchGroupId,
          scoreHomeExtraTime: m.score.extraTime?.home ?? null,
          scoreAwayExtraTime: m.score.extraTime?.away ?? null,
          scoreHomePenalties: m.score.penalties?.home ?? null,
          scoreAwayPenalties: m.score.penalties?.away ?? null,
          winnerTeamId: m.score.winner === 'HOME_TEAM' ? homeTeamId
            : m.score.winner === 'AWAY_TEAM' ? awayTeamId
            : null,
        });
      }

      // ── Descubrimiento dinámico de equipos desde partidos ──
      // Los endpoints /teams solo devuelven equipos activos en la ronda actual.
      // Equipos eliminados en fases previas (ej: Universidad Católica en R1)
      // no aparecen ahí pero sí en los datos de partidos.
      if (homeTeamId && m.homeTeam.id != null && !teams.has(homeTeamId)) {
        teams.set(homeTeamId, {
          teamId: homeTeamId,
          sportId: 'FOOTBALL',
          name: m.homeTeam.name ?? String(m.homeTeam.id),
          shortName: m.homeTeam.shortName || m.homeTeam.tla || m.homeTeam.name || String(m.homeTeam.id),
          crestUrl: m.homeTeam.crest ?? `https://crests.football-data.org/${m.homeTeam.id}.png`,
          providerKey: FD_PROVIDER_KEY,
          providerTeamId: String(m.homeTeam.id),
        });
      }
      if (awayTeamId && m.awayTeam.id != null && !teams.has(awayTeamId)) {
        teams.set(awayTeamId, {
          teamId: awayTeamId,
          sportId: 'FOOTBALL',
          name: m.awayTeam.name ?? String(m.awayTeam.id),
          shortName: m.awayTeam.shortName || m.awayTeam.tla || m.awayTeam.name || String(m.awayTeam.id),
          crestUrl: m.awayTeam.crest ?? `https://crests.football-data.org/${m.awayTeam.id}.png`,
          providerKey: FD_PROVIDER_KEY,
          providerTeamId: String(m.awayTeam.id),
        });
      }

      // ── Acumular piernas para ties eliminatorios ──
      if (meta.stageType !== 'GROUP_STAGE') {
        // Clave canónica: misma sin importar quién juega de local en cada pierna
        const pairKey = homeTeamId && awayTeamId
          ? [homeTeamId, awayTeamId].sort().join('|')
          : `solo:${matchId}`; // equipo desconocido → llave individual
        const accKey = `${stageId}|${pairKey}`;

        if (!tieAccumulators.has(accKey)) {
          tieAccumulators.set(accKey, { legs: [], stageId, stageFdName: m.stage });
        }
        tieAccumulators.get(accKey)!.legs.push({
          homeId: homeTeamId,
          awayId: awayTeamId,
          utcDate: m.utcDate,
          scoreHome: canonicalScoreHome,
          scoreAway: canonicalScoreAway,
          penHome: m.score.penalties?.home ?? null,
          penAway: m.score.penalties?.away ?? null,
          winner: m.score.winner ?? null,
          homeTeamFdName: m.homeTeam.name ?? null,
          awayTeamFdName: m.awayTeam.name ?? null,
          homeTeamCrest: m.homeTeam.crest ?? null,
          awayTeamCrest: m.awayTeam.crest ?? null,
        });
      }
    }

    // ── Construir TieBlocks desde acumuladores ────────────────────────────────
    const tiesByStageId = new Map<string, TieBlock[]>();
    const tieOrderByStage = new Map<string, number>();

    for (const acc of tieAccumulators.values()) {
      // Ordenar piernas cronológicamente (leg1 = más antigua)
      acc.legs.sort((a, b) => a.utcDate.localeCompare(b.utcDate));
      const leg1 = acc.legs[0];
      const leg2 = acc.legs.length > 1 ? acc.legs[1] : null;
      const { stageId, stageFdName } = acc;

      const idx = tieOrderByStage.get(stageId) ?? 0;
      tieOrderByStage.set(stageId, idx + 1);
      const tieId = `tie:${stageId}:${idx}`;

      // slotA = local en leg1, slotB = visitante en leg1
      const slotAId = leg1.homeId;
      const slotBId = leg1.awayId;
      const slotATeam = slotAId ? teams.get(slotAId) : undefined;
      const slotBTeam = slotBId ? teams.get(slotBId) : undefined;

      // Scores: agregado si hay 2 piernas, individual si 1
      let scoreA: number | null = null;
      let scoreB: number | null = null;
      let penA: number | null = null;
      let penB: number | null = null;
      let winnerId: string | null = null;

      if (leg2) {
        // Agregado parcial o total: suma los goles jugados hasta ahora.
        const leg1Played = leg1.scoreHome !== null || leg1.scoreAway !== null;
        const leg2Played = leg2.scoreHome !== null || leg2.scoreAway !== null;
        // Heurística: API free tier no actualiza scores en tiempo real.
        // Si leg2 está en curso (tiempo), tratar como 0-0 para mostrar agregado parcial correcto.
        const leg2IsLive = !leg2Played && isLegLiveByTime(leg2.utcDate);

        if (leg1Played || leg2Played || leg2IsLive) {
          // Para leg2 en vivo sin score del API: asumir 0-0 (se actualizará al terminar el partido).
          // slotA juega de local en leg1 y de visitante en leg2
          scoreA = (leg1.scoreHome ?? 0) + (leg2Played ? (leg2.scoreAway ?? 0) : 0);
          // slotB juega de visitante en leg1 y de local en leg2
          scoreB = (leg1.scoreAway ?? 0) + (leg2Played ? (leg2.scoreHome ?? 0) : 0);
        }
        // Penales del leg2 (partido decisivo — slotA es visitante, slotB es local)
        if (leg2.penHome !== null || leg2.penAway !== null) {
          penA = leg2.penAway; // slotA visitante en leg2
          penB = leg2.penHome; // slotB local en leg2
        }
        // Ganador del cruce: solo se determina cuando AMBAS piernas están jugadas.
        // Si solo se jugó la ida (o la vuelta está en curso), la serie sigue abierta → sin winner.
        if (leg2Played && scoreA !== null && scoreB !== null) {
          if (scoreA > scoreB) {
            winnerId = slotAId;
          } else if (scoreB > scoreA) {
            winnerId = slotBId;
          } else if (penA !== null && penB !== null) {
            // Empate en agregado → desempate por penales
            if (penA > penB) winnerId = slotAId;
            else if (penB > penA) winnerId = slotBId;
          }
        }
      } else {
        // Pierna única
        scoreA = leg1.scoreHome;
        scoreB = leg1.scoreAway;
        penA = leg1.penHome;
        penB = leg1.penAway;
        if (leg1.winner === 'HOME_TEAM') winnerId = slotAId;
        else if (leg1.winner === 'AWAY_TEAM') winnerId = slotBId;
      }

      const slotA: TieSlotBlock = {
        slotId: `slot:${tieId}:A`, slotRole: 'A',
        participantId: slotAId,
        placeholderText: slotAId ? null : (leg1.homeTeamFdName || 'Por definir'),
        teamName: slotATeam?.name,
        crestUrl: slotATeam?.crestUrl,
      };
      const slotB: TieSlotBlock = {
        slotId: `slot:${tieId}:B`, slotRole: 'B',
        participantId: slotBId,
        placeholderText: slotBId ? null : (leg1.awayTeamFdName || 'Por definir'),
        teamName: slotBTeam?.name,
        crestUrl: slotBTeam?.crestUrl,
      };

      // Piernas individuales — solo para cruces de ida+vuelta (2 legs).
      // scoreA/B en cada LegBlock se expresan desde la perspectiva de slotA:
      //   leg1: slotA juega de LOCAL  → scoreA=leg1.scoreHome, scoreB=leg1.scoreAway
      //   leg2: slotA juega de VISITA → scoreA=leg2.scoreAway,  scoreB=leg2.scoreHome
      // Cuando leg2 está en vivo pero el API free tier devuelve null: mostrar 0-0.
      const leg2Played2 = leg2 && (leg2.scoreHome !== null || leg2.scoreAway !== null);
      const leg2IsLive2 = leg2 && !leg2Played2 && isLegLiveByTime(leg2.utcDate);
      const legs: LegBlock[] | undefined = leg2 ? [
        {
          legNumber: 1,
          utcDate: leg1.utcDate,
          scoreA: leg1.scoreHome,
          scoreB: leg1.scoreAway,
        },
        {
          legNumber: 2,
          utcDate: leg2.utcDate,
          scoreA: leg2Played2 ? leg2.scoreAway : (leg2IsLive2 ? 0 : null),
          scoreB: leg2Played2 ? leg2.scoreHome : (leg2IsLive2 ? 0 : null),
          penA: leg2.penAway ?? null,
          penB: leg2.penHome ?? null,
        },
      ] : undefined;

      // utcDate del tie: apunta a la pierna actualmente relevante.
      // - leg2 no jugada (o en curso) → leg2.utcDate (para detección LIVE del cruce)
      // - ambas jugadas → leg2.utcDate (para referencia temporal del cruce terminado)
      const utcDateForTie: string | undefined =
        leg2 ? leg2.utcDate : leg1.utcDate;

      const tie: TieBlock = {
        tieId,
        name: `${STAGE_NAME_ES[stageFdName] ?? stageFdName} ${idx + 1}`,
        roundLabel: STAGE_ROUND_LABEL[stageFdName] ?? stageFdName.slice(0, 3),
        orderIndex: idx,
        slotA, slotB,
        scoreA, scoreB,
        scoreAExtraTime: null,
        scoreBExtraTime: null,
        scoreAPenalties: penA,
        scoreBPenalties: penB,
        winnerId,
        utcDate: utcDateForTie,
        legs,
      };

      if (!tiesByStageId.has(stageId)) tiesByStageId.set(stageId, []);
      tiesByStageId.get(stageId)!.push(tie);
    }

    // ── Score overlay: parchear scores/status desde API-Football si está configurado ──
    if (this.cliOverlay) {
      const { normTeamName } = await import('./api-football-cli-overlay.js');
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        if (!m.startTimeUtc) continue;
        const homeTeam = teams.get(m.homeTeamId);
        const awayTeam = teams.get(m.awayTeamId);
        if (!homeTeam || !awayTeam) continue;
        const datePrefix = m.startTimeUtc.slice(0, 10);
        const override = await this.cliOverlay.getOverride(datePrefix, homeTeam.name, awayTeam.name);
        if (!override) continue;
        matches[i] = {
          ...m,
          scoreHome: override.scoreHome,
          scoreAway: override.scoreAway,
          status: override.status === 'FINISHED' ? 'FINISHED'
                : override.status === 'IN_PROGRESS' ? 'IN_PROGRESS'
                : m.status,
        };
      }
      console.log(`[FootballDataTournamentSource] Score overlay aplicado para ${this.config.competitionCode}`);
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
      `[FootballDataTournamentSource] Fetched ${this.config.competitionCode}: ` +
      `${teams.size} equipos, ${matches.length} partidos, ` +
      `${groupMeta.size} grupos, ${tiesByStageId.size} fases eliminatorias`,
    );

    // Fire-and-forget: download and cache crest images locally.
    this.crestCache.warmup(
      [...teams.values()]
        .filter((t) => t.providerTeamId)
        .map((t) => ({ providerTeamId: t.providerTeamId!, crestUrl: t.crestUrl })),
      FD_PROVIDER_KEY,
    ).then((urlMap) => {
      if (!this.cache) return;
      // Update teams Map with local URLs
      for (const [canonId, team] of this.cache.teams) {
        if (team.providerTeamId) {
          const localUrl = urlMap.get(team.providerTeamId);
          if (localUrl) this.cache.teams.set(canonId, { ...team, crestUrl: localUrl });
        }
      }
      // Update standings with local URLs
      for (const [groupId, entries] of this.cache.standingsByGroupId) {
        this.cache.standingsByGroupId.set(groupId, entries.map((e) => {
          const provId = e.teamId.split(':')[2];
          return provId ? { ...e, crestUrl: urlMap.get(provId) ?? e.crestUrl } : e;
        }));
      }
      console.log(`[FootballDataTournamentSource] crest cache warm ${this.config.competitionCode} (${urlMap.size} teams)`);
    }).catch((err) => {
      console.warn(`[FootballDataTournamentSource] crest warmup error ${this.config.competitionCode}:`, err);
    });
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
