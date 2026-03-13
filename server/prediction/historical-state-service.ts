/**
 * historical-state-service.ts — service for pre-match historical team state.
 *
 * Orchestrates the historical match loader and team-state replay to produce
 * the exact pre-match Elo rating and 365d match count for any fixture.
 *
 * Usage in shadow-runner: call getPreMatchTeamState() before buildMatchInput()
 * to obtain historical context that replaces the current-standings approximation.
 *
 * Cache strategy:
 * - Historical matches are cached to disk by HistoricalLoader
 * - In-memory: per-competition match arrays, reloaded when stale (TTL 6h)
 * - Replay is synchronous (O(n)), computed on every call — no result cache needed
 *
 * H2 — Historical Team State Backbone
 */

import type { FinishedMatchRecord, PreMatchTeamState } from '@sportpulse/prediction';
import { computePreMatchTeamState } from '@sportpulse/prediction';
import { loadHistoricalMatches, type HistoricalLoaderOptions } from './historical-match-loader.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface CompetitionHistoryEntry {
  matches: FinishedMatchRecord[];
  loadedAt: number;
  currentSeasonStartYear: number;
}

/** TTL for the in-memory match cache (matches disk cache current-season TTL). */
const MEMORY_TTL_MS = 6 * 3600_000;

// ── HistoricalStateService ─────────────────────────────────────────────────

export class HistoricalStateService {
  private readonly loaderOptions: HistoricalLoaderOptions;
  /** In-memory per-competition cache: competitionCode → entry */
  private readonly memoryCache = new Map<string, CompetitionHistoryEntry>();

  constructor(loaderOptions: HistoricalLoaderOptions) {
    this.loaderOptions = loaderOptions;
  }

  /**
   * Returns the pre-match historical team state for a given fixture.
   *
   * Anti-lookahead invariant is enforced inside computePreMatchTeamState:
   * only matches with utcDate < kickoffUtc are used.
   *
   * @param competitionCode         FD competition code, e.g. 'PD'
   * @param currentSeasonStartYear  Start year of the current season (e.g. 2025)
   * @param homeTeamId              Canonical home team ID
   * @param awayTeamId              Canonical away team ID
   * @param kickoffUtc              ISO-8601 UTC kickoff of the target match
   */
  async getPreMatchTeamState(
    competitionCode: string,
    currentSeasonStartYear: number,
    homeTeamId: string,
    awayTeamId: string,
    kickoffUtc: string,
  ): Promise<PreMatchTeamState> {
    const matches = await this._getMatches(competitionCode, currentSeasonStartYear);
    return computePreMatchTeamState(matches, homeTeamId, awayTeamId, kickoffUtc);
  }

  /**
   * Pre-warms the in-memory cache for the given competition.
   * Call this at startup or before a shadow run to avoid the first-call latency.
   */
  async warmUp(competitionCode: string, currentSeasonStartYear: number): Promise<void> {
    await this._getMatches(competitionCode, currentSeasonStartYear);
  }

  /**
   * Devuelve todos los partidos históricos cargados para una competencia.
   * Incluye la temporada actual y las anteriores (PAST_SEASONS_COUNT = 2).
   * Útil para el motor V2, que necesita separar current vs prev season.
   */
  async getAllMatches(
    competitionCode: string,
    currentSeasonStartYear: number,
  ): Promise<FinishedMatchRecord[]> {
    return this._getMatches(competitionCode, currentSeasonStartYear);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async _getMatches(
    competitionCode: string,
    currentSeasonStartYear: number,
  ): Promise<FinishedMatchRecord[]> {
    const cached = this.memoryCache.get(competitionCode);
    const nowMs = Date.now();

    if (
      cached &&
      cached.currentSeasonStartYear === currentSeasonStartYear &&
      nowMs - cached.loadedAt < MEMORY_TTL_MS
    ) {
      return cached.matches;
    }

    const matches = await loadHistoricalMatches(
      competitionCode,
      currentSeasonStartYear,
      this.loaderOptions,
    );

    this.memoryCache.set(competitionCode, {
      matches,
      loadedAt: nowMs,
      currentSeasonStartYear,
    });

    console.log(
      `[HistoricalStateService] Loaded ${matches.length} historical matches for ${competitionCode}`,
    );

    return matches;
  }
}
