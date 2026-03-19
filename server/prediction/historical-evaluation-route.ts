/**
 * GET /api/internal/historical-evaluation
 *
 * Serves HistoricalBacktestSnapshot[] + HistoricalEvaluationReport for the
 * internal lab page (/labs/evaluacion-historica).
 *
 * Strictly segregated from /api/internal/evaluation (forward EvaluationRecord).
 * source_type = 'HISTORICAL_BACKTEST' on every record in the response.
 *
 * Supports ?engine=v3|nexus|compare (default: v3 for backwards compatibility).
 *
 * Gated by PREDICTION_INTERNAL_VIEW_ENABLED.
 * Cache-Control: no-store.
 *
 * H5 — Internal Evaluation UI
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { HistoricalBacktestStore } from './historical-backtest-store.js';
import {
  computeHistoricalEvaluation,
} from './historical-evaluator.js';
import { NexusShadowReader, deriveArgmax } from './nexus-shadow-reader.js';
import type { NexusUnifiedItem } from './nexus-shadow-reader.js';
import { EvaluationStore } from './evaluation-store.js';

function isEndpointEnabled(): boolean {
  const val = process.env.PREDICTION_INTERNAL_VIEW_ENABLED;
  return typeof val === 'string' && val.trim().length > 0;
}

function computeNexusReport(
  nexusSnapshots: NexusUnifiedItem[],
  evaluationStore: EvaluationStore,
) {
  const records = evaluationStore.findAll().filter((r) => r.record_status === 'COMPLETE');
  const recordByMatchId = new Map(records.map((r) => [r.match_id, r]));

  let correct = 0;
  let brierSum = 0;
  let logLossSum = 0;
  const evaluated: Array<{
    match_id: string;
    kickoff_utc: string;
    predicted: string;
    actual: string;
    correct: boolean;
    p_home: number;
    p_draw: number;
    p_away: number;
  }> = [];

  for (const snap of nexusSnapshots) {
    const rec = recordByMatchId.get(snap.match_id);
    if (!rec || !rec.actual_result) continue;

    const ph = snap.p_home_win ?? 0;
    const pd = snap.p_draw ?? 0;
    const pa = snap.p_away_win ?? 0;
    const predicted = snap.predicted_result ?? deriveArgmax({ home: ph, draw: pd, away: pa });
    const actual = rec.actual_result;

    const isCorrect = predicted === actual;
    if (isCorrect) correct++;

    // Brier: sum of squared differences for all 3 outcomes
    const actualH = actual === 'HOME_WIN' ? 1 : 0;
    const actualD = actual === 'DRAW' ? 1 : 0;
    const actualA = actual === 'AWAY_WIN' ? 1 : 0;
    brierSum += ((ph - actualH) ** 2 + (pd - actualD) ** 2 + (pa - actualA) ** 2) / 3;

    // Log-loss for the actual outcome
    const pActual = actual === 'HOME_WIN' ? ph : actual === 'DRAW' ? pd : pa;
    logLossSum += -Math.log(Math.max(pActual, 1e-7));

    evaluated.push({
      match_id: snap.match_id,
      kickoff_utc: snap.kickoff_utc,
      predicted,
      actual,
      correct: isCorrect,
      p_home: ph,
      p_draw: pd,
      p_away: pa,
    });
  }

  const n = evaluated.length;
  return {
    accuracy: n > 0 ? correct / n : null,
    brier_score: n > 0 ? brierSum / n : null,
    log_loss: n > 0 ? logLossSum / n : null,
    total_evaluated: n,
    snapshots: evaluated,
  };
}

export function registerHistoricalEvaluationRoute(
  app: FastifyInstance,
  store: HistoricalBacktestStore,
  nexusReader: NexusShadowReader,
  evaluationStore: EvaluationStore,
): void {
  app.get('/api/internal/historical-evaluation', async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');

    if (!isEndpointEnabled()) {
      return reply.code(404).send({ error: 'Not available' });
    }

    const q = req.query as Record<string, string>;
    const competitionCode = q['competitionCode'] ?? 'PD';
    const engine = q['engine'] ?? 'v3';

    // ── V3 (default) ──────────────────────────────────────────────────────────
    if (engine === 'v3') {
      const snapshots = store.findByCompetition(competitionCode);
      const report = computeHistoricalEvaluation(snapshots, competitionCode);
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
    }

    // ── NEXUS ─────────────────────────────────────────────────────────────────
    if (engine === 'nexus') {
      const now = new Date().toISOString();
      const allNexus = nexusReader
        .findAll()
        .filter(
          (item) =>
            item.competition_id.endsWith(`:${competitionCode}`) &&
            item.kickoff_utc < now,
        );
      const nexusReport = computeNexusReport(allNexus, evaluationStore);
      return reply.send({
        source_type: 'NEXUS_SHADOW',
        competition_code: competitionCode,
        snapshot_count: allNexus.length,
        report: {
          accuracy: nexusReport.accuracy,
          brier_score: nexusReport.brier_score,
          log_loss: nexusReport.log_loss,
          total_evaluated: nexusReport.total_evaluated,
          snapshots: nexusReport.snapshots,
        },
      });
    }

    // ── COMPARE ───────────────────────────────────────────────────────────────
    if (engine === 'compare') {
      // V3 side
      const v3Snapshots = store.findByCompetition(competitionCode);
      const v3Report = computeHistoricalEvaluation(v3Snapshots, competitionCode);

      // NEXUS side
      const now = new Date().toISOString();
      const allNexus = nexusReader
        .findAll()
        .filter(
          (item) =>
            item.competition_id.endsWith(`:${competitionCode}`) &&
            item.kickoff_utc < now,
        );
      const nexusReport = computeNexusReport(allNexus, evaluationStore);

      // Overlap: match_ids present in both evaluated sets
      // v3Snapshots are HistoricalBacktestSnapshot[], correct = predicted_result === actual_result
      const v3EligibleSnaps = v3Snapshots.filter(
        (s) => s.predicted_result !== null && s.actual_result !== null,
      );
      const v3MatchIds = new Set(v3EligibleSnaps.map((s) => s.match_id));
      const nexusMatchIds = new Set(nexusReport.snapshots.map((s) => s.match_id));
      const overlapIds = [...v3MatchIds].filter((id) => nexusMatchIds.has(id));

      const v3OverlapCorrect = v3EligibleSnaps
        .filter((s) => overlapIds.includes(s.match_id) && s.predicted_result === s.actual_result)
        .length;
      const nexusOverlapCorrect = nexusReport.snapshots
        .filter((s) => overlapIds.includes(s.match_id) && s.correct).length;

      const overlapN = overlapIds.length;
      // Use overall model brier from the full v3 report's full_mode_metrics
      const v3OverlapBrier = v3Report.full_mode_metrics?.brier_score ?? null;
      const nexusOverlapBrier = nexusReport.brier_score;

      return reply.send({
        mode: 'compare',
        v3: {
          source_type: 'HISTORICAL_BACKTEST',
          competition_code: competitionCode,
          snapshot_count: v3Snapshots.length,
          report: v3Report,
        },
        nexus: {
          source_type: 'NEXUS_SHADOW',
          competition_code: competitionCode,
          snapshot_count: allNexus.length,
          report: {
            accuracy: nexusReport.accuracy,
            brier_score: nexusReport.brier_score,
            log_loss: nexusReport.log_loss,
            total_evaluated: nexusReport.total_evaluated,
          },
        },
        overlap: {
          match_count: overlapN,
          v3_accuracy: overlapN > 0 ? v3OverlapCorrect / overlapN : null,
          nexus_accuracy: overlapN > 0 ? nexusOverlapCorrect / overlapN : null,
          v3_brier: v3OverlapBrier,
          nexus_brier: nexusOverlapBrier,
        },
      });
    }

    return reply.code(400).send({ error: `Unknown engine value: "${engine}". Use v3, nexus, or compare.` });
  });
}
