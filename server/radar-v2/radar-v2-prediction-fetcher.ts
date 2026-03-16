/**
 * Radar v2 — Prediction Fetcher
 *
 * Extrae RadarV2PredictionContext desde un PredictionSnapshot (PredictionStore).
 * Función pura — sin efectos secundarios. Nunca lanza excepciones.
 *
 * Gating:
 *   - PredictionSnapshot no encontrado → null
 *   - NOT_ELIGIBLE → null (no se adjunta contexto)
 *   - LIMITED_MODE → solo xG (probs calibradas null)
 *   - FULL_MODE    → bloque completo
 */

import type { RadarV2PredictionContext } from './radar-v2-types.js';
import type { PredictionStore } from '../prediction/prediction-store.js';

/**
 * Función fetcher per-match inyectable en el service.
 * Retorna null si no hay datos o si el partido es NOT_ELIGIBLE.
 */
export type PredictionFetcher = (matchId: string) => RadarV2PredictionContext | null;

/**
 * Construye un PredictionFetcher que lee desde un PredictionStore.
 * Usa el snapshot más reciente para cada matchId.
 */
export function buildPredictionFetcher(store: PredictionStore): PredictionFetcher {
  return (matchId: string): RadarV2PredictionContext | null => {
    try {
      const snapshots = store.findByMatch(matchId);
      if (snapshots.length === 0) return null;

      // Usar el snapshot más reciente (findByMatch ya ordena desc por generated_at)
      const snap = snapshots[0];
      if (snap.generation_status === 'error') return null;

      return extractContext(snap.response_payload_json, snap.engine_id, snap.generated_at);
    } catch (err) {
      console.warn(`[RadarV2PredictionFetcher] Error fetching prediction for ${matchId}:`, err);
      return null;
    }
  };
}

// ── Internal extraction ───────────────────────────────────────────────────────

function extractContext(
  responseJson: string,
  engineId: string,
  generatedAt: string,
): RadarV2PredictionContext | null {
  let response: Record<string, unknown>;
  try {
    response = JSON.parse(responseJson) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Determinar eligibility y operatingMode
  const eligibilityStatus = parseEligibilityStatus(response);
  const operatingMode = parseOperatingMode(response, eligibilityStatus);

  // Gating: NOT_ELIGIBLE → null (no adjuntar)
  if (eligibilityStatus === 'NOT_ELIGIBLE' || operatingMode === 'NOT_ELIGIBLE') {
    return null;
  }

  // ── V1/spec schema (predictions.core / predictions.secondary / internals) ──
  const predictions = response['predictions'] as Record<string, unknown> | undefined;
  const core = predictions?.['core'] as Record<string, unknown> | undefined;
  const secondary = predictions?.['secondary'] as Record<string, unknown> | undefined;
  const internals = response['internals'] as Record<string, unknown> | undefined;

  // ── V3 schema (flat root-level fields) ────────────────────────────────────
  // V3 engine: prob_home_win, lambda_home, predicted_result (HOME_WIN/DRAW/AWAY_WIN/TOO_CLOSE),
  //            favorite_margin, markets.over_under.over_2_5, markets.btts.yes
  const isV3 = typeof response['prob_home_win'] === 'number';
  const v3Markets = response['markets'] as Record<string, Record<string, number>> | undefined;

  const isFullMode = operatingMode === 'FULL_MODE';

  // calibrationMode: V3 usa confidence (HIGH/MEDIUM/LOW), no calibration_mode
  const calibrationMode = parseCalibrationMode(response, internals);

  // ── Extraer probs (V1 vs V3) ──────────────────────────────────────────────
  const probHomeWin = isFullMode
    ? (isV3
        ? toNullableNumber(response['prob_home_win'])
        : toNullableNumber(core?.['p_home_win']))
    : null;
  const probDraw = isFullMode
    ? (isV3
        ? toNullableNumber(response['prob_draw'])
        : toNullableNumber(core?.['p_draw']))
    : null;
  const probAwayWin = isFullMode
    ? (isV3
        ? toNullableNumber(response['prob_away_win'])
        : toNullableNumber(core?.['p_away_win']))
    : null;

  // ── xG (V1 vs V3) ────────────────────────────────────────────────────────
  const expectedGoalsHome = isV3
    ? (toNullableNumber(v3Markets?.['expected_goals']?.['home']) ?? toNullableNumber(response['lambda_home']))
    : toNullableNumber(core?.['expected_goals_home']);
  const expectedGoalsAway = isV3
    ? (toNullableNumber(v3Markets?.['expected_goals']?.['away']) ?? toNullableNumber(response['lambda_away']))
    : toNullableNumber(core?.['expected_goals_away']);

  // ── Predicted result (V1 vs V3) ──────────────────────────────────────────
  // V3 usa HOME_WIN/AWAY_WIN en lugar de HOME/AWAY
  const rawPredictedResult = isV3 ? response['predicted_result'] : core?.['predicted_result'];
  const predictedResult = isFullMode ? parsePredictedResult(rawPredictedResult) : null;

  // ── Favorite margin (V1 vs V3) ───────────────────────────────────────────
  const favoriteMargin = isFullMode
    ? (isV3
        ? toNullableNumber(response['favorite_margin'])
        : toNullableNumber(core?.['favorite_margin']))
    : null;

  // ── Markets (V1 vs V3) ────────────────────────────────────────────────────
  const over2_5 = isV3
    ? toNullableNumber(v3Markets?.['over_under']?.['over_2_5'])
    : toNullableNumber(secondary?.['over_2_5']);
  const bttsYes = isV3
    ? toNullableNumber(v3Markets?.['btts']?.['yes'])
    : toNullableNumber(secondary?.['btts_yes']);

  return {
    operatingMode,
    eligibilityStatus,
    probHomeWin,
    probDraw,
    probAwayWin,
    expectedGoalsHome,
    expectedGoalsAway,
    predictedResult,
    favoriteMargin,
    over2_5,
    bttsYes,
    calibrationMode,
    engineId,
    generatedAt,
  };
}

function parseEligibilityStatus(
  r: Record<string, unknown>,
): 'ELIGIBLE' | 'NOT_ELIGIBLE' {
  const raw = r['eligibility_status'];
  if (raw === 'NOT_ELIGIBLE') return 'NOT_ELIGIBLE';
  // V3 uses 'eligibility' field
  const v3 = r['eligibility'];
  if (v3 === 'NOT_ELIGIBLE') return 'NOT_ELIGIBLE';
  return 'ELIGIBLE';
}

function parseOperatingMode(
  r: Record<string, unknown>,
  eligibilityStatus: 'ELIGIBLE' | 'NOT_ELIGIBLE',
): 'FULL_MODE' | 'LIMITED_MODE' | 'NOT_ELIGIBLE' {
  if (eligibilityStatus === 'NOT_ELIGIBLE') return 'NOT_ELIGIBLE';

  const raw = r['operating_mode'];
  if (raw === 'FULL_MODE') return 'FULL_MODE';
  if (raw === 'LIMITED_MODE') return 'LIMITED_MODE';

  // V3 eligibility field mapping
  const v3 = r['eligibility'];
  if (v3 === 'ELIGIBLE') return 'FULL_MODE';
  if (v3 === 'LIMITED') return 'LIMITED_MODE';

  // Default for ELIGIBLE: FULL_MODE
  return 'FULL_MODE';
}

function parseCalibrationMode(
  r: Record<string, unknown>,
  internals: Record<string, unknown> | undefined,
): 'bootstrap' | 'trained' | 'not_applied' {
  const raw = internals?.['calibration_mode'] ?? r['calibration_mode'];
  if (raw === 'trained') return 'trained';
  if (raw === 'not_applied') return 'not_applied';
  return 'bootstrap';
}

function parsePredictedResult(
  raw: unknown,
): 'HOME' | 'DRAW' | 'AWAY' | 'TOO_CLOSE' | null {
  if (raw === 'HOME' || raw === 'DRAW' || raw === 'AWAY' || raw === 'TOO_CLOSE') return raw;
  // V3 uses HOME_WIN / AWAY_WIN
  if (raw === 'HOME_WIN') return 'HOME';
  if (raw === 'AWAY_WIN') return 'AWAY';
  return null;
}

function toNullableNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
