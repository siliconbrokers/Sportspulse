/**
 * v3-shadow-runner.ts — Ejecutor del Motor Predictivo V3 (Unificado) para partidos pre-kickoff.
 *
 * Corre out-of-band (fire-and-forget) en paralelo con el motor Radar.
 * NO reemplaza Radar — el portal sigue usando Radar hasta que se autorice la Fase 3.
 *
 * Soporta dos estrategias de datos históricos:
 *
 *   FD (football-data.org) — PD, PL:
 *     Usa HistoricalStateService para obtener temporada actual + anterior.
 *     Prior quality: PREV_SEASON / PARTIAL.
 *
 *   DataSource + NonFdLoader — BL1, URU, ARG:
 *     Temporada actual: extrae partidos FINISHED del DataSource en memoria (sin API extra).
 *     Temporada anterior: NonFdLoader (OpenLigaDB o TheSportsDB API, TTL 1 año en disco).
 *     Prior quality: PREV_SEASON / PARTIAL si hay datos previos; LEAGUE_BASELINE si falla.
 *
 * Anti-lookahead: V3 engine filtra internamente con utcDate < kickoffUtc (buildNowUtc).
 * Fault isolation: errores por partido son capturados y nunca propagan.
 *
 * SP-PRED-V3 §18 (shadow phase)
 */

import type { DataSource } from '@sportpulse/snapshot';
import { runV3Engine } from '@sportpulse/prediction';
import type { V3MatchRecord } from '@sportpulse/prediction';
import { EventStatus } from '@sportpulse/canonical';
import type { PredictionStore } from './prediction-store.js';
import { buildSnapshot } from './prediction-store.js';
import type { EvaluationStore } from './evaluation-store.js';
import { HistoricalStateService } from './historical-state-service.js';
import { loadOLGPrevSeason, loadSDBPrevSeason } from './non-fd-prev-season-loader.js';
import type { OddsService } from '../odds/odds-service.js';
import type { InjurySource } from './injury-source.js';
import { normTeamName } from './injury-source.js';
import type { XgSource } from './xg-source.js';
import type { LineupSource } from './lineup-source.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Descriptor de una competencia no-FD para la carga de temporada anterior.
 * Si provider='openligadb': usa loadOLGPrevSeason(league, prevYear).
 * Si provider='thesportsdb' o 'sportsdb-ar': usa loadSDBPrevSeason(leagueId, providerKey, apiKey, prevYear).
 */
export interface NonFdCompDescriptor {
  competitionId: string;
  provider: 'openligadb' | 'thesportsdb';
  /** League code para OLG (e.g. 'bl1') o leagueId para SDB (e.g. '4432') */
  providerLeagueId: string;
  /** Clave canónica usada en canonicalTeamId (e.g. 'openligadb', 'thesportsdb', 'sportsdb-ar') */
  providerKey: string;
  /** API key para SDB (ignorado para OLG) */
  sdbApiKey?: string;
  /**
   * Partidos esperados por equipo en una temporada completa.
   * Usado para derivar THRESHOLD_ELIGIBLE adaptativo (§14 adaptive).
   * Ejemplos: BL1=34, URU_Clausura=15, ARG_Apertura=19.
   */
  expectedSeasonGames?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function seasonBoundaryIso(seasonStartYear: number): string {
  return new Date(Date.UTC(seasonStartYear, 6, 1)).toISOString();
}

function extractFinishedFromDataSource(
  dataSource: DataSource,
  seasonId: string,
  buildNowUtc: string,
): V3MatchRecord[] {
  return dataSource.getMatches(seasonId)
    .filter(
      (m) =>
        m.status === EventStatus.FINISHED &&
        m.startTimeUtc !== null &&
        m.startTimeUtc < buildNowUtc &&
        m.scoreHome !== null &&
        m.scoreAway !== null,
    )
    .map((m) => ({
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      utcDate: m.startTimeUtc!,
      homeGoals: m.scoreHome!,
      awayGoals: m.scoreAway!,
    }));
}

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Ejecuta predicciones V3 para todos los partidos SCHEDULED futuros.
 *
 * @param dataSource          DataSource del portal.
 * @param fdCompetitionIds    IDs de competencias FD (usan HistoricalStateService).
 * @param nonFdDescriptors    Descriptores de competencias no-FD (OLG / SDB).
 * @param historicalService   Servicio de histórico FD.
 * @param store               PredictionStore unificado.
 * @param fdCompetitionCodeMap competitionId → código FD (e.g. 'PD').
 * @param currentSeasonYear   Año de inicio de la temporada actual.
 */
export async function runV3Shadow(
  dataSource: DataSource,
  fdCompetitionIds: string[],
  nonFdDescriptors: NonFdCompDescriptor[],
  historicalService: HistoricalStateService,
  store: PredictionStore,
  fdCompetitionCodeMap: Map<string, string>,
  currentSeasonYear: number,
  evaluationStore?: EvaluationStore,
  oddsService?: OddsService,
  injurySource?: InjurySource,
  xgSource?: XgSource,
  lineupSource?: LineupSource,
): Promise<void> {
  try {
    const buildNowUtc = new Date().toISOString();
    const prevSeasonYear = currentSeasonYear - 1;

    // ── FD competitions ───────────────────────────────────────────────────────
    for (const competitionId of fdCompetitionIds) {
      const competitionCode = fdCompetitionCodeMap.get(competitionId);
      if (!competitionCode) continue;

      const seasonId = dataSource.getSeasonId(competitionId);
      if (!seasonId) continue;

      let allHistorical: V3MatchRecord[];
      try {
        const records = await historicalService.getAllMatches(competitionCode, currentSeasonYear);
        allHistorical = records.map((r) => ({
          homeTeamId: r.homeTeamId,
          awayTeamId: r.awayTeamId,
          utcDate: r.utcDate,
          homeGoals: r.homeGoals,
          awayGoals: r.awayGoals,
        }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[V3Runner] failed to load FD history for ${competitionCode}: ${msg}`);
        allHistorical = [];
      }

      const boundary = seasonBoundaryIso(currentSeasonYear);
      const currentSeasonMatches = allHistorical.filter((r) => r.utcDate >= boundary);
      const prevSeasonMatches    = allHistorical.filter((r) => r.utcDate <  boundary);

      await runMatchPredictions(
        dataSource, seasonId, competitionId, competitionCode,
        currentSeasonMatches, prevSeasonMatches, buildNowUtc, store, 'fd',
        38, // FD leagues (EPL/PD): standard 38-game season
        evaluationStore, oddsService, injurySource, xgSource, lineupSource,
      );
    }

    // ── Non-FD competitions ───────────────────────────────────────────────────
    for (const desc of nonFdDescriptors) {
      const seasonId = dataSource.getSeasonId(desc.competitionId);
      if (!seasonId) continue;

      const currentSeasonMatches = extractFinishedFromDataSource(dataSource, seasonId, buildNowUtc);

      let prevSeasonMatches: V3MatchRecord[];
      if (desc.provider === 'openligadb') {
        prevSeasonMatches = await loadOLGPrevSeason(desc.providerLeagueId, prevSeasonYear);
      } else {
        prevSeasonMatches = await loadSDBPrevSeason(
          desc.providerLeagueId,
          desc.providerKey,
          desc.sdbApiKey ?? '123',
          prevSeasonYear,
        );
      }

      await runMatchPredictions(
        dataSource, seasonId, desc.competitionId, desc.providerLeagueId,
        currentSeasonMatches, prevSeasonMatches, buildNowUtc, store, 'datasource',
        desc.expectedSeasonGames, evaluationStore, oddsService, injurySource, xgSource, lineupSource,
      );
    }

    store.persist().catch(console.error);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[V3Runner] unexpected outer error: ${msg}`);
  }
}

// ── Inner loop (shared between FD and non-FD) ─────────────────────────────────

async function runMatchPredictions(
  dataSource: DataSource,
  seasonId: string,
  competitionId: string,
  logCode: string,
  currentSeasonMatches: V3MatchRecord[],
  prevSeasonMatches: V3MatchRecord[],
  buildNowUtc: string,
  store: PredictionStore,
  strategy: 'fd' | 'datasource',
  expectedSeasonGames?: number,
  evaluationStore?: EvaluationStore,
  oddsService?: OddsService,
  injurySource?: InjurySource,
  xgSource?: XgSource,
  lineupSource?: LineupSource,
): Promise<void> {
  const scheduled = dataSource.getMatches(seasonId).filter(
    (m) =>
      m.status === 'SCHEDULED' &&
      m.startTimeUtc !== null &&
      new Date(m.startTimeUtc).getTime() > Date.now(),
  );

  // Build team name lookup for odds matching and injury team resolution
  const teams = dataSource.getTeams(competitionId);
  const teamNameMap = new Map(teams.map((t) => [t.teamId, t.name ?? t.shortName ?? t.teamId]));

  // Build normTeamName → canonicalTeamId map for InjurySource matching
  const teamNameToId = new Map<string, string>();
  for (const t of teams) {
    if (t.name)      teamNameToId.set(normTeamName(t.name), t.teamId);
    if (t.shortName) teamNameToId.set(normTeamName(t.shortName), t.teamId);
  }

  // MKT-T3-03: Fetch xG histórico una vez por competencia (incremental, cache-first)
  // Cobertura parcial es OK — el engine usa goles reales para partidos sin xG.
  let historicalXg: import('@sportpulse/prediction').XgRecord[] | undefined;
  if (xgSource) {
    try {
      // Derive season year from buildNowUtc (before July = previous year start)
      const buildDate = new Date(buildNowUtc);
      const buildYear = buildDate.getUTCFullYear();
      const buildMonth = buildDate.getUTCMonth(); // 0-indexed
      const season = buildMonth < 6 ? buildYear - 1 : buildYear;

      const fetched = await xgSource.getHistoricalXg(competitionId, season, teamNameToId);
      if (fetched.length > 0) historicalXg = fetched;
    } catch {
      historicalXg = undefined; // fault isolation
    }
  }

  let predicted = 0;

  for (const match of scheduled) {
    const matchRef = {
      matchId: match.matchId,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      startTimeUtc: match.startTimeUtc,
      status: match.status,
    };

    // Register in evaluation store so every in-scope match has a record
    evaluationStore?.registerMatch(competitionId, matchRef);

    try {
      // MKT-T3-01: Fetch injuries for this match — fault-isolated, never propagates
      let injuries: import('@sportpulse/prediction').InjuryRecord[] | undefined;
      if (injurySource && match.startTimeUtc) {
        try {
          const fetched = await injurySource.getInjuriesForMatch(
            competitionId,
            match.startTimeUtc,
            match.homeTeamId,
            match.awayTeamId,
            teamNameToId,
          );
          if (fetched.length > 0) injuries = fetched;
        } catch {
          injuries = undefined; // fault isolation
        }
      }

      // MKT-T3-04: Fetch confirmed lineup (~1h before kickoff) — fault-isolated, never propagates
      let confirmedLineups: import('@sportpulse/prediction').ConfirmedLineupRecord[] | undefined;
      if (lineupSource && match.startTimeUtc) {
        const minutesToKickoff = (new Date(match.startTimeUtc).getTime() - Date.now()) / 60_000;
        if (minutesToKickoff <= 90) {
          try {
            const fetched = await lineupSource.getConfirmedLineups(
              competitionId,
              match.startTimeUtc,
              match.homeTeamId,
              match.awayTeamId,
              teamNameToId,
            );
            if (fetched.length > 0) confirmedLineups = fetched;
          } catch {
            confirmedLineups = undefined; // fault isolation
          }
        }
      }

      const input = {
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        kickoffUtc: match.startTimeUtc!,
        currentSeasonMatches,
        prevSeasonMatches,
        buildNowUtc,
        expectedSeasonGames,
        injuries,
        historicalXg,
        confirmedLineups,
      };

      const output = runV3Engine(input);
      const snapshot = buildSnapshot(match.matchId, competitionId, input, output, 'v3_unified');
      store.save(snapshot);
      predicted++;

      // Freeze snapshot in evaluation store (OE-2 pattern, V3 variant)
      if (evaluationStore) {
        evaluationStore.freezeSnapshot(competitionId, matchRef, snapshot);

        // MKT-T3-02: Attach market odds fire-and-forget — never propagates errors
        if (oddsService && output.prob_home_win != null && output.prob_draw != null && output.prob_away_win != null) {
          const homeTeamName = teamNameMap.get(match.homeTeamId) ?? match.homeTeamId;
          const awayTeamName = teamNameMap.get(match.awayTeamId) ?? match.awayTeamId;
          void oddsService.getOddsForMatch(
            competitionId,
            match.startTimeUtc!,
            homeTeamName,
            awayTeamName,
          ).then((odds) => {
            if (odds) {
              evaluationStore.attachMarketOdds(
                match.matchId,
                odds,
                output.prob_home_win!,
                output.prob_draw!,
                output.prob_away_win!,
              );
              // Persist after odds attachment
              evaluationStore.persist().catch(console.error);
            }
          }).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[V3Runner] odds fetch failed for ${match.matchId}: ${msg}`);
          });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[V3Runner] prediction failed for ${match.matchId}: ${msg}`);
      store.saveError(match.matchId, competitionId, err, 'v3_unified');
    }
  }

  // Persist evaluation store after all matches in this competition
  evaluationStore?.persist().catch(console.error);

  console.log(
    `[V3Runner] ${logCode} (${strategy}): ${predicted}/${scheduled.length} predictions stored ` +
    `(current=${currentSeasonMatches.length}, prev=${prevSeasonMatches.length})`,
  );
}
