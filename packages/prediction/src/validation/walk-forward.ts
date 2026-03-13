/**
 * walk-forward.ts — Walk-forward temporal validation para Motor V2 (§17).
 *
 * Para cada partido FINISHED en la ventana de evaluación:
 *   1. Solo usa partidos con utcDate < target.utcDate (anti-lookahead garantizado)
 *   2. Corre runV2Engine con ese slice pasado + prevSeasonMatches
 *   3. Aplica calibración isotónica online entrenada sobre predicciones pasadas (§17.1)
 *   4. Registra probabilidades raw y calibradas vs resultado real
 *
 * Cumplimiento §17: implementa la validación walk-forward sin leakage.
 * Anti-leakage de calibración: el calibrador se entrena solo con predicciones
 * cuyos kickoffUtc < kickoffUtc del partido actual (doble guardia temporal).
 *
 * Modo warmup cross-season (option warmupCalibration):
 *   Antes de iterar la temporada actual, corre un walk-forward sobre
 *   prevSeasonMatches para pre-poblar el calibrador. Al comenzar la
 *   temporada actual el calibrador ya tiene ~200-300 muestras ELIGIBLE,
 *   lo que supera el umbral MIN_CALIB_SAMPLES_WALK_FORWARD desde el primer
 *   partido. Todos los timestamps de warmup son < primer partido actual
 *   (anti-leakage garantizado por construcción).
 *
 * Funciones puras — sin IO.
 */

import { runV2Engine } from '../engine/v2/v2-engine.js';
import type { V2MatchRecord, V2EligibilityStatus, V2ConfidenceLevel } from '../engine/v2/types.js';
import {
  fitOneVsRestCalibrators,
  applyOneVsRestCalibration,
  type OneVsRestTrainingSample,
} from '../calibration/isotonic-calibrator.js';

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Mínimo de predicciones ELIGIBLE pasadas requeridas para activar calibración.
 * Por debajo de este umbral se usa identity (raw = calibrated).
 * Con warmupCalibration=true este umbral se supera desde el inicio de la temporada.
 */
export const MIN_CALIB_SAMPLES_WALK_FORWARD = 30;

// ── Types ─────────────────────────────────────────────────────────────────────

export type Outcome = 'H' | 'D' | 'A';

export interface WFPrediction {
  /** `${homeTeamId}:${awayTeamId}:${utcDate}` */
  matchId: string;
  utcDate: string;
  homeTeamId: string;
  awayTeamId: string;

  // ── Probabilidades raw (Poisson, sin calibrar) ───────────────────────────
  prob_home_win: number;
  prob_draw: number;
  prob_away_win: number;

  // ── Probabilidades calibradas (isotónica online, §17.1) ──────────────────
  /** Probabilidad local victoria calibrada. Igual a raw cuando calibration_mode='bootstrap'. */
  cal_prob_home_win: number;
  /** Probabilidad empate calibrada. */
  cal_prob_draw: number;
  /** Probabilidad victoria visitante calibrada. */
  cal_prob_away_win: number;
  /**
   * 'bootstrap': calibrador identity (< MIN_CALIB_SAMPLES_WALK_FORWARD muestras).
   * 'trained':   calibrador isotónico entrenado sobre muestras pasadas.
   */
  calibration_mode: 'bootstrap' | 'trained';
  /** Número de muestras ELIGIBLE usadas para entrenar el calibrador en este paso. */
  calib_n_samples: number;

  lambda_home: number;
  lambda_away: number;
  actual_outcome: Outcome;
  actual_home_goals: number;
  actual_away_goals: number;
  eligibility_status: V2EligibilityStatus;
  confidence_level: V2ConfidenceLevel;
  /** Partidos disponibles en la temporada actual al momento de la predicción. */
  n_current_at_time: number;
}

export interface WalkForwardOptions {
  /**
   * Si es true, ejecuta un walk-forward sobre prevSeasonMatches antes de
   * procesar la temporada actual. Esto pre-pobla el calibrador con predicciones
   * de la temporada anterior, garantizando ≥ MIN_CALIB_SAMPLES_WALK_FORWARD
   * muestras desde el primer partido de la temporada evaluada.
   *
   * Anti-leakage: todos los timestamps del warmup son anteriores al primer
   * partido de currentSeasonMatches (garantizado por construcción ya que
   * prevSeasonMatches son de una temporada anterior).
   *
   * El warmup corre con prevSeasonMatches como "currentSeason" y sin historia
   * adicional (Elo parte desde default). Es aceptable para calibración porque
   * el sesgo sistemático del Poisson se aprende con ~20+ partidos independientemente
   * del valor absoluto del Elo.
   *
   * @default false
   */
  warmupCalibration?: boolean;
}

// ── Warmup helper ─────────────────────────────────────────────────────────────

/**
 * Corre un walk-forward simplificado sobre prevSeasonMatches para generar
 * muestras de calibración. Solo retorna los OneVsRestTrainingSample de
 * predicciones ELIGIBLE — no retorna WFPrediction (warmup no es evaluado).
 *
 * Usa solo los partidos estrictamente anteriores de prevSorted como historia
 * de la temporada y sin historia adicional (prevSeasonMatches: []).
 */
function buildWarmupCalibSamples(prevSeasonMatches: V2MatchRecord[]): OneVsRestTrainingSample[] {
  const prevSorted = [...prevSeasonMatches].sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  const samples: OneVsRestTrainingSample[] = [];

  for (let j = 0; j < prevSorted.length; j++) {
    const target = prevSorted[j]!;
    const pastPrev = prevSorted.slice(0, j);

    let output;
    try {
      output = runV2Engine({
        homeTeamId: target.homeTeamId,
        awayTeamId: target.awayTeamId,
        kickoffUtc: target.utcDate,
        currentSeasonMatches: pastPrev,
        prevSeasonMatches: [], // sin historia adicional en el warmup
      });
    } catch {
      continue;
    }

    if (output.eligibility_status === 'NOT_ELIGIBLE') continue;

    const actual: Outcome =
      target.homeGoals > target.awayGoals ? 'H' : target.homeGoals < target.awayGoals ? 'A' : 'D';

    const actualFor1x2: 'HOME' | 'DRAW' | 'AWAY' =
      actual === 'H' ? 'HOME' : actual === 'A' ? 'AWAY' : 'DRAW';

    samples.push({
      raw_home: output.prob_home_win,
      raw_draw: output.prob_draw,
      raw_away: output.prob_away_win,
      actual_outcome: actualFor1x2,
      match_timestamp_ms: new Date(target.utcDate).getTime(),
      match_id: `warmup:${target.homeTeamId}:${target.awayTeamId}:${target.utcDate}`,
    });
  }

  return samples;
}

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Ejecuta validación walk-forward sobre un slice de temporada.
 *
 * Todos los partidos deben ser de la misma competencia.
 *
 * Calibración online (§17.1, §17.3):
 *   En cada paso i, el calibrador isotónico se entrena sobre las predicciones
 *   ELIGIBLE de los pasos 0..i-1. La guardia temporal del IsotonicCalibrator
 *   rechaza cualquier muestra con timestamp >= kickoffUtc[i].
 *
 * @param currentSeasonMatches  Partidos FINISHED de la temporada evaluada.
 * @param prevSeasonMatches     Partidos FINISHED de la temporada anterior (prior only).
 * @param options               Opciones de calibración.
 *
 * @returns Un WFPrediction por partido (incluyendo NOT_ELIGIBLE para tracking).
 */
export function runWalkForward(
  currentSeasonMatches: V2MatchRecord[],
  prevSeasonMatches: V2MatchRecord[],
  options: WalkForwardOptions = {},
): WFPrediction[] {
  // Orden cronológico estricto — obligatorio para que el slice pasado sea correcto
  const sorted = [...currentSeasonMatches].sort((a, b) => a.utcDate.localeCompare(b.utcDate));

  const predictions: WFPrediction[] = [];

  // Acumula muestras de entrenamiento para el calibrador online.
  // Solo se agregan predicciones ELIGIBLE con probabilidades válidas.
  // Con warmupCalibration=true se pre-pobla con predicciones de la temporada anterior.
  const calibTrainingSamples: OneVsRestTrainingSample[] =
    options.warmupCalibration && prevSeasonMatches.length > 0
      ? buildWarmupCalibSamples(prevSeasonMatches)
      : [];

  for (let i = 0; i < sorted.length; i++) {
    const target = sorted[i]!;

    // Partidos ESTRICTAMENTE anteriores (index 0..i-1)
    // El engine aplica un segundo filtro interno utcDate < kickoffUtc — doble protección.
    const currentPast = sorted.slice(0, i);

    let output;
    try {
      output = runV2Engine({
        homeTeamId: target.homeTeamId,
        awayTeamId: target.awayTeamId,
        kickoffUtc: target.utcDate,
        currentSeasonMatches: currentPast,
        prevSeasonMatches,
      });
    } catch {
      // No debería ocurrir con datos válidos; defensivo
      continue;
    }

    const actual_outcome: Outcome =
      target.homeGoals > target.awayGoals ? 'H' : target.homeGoals < target.awayGoals ? 'A' : 'D';

    const matchId = `${target.homeTeamId}:${target.awayTeamId}:${target.utcDate}`;
    const kickoffMs = new Date(target.utcDate).getTime();

    // ── Calibración online ─────────────────────────────────────────────────
    // Solo aplica sobre predicciones ELIGIBLE (tienen probabilidades significativas).
    const isEligible = output.eligibility_status !== 'NOT_ELIGIBLE';

    // Usar muestras estrictamente anteriores (guardia temporal §17.3)
    const eligibleSamples = calibTrainingSamples.filter((s) => s.match_timestamp_ms < kickoffMs);
    const nCalibSamples = eligibleSamples.length;
    const useTrainedCalib = nCalibSamples >= MIN_CALIB_SAMPLES_WALK_FORWARD;

    let calHome: number;
    let calDraw: number;
    let calAway: number;
    let calibMode: 'bootstrap' | 'trained';

    if (useTrainedCalib && isEligible) {
      const calibrators = fitOneVsRestCalibrators(eligibleSamples, kickoffMs);
      const cal = applyOneVsRestCalibration(
        output.prob_home_win,
        output.prob_draw,
        output.prob_away_win,
        calibrators,
      );
      calHome = cal.home;
      calDraw = cal.draw;
      calAway = cal.away;
      calibMode = 'trained';
    } else {
      // Bootstrap: identity (raw = calibrated)
      calHome = output.prob_home_win;
      calDraw = output.prob_draw;
      calAway = output.prob_away_win;
      calibMode = 'bootstrap';
    }

    predictions.push({
      matchId,
      utcDate: target.utcDate,
      homeTeamId: target.homeTeamId,
      awayTeamId: target.awayTeamId,
      prob_home_win: output.prob_home_win,
      prob_draw: output.prob_draw,
      prob_away_win: output.prob_away_win,
      cal_prob_home_win: calHome,
      cal_prob_draw: calDraw,
      cal_prob_away_win: calAway,
      calibration_mode: calibMode,
      calib_n_samples: nCalibSamples,
      lambda_home: output.lambda_home,
      lambda_away: output.lambda_away,
      actual_outcome,
      actual_home_goals: target.homeGoals,
      actual_away_goals: target.awayGoals,
      eligibility_status: output.eligibility_status,
      confidence_level: output.confidence_level,
      n_current_at_time: currentPast.length,
    });

    // ── Acumular para el siguiente paso ────────────────────────────────────
    // Solo partidos ELIGIBLE contribuyen al entrenamiento de la calibración.
    if (isEligible) {
      const actualOutcomeFor1x2: 'HOME' | 'DRAW' | 'AWAY' =
        actual_outcome === 'H' ? 'HOME' : actual_outcome === 'A' ? 'AWAY' : 'DRAW';

      calibTrainingSamples.push({
        raw_home: output.prob_home_win,
        raw_draw: output.prob_draw,
        raw_away: output.prob_away_win,
        actual_outcome: actualOutcomeFor1x2,
        match_timestamp_ms: kickoffMs,
        match_id: matchId,
      });
    }
  }

  return predictions;
}
