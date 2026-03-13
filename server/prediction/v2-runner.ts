/**
 * v2-runner.ts — Ejecutor del Motor Predictivo V2 para partidos pre-kickoff.
 *
 * Corre out-of-band (fire-and-forget). Coexistencia controlada con V1.
 *
 * Flujo por competencia:
 *   1. Cargar TODOS los partidos históricos (current + 2 prev seasons) via HistoricalStateService
 *   2. Separar: current season (utcDate ≥ 1-julio-currentSeasonYear) vs prev season
 *   3. Para cada partido SCHEDULED futuro → runV2Engine()
 *   4. Guardar en V2PredictionStore
 *
 * Anti-lookahead: V2 engine filtra internamente con utcDate < kickoffUtc.
 * Fault isolation: errores por partido son capturados y no propagan.
 */

import type { DataSource } from '@sportpulse/snapshot';
import { runV2Engine } from '@sportpulse/prediction';
import type { V2MatchRecord } from '@sportpulse/prediction';
import { V2PredictionStore, type V2StoredPrediction } from './v2-prediction-store.js';
import { HistoricalStateService } from './historical-state-service.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Frontera de temporada para ligas europeas (inicio en agosto).
 * Usar 1 de julio como corte: partidos desde esa fecha pertenecen a la temporada
 * que empieza ese año (e.g. 2024-07-01 → temporada 2024-25).
 *
 * Evita la contaminación por año calendario: partidos de enero-mayo 2024
 * pertenecen a la temporada 2023-24, no a 2024-25.
 */
function seasonBoundaryIso(seasonStartYear: number): string {
  // ISO UTC: 1 de julio del año de inicio de temporada
  return new Date(Date.UTC(seasonStartYear, 6, 1)).toISOString();
}

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Ejecuta predicciones V2 para todos los partidos SCHEDULED futuros.
 *
 * @param dataSource          DataSource del portal (partidos SCHEDULED/actuales).
 * @param competitionIds      IDs canónicos de competencias activas.
 * @param historicalService   Servicio de carga de histórico (current + prev seasons).
 * @param store               Store donde se persisten los resultados V2.
 * @param competitionCodeMap  competitionId → código FD (e.g. 'comp:football-data:PD' → 'PD').
 * @param currentSeasonYear   Año de inicio de la temporada actual (e.g. 2025 para 2025-26).
 */
export async function runV2Shadow(
  dataSource: DataSource,
  competitionIds: string[],
  historicalService: HistoricalStateService,
  store: V2PredictionStore,
  competitionCodeMap: Map<string, string>,
  currentSeasonYear: number,
): Promise<void> {
  try {
    for (const competitionId of competitionIds) {
      const competitionCode = competitionCodeMap.get(competitionId);
      if (!competitionCode) {
        console.log(`[V2Runner] no FD code for ${competitionId}, skipping`);
        continue;
      }

      const seasonId = dataSource.getSeasonId(competitionId);
      if (!seasonId) continue;

      // ── 1. Cargar histórico completo (current + prev seasons) ──────────
      let allHistorical: V2MatchRecord[];
      try {
        const records = await historicalService.getAllMatches(competitionCode, currentSeasonYear);
        allHistorical = records.map((r) => ({
          homeTeamId: r.homeTeamId,
          awayTeamId: r.awayTeamId,
          utcDate:    r.utcDate,
          homeGoals:  r.homeGoals,
          awayGoals:  r.awayGoals,
        }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[V2Runner] failed to load history for ${competitionCode}: ${msg}`);
        allHistorical = [];
      }

      // ── 2. Separar por temporada ────────────────────────────────────────
      // Usar frontera por fecha (1 julio), no por año calendario.
      // Ligas europeas: temporada 2024-25 empieza en agosto 2024.
      // Con año calendario, partidos de enero-mayo 2024 (temporada 2023-24)
      // caerían incorrectamente en currentSeasonMatches de 2024-25.
      const boundary = seasonBoundaryIso(currentSeasonYear);
      const currentSeasonMatches = allHistorical.filter((r) => r.utcDate >= boundary);
      const prevSeasonMatches    = allHistorical.filter((r) => r.utcDate <  boundary);

      // ── 3. Partidos futuros a predecir ──────────────────────────────────
      const scheduled = dataSource.getMatches(seasonId).filter(
        (m) =>
          m.status === 'SCHEDULED' &&
          m.startTimeUtc !== null &&
          new Date(m.startTimeUtc).getTime() > Date.now(),
      );

      let predicted = 0;
      for (const match of scheduled) {
        try {
          const output = runV2Engine({
            homeTeamId:           match.homeTeamId,
            awayTeamId:           match.awayTeamId,
            kickoffUtc:           match.startTimeUtc!,
            currentSeasonMatches,
            prevSeasonMatches,
          });

          const stored: V2StoredPrediction = {
            matchId:       match.matchId,
            competitionId,
            homeTeamId:    match.homeTeamId,
            awayTeamId:    match.awayTeamId,
            kickoffUtc:    match.startTimeUtc!,
            computedAt:    new Date().toISOString(),
            output,
          };

          store.save(stored);
          predicted++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[V2Runner] prediction failed for ${match.matchId}: ${msg}`);
        }
      }

      console.log(
        `[V2Runner] ${competitionCode}: ${predicted}/${scheduled.length} predictions stored ` +
        `(current=${currentSeasonMatches.length}, prev=${prevSeasonMatches.length} matches)`,
      );

      store.persist().catch(console.error);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[V2Runner] unexpected outer error: ${msg}`);
  }
}
