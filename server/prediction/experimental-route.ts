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
import { isExperimentalEnabled } from './prediction-flags.js';

// ── Response shape ─────────────────────────────────────────────────────────────

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

function extractCoreFields(response: unknown): Pick<
  ExperimentalPredictionResponse,
  | 'p_home_win' | 'p_draw' | 'p_away_win' | 'predicted_result'
  | 'expected_goals_home' | 'expected_goals_away'
> {
  const r = response as Record<string, unknown> | null | undefined;
  const predictions = r?.['predictions'] as Record<string, unknown> | null | undefined;
  const core = predictions?.['core'] as Record<string, unknown> | null | undefined;

  function num(v: unknown): number | null {
    return typeof v === 'number' ? v : null;
  }
  function str(v: unknown): string | null {
    return typeof v === 'string' ? v : null;
  }

  return {
    p_home_win:          num(core?.['p_home_win']),
    p_draw:              num(core?.['p_draw']),
    p_away_win:          num(core?.['p_away_win']),
    predicted_result:    str(core?.['predicted_result']),
    expected_goals_home: num(core?.['expected_goals_home']),
    expected_goals_away: num(core?.['expected_goals_away']),
  };
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

    const coreFields = responsePayload !== null
      ? extractCoreFields(responsePayload)
      : {
          p_home_win: null,
          p_draw: null,
          p_away_win: null,
          predicted_result: null,
          expected_goals_home: null,
          expected_goals_away: null,
        };

    // 6. Build and return response
    const result: ExperimentalPredictionResponse = {
      match_id:         snap.match_id,
      competition_id:   snap.competition_id,
      generated_at:     snap.generated_at,
      engine_version:   snap.engine_version,
      mode:             snap.mode,
      calibration_mode: snap.calibration_mode,
      reasons:          parseReasons(snap.reasons_json),
      ...coreFields,
    };

    return reply.send(result);
  });
}
