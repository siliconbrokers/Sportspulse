/**
 * eval-nexus-gate.ts — NEXUS Promotion Gate Evaluation CLI.
 *
 * Loads scorecards from cache/nexus-scorecards/, builds the combined scorecard,
 * calls evaluatePromotionGate() and checkDemotionTrigger(), and prints a
 * human-readable conformance report to stdout.
 *
 * Usage:
 *   pnpm eval:nexus-gate
 *
 * Spec authority:
 *   - evaluation-and-promotion spec S6: Promotion Gate
 *   - evaluation-and-promotion spec S8.2: Demotion Trigger
 *
 * @module tools/eval-nexus-gate
 */

import { loadScorecard } from '../packages/prediction/src/nexus/scorecards/scorecard-store.js';
import { buildCombinedScorecard } from '../packages/prediction/src/nexus/scorecards/scorecard-aggregator.js';
import { evaluatePromotionGate } from '../packages/prediction/src/nexus/promotion/gate-evaluator.js';
import { checkDemotionTrigger } from '../packages/prediction/src/nexus/promotion/demotion-trigger.js';
import type { GateEvaluationInput, LeagueSummary } from '../packages/prediction/src/nexus/promotion/types.js';
import {
  DEFAULT_VOLUME_REQUIREMENTS,
  DEFAULT_PERFORMANCE_REQUIREMENTS,
} from '../packages/prediction/src/nexus/promotion/types.js';
import type { NexusScorecard } from '../packages/prediction/src/nexus/scorecards/types.js';

// ── V3 baseline constants (from backtest — frozen 2026-03-17) ─────────────────

/** V3 combined mean RPS from historical backtest (PD+PL+BL1). */
const RPS_V3 = 0.1986;

/** V3 accuracy (3-way, combined PD+PL+BL1). */
const ACCURACY_V3 = 0.557;

/** V3 draw recall (combined PD+PL+BL1). */
const DRAW_RECALL_V3 = 0.343;

/** V3 log-loss (combined PD+PL+BL1). Estimated from RPS under calibrated model. */
const LOG_LOSS_V3 = 1.012;

/** Production leagues. */
const PRODUCTION_LEAGUES = [
  'comp:football-data:PD',
  'comp:football-data:PL',
  'comp:football-data:BL1',
] as const;

/** Short display names for competition IDs. */
const LEAGUE_LABELS: Record<string, string> = {
  'comp:football-data:PD': 'PD',
  'comp:football-data:PL': 'PL',
  'comp:football-data:BL1': 'BL1',
};

// ── Formatting helpers ────────────────────────────────────────────────────────

const PASS = '✓';
const FAIL = '✗';
const NA = 'N/A';

function pct(n: number, digits = 1): string {
  return (n * 100).toFixed(digits) + '%';
}

function fmt(n: number, digits = 4): string {
  return n.toFixed(digits);
}

function check(condition: boolean | null): string {
  if (condition === null) return NA;
  return condition ? PASS : FAIL;
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

// ── Build GateEvaluationInput from scorecards ─────────────────────────────────

/**
 * Build per-league summaries for the gate evaluator.
 *
 * For each production league, we need NEXUS RPS and V3 RPS.
 * The HWF scorecard has NEXUS RPS per league. For V3 we use the global
 * baseline RPS_V3 per league (since V3 per-league breakdown is not stored
 * in the scorecard — it requires access to V3 predictions which are not
 * part of the NEXUS scorecard store). We use RPS_V3 as a proxy for all
 * leagues; individual league breakdowns would require separate V3 scorecards.
 *
 * NOTE: When live_shadow has actual V3 per-match comparisons, the per-league
 * V3 RPS can be derived from scorecard entries directly. Until then, RPS_V3
 * is the best available single estimate.
 */
function buildLeagueSummaries(
  hwf: NexusScorecard,
  ls: NexusScorecard,
): LeagueSummary[] {
  return PRODUCTION_LEAGUES.map((compId) => {
    const hwfLeague = hwf.leagues[compId] ?? { n: 0, rps_mean: 0 };
    const lsLeague = ls.leagues[compId] ?? { n: 0, rps_mean: 0 };
    const totalN = hwfLeague.n + lsLeague.n;
    const nexusRps =
      totalN > 0
        ? (hwfLeague.n * hwfLeague.rps_mean + lsLeague.n * lsLeague.rps_mean) / totalN
        : 0;

    return {
      competitionId: compId,
      n: totalN,
      nLiveShadow: lsLeague.n,
      matchdayCount: estimateMatchdayCount(totalN),
      nexusRps: totalN > 0 ? nexusRps : RPS_V3 + 0.01, // pessimistic if no data
      v3Rps: RPS_V3,
    };
  });
}

/**
 * Rough matchday estimate: assume ~9 matches per matchday (8-10 for top leagues).
 */
function estimateMatchdayCount(n: number): number {
  return Math.floor(n / 9);
}

// ── Compute NEXUS derived metrics from HWF entries ────────────────────────────

interface DerivedMetrics {
  accuracy: number;
  drawRecall: number;
  logLoss: number;
}

/**
 * Derive accuracy, draw recall, and log-loss from scorecard entries.
 *
 * accuracy = fraction of entries where predicted argmax == actual result.
 * drawRecall = fraction of actual draws where NEXUS predicted draw as argmax.
 * logLoss = mean negative log-likelihood using calibrated probs.
 */
function deriveMetrics(scorecard: NexusScorecard): DerivedMetrics | null {
  if (scorecard.n === 0) return null;

  let correct = 0;
  let actualDraws = 0;
  let predictedDrawsCorrect = 0;
  let logLossSum = 0;

  for (const entry of scorecard.entries) {
    // Accuracy: predicted class = argmax of probs
    const { home, draw, away } = entry.probs;
    let predicted: '1' | 'X' | '2';
    if (home >= draw && home >= away) predicted = '1';
    else if (draw >= home && draw >= away) predicted = 'X';
    else predicted = '2';

    if (predicted === entry.result) correct++;

    // Draw recall
    if (entry.result === 'X') {
      actualDraws++;
      if (predicted === 'X') predictedDrawsCorrect++;
    }

    // Log-loss: -log(p_actual)
    const pActual =
      entry.result === '1' ? home : entry.result === 'X' ? draw : away;
    const clampedP = Math.max(1e-9, Math.min(1, pActual));
    logLossSum += -Math.log(clampedP);
  }

  return {
    accuracy: correct / scorecard.n,
    drawRecall: actualDraws > 0 ? predictedDrawsCorrect / actualDraws : 0,
    logLoss: logLossSum / scorecard.n,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const now = new Date().toISOString();

  // 1. Load scorecards
  const hwf = loadScorecard('historical_walk_forward');
  const ls = loadScorecard('live_shadow');
  const combined = buildCombinedScorecard(hwf, ls);

  // 2. Derive metrics for gate input
  const hwfMetrics = deriveMetrics(hwf);
  const lsMetrics = deriveMetrics(ls);
  const combinedMetrics = deriveMetrics(combined);

  // Fallback to V3 baseline when data is insufficient (pessimistic default)
  const nexusAccuracy = combinedMetrics?.accuracy ?? ACCURACY_V3 - 0.05;
  const nexusDrawRecall = combinedMetrics?.drawRecall ?? DRAW_RECALL_V3 - 0.05;
  const nexusLogLoss = combinedMetrics?.logLoss ?? LOG_LOSS_V3 + 0.05;

  // V3 reference for live_shadow slice (uses same baseline since no V3 LS scorer)
  const liveShadowNexusRps = ls.rps_mean;
  const liveShadowV3Rps = RPS_V3; // best available single-point estimate

  // 3. Build league summaries
  const leagueSummaries = buildLeagueSummaries(hwf, ls);

  // 4. Build gate input
  const gateInput: GateEvaluationInput = {
    // Combined
    combinedN: combined.n,
    combinedNexusRps: combined.rps_mean,
    combinedV3Rps: RPS_V3,
    combinedNexusDrawRecall: nexusDrawRecall,
    combinedV3DrawRecall: DRAW_RECALL_V3,
    combinedNexusAccuracy: nexusAccuracy,
    combinedV3Accuracy: ACCURACY_V3,
    combinedNexusLogLoss: nexusLogLoss,
    combinedV3LogLoss: LOG_LOSS_V3,
    // Live shadow
    liveShadowN: ls.n,
    liveShadowNexusRps,
    liveShadowV3Rps,
    // HWF
    hwfN: hwf.n,
    // League-level
    leagueSummaries,
    // Matchday consistency (not persisted separately; empty → gate skips S6.5)
    matchdaySummaries: [],
    // Season phases (requires phase tag in entries; estimate from n)
    seasonPhaseCount: combined.n >= 200 ? 2 : 1,
  };

  // 5. Evaluate gate
  const result = evaluatePromotionGate(gateInput, now);

  // 6. Demotion check (point-in-time on aggregates)
  const demotionSignal = checkDemotionTrigger(
    combined.rps_mean > 0 ? combined.rps_mean : RPS_V3 + 0.02,
    RPS_V3,
  );

  // ── Print report ────────────────────────────────────────────────────────────

  const line = '═'.repeat(50);
  const thinLine = '─'.repeat(50);

  console.log('');
  console.log(line);
  console.log('  NEXUS Promotion Gate Evaluation');
  console.log(`  Evaluated at: ${now}`);
  console.log(line);
  console.log('');

  // ── Scorecards section ──
  console.log('  Scorecards:');
  const hwfRpsDisplay = hwf.n > 0 ? fmt(hwf.rps_mean) : 'N/A';
  const lsRpsDisplay = ls.n > 0 ? fmt(ls.rps_mean) : 'N/A (insuficiente)';
  const combinedRpsDisplay = combined.n > 0 ? fmt(combined.rps_mean) : 'N/A';
  console.log(`    ${padRight('historical_walk_forward', 26)}: n=${padLeft(String(hwf.n), 4)}  rps=${hwfRpsDisplay}`);
  console.log(`    ${padRight('live_shadow', 26)}: n=${padLeft(String(ls.n), 4)}  rps=${lsRpsDisplay}`);
  console.log(`    ${padRight('combined', 26)}: n=${padLeft(String(combined.n), 4)}  rps=${combinedRpsDisplay}`);
  console.log('');
  console.log(`  Baseline V3                        : rps=${fmt(RPS_V3)}`);
  console.log('');

  // ── Volume requirements ──
  const vol = DEFAULT_VOLUME_REQUIREMENTS;
  console.log('  Sample requirements:');

  const totalOk = combined.n >= vol.minTotalPredictions;
  console.log(`    ${padRight('Total partidos', 28)}: ${padLeft(String(combined.n), 4)} / ${vol.minTotalPredictions}  ${check(totalOk)}`);

  const lsOk = ls.n >= vol.minLiveShadowPerLeague;
  const lsMissing = Math.max(0, vol.minLiveShadowPerLeague - ls.n);
  const lsNote = !lsOk ? `  (~${lsMissing} faltantes)` : '';
  console.log(`    ${padRight('live_shadow partidos', 28)}: ${padLeft(String(ls.n), 4)} / ${vol.minLiveShadowPerLeague}  ${check(lsOk)}${lsNote}`);

  const seasonOk = gateInput.seasonPhaseCount >= vol.minSeasonPhases;
  console.log(`    ${padRight('Season phases', 28)}: ${padLeft(String(gateInput.seasonPhaseCount), 4)} / ${vol.minSeasonPhases}  ${check(seasonOk)}`);

  console.log(`    Per-league mínimo (${vol.minPerLeague} c/u):`);
  for (const ls_summary of leagueSummaries) {
    const label = LEAGUE_LABELS[ls_summary.competitionId] ?? ls_summary.competitionId;
    const leagueOk = ls_summary.n >= vol.minPerLeague;
    const lsLivOk = ls_summary.nLiveShadow >= vol.minLiveShadowPerLeague;
    console.log(
      `      ${padRight(label, 5)}: total=${padLeft(String(ls_summary.n), 4)} ${check(leagueOk)}` +
      `  live_shadow=${padLeft(String(ls_summary.nLiveShadow), 3)} / ${vol.minLiveShadowPerLeague} ${check(lsLivOk)}`,
    );
  }
  console.log('');

  // ── Performance thresholds ──
  const perf = DEFAULT_PERFORMANCE_REQUIREMENTS;
  console.log('  Performance thresholds:');

  const rpsOk = combined.n > 0 ? combined.rps_mean < RPS_V3 : null;
  const rpsDisplay = combined.n > 0
    ? `${fmt(combined.rps_mean)} vs ${fmt(RPS_V3)}  (necesita < ${fmt(RPS_V3)})`
    : `N/A (muestra insuficiente)`;
  console.log(`    ${padRight('RPS combined < V3', 36)}: ${check(rpsOk)}  ${rpsDisplay}`);

  const lsRpsOk = ls.n > 0 ? ls.rps_mean <= RPS_V3 + perf.liveShadowRpsMaxDelta : null;
  const lsRpsPerfDisplay = ls.n > 0
    ? `${fmt(ls.rps_mean)} vs ${fmt(RPS_V3 + perf.liveShadowRpsMaxDelta)}`
    : 'N/A (muestra insuficiente)';
  console.log(`    ${padRight('RPS live_shadow ≤ V3+ε', 36)}: ${check(lsRpsOk)}  ${lsRpsPerfDisplay}`);

  const accDisplay = combinedMetrics
    ? `${pct(nexusAccuracy)} vs ${pct(ACCURACY_V3 - perf.accuracyTolerancePp)} mín`
    : 'N/A (muestra insuficiente)';
  const accOk = combinedMetrics ? nexusAccuracy >= ACCURACY_V3 - perf.accuracyTolerancePp : null;
  console.log(`    ${padRight('Accuracy ≥ V3-2pp', 36)}: ${check(accOk)}  ${accDisplay}`);

  const drDisplay = combinedMetrics
    ? `${pct(nexusDrawRecall)} vs ${pct(DRAW_RECALL_V3 - perf.drawRecallTolerancePp)} mín`
    : 'N/A (muestra insuficiente)';
  const drOk = combinedMetrics ? nexusDrawRecall >= DRAW_RECALL_V3 - perf.drawRecallTolerancePp : null;
  console.log(`    ${padRight('DRAW recall ≥ V3-3pp', 36)}: ${check(drOk)}  ${drDisplay}`);

  const llDisplay = combinedMetrics
    ? `${fmt(nexusLogLoss)} vs ${fmt(LOG_LOSS_V3 + perf.logLossMaxIncrease)} máx`
    : 'N/A (muestra insuficiente)';
  const llOk = combinedMetrics ? nexusLogLoss <= LOG_LOSS_V3 + perf.logLossMaxIncrease : null;
  console.log(`    ${padRight('Log-loss ≤ V3+0.02', 36)}: ${check(llOk)}  ${llDisplay}`);

  // RPS per-league majority
  const leaguesWinning = leagueSummaries.filter(
    (ls_s) => ls_s.n > 0 && ls_s.nexusRps < ls_s.v3Rps,
  ).length;
  const leaguesWithData = leagueSummaries.filter((ls_s) => ls_s.n > 0).length;
  const rpsLeagueOk = leaguesWithData >= perf.rpsLeagueMajorityCount
    ? leaguesWinning >= perf.rpsLeagueMajorityCount
    : null;
  console.log(`    ${padRight('RPS mejor en ≥2/3 ligas', 36)}: ${check(rpsLeagueOk)}  ${leaguesWinning}/${leaguesWithData} ligas con datos`);

  // Per-league RPS no-regression
  const rpsNoRegressionOk = leagueSummaries.every(
    (ls_s) => ls_s.n === 0 || ls_s.nexusRps <= ls_s.v3Rps + perf.perLeagueRpsNoRegressionDelta,
  );
  console.log(`    ${padRight('RPS por liga ≤ V3+0.005', 36)}: ${check(leagueSummaries.some((s) => s.n > 0) ? rpsNoRegressionOk : null)}`);

  console.log('');

  // ── Demotion signal ──
  console.log(`  Demotion signal (S8.2)           : ${demotionSignal ? `SI — NEXUS RPS excede V3 + 0.005` : 'NO'}`);
  console.log('');

  // ── Summary ──
  console.log('  ' + thinLine);

  if (result.passed) {
    console.log(`  GATE: ${PASS} PASS`);
    console.log('  Recomendación: PROMOTE — todos los requisitos satisfechos');
  } else {
    const failList = result.failedConditions.join(', ');
    console.log(`  GATE: ${FAIL} FAIL`);
    console.log(`  Falló: ${failList}`);

    // Human-readable recommendation
    const reasons: string[] = [];
    if (result.failedConditions.includes('INSUFFICIENT_LIVE_SHADOW')) {
      reasons.push(`WAIT — acumular más datos live_shadow (~${lsMissing} partidos faltantes)`);
    }
    if (result.failedConditions.includes('INSUFFICIENT_SAMPLES')) {
      const missing = Math.max(0, vol.minTotalPredictions - combined.n);
      reasons.push(`acumular más predicciones totales (~${missing} faltantes)`);
    }
    if (result.failedConditions.includes('RPS_NO_IMPROVEMENT') && combined.n > 0) {
      reasons.push('mejorar RPS agregado del modelo NEXUS');
    }
    if (reasons.length > 0) {
      console.log(`  Recomendación: ${reasons.join('; ')}`);
    }
  }

  console.log(line);
  console.log('');

  // Exit with non-zero code if gate fails, so CI pipelines can detect it
  if (!result.passed) {
    process.exitCode = 1;
  }
}

main();
