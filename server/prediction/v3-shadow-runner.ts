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

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DataSource } from '@sportpulse/snapshot';
import { runV3Engine } from '@sportpulse/prediction';
import type { V3MatchRecord, CalibrationTable } from '@sportpulse/prediction';
import type { LogisticCoefficients } from '@sportpulse/prediction';
import { EventStatus } from '@sportpulse/canonical';
import type { PredictionStore } from './prediction-store.js';
import { buildSnapshot } from './prediction-store.js';
import type { EvaluationStore } from './evaluation-store.js';
import { HistoricalStateService } from './historical-state-service.js';
import { loadOLGPrevSeason, loadSDBPrevSeason } from './non-fd-prev-season-loader.js';
import { loadAfHistoricalMatches } from './historical-match-loader-af.js';
import type { OddsService } from '../odds/odds-service.js';
import type { InjurySource } from './injury-source.js';
import { normTeamName } from './injury-source.js';
import type { XgSource } from './xg-source.js';
import type { LineupSource } from './lineup-source.js';

// ── Logistic coefficients (loaded once, refreshed when file changes) ──────────
//
// §SP-V4-23: Loaded from cache/logistic-coefficients.json.
// If the file does not exist (model not yet trained), undefined is used and the
// engine falls back to DEFAULT_LOGISTIC_COEFFICIENTS (uniform prior).
// Only relevant when ENSEMBLE_ENABLED=true in the engine input.

const LOGISTIC_COEF_PATH = path.join(process.cwd(), 'cache', 'logistic-coefficients.json');
const LOGISTIC_COEF_TTL_MS = 60 * 60_000; // 1h — retrain is infrequent

interface LogisticCoefEntry {
  coefficients: LogisticCoefficients;
  loadedAt: number;
}

let _logisticCoefEntry: LogisticCoefEntry | undefined;

function loadLogisticCoefficients(): LogisticCoefficients | undefined {
  const now = Date.now();
  if (_logisticCoefEntry && now - _logisticCoefEntry.loadedAt < LOGISTIC_COEF_TTL_MS) {
    return _logisticCoefEntry.coefficients;
  }
  try {
    if (!fs.existsSync(LOGISTIC_COEF_PATH)) return undefined;
    const raw = fs.readFileSync(LOGISTIC_COEF_PATH, 'utf8');
    const parsed = JSON.parse(raw) as LogisticCoefficients;
    // Basic validation: must have all three class coefficient sets
    if (!parsed.home || !parsed.draw || !parsed.away) return undefined;
    _logisticCoefEntry = { coefficients: parsed, loadedAt: now };
    console.log(`[Ensemble] Logistic coefficients loaded: trained_on=${parsed.trained_on_matches} matches, at=${parsed.trained_at}`);
    return parsed;
  } catch {
    console.warn('[Ensemble] Failed to load logistic-coefficients.json — using DEFAULT_LOGISTIC_COEFFICIENTS');
    return undefined;
  }
}

// ── Calibration tables (loaded once, refreshed every 6h) ──────────────────────
//
// Mixed strategy (validated via walk-forward backtest 2025-26, 806 matches):
//   PD  → per-league table (PD has large HOME bias +0.096; per-liga: +4.5pp acc, +6.4pp DRAW recall)
//   PL  → global table     (PL bias is tiny +0.017; global "accidentally" helps via cross-league correction)
//   BL1 → global table     (per-BL1 table over-corrects: 64% DRAW recall, 53% draw prediction rate)
//   Others → global fallback
//
// Result: acc=50.6%, DRAW recall=43.2%, DRAW prec=34.2% (+1.6pp / +2.0pp / +2.8pp vs global-only)

const CAL_DIR = path.join(process.cwd(), 'cache', 'calibration');
const CAL_GLOBAL_PATH = path.join(CAL_DIR, 'v3-iso-calibration.json');
const CAL_TABLE_TTL_MS = 6 * 60 * 60_000; // 6h — generated offline, changes rarely

// competitionId → league code for per-league tables
// Only codes listed here use a per-league table; others fall back to global.
const PER_LEAGUE_TABLE_CODES: Record<string, string> = {
  'comp:football-data:PD': 'PD',
  'comp:apifootball:140':  'PD',
};

interface CalTableEntry {
  table: CalibrationTable;
  loadedAt: number;
}

const _calTables = new Map<string, CalTableEntry>(); // key: file path

function loadCalTableFromFile(filePath: string): CalibrationTable | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as CalibrationTable;
    if (!parsed.home?.length || !parsed.draw?.length || !parsed.away?.length) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function getCalTableForCompetition(competitionId: string): CalibrationTable | undefined {
  const now = Date.now();
  const leagueCode = PER_LEAGUE_TABLE_CODES[competitionId];
  const filePath = leagueCode
    ? path.join(CAL_DIR, `v3-iso-calibration-${leagueCode}.json`)
    : CAL_GLOBAL_PATH;

  const cached = _calTables.get(filePath);
  if (cached && now - cached.loadedAt < CAL_TABLE_TTL_MS) return cached.table;

  const table = loadCalTableFromFile(filePath) ?? loadCalTableFromFile(CAL_GLOBAL_PATH);
  if (table) _calTables.set(filePath, { table, loadedAt: now });
  return table;
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Descriptor de una competencia no-FD para la carga de temporada anterior.
 *   provider='openligadb':  usa loadOLGPrevSeason(league, prevYear).
 *   provider='thesportsdb': usa loadSDBPrevSeason(leagueId, providerKey, apiKey, prevYear).
 *   provider='apifootball': usa loadAfHistoricalMatches(leagueId, prevYear, apiKey).
 *                           currentSeasonMatches vienen del DataSource (team IDs consistentes).
 */
export interface NonFdCompDescriptor {
  competitionId: string;
  provider: 'openligadb' | 'thesportsdb' | 'apifootball';
  /** League code para OLG (e.g. 'bl1'), leagueId para SDB (e.g. '4432') o AF (e.g. '140') */
  providerLeagueId: string;
  /** Clave canónica usada en canonicalTeamId (e.g. 'openligadb', 'thesportsdb', 'apifootball') */
  providerKey: string;
  /** API key para SDB o API-Football (ignorado para OLG) */
  sdbApiKey?: string;
  /** API key para API-Football (solo para provider='apifootball') */
  afApiKey?: string;
  /**
   * Partidos esperados por equipo en una temporada completa.
   * Usado para derivar THRESHOLD_ELIGIBLE adaptativo (§14 adaptive).
   * Ejemplos: BL1=34, URU_Clausura=15, ARG_Apertura=19.
   */
  expectedSeasonGames?: number;
}

// ── Module-level prev-season cache (24h TTL) ──────────────────────────────────
// Prevents repeated disk reads / API fetches of immutable prev-season data on
// every scheduler cycle. Key: `{provider}:{leagueId}:{year}`.

const PREV_SEASON_MEM_TTL_MS = 24 * 60 * 60_000; // 24h — prev season is immutable

interface PrevSeasonEntry {
  records:    V3MatchRecord[];
  loadedAt:   number;
}

const _prevSeasonMemCache = new Map<string, PrevSeasonEntry>();

function prevCacheKey(provider: string, leagueId: string, year: number): string {
  return `${provider}:${leagueId}:${year}`;
}

function getPrevFromMem(provider: string, leagueId: string, year: number): V3MatchRecord[] | null {
  const key   = prevCacheKey(provider, leagueId, year);
  const entry = _prevSeasonMemCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.loadedAt > PREV_SEASON_MEM_TTL_MS) {
    _prevSeasonMemCache.delete(key);
    return null;
  }
  return entry.records;
}

function setPrevInMem(provider: string, leagueId: string, year: number, records: V3MatchRecord[]): void {
  _prevSeasonMemCache.set(prevCacheKey(provider, leagueId, year), { records, loadedAt: Date.now() });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derives the leagueCode string from a competitionId for per-liga DC_RHO lookup.
 * Returns undefined for unknown competitions → engine falls back to DC_RHO global.
 */
function deriveLeagueCode(competitionId: string): string | undefined {
  if (competitionId === 'comp:football-data:PD' || competitionId === 'PD') return 'PD';
  if (competitionId === 'comp:football-data:PL' || competitionId === 'PL') return 'PL';
  if (competitionId === 'comp:openligadb:bl1'   || competitionId === 'BL1') return 'BL1';
  if (competitionId === 'comp:thesportsdb:4432')  return 'URU';
  return undefined;
}

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
      // AF canonical competitions: team IDs are `team:apifootball:*`.
      // The FD HistoricalStateService stores `team:football-data:*` IDs — they never match.
      // Use extractFinishedFromDataSource instead to get the correct AF team IDs.
      const isAfCanonical = competitionId.startsWith('comp:apifootball:');
      if (isAfCanonical) {
        allHistorical = extractFinishedFromDataSource(dataSource, seasonId, buildNowUtc);
        console.log(`[V3Runner] AF canonical ${competitionId}: ${allHistorical.length} records from DataSource`);
      } else {
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
      const memCached = getPrevFromMem(desc.provider, desc.providerLeagueId, prevSeasonYear);
      if (memCached !== null) {
        prevSeasonMatches = memCached;
        console.log(`[V3Runner] prevSeason MEM HIT ${desc.provider}/${desc.providerLeagueId}/${prevSeasonYear}: ${memCached.length} records`);
      } else if (desc.provider === 'openligadb') {
        prevSeasonMatches = await loadOLGPrevSeason(desc.providerLeagueId, prevSeasonYear);
        setPrevInMem(desc.provider, desc.providerLeagueId, prevSeasonYear, prevSeasonMatches);
      } else if (desc.provider === 'apifootball') {
        prevSeasonMatches = await loadAfHistoricalMatches(
          Number(desc.providerLeagueId),
          prevSeasonYear,
          desc.afApiKey ?? '',
        );
        setPrevInMem(desc.provider, desc.providerLeagueId, prevSeasonYear, prevSeasonMatches);
      } else {
        prevSeasonMatches = await loadSDBPrevSeason(
          desc.providerLeagueId,
          desc.providerKey,
          desc.sdbApiKey ?? '123',
          prevSeasonYear,
        );
        setPrevInMem(desc.provider, desc.providerLeagueId, prevSeasonYear, prevSeasonMatches);
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

      // SP-V4-10: Fetch market odds before engine run so market-blend step activates.
      // OddsService has a 30-min in-memory cache per sport key, so repeated calls within
      // the same competition batch are free. Fault-isolated: if fetch fails, engine runs
      // with marketOdds=undefined (pure model, no blend).
      let marketOdds: import('@sportpulse/prediction').MarketOddsRecord | undefined;
      if (oddsService && match.startTimeUtc) {
        const homeTeamName = teamNameMap.get(match.homeTeamId) ?? match.homeTeamId;
        const awayTeamName = teamNameMap.get(match.awayTeamId) ?? match.awayTeamId;
        try {
          const fetched = await oddsService.getOddsForMatch(
            competitionId,
            match.startTimeUtc,
            homeTeamName,
            awayTeamName,
          );
          if (fetched) {
            marketOdds = {
              probHome: fetched.probHome,
              probDraw: fetched.probDraw,
              probAway: fetched.probAway,
              capturedAtUtc: fetched.capturedAtUtc,
            };
          }
        } catch {
          marketOdds = undefined; // fault isolation
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
        marketOdds,
        calibrationTable: getCalTableForCompetition(competitionId),
        leagueCode: deriveLeagueCode(competitionId),
        // §SP-V4-23: Pass logistic coefficients if trained model is available.
        // When ENSEMBLE_ENABLED=false (default), the engine ignores this field entirely.
        logisticCoefficients: loadLogisticCoefficients(),
      };

      const output = runV3Engine(input);
      const snapshot = buildSnapshot(match.matchId, competitionId, input, output, 'v3_unified');
      store.save(snapshot);
      predicted++;

      // Freeze snapshot in evaluation store (OE-2 pattern, V3 variant)
      if (evaluationStore) {
        evaluationStore.freezeSnapshot(competitionId, matchRef, snapshot);

        // MKT-T3-02: Attach market odds fire-and-forget — never propagates errors
        // Uses the same OddsService call (cached 30min) to avoid duplicate API requests.
        if (oddsService && output.prob_home_win != null && output.prob_draw != null && output.prob_away_win != null) {
          const evalHomeTeamName = teamNameMap.get(match.homeTeamId) ?? match.homeTeamId;
          const evalAwayTeamName = teamNameMap.get(match.awayTeamId) ?? match.awayTeamId;
          void oddsService.getOddsForMatch(
            competitionId,
            match.startTimeUtc!,
            evalHomeTeamName,
            evalAwayTeamName,
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

  // Persist stores after all matches in this competition (awaited to reduce crash-loss window)
  await store.persist().catch(console.error);
  await evaluationStore?.persist().catch(console.error);

  console.log(
    `[V3Runner] ${logCode} (${strategy}): ${predicted}/${scheduled.length} predictions stored ` +
    `(current=${currentSeasonMatches.length}, prev=${prevSeasonMatches.length})`,
  );
}
