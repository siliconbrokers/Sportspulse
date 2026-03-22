/**
 * WP-05 — GET /api/ui/track-record
 *
 * Public route. No auth required.
 * Returns the prediction track record for a given competitionId.
 *
 * Acceptance: K-03 (track-record public surface)
 * Version impact: none
 * Note: reads existing prediction stores, no pipeline changes
 *
 * Rules:
 *   - evidence pool: FULL_MODE, pre-kickoff, resolved (COMPLETE + evaluation_eligible) records ONLY
 *   - threshold: 200 predictions
 *   - state: available / below_threshold / unavailable
 *   - accuracy null when state != available
 *   - ForwardValidationStore data for a competition → evaluationType=historical_walk_forward
 *   - EvaluationStore with ≥200 eligible records → evaluationType=operational, state=available
 *   - EvaluationStore with <200 eligible records → state=below_threshold
 *   - No data at all → state=unavailable
 *
 * Canonical errors (envelope: { error: { code, message, details: { reason, retryable } } }):
 *   400 BAD_REQUEST / INVALID_COMPETITION_ID
 *   404 NOT_FOUND / COMPETITION_NOT_ENABLED
 *
 * Note: state=unavailable is returned as 200 OK (valid resource state), not as a 503 error.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EvaluationStore } from '../prediction/evaluation-store.js';
import type { ForwardValidationStore } from '../prediction/forward-validation-store.js';
import { REGISTRY_BY_ID } from '../competition-registry.js';
import { isCompetitionActive } from '../portal-config-store.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const TRACK_RECORD_THRESHOLD = 200;

// ── DTO ───────────────────────────────────────────────────────────────────────

export interface TrackRecordDTO {
  competitionId: string;
  state: 'available' | 'below_threshold' | 'unavailable';
  predictionCount: number;
  accuracy: number | null;
  belowThreshold: boolean;
  evaluationType: 'operational' | 'historical_walk_forward';
  disclosureMessageKey:
    | 'TRACK_RECORD_OPERATIONAL'
    | 'TRACK_RECORD_HISTORICAL_WALK_FORWARD'
    | 'TRACK_RECORD_UNAVAILABLE';
  lastEvaluatedAt: string | null;
  threshold: number;
}

// ── Query type ────────────────────────────────────────────────────────────────

interface TrackRecordQuery {
  competitionId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derives the competition slug (e.g. 'PD', 'PL') from a full competition ID
 * (e.g. 'comp:apifootball:140' → 'PD').
 * Used to match ForwardValidationStore records which use competition_code = slug.
 */
function competitionSlug(competitionId: string): string | null {
  const entry = REGISTRY_BY_ID.get(competitionId);
  return entry ? entry.slug : null;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function registerTrackRecordRoute(
  app: FastifyInstance,
  evaluationStore: EvaluationStore,
  forwardValidationStore: ForwardValidationStore,
): Promise<void> {
  app.get<{ Querystring: TrackRecordQuery }>(
    '/api/ui/track-record',
    async (request: FastifyRequest<{ Querystring: TrackRecordQuery }>, reply: FastifyReply) => {
      const { competitionId } = request.query;

      // ── 1. Validate competitionId ──────────────────────────────────────────
      if (!competitionId || competitionId.trim() === '') {
        return reply.status(400).send({
          error: {
            code: 'INVALID_COMPETITION_ID',
            message: 'competitionId query parameter is required and must not be empty',
            details: { reason: 'MISSING_COMPETITION_ID', retryable: false },
          },
        });
      }

      // ── 2. Verify competition exists in registry ───────────────────────────
      const registryEntry = REGISTRY_BY_ID.get(competitionId);
      if (!registryEntry) {
        return reply.status(404).send({
          error: {
            code: 'COMPETITION_NOT_ENABLED',
            message: `Competition '${competitionId}' is not registered`,
            details: { reason: 'COMPETITION_NOT_ENABLED', retryable: false },
          },
        });
      }

      // ── 3. Verify competition is not disabled ──────────────────────────────
      if (!isCompetitionActive(competitionId)) {
        return reply.status(404).send({
          error: {
            code: 'COMPETITION_NOT_ENABLED',
            message: `Competition '${competitionId}' is not enabled`,
            details: { reason: 'COMPETITION_NOT_ENABLED', retryable: false },
          },
        });
      }

      // ── 4. ForwardValidationStore — historical_walk_forward ───────────────
      // If the ForwardValidationStore has officially frozen + resolved records
      // for this competition, use those as the primary evidence pool.
      const slug = competitionSlug(competitionId);
      if (slug) {
        const fwdRecords = forwardValidationStore
          .findByCompetition(slug)
          .filter(
            (r) =>
              r.snapshot_frozen_at !== null &&   // officially frozen (not diagnostic)
              r.actual_result !== null &&         // result captured
              r.evaluation_eligible &&
              r.mode === 'FULL_MODE' &&
              r.predicted_result !== null,
          );

        if (fwdRecords.length > 0) {
          const count = fwdRecords.length;
          const hits = fwdRecords.filter((r) => r.predicted_result === r.actual_result).length;
          const accuracy = count > 0 ? hits / count : null;

          const lastCapturedAt = fwdRecords
            .map((r) => r.result_captured_at)
            .filter((d): d is string => d !== null)
            .sort()
            .at(-1) ?? null;

          const state: TrackRecordDTO['state'] =
            count >= TRACK_RECORD_THRESHOLD ? 'available' : 'below_threshold';

          const dto: TrackRecordDTO = {
            competitionId,
            state,
            predictionCount: count,
            accuracy: state === 'available' ? accuracy : null,
            belowThreshold: state === 'below_threshold',
            evaluationType: 'historical_walk_forward',
            disclosureMessageKey:
              state === 'available'
                ? 'TRACK_RECORD_HISTORICAL_WALK_FORWARD'
                : 'TRACK_RECORD_UNAVAILABLE',
            lastEvaluatedAt: lastCapturedAt,
            threshold: TRACK_RECORD_THRESHOLD,
          };

          reply.header('Cache-Control', 'public, max-age=300');
          return reply.send(dto);
        }
      }

      // ── 5. EvaluationStore — operational ──────────────────────────────────
      // Filter for FULL_MODE, pre-kickoff (prediction_available=true), resolved records.
      const evalRecords = evaluationStore
        .findByCompetition(competitionId)
        .filter(
          (r) =>
            r.evaluation_eligible &&             // COMPLETE + excluded_reason=null + actual_result≠null
            r.mode === 'FULL_MODE' &&
            r.prediction_available &&            // pre-kickoff snapshot existed
            r.predicted_result !== null &&
            r.actual_result !== null,
        );

      if (evalRecords.length === 0) {
        const dto: TrackRecordDTO = {
          competitionId,
          state: 'unavailable',
          predictionCount: 0,
          accuracy: null,
          belowThreshold: false,
          evaluationType: 'operational',
          disclosureMessageKey: 'TRACK_RECORD_UNAVAILABLE',
          lastEvaluatedAt: null,
          threshold: TRACK_RECORD_THRESHOLD,
        };
        reply.header('Cache-Control', 'public, max-age=60');
        return reply.send(dto);
      }

      const count = evalRecords.length;
      const hits = evalRecords.filter((r) => r.predicted_result === r.actual_result).length;
      const accuracy = hits / count;

      const lastCapturedAt = evalRecords
        .map((r) => r.ground_truth_captured_at)
        .filter((d): d is string => d !== null)
        .sort()
        .at(-1) ?? null;

      const state: TrackRecordDTO['state'] =
        count >= TRACK_RECORD_THRESHOLD ? 'available' : 'below_threshold';

      const dto: TrackRecordDTO = {
        competitionId,
        state,
        predictionCount: count,
        accuracy: state === 'available' ? accuracy : null,
        belowThreshold: state === 'below_threshold',
        evaluationType: 'operational',
        disclosureMessageKey:
          state === 'available' ? 'TRACK_RECORD_OPERATIONAL' : 'TRACK_RECORD_UNAVAILABLE',
        lastEvaluatedAt: lastCapturedAt,
        threshold: TRACK_RECORD_THRESHOLD,
      };

      reply.header('Cache-Control', 'public, max-age=300');
      return reply.send(dto);
    },
  );
}
