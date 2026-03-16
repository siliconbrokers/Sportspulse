/**
 * PE-78: Experimental prediction endpoint for the DetailPanel.
 *
 * GET /api/ui/predictions/experimental
 *
 * Query params (both required):
 *   ?matchId=       — canonical match ID
 *   ?competitionId= — used to verify PREDICTION_EXPERIMENTAL_ENABLED flag
 *
 * Gating: returns 404 if isExperimentalEnabled(competitionId) is false.
 * Always responds with Cache-Control: no-store.
 */

import type { FastifyInstance } from 'fastify';
import { PredictionStore } from './prediction-store.js';
import type { EvaluationStore } from './evaluation-store.js';
import { isExperimentalEnabled } from './prediction-flags.js';

// ── Response shape ─────────────────────────────────────────────────────────────

interface OverUnderMarketsDto {
  over_0_5: number; under_0_5: number;
  over_1_5: number; under_1_5: number;
  over_2_5: number; under_2_5: number;
  over_3_5: number; under_3_5: number;
  over_4_5: number; under_4_5: number;
}

interface BTTSMarketDto { yes: number; no: number; }
interface DoubleChanceDto { home_or_draw: number; draw_or_away: number; home_or_away: number; }
interface DNBDto { home: number; away: number; }
interface AsianHandicapDto {
  home_minus_half: number; home_plus_half: number;
  away_minus_half: number; away_plus_half: number;
}
interface ExpectedGoalsDto { home: number; away: number; total: number; implied_goal_line: number; }
interface TopScorelineDto { home: number; away: number; probability: number; }

interface MarketsDto {
  over_under: OverUnderMarketsDto;
  btts: BTTSMarketDto;
  double_chance: DoubleChanceDto;
  dnb: DNBDto;
  asian_handicap: AsianHandicapDto;
  expected_goals: ExpectedGoalsDto;
  top_scorelines: TopScorelineDto[];
}

interface MarketOddsDto {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  captured_at: string;
  bookmaker_count: number;
  edge_home: number;
  edge_draw: number;
  edge_away: number;
}

interface SignalsDto {
  xg_used: boolean;
  xg_coverage: string | null;
  absence_applied: boolean;
  absence_count_home: number;
  absence_count_away: number;
  lineup_used_home: boolean;
  lineup_used_away: boolean;
  market_blend_applied: boolean;
  warnings: string[];
}

interface ExperimentalPredictionResponse {
  match_id: string;
  competition_id: string;
  generated_at: string;
  engine_version: string;
  mode: string;
  calibration_mode: string | null;
  reasons: string[];
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  predicted_result: string | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  markets: MarketsDto | null;
  market_odds: MarketOddsDto | null;
  signals: SignalsDto | null;
}

// ── Helper: safely parse a JSON string, returning null on failure ──────────────

function safeParse(json: string, context: string): unknown {
  try {
    return JSON.parse(json);
  } catch (err) {
    console.error(`[ExperimentalRoute] JSON parse failed for ${context}:`, err);
    return null;
  }
}

// ── Helper: extract core probabilities from a parsed PredictionResponse ────────

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Extrae campos core del response shape de la spec v1.3 (predictions.core.*).
 * Usado para snapshots de V1/V2.
 */
function extractCoreFieldsFromSpec(response: Record<string, unknown>): Pick<
  ExperimentalPredictionResponse,
  | 'p_home_win' | 'p_draw' | 'p_away_win' | 'predicted_result'
  | 'expected_goals_home' | 'expected_goals_away' | 'markets'
> {
  const predictions = response['predictions'] as Record<string, unknown> | null | undefined;
  const core = predictions?.['core'] as Record<string, unknown> | null | undefined;

  return {
    p_home_win:          num(core?.['p_home_win']),
    p_draw:              num(core?.['p_draw']),
    p_away_win:          num(core?.['p_away_win']),
    predicted_result:    str(core?.['predicted_result']),
    expected_goals_home: num(core?.['expected_goals_home']),
    expected_goals_away: num(core?.['expected_goals_away']),
    markets:             null,
  };
}

/**
 * Extrae campos del output plano del motor V3 (V3PredictionOutput).
 * Los campos de prob están en el nivel raíz del objeto.
 */
function extractCoreFieldsFromV3(response: Record<string, unknown>): Pick<
  ExperimentalPredictionResponse,
  | 'p_home_win' | 'p_draw' | 'p_away_win' | 'predicted_result'
  | 'expected_goals_home' | 'expected_goals_away' | 'markets'
> {
  const expl = response['explanation'] as Record<string, unknown> | null | undefined;
  const rawMarkets = response['markets'] as MarketsDto | null | undefined;

  return {
    p_home_win:          num(response['prob_home_win']),
    p_draw:              num(response['prob_draw']),
    p_away_win:          num(response['prob_away_win']),
    predicted_result:    str(response['predicted_result']),
    expected_goals_home: num(expl?.['effective_attack_home']) ?? num(response['lambda_home']),
    expected_goals_away: num(expl?.['effective_attack_away']) ?? num(response['lambda_away']),
    markets:             rawMarkets ?? null,
  };
}

function extractSignalsFromV3(response: Record<string, unknown>): SignalsDto {
  const expl = response['explanation'] as Record<string, unknown> | null | undefined;
  const warnings = response['warnings'];
  const warningsArr: string[] = Array.isArray(warnings)
    ? warnings.filter((w): w is string => typeof w === 'string')
    : [];

  const xgUsed = expl?.['xg_used'] === true;
  const covMatches = typeof expl?.['xg_coverage_matches'] === 'number' ? expl['xg_coverage_matches'] as number : 0;
  const totMatches = typeof expl?.['xg_total_matches'] === 'number' ? expl['xg_total_matches'] as number : 0;

  return {
    xg_used: xgUsed,
    xg_coverage: xgUsed && totMatches > 0 ? `${covMatches}/${totMatches}` : null,
    absence_applied: expl?.['absence_adjustment_applied'] === true,
    absence_count_home: typeof expl?.['absence_count_home'] === 'number' ? expl['absence_count_home'] as number : 0,
    absence_count_away: typeof expl?.['absence_count_away'] === 'number' ? expl['absence_count_away'] as number : 0,
    lineup_used_home: expl?.['lineup_used_home'] === true,
    lineup_used_away: expl?.['lineup_used_away'] === true,
    market_blend_applied: expl?.['market_blend_applied'] === true,
    warnings: warningsArr,
  };
}

function extractCoreFields(response: unknown, engineId?: string): Pick<
  ExperimentalPredictionResponse,
  | 'p_home_win' | 'p_draw' | 'p_away_win' | 'predicted_result'
  | 'expected_goals_home' | 'expected_goals_away' | 'markets'
> {
  const r = response as Record<string, unknown> | null | undefined;
  if (!r) {
    return {
      p_home_win: null, p_draw: null, p_away_win: null,
      predicted_result: null, expected_goals_home: null, expected_goals_away: null,
      markets: null,
    };
  }
  // V3 output shape: has prob_home_win at root level
  if (engineId === 'v3_unified' || typeof r['prob_home_win'] === 'number') {
    return extractCoreFieldsFromV3(r);
  }
  return extractCoreFieldsFromSpec(r);
}

// ── Helper: parse reasons array from reasons_json ─────────────────────────────

function parseReasons(json: string): string[] {
  const parsed = safeParse(json, 'reasons_json');
  if (!Array.isArray(parsed)) return [];
  return parsed.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)));
}

// ── registerExperimentalPredictionRoute ───────────────────────────────────────

export function registerExperimentalPredictionRoute(
  app: FastifyInstance,
  store: PredictionStore,
  evaluationStore?: EvaluationStore,
): void {
  app.get('/api/ui/predictions/experimental', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');

    const q = req.query as Record<string, string>;
    const { matchId, competitionId } = q;

    // 1. Validate required params
    if (!matchId || !competitionId) {
      return reply.code(400).send({ error: 'matchId and competitionId are required' });
    }

    // 2. Gate by flag
    if (!isExperimentalEnabled(competitionId)) {
      return reply.code(404).send({ error: 'Not available' });
    }

    // 3. Look up snapshots
    const snapshots = store.findByMatch(matchId);
    if (snapshots.length === 0) {
      return reply.code(404).send({ error: 'No prediction found' });
    }

    // 4. Most recent snapshot
    const snap = snapshots[0];

    // 5. Parse response payload (gracefully)
    const responsePayload = safeParse(
      snap.response_payload_json,
      `response_payload[${snap.match_id}]`,
    );

    const coreFields = extractCoreFields(responsePayload, snap.engine_id);

    // 6. Resolve market odds from evaluation store (MKT-T3-02)
    let market_odds: MarketOddsDto | null = null;
    if (evaluationStore) {
      const evalRecord = evaluationStore.findByMatch(matchId);
      if (
        evalRecord &&
        evalRecord.market_prob_home !== null &&
        evalRecord.market_prob_draw !== null &&
        evalRecord.market_prob_away !== null &&
        evalRecord.market_odds_captured_at !== null &&
        evalRecord.market_bookmaker_count !== null &&
        evalRecord.edge_home !== null &&
        evalRecord.edge_draw !== null &&
        evalRecord.edge_away !== null
      ) {
        market_odds = {
          prob_home:       evalRecord.market_prob_home,
          prob_draw:       evalRecord.market_prob_draw,
          prob_away:       evalRecord.market_prob_away,
          captured_at:     evalRecord.market_odds_captured_at,
          bookmaker_count: evalRecord.market_bookmaker_count,
          edge_home:       evalRecord.edge_home,
          edge_draw:       evalRecord.edge_draw,
          edge_away:       evalRecord.edge_away,
        };
      }
    }

    // 7. Build and return response

    // Extract signals (V3 only) — reuse already-parsed responsePayload
    const isV3 = snap.engine_id === 'v3_unified' || snap.engine_version === '3.0';
    const signals: SignalsDto | null = isV3 && responsePayload
      ? extractSignalsFromV3(responsePayload as Record<string, unknown>)
      : null;

    const result: ExperimentalPredictionResponse = {
      match_id:         snap.match_id,
      competition_id:   snap.competition_id,
      generated_at:     snap.generated_at,
      engine_version:   snap.engine_version,
      mode:             snap.mode,
      calibration_mode: snap.calibration_mode,
      reasons:          parseReasons(snap.reasons_json),
      ...coreFields,
      market_odds,
      signals,
    };

    return reply.send(result);
  });
}
