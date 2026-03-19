/**
 * gate-evaluator.ts — NEXUS Promotion Gate Evaluator.
 *
 * Spec authority:
 *   - evaluation-and-promotion spec S6: Promotion Gate (all sections)
 *   - evaluation-and-promotion spec S6.1: Conjunction — ALL conditions required
 *   - evaluation-and-promotion spec S6.2: Volume conditions
 *   - evaluation-and-promotion spec S6.3: Metric conditions
 *   - evaluation-and-promotion spec S6.4: No-regression per-league
 *   - evaluation-and-promotion spec S6.5: Consistency (matchday-level)
 *   - evaluation-and-promotion spec S6.6: Live shadow condition (non-substitutable)
 *
 * PURE FUNCTION — receives scorecards as input, returns GateResult.
 * No IO, no Date.now(), no mutation.
 *
 * SPEC INVARIANT (S6.1):
 *   "A single failed condition blocks promotion."
 *   All conditions are evaluated regardless of prior failures so the full
 *   list of failedConditions is always populated for observability.
 *
 * NOTE ON PROMPT VS SPEC:
 * The implementation prompt described simplified thresholds:
 *   - RPS combined < RPS_V3 − 0.003
 *   - RPS live_shadow ≤ RPS_V3 + 0.005
 *   - Accuracy combined ≥ Accuracy_V3 − 0.5pp
 *   - DRAW recall ≥ 25%
 * The spec S6.3–S6.6 defines the full conditions above. THE SPEC GOVERNS.
 * In particular:
 *   - "RPS combined < RPS_V3 − 0.003" is not in the spec. Spec S6.3 requires
 *     only RPS_NEXUS < RPS_V3 (strictly better, no fixed delta).
 *   - "DRAW recall ≥ 25%" is absolute. Spec S6.3 requires preservation
 *     relative to V3: DRAW_recall_NEXUS >= DRAW_recall_V3 - 0.03.
 *   - Accuracy tolerance in spec is 0.02 (2pp), not 0.5pp.
 *
 * The prompt's DRAW recall absolute threshold (25%) is NOT in the spec.
 * The spec's relative threshold (V3_draw_recall - 0.03) is implemented.
 *
 * @module nexus/promotion/gate-evaluator
 */

import type {
  GateResult,
  GateEvidence,
  GateEvaluationInput,
  VolumeRequirements,
  PerformanceRequirements,
} from './types.js';
import {
  DEFAULT_VOLUME_REQUIREMENTS,
  DEFAULT_PERFORMANCE_REQUIREMENTS,
  GATE_CONDITION,
} from './types.js';
import type { GateConditionId } from './types.js';

// ── Gate evaluator ────────────────────────────────────────────────────────────

/**
 * Evaluate the NEXUS promotion gate against all conditions in spec S6.
 *
 * ALL conditions are evaluated regardless of prior failures, so the returned
 * GateResult.failedConditions is always the complete list of failures.
 *
 * PURE FUNCTION — no IO, no Date.now(), no mutation.
 *
 * @param input     Evaluation data (scorecards + metrics).
 * @param now       ISO 8601 UTC timestamp for the evaluatedAt field.
 * @param volumeReq Volume requirements (default: DEFAULT_VOLUME_REQUIREMENTS).
 * @param perfReq   Performance requirements (default: DEFAULT_PERFORMANCE_REQUIREMENTS).
 * @returns         GateResult with passed, failedConditions, and numeric evidence.
 */
export function evaluatePromotionGate(
  input: GateEvaluationInput,
  now: string,
  volumeReq: VolumeRequirements = DEFAULT_VOLUME_REQUIREMENTS,
  perfReq: PerformanceRequirements = DEFAULT_PERFORMANCE_REQUIREMENTS,
): GateResult {
  const failed: GateConditionId[] = [];

  // ── Build per-league maps ────────────────────────────────────────────────
  const perLeagueN: Record<string, number> = {};
  const perLeagueLiveShadowN: Record<string, number> = {};
  const perLeagueMatchdayCount: Record<string, number> = {};
  const perLeagueNexusRps: Record<string, number> = {};
  const perLeagueV3Rps: Record<string, number> = {};
  const perLeagueRpsDelta: Record<string, number> = {};
  const leaguesWhereNexusWins: string[] = [];

  for (const ls of input.leagueSummaries) {
    perLeagueN[ls.competitionId] = ls.n;
    perLeagueLiveShadowN[ls.competitionId] = ls.nLiveShadow;
    perLeagueMatchdayCount[ls.competitionId] = ls.matchdayCount;
    perLeagueNexusRps[ls.competitionId] = ls.nexusRps;
    perLeagueV3Rps[ls.competitionId] = ls.v3Rps;
    perLeagueRpsDelta[ls.competitionId] = ls.nexusRps - ls.v3Rps;
    if (ls.nexusRps < ls.v3Rps) {
      leaguesWhereNexusWins.push(ls.competitionId);
    }
  }

  // ── S6.2: Volume conditions ───────────────────────────────────────────────

  // Total predictions
  if (input.combinedN < volumeReq.minTotalPredictions) {
    failed.push(GATE_CONDITION.INSUFFICIENT_SAMPLES);
  }

  // Per-league minimum
  let perLeagueFailed = false;
  for (const ls of input.leagueSummaries) {
    if (ls.n < volumeReq.minPerLeague) {
      perLeagueFailed = true;
      break;
    }
  }
  if (perLeagueFailed) {
    failed.push(GATE_CONDITION.INSUFFICIENT_SAMPLES_PER_LEAGUE);
  }

  // Live shadow per-league minimum (S6.2 origin composition — non-substitutable)
  let liveShadowPerLeagueFailed = false;
  for (const ls of input.leagueSummaries) {
    if (ls.nLiveShadow < volumeReq.minLiveShadowPerLeague) {
      liveShadowPerLeagueFailed = true;
      break;
    }
  }
  if (liveShadowPerLeagueFailed) {
    failed.push(GATE_CONDITION.INSUFFICIENT_LIVE_SHADOW);
  }

  // Season phases (S6.2 + S4.4)
  if (input.seasonPhaseCount < volumeReq.minSeasonPhases) {
    failed.push(GATE_CONDITION.INSUFFICIENT_SEASON_PHASES);
  }

  // Matchdays per league
  let matchdayFailed = false;
  for (const ls of input.leagueSummaries) {
    if (ls.matchdayCount < volumeReq.minMatchdaysPerLeague) {
      matchdayFailed = true;
      break;
    }
  }
  if (matchdayFailed) {
    failed.push(GATE_CONDITION.INSUFFICIENT_MATCHDAYS);
  }

  // ── S6.3: Metric conditions ───────────────────────────────────────────────

  // RPS aggregate improvement (strictly better)
  if (input.combinedNexusRps >= input.combinedV3Rps) {
    failed.push(GATE_CONDITION.RPS_NO_IMPROVEMENT);
  }

  // RPS per-league majority (>= 2 of 3 production leagues)
  if (leaguesWhereNexusWins.length < perfReq.rpsLeagueMajorityCount) {
    failed.push(GATE_CONDITION.RPS_LEAGUE_MAJORITY_FAILED);
  }

  // DRAW recall preservation (relative to V3, tolerance = 0.03)
  const drawRecallDelta = input.combinedNexusDrawRecall - input.combinedV3DrawRecall;
  if (drawRecallDelta < -perfReq.drawRecallTolerancePp) {
    failed.push(GATE_CONDITION.DRAW_RECALL_REGRESSION);
  }

  // Accuracy preservation (relative to V3, tolerance = 0.02)
  const accuracyDelta = input.combinedNexusAccuracy - input.combinedV3Accuracy;
  if (accuracyDelta < -perfReq.accuracyTolerancePp) {
    failed.push(GATE_CONDITION.ACCURACY_REGRESSION);
  }

  // Log-loss preservation (max increase = 0.02)
  const logLossDelta = input.combinedNexusLogLoss - input.combinedV3LogLoss;
  if (logLossDelta > perfReq.logLossMaxIncrease) {
    failed.push(GATE_CONDITION.LOG_LOSS_REGRESSION);
  }

  // ── S6.4: No-regression per-league ────────────────────────────────────────

  // Every production league: RPS_NEXUS <= RPS_V3 + 0.005
  let perLeagueRegressionFailed = false;
  for (const ls of input.leagueSummaries) {
    if (ls.nexusRps > ls.v3Rps + perfReq.perLeagueRpsNoRegressionDelta) {
      perLeagueRegressionFailed = true;
      break;
    }
  }
  if (perLeagueRegressionFailed) {
    failed.push(GATE_CONDITION.PER_LEAGUE_RPS_REGRESSION);
  }

  // ── S6.5: Matchday consistency ────────────────────────────────────────────

  // NEXUS RPS < V3 RPS in >= 70% of evaluated matchdays
  const qualifyingMatchdays = input.matchdaySummaries.filter(
    (md) => md.nexusRps !== undefined && md.v3Rps !== undefined,
  );
  let matchdayConsistencyFraction = 1.0; // default: pass when no matchdays
  if (qualifyingMatchdays.length > 0) {
    const nexusWinsCount = qualifyingMatchdays.filter(
      (md) => md.nexusRps < md.v3Rps,
    ).length;
    matchdayConsistencyFraction = nexusWinsCount / qualifyingMatchdays.length;
    if (matchdayConsistencyFraction < perfReq.matchdayConsistencyMinFraction) {
      failed.push(GATE_CONDITION.MATCHDAY_CONSISTENCY_FAILED);
    }
  }

  // ── S6.6: Live shadow condition (non-substitutable) ───────────────────────

  // RPS_NEXUS_live_shadow <= RPS_V3_live_shadow + 0.005
  const liveShadowRpsDelta = input.liveShadowNexusRps - input.liveShadowV3Rps;
  if (liveShadowRpsDelta > perfReq.liveShadowRpsMaxDelta) {
    failed.push(GATE_CONDITION.LIVE_SHADOW_RPS_REGRESSION);
  }

  // ── Build evidence ────────────────────────────────────────────────────────

  const evidence: GateEvidence = {
    totalN: input.combinedN,
    liveShadowN: input.liveShadowN,
    hwfN: input.hwfN,
    seasonPhaseCount: input.seasonPhaseCount,
    perLeagueN,
    perLeagueLiveShadowN,
    perLeagueMatchdayCount,
    combinedNexusRps: input.combinedNexusRps,
    combinedV3Rps: input.combinedV3Rps,
    rpsDelta: input.combinedNexusRps - input.combinedV3Rps,
    leaguesWhereNexusWins,
    combinedNexusDrawRecall: input.combinedNexusDrawRecall,
    combinedV3DrawRecall: input.combinedV3DrawRecall,
    drawRecallDelta,
    combinedNexusAccuracy: input.combinedNexusAccuracy,
    combinedV3Accuracy: input.combinedV3Accuracy,
    accuracyDelta,
    combinedNexusLogLoss: input.combinedNexusLogLoss,
    combinedV3LogLoss: input.combinedV3LogLoss,
    logLossDelta,
    perLeagueRpsDelta,
    matchdayConsistencyFraction,
    liveShadowNexusRps: input.liveShadowNexusRps,
    liveShadowV3Rps: input.liveShadowV3Rps,
    liveShadowRpsDelta,
  };

  // ── Return result ─────────────────────────────────────────────────────────

  return {
    passed: failed.length === 0,
    failedConditions: failed,
    evidence,
    evaluatedAt: now,
  };
}
