/**
 * v3-engine.ts — Motor Predictivo V3: Orquestador principal.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §1–§18
 *
 * Implementa el pipeline completo en orden:
 *   §anti-lookahead → §4 → §5 → §6 → §7 → §8 → §9 → §10 → §11 → §12+§13 → §14 → §15 → §18
 *
 * INVARIANTES:
 *   - Función pura. Sin Date.now(). Sin Math.random(). Sin IO.
 *   - Anti-lookahead filtra utcDate < kickoffUtc (NO < buildNowUtc).
 *   - NOT_ELIGIBLE → prob_* y lambda_* son null.
 *   - |prob_home + prob_draw + prob_away − 1| < 1e-9 (garantizado por renormalización).
 *   - Sin Elo en ningún paso.
 *
 * @module v3-engine
 */

import type {
  V3EngineInput,
  V3PredictionOutput,
  V3Warning,
  PriorQuality,
  V3PipelineIntermediates,
} from './types.js';
import { computeLeagueBaselines } from './league-baseline.js';
import { resolveTeamStats } from './team-stats.js';
import { applyShrinkage } from './shrinkage.js';
import { buildPrior, mixWithPrior } from './prior.js';
import { computeMatchSignalsRA } from './rival-adjustment.js';
import { computeRecencyDeltas } from './recency.js';
import { computeV3Lambdas } from './lambda.js';
import { computePoissonMatrix } from './poisson-matrix.js';
import { computeEligibility } from './eligibility.js';
import { THRESHOLD_NOT_ELIGIBLE, THRESHOLD_ELIGIBLE, DC_RHO, DC_RHO_PER_LEAGUE, LAMBDA_MIN, LAMBDA_MAX, XG_PARTIAL_COVERAGE_THRESHOLD, DRAW_LEAGUE_AVG_RATE, SOS_SENSITIVITY } from './constants.js';
import { estimateDcRho } from './dc-rho-estimator.js';
import { computeConfidence } from './confidence.js';
import { computePredictedResult } from './predicted-result.js';
import { renderProbText } from './pre-match-text.js';
import { computeMarkets } from './markets.js';
import { daysToLastMatch, restMultiplier } from './rest-adjustment.js';
import { computeH2HAdjustment } from './h2h-adjustment.js';
import { computeGoalForm } from './goal-form.js';
import { augmentMatchesWithXg, computeXgCoverage } from './xg-augment.js';
import { computeAbsenceMultiplier } from './absence-adjustment.js';
import { blendWithMarketOdds } from './market-blend.js';
import { applyIsoCalibration } from '../../calibration/iso-calibrator.js';
import { applyDrawAffinity } from './draw-affinity.js';

// ── Output NOT_ELIGIBLE ────────────────────────────────────────────────────

function buildNotEligibleOutput(
  gamesHome: number,
  gamesAway: number,
): V3PredictionOutput {
  return {
    engine_id: 'v3_unified',
    engine_version: '4.2',
    eligibility: 'NOT_ELIGIBLE',
    confidence: 'INSUFFICIENT',
    prob_home_win: null,
    prob_draw: null,
    prob_away_win: null,
    lambda_home: null,
    lambda_away: null,
    predicted_result: null,
    favorite_margin: null,
    pre_match_text: null,
    markets: null,
    explanation: {
      effective_attack_home: 0,
      effective_defense_home: 0,
      effective_attack_away: 0,
      effective_defense_away: 0,
      delta_attack_home: 1.0,
      delta_defense_home: 1.0,
      delta_attack_away: 1.0,
      delta_defense_away: 1.0,
      home_advantage_applied: false,
      venue_split_home: false,
      venue_split_away: false,
      prior_quality_home: 'LEAGUE_BASELINE',
      prior_quality_away: 'LEAGUE_BASELINE',
      rival_adjustment_used: false,
      dc_correction_applied: false,
      league_home_goals_pg: 0,
      league_away_goals_pg: 0,
      dc_rho_used: DC_RHO,
      dc_rho_estimated: false,
      games_home: gamesHome,
      games_away: gamesAway,
      rest_days_home: null,
      rest_days_away: null,
      rest_mult_home: 1.0,
      rest_mult_away: 1.0,
      rest_adjustment_applied: false,
      h2h_n_matches: 0,
      h2h_mult_home: 1.0,
      h2h_mult_away: 1.0,
      h2h_adjustment_applied: false,
      goal_form_home: null,
      goal_form_away: null,
      // §T3-01 defaults
      xg_used: false,
      xg_coverage_matches: 0,
      xg_total_matches: 0,
      // §T3-02/03 defaults
      absence_score_home: 0,
      absence_score_away: 0,
      absence_mult_home: 1.0,
      absence_mult_away: 1.0,
      absence_adjustment_applied: false,
      absence_count_home: 0,
      absence_count_away: 0,
      lineup_used_home: false,
      lineup_used_away: false,
      // §T3-04 defaults
      market_blend_applied: false,
      market_blend_weight: 0,
      model_prob_home_pre_blend: null,
      model_prob_draw_pre_blend: null,
      model_prob_away_pre_blend: null,
      market_prob_home: null,
      market_prob_draw: null,
      market_prob_away: null,
    },
    warnings: [],
  };
}

// ── Motor principal ────────────────────────────────────────────────────────

/**
 * Ejecuta el pipeline completo V3 para un partido.
 *
 * El motor es una función pura: mismos inputs → mismos outputs.
 * Anti-lookahead: utcDate < kickoffUtc (el caller puede pasar currentSeasonMatches sin pre-filtrar).
 *
 * @param input  V3EngineInput con homeTeamId, awayTeamId, kickoffUtc, buildNowUtc y historial
 * @returns      V3PredictionOutput completo
 */
export function runV3Engine(input: V3EngineInput): V3PredictionOutput {
  const {
    homeTeamId,
    awayTeamId,
    kickoffUtc,
    buildNowUtc,
    currentSeasonMatches,
    prevSeasonMatches,
    expectedSeasonGames,
    historicalXg,
    injuries,
    confirmedLineups,
    marketOdds,
    calibrationTable,
    leagueCode,
    _overrideConstants,
    collectIntermediates,
  } = input;

  const kShrinkOverride         = _overrideConstants?.K_SHRINK;
  const priorEquivGamesOverride = _overrideConstants?.PRIOR_EQUIV_GAMES;
  const betaRecentOverride      = _overrideConstants?.BETA_RECENT;
  const dcRhoOverride           = _overrideConstants?.DC_RHO;
  // §SP-V4-05: SoS sensitivity — uses override if provided (sweep tools), else global constant
  const sosSensitivity          = _overrideConstants?.SOS_SENSITIVITY ?? SOS_SENSITIVITY;
  const drawAffinityOverrides   = (_overrideConstants?.DRAW_AFFINITY_POWER != null ||
                                   _overrideConstants?.DRAW_LOW_SCORING_BETA != null)
    ? {
        DRAW_AFFINITY_POWER:    _overrideConstants?.DRAW_AFFINITY_POWER,
        DRAW_LOW_SCORING_BETA:  _overrideConstants?.DRAW_LOW_SCORING_BETA,
      }
    : undefined;

  // ── §anti-lookahead ────────────────────────────────────────────────────
  // Filtrar por kickoffUtc (NO buildNowUtc) — el motor puede usarse con buildNowUtc
  // anterior al kickoff (predicciones generadas horas antes del partido).
  const currentFiltered = currentSeasonMatches.filter((m) => m.utcDate < kickoffUtc);

  // ── §T3-01: xG Augmentation ────────────────────────────────────────────
  // Reemplaza goals con xG en el array para baselines y team stats.
  // H2H, rest, goal-form siguen usando currentFiltered (goles reales).
  const xgCoverage = computeXgCoverage(currentFiltered, historicalXg);
  const currentFilteredXg = augmentMatchesWithXg(currentFiltered, historicalXg);

  const warnings: V3Warning[] = [];

  // Warning si cobertura de xG es parcial (< XG_PARTIAL_COVERAGE_THRESHOLD)
  if (
    xgCoverage.xgUsed &&
    xgCoverage.totalMatches > 0 &&
    xgCoverage.coverageMatches / xgCoverage.totalMatches < XG_PARTIAL_COVERAGE_THRESHOLD
  ) {
    warnings.push('XG_PARTIAL_COVERAGE');
  }

  // ── §4 League Baseline ─────────────────────────────────────────────────
  // Usa utcDate < buildNowUtc para los baselines (solo partidos ya jugados al momento del build).
  // [T3-01] Usa currentFilteredXg para integrar xG en la baseline.
  const baselines = computeLeagueBaselines(currentFilteredXg, buildNowUtc);

  // Detectar si se usó fallback baseline
  const baselineUsedFallback = currentFilteredXg.filter(
    (m) => m.utcDate < buildNowUtc,
  ).length < 10;
  if (baselineUsedFallback) {
    warnings.push('FALLBACK_BASELINE');
  }

  // ── §5 Stats por equipo con time-decay + venue split ──────────────────
  // Home equipo juega como local → venue = 'HOME'
  // Away equipo juega como visitante → venue = 'AWAY'
  // [T3-01] Usa currentFilteredXg para integrar xG en las stats de equipo.
  const homeStats = resolveTeamStats(homeTeamId, currentFilteredXg, buildNowUtc, 'HOME');
  const awayStats = resolveTeamStats(awayTeamId, currentFilteredXg, buildNowUtc, 'AWAY');

  // Detectar ausencia de venue split
  if (!homeStats.venueSplit || !awayStats.venueSplit) {
    warnings.push('NO_VENUE_SPLIT');
  }

  // ── §14 Eligibility (early check — NOT_ELIGIBLE no computa probs) ──────
  // Thresholds adaptativos: si se conoce el largo de la temporada, escalar al 18%.
  // Fórmula: round(expectedSeasonGames × 0.18), clamp [THRESHOLD_NOT_ELIGIBLE+1, THRESHOLD_ELIGIBLE].
  // Ejemplos: EPL 38→7, BL1 34→6, URU_Clausura 15→3→clamp(4), ARG_Apertura 19→3→clamp(4).
  const effectiveThresholdEligible = expectedSeasonGames != null
    ? Math.min(
        THRESHOLD_ELIGIBLE,
        Math.max(THRESHOLD_NOT_ELIGIBLE + 1, Math.round(expectedSeasonGames * 0.18)),
      )
    : THRESHOLD_ELIGIBLE;

  const eligibility = computeEligibility(
    homeStats.games,
    awayStats.games,
    THRESHOLD_NOT_ELIGIBLE,
    effectiveThresholdEligible,
  );

  if (eligibility === 'NOT_ELIGIBLE') {
    return buildNotEligibleOutput(homeStats.games, awayStats.games);
  }

  // ── §6 Shrinkage Bayesiano ─────────────────────────────────────────────
  const homeShrunk = applyShrinkage(homeStats, baselines.league_goals_pg, kShrinkOverride);
  const awayShrunk = applyShrinkage(awayStats, baselines.league_goals_pg, kShrinkOverride);

  // ── §7 Prior de temporada anterior ────────────────────────────────────
  const homePriorData = buildPrior(prevSeasonMatches, homeTeamId, baselines);
  const awayPriorData = buildPrior(prevSeasonMatches, awayTeamId, baselines);

  if (
    homePriorData.prior_quality === 'LEAGUE_BASELINE' &&
    awayPriorData.prior_quality === 'LEAGUE_BASELINE'
  ) {
    warnings.push('NO_PRIOR');
  }

  const homePriorResult = mixWithPrior(
    homeStats.games,
    homeShrunk.attack_shrunk,
    homeShrunk.defense_shrunk,
    homePriorData.prior_attack,
    homePriorData.prior_defense,
    homePriorData.prior_quality,
    priorEquivGamesOverride,
  );

  const awayPriorResult = mixWithPrior(
    awayStats.games,
    awayShrunk.attack_shrunk,
    awayShrunk.defense_shrunk,
    awayPriorData.prior_attack,
    awayPriorData.prior_defense,
    awayPriorData.prior_quality,
    priorEquivGamesOverride,
  );

  // ── §8 Rival Adjustment ────────────────────────────────────────────────
  // getOpponentEffective necesita las effective rates del rival para normalizar.
  // Computamos un cache lazy de effective rates por equipo.
  const effectiveCache = new Map<
    string,
    { attack_eff: number; defense_eff: number; games: number }
  >();

  function getOpponentEffective(
    opponentId: string,
  ): { attack_eff: number; defense_eff: number; games: number } {
    if (effectiveCache.has(opponentId)) return effectiveCache.get(opponentId)!;

    // Stats totales del oponente (sin venue split para rival adjustment)
    // [T3-01] Usa currentFilteredXg para que los effective rates del rival sean coherentes.
    const oppStats = resolveTeamStats(opponentId, currentFilteredXg, buildNowUtc, 'HOME');
    const oppShrunk = applyShrinkage(oppStats, baselines.league_goals_pg);
    const oppPriorData = buildPrior(prevSeasonMatches, opponentId, baselines);
    const oppPriorResult = mixWithPrior(
      oppStats.games,
      oppShrunk.attack_shrunk,
      oppShrunk.defense_shrunk,
      oppPriorData.prior_attack,
      oppPriorData.prior_defense,
      oppPriorData.prior_quality,
    );

    const entry = {
      attack_eff: oppPriorResult.effective_attack,
      defense_eff: oppPriorResult.effective_defense,
      games: oppStats.games,
    };
    effectiveCache.set(opponentId, entry);
    return entry;
  }

  // [T3-01] Señales RA usan currentFilteredXg para coherencia con baselines y stats.
  const homeSignals = computeMatchSignalsRA(currentFilteredXg, homeTeamId, getOpponentEffective);
  const awaySignals = computeMatchSignalsRA(currentFilteredXg, awayTeamId, getOpponentEffective);
  const rivalAdjustmentUsed = homeSignals.length > 0 || awaySignals.length > 0;

  // Ordenar cronológicamente para recency
  const homeSignalsSorted = [...homeSignals].sort((a, b) =>
    a.utcDate.localeCompare(b.utcDate),
  );
  const awaySignalsSorted = [...awaySignals].sort((a, b) =>
    a.utcDate.localeCompare(b.utcDate),
  );

  // ── §9 Recency Deltas ──────────────────────────────────────────────────
  // §SP-V4-05: sosSensitivity pesa partidos por calidad del rival.
  // rivalStrength ya viene embebida en cada MatchSignalRA desde computeMatchSignalsRA.
  const homeRecency = computeRecencyDeltas(
    homeSignalsSorted,
    homeStats.games,
    homePriorResult.effective_attack,
    homePriorResult.effective_defense,
    sosSensitivity,
  );
  const awayRecency = computeRecencyDeltas(
    awaySignalsSorted,
    awayStats.games,
    awayPriorResult.effective_attack,
    awayPriorResult.effective_defense,
    sosSensitivity,
  );

  // ── §10 + §11 Effective Forces + Lambdas ──────────────────────────────
  const lambdaResult = computeV3Lambdas({
    effective_attack_home: homePriorResult.effective_attack,
    effective_defense_home: homePriorResult.effective_defense,
    effective_attack_away: awayPriorResult.effective_attack,
    effective_defense_away: awayPriorResult.effective_defense,
    delta_attack_home: homeRecency.delta_attack,
    delta_defense_home: homeRecency.delta_defense,
    delta_attack_away: awayRecency.delta_attack,
    delta_defense_away: awayRecency.delta_defense,
    venue_split_home: homeStats.venueSplit,
    venue_split_away: awayStats.venueSplit,
    baselines,
    betaRecentOverride,
  });

  // ── §T2-01: Rest adjustment ────────────────────────────────────────────
  const restDaysHome = daysToLastMatch(homeTeamId, currentFiltered, kickoffUtc);
  const restDaysAway = daysToLastMatch(awayTeamId, currentFiltered, kickoffUtc);
  const restMultHome = restMultiplier(restDaysHome);
  const restMultAway = restMultiplier(restDaysAway);
  const restAdjApplied = restMultHome !== 1.0 || restMultAway !== 1.0;

  // ── §T2-02: H2H adjustment ─────────────────────────────────────────────
  const h2hResult = computeH2HAdjustment(
    homeTeamId,
    awayTeamId,
    currentFiltered,
    prevSeasonMatches,
    baselines,
  );

  // ── §T2-03: Goal form (informacional) ──────────────────────────────────
  // Goal form usa currentFiltered (goles reales) — es una señal complementaria.
  const homeGoalForm = computeGoalForm(homeTeamId, currentFiltered, buildNowUtc);
  const awayGoalForm = computeGoalForm(awayTeamId, currentFiltered, buildNowUtc);

  // ── §T3-02 + §T3-03: Absence adjustment ───────────────────────────────
  const absenceResult = computeAbsenceMultiplier(
    homeTeamId,
    awayTeamId,
    injuries,
    confirmedLineups,
  );

  // Lambdas finales: aplicar rest + H2H + absence multiplicadores, re-clipear
  // §SP-V4-13: positional absence factors applied cross-team:
  //   lambda_home *= mult_attack_home (home team attack) * mult_defense_away (away team defense)
  //   lambda_away *= mult_attack_away (away team attack) * mult_defense_home (home team defense)
  const lambdaHomeFinal = Math.max(
    LAMBDA_MIN,
    Math.min(
      LAMBDA_MAX,
      lambdaResult.lambda_home * restMultHome * h2hResult.mult_home * absenceResult.mult_home * absenceResult.mult_defense_away,
    ),
  );
  const lambdaAwayFinal = Math.max(
    LAMBDA_MIN,
    Math.min(
      LAMBDA_MAX,
      lambdaResult.lambda_away * restMultAway * h2hResult.mult_away * absenceResult.mult_away * absenceResult.mult_defense_home,
    ),
  );

  // ── §12 DC_RHO estimation + §13 Poisson Matrix ────────────────────────
  // Estimar ρ desde datos históricos. Cuando hay < 20 partidos en la temporada
  // actual (inicio de temporada), combinar con prevSeasonMatches para una
  // estimación más estable del patrón de scores bajos de la liga.
  // DC_RHO fijo (backtest evidence: -0.15 supera al estimador empírico en 0.035 score).
  // Si se provee override (solo para sweep tools), usa ese valor.
  // estimateDcRho se preserva como herramienta de investigación pero no se usa en producción.
  // §SP-V4-03: Lookup per-liga cuando leagueCode está disponible; fallback a DC_RHO global.
  const leagueRho = (leagueCode != null && DC_RHO_PER_LEAGUE[leagueCode] != null)
    ? DC_RHO_PER_LEAGUE[leagueCode]!
    : DC_RHO;
  const estimatedRho = dcRhoOverride ?? leagueRho;
  const dcRhoEstimated = false;

  const poissonResult = computePoissonMatrix(
    lambdaHomeFinal,
    lambdaAwayFinal,
    estimatedRho,
  );

  if (poissonResult.tailMassExceeded) {
    warnings.push('TAIL_MASS_EXCEEDED');
  }

  // ── §DRAW-AFFINITY: boost p_draw cuando los equipos están equilibrados ────
  // El modelo Poisson subestima empates cuando λh > λa (home advantage separa
  // las distribuciones). Señal combinada:
  //   1. Balance de lambdas (cuán parejos son los equipos)
  //   2. Bajo marcador esperado (avg_λ bajo → 0-0 y 1-1 dominan)
  //   3. Propensidad histórica: qué tan seguido empata cada equipo en su rol
  // El boost se aplica ANTES del market blend para que las odds del mercado
  // vean la probabilidad de empate ya corregida.

  // Computar tasa de empate de cada equipo en su rol (home/away) desde la temporada actual.
  // Computar tasa de empate de cada equipo en su rol (home/away).
  // Bayesian smoothing contra la media de liga: evita que el factor colapse
  // a 0 en early season cuando un equipo no ha empatado aún.
  //   smoothed = (draws + SMOOTH × avgRate) / (games + SMOOTH)
  const DRAW_PROPENSITY_SMOOTH = 6;

  const homeGamesInRole = currentFiltered.filter((m) => m.homeTeamId === homeTeamId);
  const awayGamesInRole = currentFiltered.filter((m) => m.awayTeamId === awayTeamId);

  const homeDrawsInRole = homeGamesInRole.filter((m) => m.homeGoals === m.awayGoals).length;
  const awayDrawsInRole = awayGamesInRole.filter((m) => m.homeGoals === m.awayGoals).length;

  const homeDrawRate =
    (homeDrawsInRole + DRAW_PROPENSITY_SMOOTH * DRAW_LEAGUE_AVG_RATE) /
    (homeGamesInRole.length + DRAW_PROPENSITY_SMOOTH);

  const awayDrawRate =
    (awayDrawsInRole + DRAW_PROPENSITY_SMOOTH * DRAW_LEAGUE_AVG_RATE) /
    (awayGamesInRole.length + DRAW_PROPENSITY_SMOOTH);

  // Señal adicional: proximidad en la tabla (puntos/partido similares → más empates).
  // Cuando ambos equipos tienen ppg cercano, el partido es entre equipos equilibrados
  // en rendimiento real (no solo en fuerzas teóricas). Señal independiente del lambda balance.
  function computePpg(teamId: string): number {
    const games = currentFiltered.filter(
      (m) => m.homeTeamId === teamId || m.awayTeamId === teamId,
    );
    if (games.length === 0) return 1.0;
    let pts = 0;
    for (const m of games) {
      const isHome = m.homeTeamId === teamId;
      const scored = isHome ? m.homeGoals : m.awayGoals;
      const conceded = isHome ? m.awayGoals : m.homeGoals;
      if (scored > conceded) pts += 3;
      else if (scored === conceded) pts += 1;
    }
    return pts / games.length;
  }
  const ppgHome = computePpg(homeTeamId);
  const ppgAway = computePpg(awayTeamId);
  // Proximity ∈ (0, 1]: 1 = misma ppg, decrece con diferencia
  const tableProximity = 1 / (1 + Math.abs(ppgHome - ppgAway));

  // Señal adicional: tasa de empate H2H para este cruce específico.
  // Algunos emparejamientos tienen historial sistemático de empates.
  // Usa prevSeasonMatches + currentFiltered (ambas direcciones del partido).
  const h2hMatches = [...prevSeasonMatches, ...currentFiltered].filter(
    (m) =>
      (m.homeTeamId === homeTeamId && m.awayTeamId === awayTeamId) ||
      (m.homeTeamId === awayTeamId && m.awayTeamId === homeTeamId),
  );
  const h2hDrawRate =
    h2hMatches.length >= 2
      ? h2hMatches.filter((m) => m.homeGoals === m.awayGoals).length /
        h2hMatches.length
      : undefined;

  // ── §T3-04: Market blend ───────────────────────────────────────────────
  // Mezcla probabilidades 1X2 del modelo con odds del mercado (si están disponibles).
  // Se aplica sobre probs Poisson puras (antes de calibración y draw affinity),
  // ya que las cuotas de mercado son una señal externa pre-calibración.
  // Los mercados derivados (O/U, BTTS, scorelines) siguen usando la matriz Poisson original.
  const blendResult = blendWithMarketOdds(
    poissonResult.prob_home_win,
    poissonResult.prob_draw,
    poissonResult.prob_away_win,
    marketOdds,
  );

  if (blendResult.invalidOdds) {
    warnings.push('MARKET_ODDS_INVALID');
  }

  // These are `let` so the calibration step (§Cal) can reassign them.
  let finalProbHome = blendResult.prob_home;
  let finalProbDraw  = blendResult.prob_draw;
  let finalProbAway  = blendResult.prob_away;

  // ── §Cal Isotonic Calibration (Phase 5) ───────────────────────────────────
  // Corrige el sesgo sistemático del modelo (sobre-estimación HOME, sub-estimación AWAY).
  // Se aplica ANTES del draw affinity boost para que la calibración opere sobre
  // el modelo puro y el draw affinity añada diferenciación en el espacio calibrado.
  // Backward-compatible: if calibrationTable is absent, no-op.
  if (calibrationTable != null && calibrationTable.home.length > 0) {
    const calResult = applyIsoCalibration(
      finalProbHome,
      finalProbDraw,
      finalProbAway,
      calibrationTable,
    );
    if (calResult.calibrated) {
      finalProbHome = calResult.p_home;
      finalProbDraw = calResult.p_draw;
      finalProbAway = calResult.p_away;
    }
  }

  // ── §DRAW-AFFINITY: Draw probability boost ────────────────────────────────
  // Se aplica DESPUÉS de la calibración para añadir diferenciación de partido
  // (balance de fuerzas, propensidad, H2H) en el espacio ya calibrado.
  // Skipped when _skipDrawAffinity=true (used by gen-calibration.ts to generate
  // tuples from pre-affinity probs, so calibration is trained on the same
  // probability space it is applied to at inference time).
  if (!input._skipDrawAffinity) {
    const drawAffinityResult = applyDrawAffinity(
      finalProbHome,
      finalProbDraw,
      finalProbAway,
      lambdaHomeFinal,
      lambdaAwayFinal,
      homeDrawRate,
      awayDrawRate,
      tableProximity,
      h2hDrawRate,
      drawAffinityOverrides,
    );

    finalProbHome = drawAffinityResult.prob_home;
    finalProbDraw = drawAffinityResult.prob_draw;
    finalProbAway = drawAffinityResult.prob_away;
  }

  // ── §15 Confidence ─────────────────────────────────────────────────────
  // Compute preliminary favorite_margin from final 1X2 probs for confidence downgrade.
  const sortedProbs = [finalProbHome, finalProbDraw, finalProbAway].sort((a, b) => b - a);
  const prelimMargin = sortedProbs[0] - sortedProbs[1];
  const confidence = computeConfidence(
    homeStats.games,
    awayStats.games,
    homePriorResult.prior_quality,
    awayPriorResult.prior_quality,
    prelimMargin,
  );

  // ── §18 Predicted Result ───────────────────────────────────────────────
  // Usa probabilidades finales (blended si T3-04 aplica).
  const predictedResultOutput = computePredictedResult(
    finalProbHome,
    finalProbDraw,
    finalProbAway,
  );

  // ── Pre-match text ─────────────────────────────────────────────────────
  // Usar un matchId derivado de los teamIds y kickoff para seed determinista.
  const matchId = `${homeTeamId}__${awayTeamId}__${kickoffUtc}`;
  const preMatchText = renderProbText(
    finalProbHome,
    finalProbDraw,
    finalProbAway,
    matchId,
  );

  // ── §T1 Mercados derivados ─────────────────────────────────────────────
  // O/U, BTTS y scorelines usan la matriz Poisson original (estructuralmente más rica).
  // Per spec §16.3/§16.4: double_chance y DNB usan las probs calibradas finales
  // (finalProbHome/Draw/Away — post-calibración y post-draw affinity).
  const markets = computeMarkets(
    poissonResult.matrix,
    poissonResult.prob_home_win,
    poissonResult.prob_draw,
    poissonResult.prob_away_win,
    lambdaHomeFinal,
    lambdaAwayFinal,
    finalProbHome,
    finalProbDraw,
    finalProbAway,
  );

  // ── §SP-V4-20: Intermediates collection (only when collectIntermediates=true) ─
  // NOT for production use — only used by tools/train-logistic.ts.
  // xgCoverage fraction: coverageMatches / totalMatches (0 when no matches).
  const intermediates: V3PipelineIntermediates | undefined = collectIntermediates
    ? {
        lambdaHome:        lambdaHomeFinal,
        lambdaAway:        lambdaAwayFinal,
        restDaysHome:      restDaysHome ?? 0,
        restDaysAway:      restDaysAway ?? 0,
        h2hMultHome:       h2hResult.mult_home,
        h2hMultAway:       h2hResult.mult_away,
        absenceScoreHome:  absenceResult.mult_home,
        absenceScoreAway:  absenceResult.mult_away,
        xgCoverage:        xgCoverage.totalMatches > 0
          ? xgCoverage.coverageMatches / xgCoverage.totalMatches
          : 0,
      }
    : undefined;

  // ── Armar output ───────────────────────────────────────────────────────
  return {
    engine_id: 'v3_unified',
    engine_version: '4.2',
    eligibility,
    confidence,
    prob_home_win: finalProbHome,
    prob_draw: finalProbDraw,
    prob_away_win: finalProbAway,
    lambda_home: lambdaHomeFinal,
    lambda_away: lambdaAwayFinal,
    predicted_result: predictedResultOutput.predicted_result,
    favorite_margin: predictedResultOutput.favorite_margin,
    pre_match_text: preMatchText,
    markets,
    _intermediates: intermediates,
    explanation: {
      effective_attack_home: homePriorResult.effective_attack,
      effective_defense_home: homePriorResult.effective_defense,
      effective_attack_away: awayPriorResult.effective_attack,
      effective_defense_away: awayPriorResult.effective_defense,
      delta_attack_home: homeRecency.delta_attack,
      delta_defense_home: homeRecency.delta_defense,
      delta_attack_away: awayRecency.delta_attack,
      delta_defense_away: awayRecency.delta_defense,
      home_advantage_applied: lambdaResult.home_advantage_applied,
      venue_split_home: homeStats.venueSplit,
      venue_split_away: awayStats.venueSplit,
      prior_quality_home: homePriorResult.prior_quality as PriorQuality,
      prior_quality_away: awayPriorResult.prior_quality as PriorQuality,
      rival_adjustment_used: rivalAdjustmentUsed,
      dc_correction_applied: true, // Dixon-Coles siempre se aplica cuando hay probs
      league_home_goals_pg: baselines.league_home_goals_pg,
      league_away_goals_pg: baselines.league_away_goals_pg,
      dc_rho_used: estimatedRho,
      dc_rho_estimated: dcRhoEstimated,
      games_home: homeStats.games,
      games_away: awayStats.games,
      rest_days_home: restDaysHome,
      rest_days_away: restDaysAway,
      rest_mult_home: restMultHome,
      rest_mult_away: restMultAway,
      rest_adjustment_applied: restAdjApplied,
      h2h_n_matches: h2hResult.n_matches,
      h2h_mult_home: h2hResult.mult_home,
      h2h_mult_away: h2hResult.mult_away,
      h2h_adjustment_applied: h2hResult.applied,
      goal_form_home: homeGoalForm.n_matches > 0 ? homeGoalForm : null,
      goal_form_away: awayGoalForm.n_matches > 0 ? awayGoalForm : null,
      // §T3-01: xG augmentation
      xg_used: xgCoverage.xgUsed,
      xg_coverage_matches: xgCoverage.coverageMatches,
      xg_total_matches: xgCoverage.totalMatches,
      // §T3-02/03: Absence adjustment
      absence_score_home: absenceResult.absence_score_home,
      absence_score_away: absenceResult.absence_score_away,
      absence_mult_home: absenceResult.mult_home,
      absence_mult_away: absenceResult.mult_away,
      absence_adjustment_applied: absenceResult.applied,
      absence_count_home: absenceResult.absence_count_home,
      absence_count_away: absenceResult.absence_count_away,
      lineup_used_home: absenceResult.lineup_used_home,
      lineup_used_away: absenceResult.lineup_used_away,
      // §T3-04: Market blend
      market_blend_applied: blendResult.applied,
      market_blend_weight: blendResult.blend_weight,
      model_prob_home_pre_blend: blendResult.model_prob_home_pre_blend,
      model_prob_draw_pre_blend: blendResult.model_prob_draw_pre_blend,
      model_prob_away_pre_blend: blendResult.model_prob_away_pre_blend,
      market_prob_home: blendResult.market_prob_home,
      market_prob_draw: blendResult.market_prob_draw,
      market_prob_away: blendResult.market_prob_away,
    },
    warnings,
  };
}
