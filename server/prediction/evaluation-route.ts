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

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EvaluationStore } from './evaluation-store.js';
import type { EvaluationRecord } from './evaluation-store.js';
import { computeMetrics } from './metrics-engine.js';
import { NexusShadowReader, deriveArgmax } from './nexus-shadow-reader.js';
import type { NexusShadowSnapshot } from './nexus-shadow-runner.js';

function isEndpointEnabled(): boolean {
  const val = process.env.PREDICTION_INTERNAL_VIEW_ENABLED;
  return typeof val === 'string' && val.trim().length > 0;
}

// ── Build synthetic EvaluationRecord from a NEXUS snapshot ───────────────────

function buildSyntheticRecord(
  snap: NexusShadowSnapshot & { predicted_result: string },
  groundTruth: EvaluationRecord | undefined,
): EvaluationRecord {
  const hasGroundTruth =
    groundTruth?.actual_result !== null && groundTruth?.actual_result !== undefined;

  return {
    match_id:               snap.matchId,
    competition_id:         snap.competitionId,
    home_team_id:           '',
    away_team_id:           '',
    scheduled_kickoff_utc:  snap.kickoffUtc,

    record_status:          hasGroundTruth ? 'COMPLETE' : 'SNAPSHOT_FROZEN',
    snapshot_id:            `nexus:${snap.matchId}`,
    snapshot_frozen_at:     snap.createdAtUtc,
    snapshot_generated_at:  snap.buildNowUtc,
    engine_version:         snap.modelVersion,
    spec_version:           snap.featureSchemaVersion,
    prediction_available:   true,

    evaluation_eligible:    hasGroundTruth,
    excluded_reason:        null,

    mode:                   `nexus:${snap.ensembleConfidence}`,
    calibration_mode:       snap.calibrationSource,
    predicted_result:       snap.predicted_result,
    p_home_win:             snap.probs.home,
    p_draw:                 snap.probs.draw,
    p_away_win:             snap.probs.away,
    expected_goals_home:    null,
    expected_goals_away:    null,
    reasons: [
      `track4=${snap.track4Status}`,
      `calibration=${snap.calibrationSource}`,
      `confidence=${snap.ensembleConfidence}`,
    ],

    ground_truth_status:      hasGroundTruth ? 'CAPTURED' : 'PENDING',
    ground_truth_captured_at: groundTruth?.ground_truth_captured_at ?? null,
    final_home_goals:         groundTruth?.final_home_goals ?? null,
    final_away_goals:         groundTruth?.final_away_goals ?? null,
    actual_result:            groundTruth?.actual_result ?? null,

    market_prob_home:         null,
    market_prob_draw:         null,
    market_prob_away:         null,
    market_odds_captured_at:  null,
    market_bookmaker_count:   null,
    edge_home:                null,
    edge_draw:                null,
    edge_away:                null,

    ui_render_result:         null,
    ui_clear_or_confusing:    null,
    runtime_issue:            null,
    runtime_notes:            null,
  };
}

// ── Inline overlap metrics ─────────────────────────────────────────────────────

const EPSILON = 1e-15;

interface OverlapMetrics {
  match_count: number;
  v3_accuracy: number | null;
  nexus_accuracy: number | null;
  v3_brier: number | null;
  nexus_brier: number | null;
  v3_log_loss: number | null;
  nexus_log_loss: number | null;
}

function computeOverlap(
  v3Records: EvaluationRecord[],
  nexusRecords: EvaluationRecord[],
): OverlapMetrics {
  // Build lookup maps
  const v3Map = new Map(v3Records.map((r) => [r.match_id, r]));
  const nexusMap = new Map(nexusRecords.map((r) => [r.match_id, r]));

  // Intersection: both engines predicted and ground truth is known
  const overlapIds: string[] = [];
  for (const [id, v3r] of v3Map) {
    const nxr = nexusMap.get(id);
    if (
      nxr &&
      v3r.predicted_result !== null &&
      nxr.predicted_result !== null &&
      v3r.actual_result !== null &&
      nxr.actual_result !== null
    ) {
      overlapIds.push(id);
    }
  }

  if (overlapIds.length === 0) {
    return {
      match_count: 0,
      v3_accuracy: null,
      nexus_accuracy: null,
      v3_brier: null,
      nexus_brier: null,
      v3_log_loss: null,
      nexus_log_loss: null,
    };
  }

  let v3Correct = 0, nexusCorrect = 0;
  let v3BrierSum = 0, nexusBrierSum = 0;
  let v3LLSum = 0, nexusLLSum = 0;
  const n = overlapIds.length;

  for (const id of overlapIds) {
    const v3r = v3Map.get(id)!;
    const nxr = nexusMap.get(id)!;
    const actual = v3r.actual_result!;

    if (v3r.predicted_result === actual) v3Correct++;
    if (nxr.predicted_result === actual) nexusCorrect++;

    // Brier: only if probabilities available
    if (
      v3r.p_home_win !== null && v3r.p_draw !== null && v3r.p_away_win !== null
    ) {
      const hw = v3r.p_home_win, dr = v3r.p_draw, aw = v3r.p_away_win;
      v3BrierSum +=
        Math.pow(hw - (actual === 'HOME_WIN' ? 1 : 0), 2) +
        Math.pow(dr - (actual === 'DRAW' ? 1 : 0), 2) +
        Math.pow(aw - (actual === 'AWAY_WIN' ? 1 : 0), 2);
    }
    if (
      nxr.p_home_win !== null && nxr.p_draw !== null && nxr.p_away_win !== null
    ) {
      const hw = nxr.p_home_win, dr = nxr.p_draw, aw = nxr.p_away_win;
      nexusBrierSum +=
        Math.pow(hw - (actual === 'HOME_WIN' ? 1 : 0), 2) +
        Math.pow(dr - (actual === 'DRAW' ? 1 : 0), 2) +
        Math.pow(aw - (actual === 'AWAY_WIN' ? 1 : 0), 2);
    }

    // Log-loss
    if (
      v3r.p_home_win !== null && v3r.p_draw !== null && v3r.p_away_win !== null
    ) {
      const p =
        actual === 'HOME_WIN' ? v3r.p_home_win
        : actual === 'DRAW' ? v3r.p_draw
        : v3r.p_away_win;
      v3LLSum -= Math.log(Math.max(p, EPSILON));
    }
    if (
      nxr.p_home_win !== null && nxr.p_draw !== null && nxr.p_away_win !== null
    ) {
      const p =
        actual === 'HOME_WIN' ? nxr.p_home_win
        : actual === 'DRAW' ? nxr.p_draw
        : nxr.p_away_win;
      nexusLLSum -= Math.log(Math.max(p, EPSILON));
    }
  }

  return {
    match_count:    n,
    v3_accuracy:    v3Correct / n,
    nexus_accuracy: nexusCorrect / n,
    v3_brier:       v3BrierSum / n,
    nexus_brier:    nexusBrierSum / n,
    v3_log_loss:    v3LLSum / n,
    nexus_log_loss: nexusLLSum / n,
  };
}

// ── registerEvaluationRoute ───────────────────────────────────────────────────

export function registerEvaluationRoute(
  app: FastifyInstance,
  evaluationStore: EvaluationStore,
  nexusReader: NexusShadowReader,
): void {
  app.get('/api/internal/evaluation', async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');

    if (!isEndpointEnabled()) {
      return reply.code(404).send({ error: 'Not available' });
    }

    const q = req.query as Record<string, string>;
    const { competitionId } = q;
    const rawLimit = parseInt(q['limit'] ?? '0', 10);
    const limit = isNaN(rawLimit) || rawLimit <= 0 ? undefined : rawLimit;

    // Parse engine filter (default: v3 — do NOT break current behaviour)
    const engine = (q['engine'] ?? 'v3') as 'v3' | 'nexus' | 'compare';

    // ── engine=v3: current behaviour unchanged ──────────────────────────────
    if (engine === 'v3') {
      let records = competitionId
        ? evaluationStore.findByCompetition(competitionId)
        : evaluationStore.findAll();

      records = records.sort((a, b) =>
        b.scheduled_kickoff_utc.localeCompare(a.scheduled_kickoff_utc),
      );

      const metrics = computeMetrics(records);
      const paginatedRecords = limit !== undefined ? records.slice(0, limit) : records;

      return reply.send({ ...metrics, records: paginatedRecords });
    }

    // ── Build NEXUS synthetic records ───────────────────────────────────────

    const nexusUnified = competitionId
      ? nexusReader.findByCompetition(competitionId)
      : nexusReader.findAll();

    const syntheticNexusRecords: EvaluationRecord[] = nexusUnified.map((item) => {
      const groundTruth = evaluationStore.findByMatch(item.match_id);

      // Reconstruct minimal NexusShadowSnapshot from the unified item's payloads
      const respPayload = item.response_payload as {
        probs: { home: number; draw: number; away: number };
        calibrationVersion: string;
        modelVersion: string;
      };
      const reqPayload = item.request_payload as {
        weights: { track12: number; track3: number; track4: number };
        featureSchemaVersion: string;
        datasetWindow: string;
      };

      const reasons = item.reasons;
      const track4Status = reasons.find((r) => r.startsWith('track4='))?.replace('track4=', '') ?? '';
      const calibrationSource = item.calibration_mode ?? '';
      const ensembleConfidence = item.mode.replace('nexus:', '');

      const snap: NexusShadowSnapshot & { predicted_result: string } = {
        matchId:              item.match_id,
        competitionId:        item.competition_id,
        buildNowUtc:          item.generated_at, // createdAtUtc is the best proxy available here
        kickoffUtc:           groundTruth?.scheduled_kickoff_utc ?? '',
        featureSchemaVersion: reqPayload?.featureSchemaVersion ?? '',
        datasetWindow:        reqPayload?.datasetWindow ?? '',
        modelVersion:         item.engine_version,
        calibrationVersion:   respPayload?.calibrationVersion ?? '',
        probs:                respPayload?.probs ?? { home: 0, draw: 0, away: 0 },
        weights:              reqPayload?.weights ?? { track12: 0, track3: 0, track4: 0 },
        track4Status,
        calibrationSource,
        ensembleConfidence,
        createdAtUtc:         item.generated_at,
        predicted_result:     item.predicted_result ?? deriveArgmax(respPayload?.probs ?? { home: 0, draw: 0, away: 0 }),
      };

      return buildSyntheticRecord(snap, groundTruth);
    });

    const sortedNexus = syntheticNexusRecords.sort((a, b) =>
      b.scheduled_kickoff_utc.localeCompare(a.scheduled_kickoff_utc),
    );

    // ── engine=nexus ────────────────────────────────────────────────────────
    if (engine === 'nexus') {
      const metrics = computeMetrics(sortedNexus);
      const paginatedRecords = limit !== undefined ? sortedNexus.slice(0, limit) : sortedNexus;
      return reply.send({ ...metrics, records: paginatedRecords });
    }

    // ── engine=compare ──────────────────────────────────────────────────────
    let v3Records = competitionId
      ? evaluationStore.findByCompetition(competitionId)
      : evaluationStore.findAll();
    v3Records = v3Records.sort((a, b) =>
      b.scheduled_kickoff_utc.localeCompare(a.scheduled_kickoff_utc),
    );

    const metricsV3 = computeMetrics(v3Records);
    const metricsNexus = computeMetrics(sortedNexus);
    const overlap = computeOverlap(v3Records, sortedNexus);

    const paginatedV3 = limit !== undefined ? v3Records.slice(0, limit) : v3Records;
    const paginatedNexus = limit !== undefined ? sortedNexus.slice(0, limit) : sortedNexus;

    return reply.send({
      mode: 'compare',
      v3:    { ...metricsV3,    records: paginatedV3 },
      nexus: { ...metricsNexus, records: paginatedNexus },
      overlap,
    });
  });
}
