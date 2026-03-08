/**
 * IncidentService — orquestador principal.
 *
 * Implementa el flujo §7.10:
 *   1. Cargar snapshot de caché
 *   2. Evaluar shouldScrapeIncidents
 *   3. Si no → devolver snapshot actual
 *   4. Si sí → lock → fetch via API-Football → persistir → devolver
 *
 * Fuente de datos: ApiFootballIncidentSource (api-sports.io)
 * Reemplaza Flashscore que usa JS rendering y no funciona con fetch plano.
 *
 * Lock in-memory (spec §7.9): Map<matchId, Promise> evita fetches duplicados
 * para el mismo partido cuando dos usuarios lo abren simultáneamente.
 */
import { shouldScrapeIncidents } from './should-scrape.js';
import { loadIncidentSnapshot, saveIncidentSnapshot } from './incident-cache.js';
import { ApiFootballIncidentSource } from './apifootball-incident-source.js';
import type {
  IncidentSnapshot,
  MatchCoreInput,
  SnapshotType,
  IncidentEvent,
} from './types.js';

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

  constructor(apiFootballKey: string) {
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
    // 1. Cargar snapshot existente
    const snapshot = await loadIncidentSnapshot(matchCore.matchId);

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
    const work = this.runFetch(matchCore, snapshot).finally(() => {
      this.locks.delete(matchCore.matchId);
    });
    this.locks.set(matchCore.matchId, work);
    return work;
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

      // For FINISHED matches with no events and no prior snapshot, the fixture
      // likely couldn't be resolved (free plan restrictions, match not yet live-cached).
      // Don't persist an empty final snapshot — allow retry on next request.
      if (events.length === 0 && matchCore.status === 'FINISHED' && !fallback) {
        return null;
      }

      const snapshot = buildSnapshot(matchCore, events);
      await saveIncidentSnapshot(snapshot);
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
