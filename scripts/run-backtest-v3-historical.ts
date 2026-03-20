/**
 * run-backtest-v3-historical.ts — Genera snapshots V3 sobre una temporada histórica.
 *
 * Walk-forward backtest usando runV3Engine (Motor V3 Unificado, sin Elo).
 * Para cada partido M de la temporada objetivo, el motor se invoca con:
 *   - currentSeasonMatches = partidos de la temporada antes de M (anti-lookahead)
 *   - prevSeasonMatches     = todos los partidos de la temporada anterior
 *   - buildNowUtc = kickoffUtc de M (modo backtest, sin lookahead)
 *
 * Diferencia con run-backtest-historical.ts (V1):
 *   - V1 usa PredictionService + Elo explícito desde HistoricalStateService
 *   - V3 usa runV3Engine, estadísticas de goles, shrinkage, H2H, rest, recency
 *   - V3 NO usa Elo en ningún paso
 *
 * Fuentes de datos soportadas:
 *   - football-data.org (FD): ligas europeas clásicas (PD, PL, BL1, SA, FL1, DED, PPL)
 *                             Lee desde football-data API con FOOTBALL_DATA_TOKEN
 *   - TheSportsDB (SDB):      URU — liga Uruguaya
 *                             Lee desde TheSportsDB API con SPORTSDB_API_KEY
 *   - API-Football canonical (AF): ligas AF (CL, AR, BR, MX y sus IDs numéricos)
 *                             Lee desde cache/historical/apifootball/{leagueId}/{year}.json
 *                             Generado por: tools/calibrate-league-report.ts o descarga directa
 *
 * Uso:
 *   pnpm backtest:v3:historical PD 2025
 *   pnpm backtest:v3:historical PD,PL,BL1 2025
 *   pnpm backtest:v3:historical URU 2024   # Liga Uruguaya via TheSportsDB
 *   pnpm backtest:v3:historical CL 2024   # Primera División Chile via AF canonical
 *   pnpm backtest:v3:historical AR 2024   # Liga Argentina via AF canonical
 *
 * Salida: cache/predictions/historical-backtest-v3-{comp}-{year}.json
 *
 * Este archivo es leído por:
 *   - tools/backfill-historical-odds.ts  → descarga odds históricas para las fechas de los partidos
 *   - tools/analyze-blend-accuracy.ts   → compara accuracy modelo solo vs blend con mercado
 */

import 'dotenv/config';

import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord } from '../packages/prediction/src/engine/v3/types.js';
import { loadHistoricalMatches } from '../server/prediction/historical-match-loader.js';
import {
  loadHistoricalMatchesSportsDB,
  SPORTSDB_PROVIDER_KEY,
} from '../server/prediction/historical-match-loader-sportsdb.js';
import type { FinishedMatchRecord } from '@sportpulse/prediction';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Constants ─────────────────────────────────────────────────────────────────

const SPORTSDB_COMPS: Record<string, { leagueId: string; name: string; expectedSeasonGames?: number }> = {
  URU: { leagueId: '4432', name: 'Uruguayan Primera Division', expectedSeasonGames: 15 },
};

/** AF canonical leagues with calendar-year seasons (read from cache/historical/apifootball/). */
const AF_COMPS: Record<string, { leagueId: number; name: string; expectedSeasonGames?: number }> = {
  CL:  { leagueId: 265, name: 'Primera División Chile',    expectedSeasonGames: 30 },
  AR:  { leagueId: 128, name: 'Liga Argentina',            expectedSeasonGames: 19 },
  BR:  { leagueId: 71,  name: 'Brasileirão Série A',       expectedSeasonGames: 38 },
  MX:  { leagueId: 262, name: 'Liga MX',                   expectedSeasonGames: 17 },
  '265': { leagueId: 265, name: 'Primera División Chile',  expectedSeasonGames: 30 },
  '128': { leagueId: 128, name: 'Liga Argentina',          expectedSeasonGames: 19 },
  '71':  { leagueId: 71,  name: 'Brasileirão Série A',     expectedSeasonGames: 38 },
  '262': { leagueId: 262, name: 'Liga MX',                 expectedSeasonGames: 17 },
};

const HIST_AF_BASE = path.resolve(process.cwd(), 'cache/historical/apifootball');

function loadHistoricalAF(leagueId: number, year: number): FinishedMatchRecord[] {
  const file = path.join(HIST_AF_BASE, String(leagueId), `${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    // Stored as { season, matches: V3MatchRecord[] } — shape identical to FinishedMatchRecord
    return (raw?.matches as FinishedMatchRecord[]) ?? [];
  } catch { return []; }
}

// Expected season games per FD competition (used for adaptive eligibility threshold)
const FD_EXPECTED_SEASON_GAMES: Record<string, number> = {
  PD:  38, // LaLiga
  PL:  38, // Premier League
  BL1: 34, // Bundesliga
  SA:  38, // Serie A
  FL1: 38, // Ligue 1
  DED: 34, // Eredivisie
  PPL: 34, // Primeira Liga
};

// ── Season boundary helpers ───────────────────────────────────────────────────

function europeanSeasonBoundaryIso(year: number): string {
  return new Date(Date.UTC(year, 6, 1)).toISOString();
}

function januarySeasonBoundaryIso(year: number): string {
  return new Date(Date.UTC(year, 0, 1)).toISOString();
}

function seasonBoundaryIso(comp: string, year: number): string {
  return comp in SPORTSDB_COMPS
    ? januarySeasonBoundaryIso(year)
    : europeanSeasonBoundaryIso(year);
}

// ── Store (per-competition V3 file) ──────────────────────────────────────────

/** Minimal schema for V3 backtest snapshots. */
interface V3BacktestSnapshot {
  snapshot_id: string;
  source_type: 'HISTORICAL_BACKTEST_V3';
  engine_id: 'v3_unified';
  competition_code: string;
  match_id: string;
  kickoff_utc: string;
  home_team_id: string;
  away_team_id: string;

  // Ground truth
  actual_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  home_goals: number;
  away_goals: number;

  // Sample context
  current_season_matches_available: number;
  prev_season_matches_available: number;
  games_home: number;
  games_away: number;

  // Eligibility
  mode: 'FULL_MODE' | 'LIMITED_MODE' | 'NOT_ELIGIBLE';
  confidence: string;

  // Probabilities (null if NOT_ELIGIBLE)
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  lambda_home: number | null;
  lambda_away: number | null;
  predicted_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null;

  // Warnings/reasons
  warnings: string[];

  build_status: 'SUCCESS' | 'NOT_ELIGIBLE' | 'ERROR';
  error_detail?: string;
  generated_at: string;
}

interface V3BacktestStoreDoc {
  version: 1;
  engine_id: 'v3_unified';
  savedAt: string;
  snapshots: V3BacktestSnapshot[];
}

const OUTPUT_DIR = path.resolve(process.cwd(), 'cache/predictions');

function buildOutputPath(comp: string, seasonYear: number): string {
  return path.join(OUTPUT_DIR, `historical-backtest-v3-${comp.toLowerCase()}-${seasonYear}.json`);
}

function persistV3Snapshots(comp: string, seasonYear: number, snapshots: V3BacktestSnapshot[]): void {
  const doc: V3BacktestStoreDoc = {
    version: 1,
    engine_id: 'v3_unified',
    savedAt: new Date().toISOString(),
    snapshots,
  };
  const outPath = buildOutputPath(comp, seasonYear);
  const tmpPath = outPath + '.tmp';
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 2), 'utf-8');
  fs.renameSync(tmpPath, outPath);
  console.log(`[${comp}] ✓ Guardado: ${outPath}`);
}

// ── V3 backtest for one competition+season ────────────────────────────────────

async function runBacktestForComp(
  comp: string,
  seasonYear: number,
  currentSeasonRaw: FinishedMatchRecord[],
  prevSeasonRaw: FinishedMatchRecord[],
  expectedSeasonGames?: number,
): Promise<void> {
  const toV3Record = (r: FinishedMatchRecord): V3MatchRecord => ({
    homeTeamId: r.homeTeamId,
    awayTeamId: r.awayTeamId,
    utcDate: r.utcDate,
    homeGoals: r.homeGoals,
    awayGoals: r.awayGoals,
  });

  const currentSeason: V3MatchRecord[] = currentSeasonRaw.map(toV3Record);
  const prevSeason:    V3MatchRecord[] = prevSeasonRaw.map(toV3Record);

  // Sort chronologically
  currentSeason.sort((a, b) => a.utcDate.localeCompare(b.utcDate));

  console.log(`[${comp}] Walk-forward backtest: ${currentSeason.length} partidos, prevSeason: ${prevSeason.length}`);

  const snapshots: V3BacktestSnapshot[] = [];
  let processed = 0;

  for (const r of currentSeasonRaw.sort((a, b) => a.utcDate.localeCompare(b.utcDate))) {
    processed++;
    if (processed % 50 === 0 || processed === currentSeasonRaw.length) {
      console.log(`[${comp}] ${processed}/${currentSeasonRaw.length}...`);
    }

    const matchId  = `${r.homeTeamId}:${r.awayTeamId}:${r.utcDate}`;
    const snapId   = `hbt-v3:${comp}:hist:${matchId}`;
    const actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' =
      r.homeGoals > r.awayGoals ? 'HOME_WIN' :
      r.homeGoals < r.awayGoals ? 'AWAY_WIN' : 'DRAW';

    // Anti-lookahead: only matches strictly before this kickoff
    const currentSeasonBefore = currentSeason.filter((m) => m.utcDate < r.utcDate);

    try {
      const output = runV3Engine({
        homeTeamId:            r.homeTeamId,
        awayTeamId:            r.awayTeamId,
        kickoffUtc:            r.utcDate,
        buildNowUtc:           r.utcDate,
        currentSeasonMatches:  currentSeasonBefore,
        prevSeasonMatches:     prevSeason,
        expectedSeasonGames,
      });

      const mode: V3BacktestSnapshot['mode'] =
        output.eligibility === 'ELIGIBLE'  ? 'FULL_MODE'    :
        output.eligibility === 'LIMITED'   ? 'LIMITED_MODE' :
        'NOT_ELIGIBLE';

      snapshots.push({
        snapshot_id:   snapId,
        source_type:   'HISTORICAL_BACKTEST_V3',
        engine_id:     'v3_unified',
        competition_code: comp,
        match_id:      matchId,
        kickoff_utc:   r.utcDate,
        home_team_id:  r.homeTeamId,
        away_team_id:  r.awayTeamId,
        actual_result: actual,
        home_goals:    r.homeGoals,
        away_goals:    r.awayGoals,
        current_season_matches_available: currentSeasonBefore.length,
        prev_season_matches_available:    prevSeason.length,
        games_home:    output.explanation.games_home,
        games_away:    output.explanation.games_away,
        mode,
        confidence:    output.confidence,
        p_home_win:    output.prob_home_win,
        p_draw:        output.prob_draw,
        p_away_win:    output.prob_away_win,
        lambda_home:   output.lambda_home,
        lambda_away:   output.lambda_away,
        predicted_result: output.predicted_result,
        warnings:      output.warnings,
        build_status:  mode === 'NOT_ELIGIBLE' ? 'NOT_ELIGIBLE' : 'SUCCESS',
        generated_at:  new Date().toISOString(),
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${comp}] Error ${r.homeTeamId} vs ${r.awayTeamId}: ${msg}`);
      snapshots.push({
        snapshot_id:   snapId,
        source_type:   'HISTORICAL_BACKTEST_V3',
        engine_id:     'v3_unified',
        competition_code: comp,
        match_id:      matchId,
        kickoff_utc:   r.utcDate,
        home_team_id:  r.homeTeamId,
        away_team_id:  r.awayTeamId,
        actual_result: actual,
        home_goals:    r.homeGoals,
        away_goals:    r.awayGoals,
        current_season_matches_available: currentSeason.filter((m) => m.utcDate < r.utcDate).length,
        prev_season_matches_available:    prevSeason.length,
        games_home:    0,
        games_away:    0,
        mode:          'NOT_ELIGIBLE',
        confidence:    'LOW',
        p_home_win:    null,
        p_draw:        null,
        p_away_win:    null,
        lambda_home:   null,
        lambda_away:   null,
        predicted_result: null,
        warnings:      [],
        build_status:  'ERROR',
        error_detail:  msg,
        generated_at:  new Date().toISOString(),
      });
    }
  }

  // Summary
  const byMode: Record<string, number> = {};
  for (const s of snapshots) byMode[s.mode] = (byMode[s.mode] ?? 0) + 1;
  const eligible = snapshots.filter((s) => s.build_status === 'SUCCESS');
  const withPred = eligible.filter((s) => s.predicted_result !== null);

  console.log(`[${comp}] ✓ ${snapshots.length} snapshots`);
  console.log(`[${comp}]   Modos: ${JSON.stringify(byMode)}`);
  console.log(`[${comp}]   Elegibles: ${eligible.length}  con prediccion: ${withPred.length}`);

  persistV3Snapshots(comp, seasonYear, snapshots);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiToken    = process.env.FOOTBALL_DATA_TOKEN ?? '';
  const sportsdbKey = process.env.SPORTSDB_API_KEY ?? '1';

  const comps = (process.argv[2] ?? 'PD').split(',').map((c) => c.trim().toUpperCase());
  const seasonYear = parseInt(
    process.argv[3] ??
      String(new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0)),
    10,
  );

  console.log(`\nV3 Historical Backtest (runV3Engine — sin Elo)`);
  console.log(`Competencias: ${comps.join(', ')}   Temporada: ${seasonYear}`);

  for (const comp of comps) {
    const afConfig   = AF_COMPS[comp];
    const sdbConfig  = afConfig == null ? SPORTSDB_COMPS[comp] : undefined;
    const isSportsDB = sdbConfig != null;

    const boundary     = seasonBoundaryIso(comp, seasonYear);
    const nextBoundary = isSportsDB
      ? januarySeasonBoundaryIso(seasonYear + 1)
      : europeanSeasonBoundaryIso(seasonYear + 1);
    const prevBoundary = isSportsDB
      ? januarySeasonBoundaryIso(seasonYear - 1)
      : europeanSeasonBoundaryIso(seasonYear - 1);

    console.log(`\n[${comp}] Cargando histórico... (provider: ${isSportsDB ? 'thesportsdb' : 'football-data'})`);

    let allCurrentRaw: FinishedMatchRecord[];
    let allPrevRaw:    FinishedMatchRecord[];

    try {
      if (afConfig != null) {
        // AF canonical: read from cache/historical/apifootball/{leagueId}/{year}.json
        allCurrentRaw = loadHistoricalAF(afConfig.leagueId, seasonYear);
        allPrevRaw    = loadHistoricalAF(afConfig.leagueId, seasonYear - 1);
      } else if (isSportsDB) {
        if (!sdbConfig) continue;
        // Current season
        allCurrentRaw = await loadHistoricalMatchesSportsDB(sdbConfig.leagueId, seasonYear, { apiKey: sportsdbKey });
        // Previous season
        try {
          allPrevRaw = await loadHistoricalMatchesSportsDB(sdbConfig.leagueId, seasonYear - 1, { apiKey: sportsdbKey });
        } catch {
          allPrevRaw = [];
        }
      } else {
        if (!apiToken) {
          console.error(`[${comp}] ERROR: FOOTBALL_DATA_TOKEN no configurado`);
          continue;
        }
        // Load both seasons (current year has prev season data too via the loader's lookback)
        const allMatches = await loadHistoricalMatches(comp, seasonYear, { apiToken });
        allCurrentRaw = allMatches.filter((r) => r.utcDate >= boundary && r.utcDate < nextBoundary);
        allPrevRaw    = allMatches.filter((r) => r.utcDate >= prevBoundary && r.utcDate < boundary);
      }
    } catch (err) {
      console.error(`[${comp}] ERROR cargando histórico:`, err);
      continue;
    }

    const currentSeason = allCurrentRaw.sort((a, b) => a.utcDate.localeCompare(b.utcDate));
    const prevSeason    = allPrevRaw.sort((a, b) => a.utcDate.localeCompare(b.utcDate));

    console.log(`[${comp}] Temporada ${seasonYear}: ${currentSeason.length} partidos`);
    console.log(`[${comp}] Temporada anterior: ${prevSeason.length} partidos`);

    if (currentSeason.length === 0) {
      console.warn(`[${comp}] Sin partidos en temporada ${seasonYear}. Verifica el año o la caché.`);
      continue;
    }

    const expectedSeasonGames = afConfig != null
      ? afConfig.expectedSeasonGames
      : isSportsDB
        ? sdbConfig?.expectedSeasonGames
        : FD_EXPECTED_SEASON_GAMES[comp];

    await runBacktestForComp(comp, seasonYear, currentSeason, prevSeason, expectedSeasonGames);
  }

  console.log('\n✓ Backtest V3 completo.');
  console.log('  Para evaluar los resultados, correr el evaluador en los archivos generados.');
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
