/**
 * PE evaluation endpoint — internal inspection of evaluation records + metrics.
 *
 * GET /api/internal/evaluation?competitionId=&limit=
 *
 * Gated by PREDICTION_INTERNAL_VIEW_ENABLED env var — 404 if not set.
 * Metrics are recomputed on-demand (no caching).
 * Cache-Control: no-store
 *
 * OE-5 — PE Observation & Evaluation Plan v1.1
 */

import type { FastifyInstance } from 'fastify';
import { EvaluationStore } from './evaluation-store.js';
import { computeMetrics } from './metrics-engine.js';

function isEndpointEnabled(): boolean {
  const val = process.env.PREDICTION_INTERNAL_VIEW_ENABLED;
  return typeof val === 'string' && val.trim().length > 0;
}

export function registerEvaluationRoute(
  app: FastifyInstance,
  evaluationStore: EvaluationStore,
): void {
  app.get('/api/internal/evaluation', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');

    if (!isEndpointEnabled()) {
      return reply.code(404).send({ error: 'Not available' });
    }

    const q = req.query as Record<string, string>;
    const { competitionId } = q;
    const rawLimit = parseInt(q['limit'] ?? '0', 10);
    const limit = isNaN(rawLimit) || rawLimit <= 0 ? undefined : rawLimit;

    // Fetch records
    let records = competitionId
      ? evaluationStore.findByCompetition(competitionId)
      : evaluationStore.findAll();

    // Sort by scheduled_kickoff_utc descending
    records = records.sort((a, b) =>
      b.scheduled_kickoff_utc.localeCompare(a.scheduled_kickoff_utc),
    );

    // Compute metrics on the full unsliced set (metrics over all records for the competition)
    const metrics = computeMetrics(records);

    // Apply limit to records list only
    const paginatedRecords = limit !== undefined ? records.slice(0, limit) : records;

    return reply.send({
      ...metrics,
      records: paginatedRecords,
    });
  });
}
