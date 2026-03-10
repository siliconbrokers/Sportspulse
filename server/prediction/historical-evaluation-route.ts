/**
 * GET /api/internal/historical-evaluation
 *
 * Serves HistoricalBacktestSnapshot[] + HistoricalEvaluationReport for the
 * internal lab page (/labs/evaluacion-historica).
 *
 * Strictly segregated from /api/internal/evaluation (forward EvaluationRecord).
 * source_type = 'HISTORICAL_BACKTEST' on every record in the response.
 *
 * Gated by PREDICTION_INTERNAL_VIEW_ENABLED.
 * Cache-Control: no-store.
 *
 * H5 — Internal Evaluation UI
 */

import type { FastifyInstance } from 'fastify';
import { HistoricalBacktestStore } from './historical-backtest-store.js';
import {
  computeHistoricalEvaluation,
} from './historical-evaluator.js';

function isEndpointEnabled(): boolean {
  const val = process.env.PREDICTION_INTERNAL_VIEW_ENABLED;
  return typeof val === 'string' && val.trim().length > 0;
}

export function registerHistoricalEvaluationRoute(
  app: FastifyInstance,
  store: HistoricalBacktestStore,
): void {
  app.get('/api/internal/historical-evaluation', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');

    if (!isEndpointEnabled()) {
      return reply.code(404).send({ error: 'Not available' });
    }

    const q = req.query as Record<string, string>;
    const competitionCode = q['competitionCode'] ?? 'PD';

    const snapshots = store.findByCompetition(competitionCode);

    // If no snapshots for competition, still return empty report
    const report = computeHistoricalEvaluation(snapshots, competitionCode);

    // Sort snapshots by kickoff descending for display
    const sorted = [...snapshots].sort((a, b) =>
      b.kickoff_utc.localeCompare(a.kickoff_utc),
    );

    return reply.send({
      source_type: 'HISTORICAL_BACKTEST',
      competition_code: competitionCode,
      snapshot_count: snapshots.length,
      report,
      snapshots: sorted,
    });
  });
}
