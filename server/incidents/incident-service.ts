/**
 * IncidentService — orquestador principal.
 *
 * Implementa el flujo §7.10:
 *   1. Cargar snapshot de caché
 *   2. Evaluar shouldScrapeIncidents
 *   3. Si no → devolver snapshot actual
 *   4. Si sí → lock → fetch → persistir → devolver
 *
 * Fuentes de datos:
 *   - NATIVE_GOALS_COMPETITIONS (BL1): usa goalsFallback directamente (OpenLigaDB, sin quota)
 *     → solo goles (no tarjetas ni sustituciones), pero gratis e ilimitado
 *   - Resto: ApiFootballIncidentSource (api-sports.io, 100 req/día compartido)
 *     → con fallback a goalsFallback si quota agotada y partido FINISHED
 *
 * Lock in-memory (spec §7.9): Map<matchId, Promise> evita fetches duplicados
 * para el mismo partido cuando dos usuarios lo abren simultáneamente.
 */
import { shouldScrapeIncidents } from './should-scrape.js';
import { loadIncidentSnapshot, saveIncidentSnapshot } from './incident-cache.js';
import { ApiFootballIncidentSource, isApiFootballQuotaExhausted } from './apifootball-incident-source.js';
import type {
  IncidentSnapshot,
  MatchCoreInput,
  SnapshotType,
  IncidentEvent,
} from './types.js';

/**
 * Competiciones que usan su proveedor nativo de goles (gratuito, sin quota).
 * Para estas, se bypasea API-Football completamente — solo goles disponibles.
 */
const NATIVE_GOALS_COMPETITIONS = new Set([
  'comp:openligadb:bl1',
]);

/** True si la competición NO usa API-Football para incidentes. */
export function usesNativeGoals(competitionId: string): boolean {
  return NATIVE_GOALS_COMPETITIONS.has(competitionId);
}

/** Minimal interface for goals fallback — satisfied by MatchEventsService. */
export interface IGoalsFallback {
  getMatchGoals(canonicalMatchId: string): Promise<GoalFallbackItem[]>;
}

interface GoalFallbackItem {
  minute: number;
  injuryTime?: number;
  type: 'GOAL' | 'OWN_GOAL' | 'PENALTY';
  team: 'HOME' | 'AWAY';
  scorerName?: string;
}

function goalsToIncidents(goals: GoalFallbackItem[]): IncidentEvent[] {
  return goals.map((g) => ({
    type: g.type === 'PENALTY' ? 'PENALTY_GOAL' as const
        : g.type === 'OWN_GOAL' ? 'OWN_GOAL' as const
        : 'GOAL' as const,
    minute: g.minute,
    minuteExtra: g.injuryTime,
    teamSide: g.team,
    playerName: g.scorerName,
  }));
}

function buildSnapshot(
  matchCore: MatchCoreInput,
  events: IncidentEvent[],
): IncidentSnapshot {
  const status = matchCore.status;
  const snapshotType: SnapshotType =
    status === 'FINISHED' ? 'final'
    : status === 'HT'     ? 'halftime'
    : 'live';

  return {
    matchId:             matchCore.matchId,
    snapshotType,
    matchStatusAtScrape: status,
    homeScoreAtScrape:   matchCore.homeScore,
    awayScoreAtScrape:   matchCore.awayScore,
    scrapedAtUtc:        new Date().toISOString(),
    isFinal:             status === 'FINISHED',
    events,
  };
}

export class IncidentService {
  private readonly source: ApiFootballIncidentSource;
  /** Lock in-memory: clave = matchId, valor = Promise del fetch en curso */
  private locks = new Map<string, Promise<IncidentSnapshot | null>>();

  constructor(
    apiFootballKey: string,
    private readonly goalsFallback?: IGoalsFallback,
  ) {
    this.source = new ApiFootballIncidentSource(apiFootballKey);
  }

  /**
   * Devuelve el snapshot de incidentes para un partido.
   * Puede disparar un fetch a API-Football si es necesario (spec §7.2).
   *
   * @param matchCore — estado actual del partido desde el provider
   */
  async get(
    matchCore: MatchCoreInput,
    // siblingMatches kept for API compat but no longer used (API-Football resolves by date+league)
    _siblingMatches: MatchCoreInput[] = [],
  ): Promise<IncidentSnapshot | null> {
    // 1. Cargar snapshot existente (con contexto de liga/temporada para ruta jerárquica)
    const snapshot = await loadIncidentSnapshot(matchCore.matchId, matchCore);

    // 2. Evaluar si hay que refrescar
    if (!shouldScrapeIncidents(matchCore, snapshot, new Date())) {
      return snapshot;
    }

    // 3. Si hay lock activo para este partido → reutilizar (spec §7.9, AC-6)
    const existingLock = this.locks.get(matchCore.matchId);
    if (existingLock) {
      console.log(`[IncidentService] Reusing lock for matchId=${matchCore.matchId}`);
      return existingLock;
    }

    // 4. Adquirir lock y ejecutar fetch
    // Para competiciones nativas (BL1): bypass API-Football, usar proveedor nativo directamente
    const runWork = usesNativeGoals(matchCore.competitionId)
      ? this.runNativeFetch(matchCore, snapshot)
      : this.runFetch(matchCore, snapshot);

    const work = runWork.finally(() => {
      this.locks.delete(matchCore.matchId);
    });
    this.locks.set(matchCore.matchId, work);
    return work;
  }

  /**
   * Fetch nativo: usa goalsFallback directamente sin tocar API-Football.
   * Solo disponible para competiciones en NATIVE_GOALS_COMPETITIONS.
   * Devuelve goles únicamente (sin tarjetas ni sustituciones).
   */
  private async runNativeFetch(
    matchCore: MatchCoreInput,
    fallback: IncidentSnapshot | null,
  ): Promise<IncidentSnapshot | null> {
    if (!this.goalsFallback) {
      console.warn(`[IncidentService] runNativeFetch: no goalsFallback configured for ${matchCore.matchId}`);
      return fallback;
    }
    try {
      const goals = await this.goalsFallback.getMatchGoals(matchCore.matchId);
      if (goals.length === 0 && fallback) return fallback;
      if (goals.length === 0) return null;

      const events = goalsToIncidents(goals);
      const snapshot = buildSnapshot(matchCore, events);
      await saveIncidentSnapshot(snapshot, matchCore);
      console.log(
        `[IncidentService] Native snapshot matchId=${matchCore.matchId} ` +
        `status=${matchCore.status} goals=${events.length}`,
      );
      return snapshot;
    } catch (err) {
      console.error(`[IncidentService] Native fetch failed for ${matchCore.matchId}:`, err);
      return fallback;
    }
  }

  private async runFetch(
    matchCore: MatchCoreInput,
    fallback: IncidentSnapshot | null,
  ): Promise<IncidentSnapshot | null> {
    try {
      const events = await this.source.getIncidents(matchCore);

      // If API returned no events (unknown competition, API failure, etc.)
      // and we have an existing snapshot, keep it.
      if (events.length === 0 && fallback) {
        return fallback;
      }

      // Fallback: when API-Football quota is exhausted or returned no events for a
      // FINISHED match, try to get goal events from the existing goals service
      // (TheSportsDB / OpenLigaDB). Goals-only — no cards or subs.
      if (events.length === 0 && matchCore.status === 'FINISHED' && this.goalsFallback) {
        const quotaGone = isApiFootballQuotaExhausted();
        try {
          const goals = await this.goalsFallback.getMatchGoals(matchCore.matchId);
          if (goals.length > 0) {
            const fallbackEvents = goalsToIncidents(goals);
            const snapshot = buildSnapshot(matchCore, fallbackEvents);
            await saveIncidentSnapshot(snapshot, matchCore);
            console.log(
              `[IncidentService] Saved goals-fallback snapshot matchId=${matchCore.matchId} ` +
              `goals=${fallbackEvents.length}${quotaGone ? ' (quota exhausted)' : ''}`,
            );
            return snapshot;
          }
        } catch (fallbackErr) {
          console.warn(`[IncidentService] Goals fallback failed for ${matchCore.matchId}:`, fallbackErr);
        }
      }

      // For FINISHED matches with no events and no prior snapshot, the fixture
      // likely couldn't be resolved (free plan restrictions, match not yet live-cached).
      // Don't persist an empty final snapshot — allow retry on next request.
      if (events.length === 0 && matchCore.status === 'FINISHED' && !fallback) {
        return null;
      }

      const snapshot = buildSnapshot(matchCore, events);
      await saveIncidentSnapshot(snapshot, matchCore);
      console.log(
        `[IncidentService] Saved snapshot matchId=${matchCore.matchId} ` +
        `status=${matchCore.status} events=${events.length} isFinal=${snapshot.isFinal}`,
      );

      return snapshot;
    } catch (err) {
      // AC-7: fallo → devolver snapshot anterior, nunca romper UI
      console.error(`[IncidentService] Fetch failed for matchId=${matchCore.matchId}:`, err);
      return fallback;
    }
  }
}
