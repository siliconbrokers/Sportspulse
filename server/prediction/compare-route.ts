/**
 * compare-route.ts — GET /api/ui/predictions/compare
 *
 * Comparison endpoint for V1 vs V2 prediction engines per SP-PRED-V2 §7.
 *
 * Query params:
 *   ?matchId=<string> — canonical match identifier (required)
 *
 * Returns latest V1 and V2 predictions side-by-side for the given match.
 * Either entry may be null if no prediction exists for that engine.
 *
 * Gating: requires features.predictions=true in portal config (same as /api/ui/radar).
 *
 * SP-PRED-V2 §7
 */

import type { FastifyInstance } from 'fastify';
import type { PredictionStore } from './prediction-store.js';
import type { V2PredictionStore } from './v2-prediction-store.js';

// ── Response types ─────────────────────────────────────────────────────────────

export interface CompareEntry {
  engine_id: string;
  generated_at: string;
  mode: string;
  prob_home: number | null;
  prob_draw: number | null;
  prob_away: number | null;
  predicted_result: string | null;
  /** V2 confidence level: HIGH | MEDIUM | LOW | INSUFFICIENT (null for V1) */
  confidence_level: string | null;
  /** V2 eligibility: ELIGIBLE | LIMITED | NOT_ELIGIBLE (null for V1 — uses mode) */
  eligibility_status: string | null;
  lambda_home: number | null;
  lambda_away: number | null;
}

export interface PredictionCompareResponse {
  matchId: string;
  v1: CompareEntry | null;
  v2: CompareEntry | null;
}

// ── Field extractor for V1 (from PredictionSnapshot.response_payload_json) ─────

function extractV1Fields(responseJson: string): Pick<
  CompareEntry,
  'prob_home' | 'prob_draw' | 'prob_away' | 'predicted_result' | 'lambda_home' | 'lambda_away' | 'mode'
> {
  try {
    const r = JSON.parse(responseJson) as Record<string, unknown>;
    const core = r['core'] as Record<string, unknown> | undefined;
    const raw = r['raw_1x2'] as Record<string, unknown> | undefined;
    const cal = core?.['calibrated_1x2'] as Record<string, unknown> | undefined;
    const probs1x2 = cal ?? (raw as Record<string, unknown> | undefined);
    const internals = r['internals'] as Record<string, unknown> | undefined;

    const prob_home = typeof probs1x2?.['home'] === 'number' ? probs1x2['home'] : null;
    const prob_draw = typeof probs1x2?.['draw'] === 'number' ? probs1x2['draw'] : null;
    const prob_away = typeof probs1x2?.['away'] === 'number' ? probs1x2['away'] : null;
    const predicted_result = typeof core?.['predicted_result'] === 'string'
      ? (core['predicted_result'] as string)
      : null;
    const lambdas = internals?.['lambdas'] as Record<string, unknown> | undefined;
    const lambda_home = typeof lambdas?.['lambda_home'] === 'number' ? lambdas['lambda_home'] : null;
    const lambda_away = typeof lambdas?.['lambda_away'] === 'number' ? lambdas['lambda_away'] : null;
    const mode = typeof r['operating_mode'] === 'string'
      ? (r['operating_mode'] as string)
      : typeof r['eligibility_status'] === 'string'
        ? (r['eligibility_status'] as string)
        : 'UNKNOWN';

    return { prob_home, prob_draw, prob_away, predicted_result, lambda_home, lambda_away, mode };
  } catch {
    return { prob_home: null, prob_draw: null, prob_away: null, predicted_result: null, lambda_home: null, lambda_away: null, mode: 'UNKNOWN' };
  }
}

// ── Field extractor for V2 (from V2StoredPrediction.output) ────────────────────

function extractV2Fields(output: Record<string, unknown>): Pick<
  CompareEntry,
  'prob_home' | 'prob_draw' | 'prob_away' | 'predicted_result' | 'confidence_level' |
  'eligibility_status' | 'lambda_home' | 'lambda_away' | 'mode'
> {
  const prob_home = typeof output['prob_home_win'] === 'number' ? output['prob_home_win'] : null;
  const prob_draw = typeof output['prob_draw'] === 'number' ? output['prob_draw'] : null;
  const prob_away = typeof output['prob_away_win'] === 'number' ? output['prob_away_win'] : null;
  const lambda_home = typeof output['lambda_home'] === 'number' ? output['lambda_home'] : null;
  const lambda_away = typeof output['lambda_away'] === 'number' ? output['lambda_away'] : null;
  const confidence_level = typeof output['confidence_level'] === 'string'
    ? (output['confidence_level'] as string) : null;
  const eligibility_status = typeof output['eligibility_status'] === 'string'
    ? (output['eligibility_status'] as string) : null;

  // Derive a mode-like field from eligibility for consistency with V1 shape
  const mode = eligibility_status === 'NOT_ELIGIBLE' ? 'NOT_ELIGIBLE' : 'FULL_MODE';

  // V2 does not compute a predicted_result (no TOO_CLOSE/decision policy yet)
  const predicted_result = null;

  return { prob_home, prob_draw, prob_away, predicted_result, confidence_level, eligibility_status, lambda_home, lambda_away, mode };
}

// ── Route registration ─────────────────────────────────────────────────────────

export function registerCompareRoute(
  fastify: FastifyInstance,
  v1Store: PredictionStore,
  v2Store: V2PredictionStore,
  isPredictionsEnabled: () => boolean,
): void {
  fastify.get('/api/ui/predictions/compare', async (request, reply) => {
    // Gate: features.predictions must be enabled
    if (!isPredictionsEnabled()) {
      return reply.status(403).send({ error: 'predictions feature not enabled' });
    }

    const query = request.query as Record<string, unknown>;
    const matchId = query.matchId;
    if (!matchId || typeof matchId !== 'string') {
      return reply.status(400).send({ error: 'matchId query param is required' });
    }

    // ── V1: latest snapshot from unified store ─────────────────────────────
    const v1Snapshots = v1Store.findByMatch(matchId);
    const latestV1 = v1Snapshots.length > 0 ? v1Snapshots[0] : null;

    let v1Entry: CompareEntry | null = null;
    if (latestV1 && latestV1.generation_status === 'ok') {
      const fields = extractV1Fields(latestV1.response_payload_json);
      v1Entry = {
        engine_id: latestV1.engine_id ?? 'v1_elo_poisson',
        generated_at: latestV1.generated_at,
        mode: fields.mode,
        prob_home: fields.prob_home,
        prob_draw: fields.prob_draw,
        prob_away: fields.prob_away,
        predicted_result: fields.predicted_result,
        confidence_level: null,
        eligibility_status: null,
        lambda_home: fields.lambda_home,
        lambda_away: fields.lambda_away,
      };
    }

    // ── V2: from V2PredictionStore ─────────────────────────────────────────
    const latestV2 = v2Store.get(matchId);

    let v2Entry: CompareEntry | null = null;
    if (latestV2) {
      const fields = extractV2Fields(latestV2.output as unknown as Record<string, unknown>);
      v2Entry = {
        engine_id: 'v2_structural_attack_defense',
        generated_at: latestV2.computedAt,
        mode: fields.mode,
        prob_home: fields.prob_home,
        prob_draw: fields.prob_draw,
        prob_away: fields.prob_away,
        predicted_result: fields.predicted_result,
        confidence_level: fields.confidence_level,
        eligibility_status: fields.eligibility_status,
        lambda_home: fields.lambda_home,
        lambda_away: fields.lambda_away,
      };
    }

    const response: PredictionCompareResponse = {
      matchId,
      v1: v1Entry,
      v2: v2Entry,
    };

    reply
      .header('Cache-Control', 'no-store')
      .send(response);
  });
}
