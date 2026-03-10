/**
 * PE-75: Internal inspection endpoint for the Predictive Engine.
 *
 * GET /api/internal/predictions
 *
 * Query params:
 *   ?matchId=      — inspect a specific match (takes priority over competitionId)
 *   ?competitionId= — list recent predictions for a competition
 *   ?limit=        — max results (default 20, min 1, max 100)
 *
 * Gating: enabled if PREDICTION_INTERNAL_VIEW_ENABLED is non-empty.
 * Returns 404 if the flag is off.
 */

import type { FastifyInstance } from 'fastify';
import { PredictionStore } from './prediction-store.js';

// ── Response shape ─────────────────────────────────────────────────────────────

interface InspectionItem {
  // -- Identity --
  match_id: string;
  competition_id: string;
  generated_at: string;
  engine_version: string;
  generation_status: 'ok' | 'error';
  error_detail?: string;

  // -- Mode and reasons --
  mode: string;
  calibration_mode: string | null;
  reasons: string[];
  degradation_notes: string[];

  // -- P1 core probabilities --
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  predicted_result: string | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;

  // -- P2 extended --
  favorite_margin: number | null;
  draw_risk: number | null;

  // -- Full payloads --
  request_payload: unknown;
  response_payload: unknown;
}

// ── Helper: extract core probabilities from a parsed PredictionResponse ────────

function extractCoreFields(response: unknown): Pick<
  InspectionItem,
  | 'p_home_win' | 'p_draw' | 'p_away_win' | 'predicted_result'
  | 'expected_goals_home' | 'expected_goals_away'
  | 'favorite_margin' | 'draw_risk'
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
    p_home_win:           num(core?.['p_home_win']),
    p_draw:               num(core?.['p_draw']),
    p_away_win:           num(core?.['p_away_win']),
    predicted_result:     str(core?.['predicted_result']),
    expected_goals_home:  num(core?.['expected_goals_home']),
    expected_goals_away:  num(core?.['expected_goals_away']),
    favorite_margin:      num(core?.['favorite_margin']),
    draw_risk:            num(core?.['draw_risk']),
  };
}

// ── Helper: safely parse a JSON string, returning null on failure ──────────────

function safeParse(json: string, context: string): unknown {
  try {
    return JSON.parse(json);
  } catch (err) {
    console.error(`[InspectionRoute] JSON parse failed for ${context}:`, err);
    return null;
  }
}

// ── Helper: parse reasons array from reasons_json ─────────────────────────────

function parseReasons(json: string): string[] {
  const parsed = safeParse(json, 'reasons_json');
  if (!Array.isArray(parsed)) return [];
  return parsed.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)));
}

// ── Helper: parse degradation notes from degradation_flags_json ───────────────

function parseDegradationNotes(json: string): string[] {
  const parsed = safeParse(json, 'degradation_flags_json');
  if (!Array.isArray(parsed)) return [];
  return parsed.map((f) => (typeof f === 'string' ? f : JSON.stringify(f)));
}

// ── isEndpointEnabled ──────────────────────────────────────────────────────────

function isEndpointEnabled(): boolean {
  const val = process.env.PREDICTION_INTERNAL_VIEW_ENABLED;
  return typeof val === 'string' && val.trim().length > 0;
}

// ── registerInspectionRoute ───────────────────────────────────────────────────

export function registerInspectionRoute(app: FastifyInstance, store: PredictionStore): void {
  app.get('/api/internal/predictions', async (req, reply) => {
    // Gate: endpoint is off if no competition is in the internal view list
    if (!isEndpointEnabled()) {
      return reply.code(404).send({ error: 'Not available' });
    }

    const q = req.query as Record<string, string>;

    // Parse limit (default 20, clamp 1..100)
    const rawLimit = parseInt(q['limit'] ?? '20', 10);
    const limit = isNaN(rawLimit) ? 20 : Math.min(100, Math.max(1, rawLimit));

    // Resolve which snapshots to return
    const { matchId, competitionId } = q;
    let snapshots;
    if (matchId) {
      snapshots = store.findByMatch(matchId).slice(0, limit);
    } else if (competitionId) {
      snapshots = store.findByCompetition(competitionId, limit);
    } else {
      snapshots = store.findAll(limit);
    }

    // Build response items
    const items: InspectionItem[] = snapshots.map((snap) => {
      const requestPayload = safeParse(snap.request_payload_json, `request_payload[${snap.match_id}]`);
      const responsePayload = safeParse(snap.response_payload_json, `response_payload[${snap.match_id}]`);

      const coreFields = responsePayload !== null
        ? extractCoreFields(responsePayload)
        : {
            p_home_win: null,
            p_draw: null,
            p_away_win: null,
            predicted_result: null,
            expected_goals_home: null,
            expected_goals_away: null,
            favorite_margin: null,
            draw_risk: null,
          };

      const item: InspectionItem = {
        match_id:           snap.match_id,
        competition_id:     snap.competition_id,
        generated_at:       snap.generated_at,
        engine_version:     snap.engine_version,
        generation_status:  snap.generation_status,
        mode:               snap.mode,
        calibration_mode:   snap.calibration_mode,
        reasons:            parseReasons(snap.reasons_json),
        degradation_notes:  parseDegradationNotes(snap.degradation_flags_json),
        request_payload:    requestPayload,
        response_payload:   responsePayload,
        ...coreFields,
      };

      if (snap.error_detail !== undefined) {
        item.error_detail = snap.error_detail;
      }

      return item;
    });

    reply.header('Cache-Control', 'no-store');
    return reply.send({ items, count: items.length });
  });
}
