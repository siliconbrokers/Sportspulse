/**
 * LiveOverlayDataSource — wraps any DataSource y parchea scores en vivo
 * usando ApifootballLiveOverlay como fuente secundaria de alta frecuencia.
 *
 * Sólo parchea matches que:
 *   1. No están FINISHED según la fuente primaria
 *   2. Tuvieron kickoff hace 0–180 min (ventana heurística de partido en vivo)
 *   3. El overlay tiene un score registrado para ese par de equipos
 *
 * Todos los demás métodos delegan sin cambios a la fuente interna.
 */

import type { Team, Match, EventStatus } from '@sportpulse/canonical';
import type { DataSource, StandingEntry, MatchGoalEventDTO, SubTournamentInfo } from '@sportpulse/snapshot';
import type { ApifootballLiveOverlay } from './apifootball-live-overlay.js';

const LIVE_WINDOW_MIN = 180;

/** Convierte statusShort de API-Football al status canónico del portal. */
function toCanonicalStatus(
  afShort: string,
  originalStatus: string,
): string {
  switch (afShort) {
    case 'FT': case 'AET': case 'PEN': case 'AWD': case 'WO':
      return 'FINISHED';
    case '1H': case 'HT': case '2H': case 'ET': case 'BT': case 'P':
    case 'LIVE':
      return 'IN_PROGRESS';
    default:
      return originalStatus;
  }
}

export class LiveOverlayDataSource implements DataSource {
  /** Reverse mapping: seasonId → competitionId (populado en getSeasonId) */
  private readonly seasonToComp = new Map<string, string>();
  /** Cache de teamId → name por competitionId */
  private readonly teamNameCache = new Map<string, Map<string, string>>();

  constructor(
    private readonly inner: DataSource,
    private readonly overlay: ApifootballLiveOverlay,
  ) {}

  // ── DataSource interface — con overlay en getMatches ─────────────────────────

  getTeams(competitionId: string): Team[] {
    return this.inner.getTeams(competitionId);
  }

  getMatches(seasonId: string, subTournamentKey?: string): Match[] {
    const matches = this.inner.getMatches(seasonId, subTournamentKey);

    // Necesitamos el competitionId para resolver nombres de equipo
    const compId = this.seasonToComp.get(seasonId);
    if (!compId) return matches;

    const teamNames = this.getTeamNames(compId);
    if (teamNames.size === 0) return matches;

    const nowMs = Date.now();

    return matches.map((m) => {
      // Solo intentar overlay en partidos potencialmente en vivo
      if (m.status === 'FINISHED') return m;
      if (!m.startTimeUtc) return m;

      const minsElapsed = (nowMs - new Date(m.startTimeUtc).getTime()) / 60_000;
      if (minsElapsed < 0 || minsElapsed > LIVE_WINDOW_MIN) return m;

      const homeName = teamNames.get(m.homeTeamId);
      const awayName = teamNames.get(m.awayTeamId);
      if (!homeName || !awayName) return m;

      const live = this.overlay.getLiveScore(homeName, awayName);
      if (!live) return m;

      return {
        ...m,
        scoreHome: live.home,
        scoreAway: live.away,
        status:    toCanonicalStatus(live.statusShort, m.status) as EventStatus,
      };
    });
  }

  /**
   * Intercepta getSeasonId para poblar el mapping inverso seasonId → competitionId.
   * Todos los callers hacen getSeasonId(compId) antes de getMatches(seasonId),
   * por lo que este mapping siempre está disponible cuando se necesita.
   */
  getSeasonId(competitionId: string): string | undefined {
    const id = this.inner.getSeasonId(competitionId);
    if (id) this.seasonToComp.set(id, competitionId);
    return id;
  }

  // ── Delegation (sin cambios) ──────────────────────────────────────────────────

  getStandings(competitionId: string, subTournamentKey?: string): StandingEntry[] {
    return this.inner.getStandings?.(competitionId, subTournamentKey) ?? [];
  }

  getSubTournaments(competitionId: string): SubTournamentInfo[] {
    return this.inner.getSubTournaments?.(competitionId) ?? [];
  }

  getActiveSubTournament(competitionId: string): string | undefined {
    return this.inner.getActiveSubTournament?.(competitionId);
  }

  getCurrentMatchday(competitionId: string, subTournamentKey?: string): number | undefined {
    return this.inner.getCurrentMatchday?.(competitionId, subTournamentKey);
  }

  getLastPlayedMatchday(competitionId: string, subTournamentKey?: string): number | undefined {
    return this.inner.getLastPlayedMatchday?.(competitionId, subTournamentKey);
  }

  getNextMatchday(competitionId: string, subTournamentKey?: string): number | undefined {
    return this.inner.getNextMatchday?.(competitionId, subTournamentKey);
  }

  getTotalMatchdays(competitionId: string, subTournamentKey?: string): number {
    return this.inner.getTotalMatchdays?.(competitionId, subTournamentKey) ?? 38;
  }

  async getMatchGoals(canonicalMatchId: string): Promise<MatchGoalEventDTO[]> {
    return this.inner.getMatchGoals?.(canonicalMatchId) ?? [];
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private getTeamNames(competitionId: string): Map<string, string> {
    if (!this.teamNameCache.has(competitionId)) {
      const teams = this.inner.getTeams(competitionId);
      this.teamNameCache.set(
        competitionId,
        new Map(teams.map((t) => [t.teamId, t.name])),
      );
    }
    return this.teamNameCache.get(competitionId)!;
  }
}
