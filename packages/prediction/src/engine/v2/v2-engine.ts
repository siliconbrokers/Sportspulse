/**
 * v2-engine.ts — Orquestador del Motor Predictivo V2.
 *
 * Pipeline completo por §2–§16:
 *   1. Anti-lookahead filter
 *   2. League baselines (§4.3)
 *   3. Team stats — temporada actual (§4.1)
 *   4. Observed rates (§5)
 *   5. Eligibility (§13)  ← early exit en NOT_ELIGIBLE
 *   6. Prior estructural — temporada anterior (§6)
 *   7. Shrinkage → effective rates (§7)
 *   8. Rival-adjusted signals (§8)
 *   9. Recency deltas (§9)
 *  10. Effective forces (§10)
 *  11. Lambdas V2 (§11)
 *  12. Poisson 1X2 (§12)
 *  13. Confidence (§14)
 *  14. Output completo (§16)
 *
 * Función pura. Sin IO. Sin timestamps de entorno. Determinista.
 *
 * INVARIANTES:
 *   - Sin Elo en ningún paso.
 *   - Sin "equipo grande" como bonus manual.
 *   - Anti-lookahead: solo utcDate < kickoffUtc.
 *   - NOT_ELIGIBLE no devuelve probabilidades.
 *
 * FUERA DE ALCANCE (declarado explícitamente — §17):
 *   §17 walk-forward validation (Log Loss, Brier Score, calibración por buckets,
 *   draw rate real vs predicha) NO está implementado en esta iteración.
 *   Este motor produce probabilidades sin medición de calidad predictiva temporal.
 *   Cualquier claim de conformidad total con la spec está condicionado a este gap.
 *   Tarea pendiente: implementar walk-forward validation antes de producción real.
 */

import type {
  V2EngineInput,
  V2PredictionOutput,
  SampleSizeEffect,
  PriorQuality,
  PriorSource,
} from './types.js';
import { computeTeamStats, computeObservedRates, computeLeagueBaselines } from './stats-builder.js';
import { buildTeamPrior } from './prior-builder.js';
import { computeEffectiveRates } from './shrinkage.js';
import { computeMatchSignals, getRivalBaseline } from './rival-adjustment.js';
import { computeRecentFormDeltas } from './recency.js';
import { computeV2Lambdas } from './lambda-v2.js';
import { computeV2Eligibility } from './eligibility-v2.js';
import { computeV2Confidence } from './confidence-v2.js';
import { computePoissonProbs } from './poisson-v2.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clasifica efecto de muestra por PJ mínimo entre los dos equipos. */
function classifySampleSize(home_pj: number, away_pj: number): SampleSizeEffect {
  const min_pj = Math.min(home_pj, away_pj);
  if (min_pj >= 15) return 'HIGH';
  if (min_pj >= 7) return 'MEDIUM';
  return 'LOW';
}

/** Calidad de prior agregada: retorna la peor de los dos equipos. */
const PRIOR_QUALITY_ORDER: Record<PriorQuality, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

function worstPriorQuality(a: PriorQuality, b: PriorQuality): PriorQuality {
  return PRIOR_QUALITY_ORDER[a] <= PRIOR_QUALITY_ORDER[b] ? a : b;
}

/**
 * Fuente de prior agregada: retorna la menos informativa de los dos equipos.
 * Orden de degradación: PREV_SEASON > PARTIAL > LOWER_DIVISION > LEAGUE_BASELINE.
 * Usar la peor es conservador y honesto: si uno de los equipos carece de prior,
 * el partido no tiene prior completo.
 */
const PRIOR_SOURCE_ORDER: Record<PriorSource, number> = {
  PREV_SEASON: 3,
  PARTIAL: 2,
  LOWER_DIVISION: 1,
  LEAGUE_BASELINE: 0,
};

function worstPriorSource(a: PriorSource, b: PriorSource): PriorSource {
  return PRIOR_SOURCE_ORDER[a] <= PRIOR_SOURCE_ORDER[b] ? a : b;
}

// ── Output NOT_ELIGIBLE ────────────────────────────────────────────────────────

function buildNotEligibleOutput(reason: string): V2PredictionOutput {
  void reason; // para trazabilidad futura
  return {
    engine_version: 'v2_structural_attack_defense',
    eligibility_status: 'NOT_ELIGIBLE',
    confidence_level: 'INSUFFICIENT',
    prior_quality: 'NONE',
    prior_source: 'LEAGUE_BASELINE' as PriorSource,
    lambda_home: 0,
    lambda_away: 0,
    prob_home_win: 0,
    prob_draw: 0,
    prob_away_win: 0,
    explanation: {
      effective_attack_home: 0,
      effective_defense_home: 0,
      effective_attack_away: 0,
      effective_defense_away: 0,
      recent_attack_delta_home: 1.0,
      recent_defense_delta_home: 1.0,
      recent_attack_delta_away: 1.0,
      recent_defense_delta_away: 1.0,
      sample_size_effect: 'LOW',
      rival_adjustment_used: false,
      recent_form_used: false,
      prior_quality_home: 'NONE',
      prior_quality_away: 'NONE',
      prior_source_home: 'LEAGUE_BASELINE' as PriorSource,
      prior_source_away: 'LEAGUE_BASELINE' as PriorSource,
    },
  };
}

// ── Motor principal ────────────────────────────────────────────────────────────

/**
 * Ejecuta el pipeline completo V2 para un partido.
 *
 * @param input  Contiene homeTeamId, awayTeamId, kickoffUtc y partidos históricos.
 * @returns      V2PredictionOutput con todos los campos obligatorios.
 */
export function runV2Engine(input: V2EngineInput): V2PredictionOutput {
  const { homeTeamId, awayTeamId, kickoffUtc, currentSeasonMatches, prevSeasonMatches } = input;

  // ── Paso 1: Anti-lookahead ────────────────────────────────────────────────
  // Excluir el partido objetivo. Prev season ya es pasado → no filtrar.
  const currentFiltered = currentSeasonMatches.filter((m) => m.utcDate < kickoffUtc);

  // ── Paso 2: League baselines ─────────────────────────────────────────────
  const baselines = computeLeagueBaselines(currentFiltered);

  // ── Paso 3: Team stats ───────────────────────────────────────────────────
  const homeStats = computeTeamStats(currentFiltered, homeTeamId);
  const awayStats = computeTeamStats(currentFiltered, awayTeamId);

  // ── Paso 4: Observed rates ────────────────────────────────────────────────
  const homeRates = computeObservedRates(homeStats);
  const awayRates = computeObservedRates(awayStats);

  // ── Paso 5: Eligibility ───────────────────────────────────────────────────
  const eligibility = computeV2Eligibility(homeStats.pj_total, awayStats.pj_total, baselines);

  if (eligibility.status === 'NOT_ELIGIBLE') {
    return buildNotEligibleOutput(eligibility.reason);
  }

  // ── Paso 6: Prior estructural ─────────────────────────────────────────────
  const homePrior = buildTeamPrior(prevSeasonMatches, homeTeamId, baselines);
  const awayPrior = buildTeamPrior(prevSeasonMatches, awayTeamId, baselines);

  // ── Paso 7: Shrinkage → effective rates ──────────────────────────────────
  // home equipo juega como local, away equipo juega como visitante
  const homeEff = computeEffectiveRates(homeStats, homeRates, homePrior, true);
  const awayEff = computeEffectiveRates(awayStats, awayRates, awayPrior, false);

  // ── Paso 8: Rival-adjusted signals ───────────────────────────────────────
  // Para cada partido, la señal se ajusta por la baseline del rival.
  // Jerarquía (§8.2): current season stats → rival prior → league baseline.
  const opponentStatsCache = new Map<string, ReturnType<typeof computeTeamStats>>();
  const opponentPriorCache = new Map<string, ReturnType<typeof buildTeamPrior>>();

  function getOpponentContext(
    opponentId: string,
    opponentIsHome: boolean,
  ): { attack_baseline: number; defense_baseline: number } {
    if (!opponentStatsCache.has(opponentId)) {
      opponentStatsCache.set(opponentId, computeTeamStats(currentFiltered, opponentId));
    }
    if (!opponentPriorCache.has(opponentId)) {
      opponentPriorCache.set(opponentId, buildTeamPrior(prevSeasonMatches, opponentId, baselines));
    }
    const oppStats = opponentStatsCache.get(opponentId)!;
    const oppPrior = opponentPriorCache.get(opponentId)!;
    return getRivalBaseline(
      oppStats.pj_total > 0 ? oppStats : null,
      oppPrior.prior_quality !== 'NONE' ? oppPrior : null,
      baselines,
      opponentIsHome,
    );
  }

  const homeSignals = computeMatchSignals(currentFiltered, homeTeamId, getOpponentContext);
  const awaySignals = computeMatchSignals(currentFiltered, awayTeamId, getOpponentContext);
  const rivalAdjustmentUsed = homeSignals.length > 0 || awaySignals.length > 0;

  // ── Paso 9: Recency ───────────────────────────────────────────────────────
  // Ordenar señales cronológicamente antes de pasar a recency
  const homeSignalsSorted = [...homeSignals].sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  const awaySignalsSorted = [...awaySignals].sort((a, b) => a.utcDate.localeCompare(b.utcDate));

  const homeRecency = computeRecentFormDeltas(homeSignalsSorted);
  const awayRecency = computeRecentFormDeltas(awaySignalsSorted);
  const recentFormUsed = homeRecency.n_recent > 0 || awayRecency.n_recent > 0;

  // ── Paso 10 → 11: Lambdas ─────────────────────────────────────────────────
  const lambdaResult = computeV2Lambdas({
    league_home_goals_pg: baselines.league_home_goals_pg,
    league_away_goals_pg: baselines.league_away_goals_pg,
    effective_attack_home: homeEff.effective_attack,
    effective_defense_home: homeEff.effective_defense,
    effective_attack_away: awayEff.effective_attack,
    effective_defense_away: awayEff.effective_defense,
    effective_recent_attack_delta_home: homeRecency.effective_recent_attack_delta,
    effective_recent_defense_delta_home: homeRecency.effective_recent_defense_delta,
    effective_recent_attack_delta_away: awayRecency.effective_recent_attack_delta,
    effective_recent_defense_delta_away: awayRecency.effective_recent_defense_delta,
  });

  // ── Paso 12: Poisson 1X2 ─────────────────────────────────────────────────
  const poisson = computePoissonProbs(lambdaResult.lambda_home, lambdaResult.lambda_away);

  // ── Paso 13: Confidence ───────────────────────────────────────────────────
  const confidence = computeV2Confidence({
    home_pj: homeStats.pj_total,
    away_pj: awayStats.pj_total,
    home_pj_context: homeStats.pj_home,
    away_pj_context: awayStats.pj_away,
    prior_quality_home: homePrior.prior_quality,
    prior_quality_away: awayPrior.prior_quality,
    n_recent_home: homeRecency.n_recent,
    n_recent_away: awayRecency.n_recent,
    rival_adjustment_used: rivalAdjustmentUsed,
  });

  // ── Paso 14: Output ───────────────────────────────────────────────────────
  const aggPriorQuality = worstPriorQuality(homePrior.prior_quality, awayPrior.prior_quality);
  // Fuente más degradada de los dos: si alguno carece de prior real, el partido tampoco lo tiene.
  const aggPriorSource = worstPriorSource(homePrior.prior_source, awayPrior.prior_source);

  return {
    engine_version: 'v2_structural_attack_defense',
    eligibility_status: eligibility.status,
    confidence_level: confidence,
    prior_quality: aggPriorQuality,
    prior_source: aggPriorSource,
    lambda_home: lambdaResult.lambda_home,
    lambda_away: lambdaResult.lambda_away,
    prob_home_win: poisson.prob_home_win,
    prob_draw: poisson.prob_draw,
    prob_away_win: poisson.prob_away_win,
    explanation: {
      effective_attack_home: homeEff.effective_attack,
      effective_defense_home: homeEff.effective_defense,
      effective_attack_away: awayEff.effective_attack,
      effective_defense_away: awayEff.effective_defense,
      recent_attack_delta_home: homeRecency.effective_recent_attack_delta,
      recent_defense_delta_home: homeRecency.effective_recent_defense_delta,
      recent_attack_delta_away: awayRecency.effective_recent_attack_delta,
      recent_defense_delta_away: awayRecency.effective_recent_defense_delta,
      sample_size_effect: classifySampleSize(homeStats.pj_total, awayStats.pj_total),
      rival_adjustment_used: rivalAdjustmentUsed,
      recent_form_used: recentFormUsed,
      prior_quality_home: homePrior.prior_quality,
      prior_quality_away: awayPrior.prior_quality,
      prior_source_home: homePrior.prior_source,
      prior_source_away: awayPrior.prior_source,
    },
  };
}
