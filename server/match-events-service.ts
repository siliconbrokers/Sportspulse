/**
 * MatchEventsService — fetches goal events for FINISHED matches.
 *
 * Strategy:
 *   - Registered providers (e.g., OpenLigaDB for BL1): delegated directly
 *   - TheSportsDB matches (Liga Uruguaya): direct lookuptimeline.php call
 *   - football-data.org matches (LaLiga/PL): round-based lookup in TheSportsDB,
 *     then lookuptimeline.php for the matched event
 *
 * Events are cached indefinitely (FINISHED matches are immutable).
 */
import type { DataSource, MatchGoalEventDTO } from '@sportpulse/snapshot';

// TheSportsDB league IDs for football-data.org competitions
const FD_TO_SDB_LEAGUE: Record<string, string> = {
  PD:  '4335', // Spanish La Liga
  PL:  '4328', // English Premier League
  // BL1 is handled by OpenLigaDB — not routed through TheSportsDB
};

/** Converts football-data season "2025-26" → TheSportsDB "2025-2026". */
function toSdbSeason(fdSeason: string): string {
  if (!fdSeason.includes('-')) return fdSeason;
  const [y1, y2short] = fdSeason.split('-');
  const y2 = y2short.length === 2 ? `${y1.slice(0, 2)}${y2short}` : y2short;
  return `${y1}-${y2}`;
}

interface SdbTimelineEvent {
  strTimeline: string;
  intTime: string;
  idTeam: string;
  strPlayer: string;
  strTimelineDetail: string;
}

interface SdbRoundEvent {
  idEvent: string;
  dateEvent: string;
  idHomeTeam: string;
  idAwayTeam: string;
  intHomeScore: string | null;
  intAwayScore: string | null;
}

export class MatchEventsService {
  private readonly baseUrl = 'https://www.thesportsdb.com/api/v1/json';
  private readonly goalsCache = new Map<string, MatchGoalEventDTO[]>();

  /** External provider handlers registered via registerProvider(). */
  private readonly providerHandlers = new Map<
    string,
    { getMatchGoals(canonicalMatchId: string): Promise<MatchGoalEventDTO[]> }
  >();

  constructor(
    private readonly sdbApiKey: string,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Registers an external provider to handle goal events for its own matches.
   * The providerKey must match the one embedded in canonicalMatchId.
   */
  registerProvider(
    providerKey: string,
    handler: { getMatchGoals(canonicalMatchId: string): Promise<MatchGoalEventDTO[]> },
  ): void {
    this.providerHandlers.set(providerKey, handler);
  }

  async getMatchGoals(canonicalMatchId: string): Promise<MatchGoalEventDTO[]> {
    if (this.goalsCache.has(canonicalMatchId)) {
      return this.goalsCache.get(canonicalMatchId)!;
    }

    const parts = canonicalMatchId.split(':'); // ['match', providerKey, providerMatchId]
    const providerKey = parts[1];
    const providerMatchId = parts[2];
    if (!providerKey || !providerMatchId) return [];

    try {
      let goals: MatchGoalEventDTO[];

      // Check registered providers first (e.g., OpenLigaDB for BL1)
      if (this.providerHandlers.has(providerKey)) {
        goals = await this.providerHandlers.get(providerKey)!.getMatchGoals(canonicalMatchId);
      } else if (providerKey === 'thesportsdb') {
        goals = await this.fetchSdbTimeline(providerMatchId, canonicalMatchId);
      } else if (providerKey === 'football-data') {
        goals = await this.fetchViaFdMatch(canonicalMatchId);
      } else {
        return [];
      }

      this.goalsCache.set(canonicalMatchId, goals);
      console.log(
        `[MatchEventsService] ${canonicalMatchId} → ${goals.length} goal(s) cached`,
      );
      return goals;
    } catch (err) {
      console.warn(`[MatchEventsService] Failed for ${canonicalMatchId}:`, err);
      return [];
    }
  }

  // ── TheSportsDB direct timeline fetch ─────────────────────────────────────

  private async fetchSdbTimeline(
    sdbEventId: string,
    canonicalMatchId: string,
  ): Promise<MatchGoalEventDTO[]> {
    const { homeId, awayId } = this.getSdbTeamIds(canonicalMatchId, 'thesportsdb');

    const data = await this.apiGet<{ timeline: SdbTimelineEvent[] | null }>(
      `/lookuptimeline.php?id=${sdbEventId}`,
    );

    return (data.timeline ?? [])
      .filter((e) => e.strTimeline === 'Goal')
      .map((e) => ({
        minute: parseInt(e.intTime, 10) || 0,
        type:
          e.strTimelineDetail.toLowerCase().includes('own')     ? 'OWN_GOAL' as const
          : e.strTimelineDetail.toLowerCase().includes('penalty') ? 'PENALTY'  as const
          : 'GOAL' as const,
        team: e.idTeam === homeId ? 'HOME' as const : 'AWAY' as const,
        scorerName: e.strPlayer || undefined,
      }))
      .filter((g) => !isNaN(g.minute));
  }

  // ── football-data.org → TheSportsDB round lookup ──────────────────────────

  private async fetchViaFdMatch(canonicalMatchId: string): Promise<MatchGoalEventDTO[]> {
    const meta = this.findFdMatchMeta(canonicalMatchId);
    if (!meta) {
      console.warn(`[MatchEventsService] No metadata found for ${canonicalMatchId}`);
      return [];
    }

    const sdbLeagueId = FD_TO_SDB_LEAGUE[meta.competitionCode];
    if (!sdbLeagueId) return [];

    const sdbSeason = meta.season; // already "YYYY-YYYY" format
    const matchDate = meta.startDateUtc?.slice(0, 10); // "YYYY-MM-DD"

    const roundData = await this.apiGet<{ events: SdbRoundEvent[] | null }>(
      `/eventsround.php?id=${sdbLeagueId}&r=${meta.matchday}&s=${sdbSeason}`,
    );

    const events = roundData.events ?? [];
    console.log(
      `[MatchEventsService] eventsround: league=${sdbLeagueId} md=${meta.matchday} season=${sdbSeason} → ${events.length} events, dates=[${events.map((e) => e.dateEvent).join(',')}]`,
    );

    // Disambiguate: match by date, then by score if multiple on same date
    const sameDay = events.filter((e) => e.dateEvent === matchDate);
    const sdbEvent = sameDay.length === 1
      ? sameDay[0]
      : sameDay.find(
          (e) =>
            parseInt(e.intHomeScore ?? '', 10) === meta.scoreHome &&
            parseInt(e.intAwayScore ?? '', 10) === meta.scoreAway,
        ) ?? sameDay[0];

    if (!sdbEvent) {
      console.warn(
        `[MatchEventsService] No SDB event found for ${canonicalMatchId} (date=${matchDate}, md=${meta.matchday})`,
      );
      return [];
    }

    const timelineData = await this.apiGet<{ timeline: SdbTimelineEvent[] | null }>(
      `/lookuptimeline.php?id=${sdbEvent.idEvent}`,
    );

    return (timelineData.timeline ?? [])
      .filter((e) => e.strTimeline === 'Goal')
      .map((e) => ({
        minute: parseInt(e.intTime, 10) || 0,
        type:
          e.strTimelineDetail.toLowerCase().includes('own')     ? 'OWN_GOAL' as const
          : e.strTimelineDetail.toLowerCase().includes('penalty') ? 'PENALTY'  as const
          : 'GOAL' as const,
        team: e.idTeam === sdbEvent.idHomeTeam ? 'HOME' as const : 'AWAY' as const,
        scorerName: e.strPlayer || undefined,
      }))
      .filter((g) => !isNaN(g.minute));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Finds football-data.org match metadata from the canonical DataSource. */
  private findFdMatchMeta(canonicalMatchId: string): {
    matchday: number;
    startDateUtc: string;
    competitionCode: string;
    season: string;
    scoreHome: number | null;
    scoreAway: number | null;
  } | null {
    for (const code of Object.keys(FD_TO_SDB_LEAGUE)) {
      const compId = `comp:football-data:${code}`;
      const seasonId = this.dataSource.getSeasonId(compId);
      if (!seasonId) continue;
      const matches = this.dataSource.getMatches(seasonId);
      const match = matches.find((m) => m.matchId === canonicalMatchId);
      if (!match || !match.matchday || !match.startTimeUtc) continue;

      // Derive season string from match date (e.g. 2026-03-06 → "2025-2026")
      // European seasons: if month < 7, season started previous year
      const matchDate = new Date(match.startTimeUtc);
      const year = matchDate.getUTCFullYear();
      const month = matchDate.getUTCMonth() + 1; // 1-based
      const y1 = month < 7 ? year - 1 : year;
      const season = `${y1}-${y1 + 1}`;

      return {
        matchday: match.matchday,
        startDateUtc: match.startTimeUtc,
        competitionCode: code,
        season,
        scoreHome: match.scoreHome,
        scoreAway: match.scoreAway,
      };
    }
    return null;
  }

  /** Extracts home/away TheSportsDB team IDs from the canonical match. */
  private getSdbTeamIds(
    canonicalMatchId: string,
    providerKey: string,
  ): { homeId: string; awayId: string } {
    const compId = `comp:${providerKey}:4432`; // Liga Uruguaya
    const seasonId = this.dataSource.getSeasonId(compId);
    if (seasonId) {
      const match = this.dataSource.getMatches(seasonId).find(
        (m) => m.matchId === canonicalMatchId,
      );
      if (match) {
        return {
          homeId: match.homeTeamId.split(':')[2] ?? '',
          awayId: match.awayTeamId.split(':')[2] ?? '',
        };
      }
    }
    return { homeId: '', awayId: '' };
  }

  private async apiGet<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}/${this.sdbApiKey}${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TheSportsDB HTTP ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  }
}
