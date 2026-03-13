/**
 * run-backtest-historical.ts — Genera snapshots V1 sobre una temporada histórica.
 *
 * Replica la lógica de HistoricalBacktestRunner pero usando el historical-match-loader
 * (caché de disco + API histórica) en lugar de FootballDataSource (solo temporada actual).
 *
 * Uso:
 *   pnpm backtest:v1:historical PD 2024
 *   pnpm backtest:v1:historical PL 2024
 *   pnpm backtest:v1:historical PD,PL 2024
 *   pnpm backtest:v1:historical URU 2024   # Liga Uruguaya via TheSportsDB
 *
 * Requiere: FOOTBALL_DATA_TOKEN y SPORTSDB_API_KEY en .env
 * Salida: cache/predictions/historical-backtest.json (reemplaza por competencia+temporada)
 *
 * NOTA: El matchId en los snapshots V1 usa el mismo formato que V2
 *   (`${homeTeamId}:${awayTeamId}:${utcDate}`) para que la intersección
 *   en validate:v2:segmented funcione correctamente.
 */

import 'dotenv/config';

import { loadHistoricalMatches } from '../server/prediction/historical-match-loader.js';
import {
  loadHistoricalMatchesSportsDB,
  SPORTSDB_PROVIDER_KEY,
} from '../server/prediction/historical-match-loader-sportsdb.js';
import { HistoricalStateService } from '../server/prediction/historical-state-service.js';
import { computePreMatchTeamState } from '@sportpulse/prediction';
import { PredictionService }      from '../server/prediction/prediction-service.js';
import {
  HistoricalBacktestStore,
  type HistoricalBacktestSnapshot,
} from '../server/prediction/historical-backtest-store.js';
import { buildMatchInput } from '../server/prediction/match-input-adapter.js';
import type { Match, Competition, Season } from '@sportpulse/canonical';
import type { FinishedMatchRecord } from '@sportpulse/prediction';

// ── URU config ────────────────────────────────────────────────────────────────

/** Competition codes that use TheSportsDB instead of football-data.org. */
const SPORTSDB_COMPS: Record<string, { leagueId: string; name: string }> = {
  URU: { leagueId: '4432', name: 'Uruguayan Primera Division' },
};

// ── Season boundary ───────────────────────────────────────────────────────────

/** European leagues: season starts July 1. */
function europeanSeasonBoundaryIso(year: number): string {
  return new Date(Date.UTC(year, 6, 1)).toISOString();
}

/** URU and other January-based leagues: season starts January 1. */
function januarySeasonBoundaryIso(year: number): string {
  return new Date(Date.UTC(year, 0, 1)).toISOString();
}

function seasonBoundaryIso(comp: string, year: number): string {
  return comp in SPORTSDB_COMPS
    ? januarySeasonBoundaryIso(year)
    : europeanSeasonBoundaryIso(year);
}

// ── extractProbs — mismo contrato que en historical-backtest-runner.ts ────────

function extractProbs(response: unknown): {
  p_home_win:          number | null;
  p_draw:              number | null;
  p_away_win:          number | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  predicted_result:    string | null;
  mode:                string;
  reasons:             string[];
  raw_p_home_win:      number | null;
  raw_p_draw:          number | null;
  raw_p_away_win:      number | null;
  lambda_home:         number | null;
  lambda_away:         number | null;
  effective_elo_home:  number | null;
  effective_elo_away:  number | null;
  calibration_mode:    string | null;
} {
  const r   = response as Record<string, unknown> | null | undefined;
  const mode = typeof r?.['operating_mode'] === 'string'
    ? (r['operating_mode'] as string)
    : typeof r?.['eligibility_status'] === 'string'
      ? (r['eligibility_status'] as string)
      : 'UNKNOWN';

  const predictions = r?.['predictions'] as Record<string, unknown> | null | undefined;
  const core        = predictions?.['core'] as Record<string, unknown> | null | undefined;
  const rawReasons  = r?.['reasons'];
  const reasons     = Array.isArray(rawReasons) ? (rawReasons as string[]) : [];
  const internals   = r?.['internals'] as Record<string, unknown> | null | undefined;
  const rawProbs    = internals?.['raw_1x2_probs'] as Record<string, unknown> | null | undefined;

  return {
    p_home_win:          typeof core?.['p_home_win']          === 'number' ? core['p_home_win']          : null,
    p_draw:              typeof core?.['p_draw']              === 'number' ? core['p_draw']              : null,
    p_away_win:          typeof core?.['p_away_win']          === 'number' ? core['p_away_win']          : null,
    expected_goals_home: typeof core?.['expected_goals_home'] === 'number' ? core['expected_goals_home'] : null,
    expected_goals_away: typeof core?.['expected_goals_away'] === 'number' ? core['expected_goals_away'] : null,
    predicted_result:    typeof core?.['predicted_result']    === 'string' ? core['predicted_result']    : null,
    mode,
    reasons,
    raw_p_home_win: typeof rawProbs?.['home'] === 'number' ? rawProbs['home'] : null,
    raw_p_draw:     typeof rawProbs?.['draw'] === 'number' ? rawProbs['draw'] : null,
    raw_p_away_win: typeof rawProbs?.['away'] === 'number' ? rawProbs['away'] : null,
    lambda_home:        typeof internals?.['lambda_home']    === 'number' ? internals['lambda_home']    : null,
    lambda_away:        typeof internals?.['lambda_away']    === 'number' ? internals['lambda_away']    : null,
    effective_elo_home: typeof internals?.['elo_home_pre']   === 'number' ? internals['elo_home_pre']   : null,
    effective_elo_away: typeof internals?.['elo_away_pre']   === 'number' ? internals['elo_away_pre']   : null,
    calibration_mode:   typeof internals?.['calibration_mode'] === 'string' ? internals['calibration_mode'] : null,
  };
}

function normalizePredictedResult(
  predicted: string | null,
): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (predicted === 'HOME') return 'HOME_WIN';
  if (predicted === 'AWAY') return 'AWAY_WIN';
  if (predicted === 'DRAW') return 'DRAW';
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apiToken    = process.env.FOOTBALL_DATA_TOKEN ?? '';
  const sportsdbKey = process.env.SPORTSDB_API_KEY ?? '1';

  const comps = (process.argv[2] ?? 'PD').split(',').map((c) => c.trim().toUpperCase());
  const seasonYear = parseInt(
    process.argv[3] ??
      String(new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0)),
    10,
  );

  console.log(`\nV1 Historical Backtest`);
  console.log(`Competencias: ${comps.join(', ')}   Temporada: ${seasonYear}`);

  const predictionService      = new PredictionService();
  const historicalStateService = apiToken ? new HistoricalStateService({ apiToken }) : null;
  const store                  = new HistoricalBacktestStore();

  for (const comp of comps) {
    const sdbConfig = SPORTSDB_COMPS[comp];
    const isSportsDB = sdbConfig != null;

    const providerKey   = isSportsDB ? SPORTSDB_PROVIDER_KEY : 'football-data';
    const competitionId = isSportsDB
      ? `comp:${SPORTSDB_PROVIDER_KEY}:${sdbConfig.leagueId}`
      : `comp:football-data:${comp}`;
    const seasonId = isSportsDB
      ? `season:${SPORTSDB_PROVIDER_KEY}:${sdbConfig.leagueId}-${seasonYear}`
      : `season:football-data:${comp}:${seasonYear}`;
    const boundary = seasonBoundaryIso(comp, seasonYear);
    const nextBoundary = isSportsDB
      ? januarySeasonBoundaryIso(seasonYear + 1)
      : europeanSeasonBoundaryIso(seasonYear + 1);

    console.log(`\n[${comp}] Cargando histórico... (provider: ${providerKey})`);
    let allMatches: FinishedMatchRecord[];
    try {
      if (isSportsDB) {
        allMatches = await loadHistoricalMatchesSportsDB(sdbConfig.leagueId, seasonYear, {
          apiKey: sportsdbKey,
        });
      } else {
        if (!apiToken) {
          console.error(`[${comp}] ERROR: FOOTBALL_DATA_TOKEN no configurado`);
          continue;
        }
        allMatches = await loadHistoricalMatches(comp, seasonYear, { apiToken });
      }
    } catch (err) {
      console.error(`[${comp}] ERROR cargando histórico:`, err);
      continue;
    }

    // Solo partidos de la temporada objetivo
    const currentSeason = allMatches
      .filter((r) => r.utcDate >= boundary && r.utcDate < nextBoundary)
      .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

    console.log(`[${comp}] ${currentSeason.length} partidos en temporada ${seasonYear}`);

    if (currentSeason.length === 0) {
      console.warn(`[${comp}] Sin partidos. Verifica el año.`);
      continue;
    }

    // Pre-warm historical state para FD competitions
    if (!isSportsDB && historicalStateService) {
      console.log(`[${comp}] Pre-warming historical state...`);
      await historicalStateService.warmUp(comp, seasonYear);
    }

    // Para TheSportsDB: pre-computar el Elo replay directamente
    // (HistoricalStateService es FD-only; para SDB usamos computePreMatchTeamState directo)
    const sdbAllMatches = isSportsDB ? allMatches : null;

    // Objetos mínimos de competencia y temporada para buildMatchInput
    const competition: Competition = {
      competitionId,
      sportId:               'FOOTBALL',
      providerKey,
      providerCompetitionCode: isSportsDB ? sdbConfig.leagueId : comp,
      name:                  isSportsDB ? sdbConfig.name : comp,
      formatType:            'LEAGUE',
      isEnabled:             true,
    };
    const seasonLabel = isSportsDB
      ? String(seasonYear)
      : `${seasonYear}-${String(seasonYear + 1).slice(2)}`;
    const season: Season = {
      seasonId,
      competitionId,
      label:     seasonLabel,
      startDate: boundary.slice(0, 10),
      endDate:   '',
    };

    const newSnapshots: HistoricalBacktestSnapshot[] = [];
    let processed = 0;

    for (const r of currentSeason) {
      processed++;
      if (processed % 50 === 0 || processed === currentSeason.length) {
        console.log(`[${comp}] ${processed}/${currentSeason.length}...`);
      }

      // matchId en formato idéntico al de V2 — necesario para la intersección
      const matchId   = `${r.homeTeamId}:${r.awayTeamId}:${r.utcDate}`;
      const snapId    = `hbt:${comp}:hist:${matchId}`;
      const actual:   'HOME_WIN' | 'DRAW' | 'AWAY_WIN' =
        r.homeGoals > r.awayGoals ? 'HOME_WIN' :
        r.homeGoals < r.awayGoals ? 'AWAY_WIN' : 'DRAW';

      try {
        // Reconstruir estado pre-partido con Elo histórico
        let teamState;
        if (isSportsDB && sdbAllMatches) {
          // Para TheSportsDB: usar computePreMatchTeamState directamente con todos los datos cargados
          teamState = computePreMatchTeamState(sdbAllMatches, r.homeTeamId, r.awayTeamId, r.utcDate);
        } else if (historicalStateService) {
          teamState = await historicalStateService.getPreMatchTeamState(
            comp, seasonYear,
            r.homeTeamId, r.awayTeamId,
            r.utcDate,
          );
        } else {
          throw new Error('No history service available');
        }

        // Objeto Match mínimo compatible con buildMatchInput
        const match: Match = {
          matchId,
          seasonId,
          startTimeUtc:    r.utcDate,
          status:          'FINISHED' as any,  // eslint-disable-line @typescript-eslint/no-explicit-any
          homeTeamId:      r.homeTeamId,
          awayTeamId:      r.awayTeamId,
          scoreHome:       r.homeGoals,
          scoreAway:       r.awayGoals,
          providerKey,
          providerMatchId: matchId,
          lastSeenUtc:     r.utcDate,
          stageId:         null,
          groupId:         null,
        };

        const matchCounts = {
          home: { completed_365d: teamState.homeTeam.completedMatches365d },
          away: { completed_365d: teamState.awayTeam.completedMatches365d },
        };

        const adapterResult = buildMatchInput(match, competition, season, matchCounts);

        if (!adapterResult.ok) {
          newSnapshots.push({
            snapshot_id: snapId, source_type: 'HISTORICAL_BACKTEST',
            competition_code: comp, match_id: matchId, kickoff_utc: r.utcDate,
            home_team_id: r.homeTeamId, away_team_id: r.awayTeamId,
            actual_result: actual, home_goals: r.homeGoals, away_goals: r.awayGoals,
            as_of_quality: teamState.dataCompleteness,
            elo_home_pre: teamState.homeTeam.eloRating,
            elo_away_pre: teamState.awayTeam.eloRating,
            elo_home_update_count: teamState.homeTeam.updateCount,
            elo_away_update_count: teamState.awayTeam.updateCount,
            matches_365d_home: teamState.homeTeam.completedMatches365d,
            matches_365d_away: teamState.awayTeam.completedMatches365d,
            total_historical_matches: teamState.totalHistoricalMatches,
            mode: 'NOT_ELIGIBLE', predicted_result: null,
            p_home_win: null, p_draw: null, p_away_win: null,
            expected_goals_home: null, expected_goals_away: null,
            reasons: [`ADAPTER_FAILED: ${adapterResult.reason}`],
            baseline_predicted_result: null,
            baseline_p_home_win: null, baseline_p_draw: null, baseline_p_away_win: null,
            build_status: 'ERROR', error_detail: `adapter: ${adapterResult.reason}`,
            generated_at: new Date().toISOString(),
          });
          continue;
        }

        // Predicción V1 con Elo histórico real
        const histResponse = await predictionService.predict(
          adapterResult.input,
          { home: teamState.homeTeam.eloRating, away: teamState.awayTeam.eloRating },
        );
        const hist = extractProbs(histResponse);

        // Predicción baseline con Elo simétrico (DEFAULT_ELO)
        const baseResponse = await predictionService.predict(adapterResult.input);
        const base = extractProbs(baseResponse);

        newSnapshots.push({
          snapshot_id: snapId, source_type: 'HISTORICAL_BACKTEST',
          competition_code: comp, match_id: matchId, kickoff_utc: r.utcDate,
          home_team_id: r.homeTeamId, away_team_id: r.awayTeamId,
          actual_result: actual, home_goals: r.homeGoals, away_goals: r.awayGoals,
          as_of_quality: teamState.dataCompleteness,
          elo_home_pre: teamState.homeTeam.eloRating,
          elo_away_pre: teamState.awayTeam.eloRating,
          elo_home_update_count: teamState.homeTeam.updateCount,
          elo_away_update_count: teamState.awayTeam.updateCount,
          matches_365d_home: teamState.homeTeam.completedMatches365d,
          matches_365d_away: teamState.awayTeam.completedMatches365d,
          total_historical_matches: teamState.totalHistoricalMatches,
          mode:             hist.mode,
          predicted_result: normalizePredictedResult(hist.predicted_result),
          p_home_win:       hist.p_home_win,
          p_draw:           hist.p_draw,
          p_away_win:       hist.p_away_win,
          expected_goals_home: hist.expected_goals_home,
          expected_goals_away: hist.expected_goals_away,
          reasons:          hist.reasons,
          raw_p_home_win:   hist.raw_p_home_win,
          raw_p_draw:       hist.raw_p_draw,
          raw_p_away_win:   hist.raw_p_away_win,
          lambda_home:      hist.lambda_home,
          lambda_away:      hist.lambda_away,
          effective_elo_home: hist.effective_elo_home,
          effective_elo_away: hist.effective_elo_away,
          calibration_mode: hist.calibration_mode,
          baseline_predicted_result: normalizePredictedResult(base.predicted_result),
          baseline_p_home_win: base.p_home_win,
          baseline_p_draw:     base.p_draw,
          baseline_p_away_win: base.p_away_win,
          build_status: hist.mode === 'NOT_ELIGIBLE' ? 'NOT_ELIGIBLE' : 'SUCCESS',
          generated_at: new Date().toISOString(),
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${comp}] Error ${r.homeTeamId} vs ${r.awayTeamId}: ${msg}`);
        newSnapshots.push({
          snapshot_id: snapId, source_type: 'HISTORICAL_BACKTEST',
          competition_code: comp, match_id: matchId, kickoff_utc: r.utcDate,
          home_team_id: r.homeTeamId, away_team_id: r.awayTeamId,
          actual_result: actual, home_goals: r.homeGoals, away_goals: r.awayGoals,
          as_of_quality: 'BOOTSTRAP', elo_home_pre: 1500, elo_away_pre: 1500,
          elo_home_update_count: 0, elo_away_update_count: 0,
          matches_365d_home: 0, matches_365d_away: 0, total_historical_matches: 0,
          mode: 'ERROR', predicted_result: null,
          p_home_win: null, p_draw: null, p_away_win: null,
          expected_goals_home: null, expected_goals_away: null,
          reasons: [], baseline_predicted_result: null,
          baseline_p_home_win: null, baseline_p_draw: null, baseline_p_away_win: null,
          build_status: 'ERROR', error_detail: msg,
          generated_at: new Date().toISOString(),
        });
      }
    }

    // Persistir (reemplaza solo los snapshots de esta competencia+temporada)
    store.replaceForCompetitionSeason(comp, seasonYear, newSnapshots);
    await store.persist();

    // Resumen
    const modes: Record<string, number> = {};
    for (const s of newSnapshots) modes[s.mode] = (modes[s.mode] ?? 0) + 1;
    const eligible = newSnapshots.filter((s) => s.build_status === 'SUCCESS');
    const withRaw  = eligible.filter((s) => s.raw_p_home_win != null);

    console.log(`[${comp}] ✓ ${newSnapshots.length} snapshots generados`);
    console.log(`[${comp}]   Modos: ${JSON.stringify(modes)}`);
    console.log(`[${comp}]   Elegibles: ${eligible.length}  con raw_probs: ${withRaw.length}`);
  }

  console.log('\n✓ Listo. Correr ahora:');
  console.log(`  pnpm validate:v2:segmented ${comps.join(',')} ${seasonYear}`);
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
