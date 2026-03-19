/**
 * run-forward-validation-checkpoint.ts — H11 forward validation checkpoint report.
 *
 * Loads the forward-validation store and prints a structured checkpoint report
 * covering operational readiness, cohort status, comparative metrics (BASELINE
 * vs CTI_ALPHA_0_4), and the formal decision at each checkpoint.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.server.json scripts/run-forward-validation-checkpoint.ts
 *
 * H11 — Controlled Forward Validation
 */

import 'dotenv/config';
import * as path from 'node:path';
import { ForwardValidationStore } from '../server/prediction/forward-validation-store.js';
import type { ForwardValidationRecord } from '../server/prediction/forward-validation-store.js';

// ── Checkpoint definitions (frozen) ────────────────────────────────────────

const CHECKPOINT_1_THRESHOLD = 50;  // EARLY_SANITY (total completados)
const CHECKPOINT_2_THRESHOLD = 100; // DECISION_GATE — same as NEXUS minLiveShadowPerLeague
// Unified condition: ≥100 completed forward records PER LEAGUE (PD, PL, BL1)
// Mirrors NEXUS gate: minLiveShadowPerLeague=100 (evaluation-and-promotion spec §S6.2)
const FORWARD_PER_LEAGUE_THRESHOLD = 100;

// ── Decision thresholds at Checkpoint 2 ────────────────────────────────────

const FORWARD_HOME_MIN_DELTA_PP = -5;   // HOME Δ ≥ -5pp
const FORWARD_AWAY_MIN_DELTA_PP = -5;   // AWAY Δ ≥ -5pp
const FORWARD_LOGLOSS_MAX_DELTA = 0.10; // ΔLogLoss ≤ +0.10
const FORWARD_DRAW_GAIN_MIN_PP  = 2;    // drawGain ≥ +2pp (OR predDRAW > 0)

// ── Metrics helpers ────────────────────────────────────────────────────────

interface Metrics {
  n: number;
  accuracy: number | null;
  brierScore: number | null;
  logLoss: number | null;
  predDrawCount: number;
  predDrawRate: number | null;
  avgPDrawOnActualDraw: number | null;
  homeHitRate: number | null;
  awayHitRate: number | null;
  homeN: number;
  awayN: number;
}

function safeLog(p: number): number {
  return Math.log(Math.max(p, 1e-15));
}

function computeMetrics(records: ForwardValidationRecord[]): Metrics {
  const evaluable = records.filter(
    (r) =>
      r.evaluation_eligible &&
      r.actual_result !== null &&
      r.p_home_win !== null &&
      r.p_draw !== null &&
      r.p_away_win !== null &&
      r.predicted_result !== null,
  );

  const n = evaluable.length;
  if (n === 0) {
    return {
      n: 0,
      accuracy: null,
      brierScore: null,
      logLoss: null,
      predDrawCount: 0,
      predDrawRate: null,
      avgPDrawOnActualDraw: null,
      homeHitRate: null,
      awayHitRate: null,
      homeN: 0,
      awayN: 0,
    };
  }

  let correctCount = 0;
  let brierSum = 0;
  let logLossSum = 0;
  let predDrawCount = 0;
  let pDrawSumOnActualDraw = 0;
  let actualDrawCount = 0;
  let homeHits = 0;
  let homeTotal = 0;
  let awayHits = 0;
  let awayTotal = 0;

  for (const r of evaluable) {
    const pH = r.p_home_win!;
    const pD = r.p_draw!;
    const pA = r.p_away_win!;
    const actual = r.actual_result!;
    const pred = r.predicted_result!;

    // Accuracy
    const normalised = pred === 'HOME' ? 'HOME_WIN' : pred === 'AWAY' ? 'AWAY_WIN' : pred === 'DRAW' ? 'DRAW' : null;
    if (normalised !== null && normalised === actual) correctCount++;

    // Brier score (multiclass)
    const iH = actual === 'HOME_WIN' ? 1 : 0;
    const iD = actual === 'DRAW' ? 1 : 0;
    const iA = actual === 'AWAY_WIN' ? 1 : 0;
    brierSum += (pH - iH) ** 2 + (pD - iD) ** 2 + (pA - iA) ** 2;

    // Log loss
    const pActual = actual === 'HOME_WIN' ? pH : actual === 'DRAW' ? pD : pA;
    logLossSum += -safeLog(pActual);

    // Draw prediction count
    if (pred === 'DRAW') predDrawCount++;

    // Avg p_draw on actual draws
    if (actual === 'DRAW') {
      pDrawSumOnActualDraw += pD;
      actualDrawCount++;
    }

    // HOME hit rate
    if (actual === 'HOME_WIN') {
      homeTotal++;
      if (normalised === 'HOME_WIN') homeHits++;
    }

    // AWAY hit rate
    if (actual === 'AWAY_WIN') {
      awayTotal++;
      if (normalised === 'AWAY_WIN') awayHits++;
    }
  }

  return {
    n,
    accuracy: correctCount / n,
    brierScore: brierSum / n,
    logLoss: logLossSum / n,
    predDrawCount,
    predDrawRate: predDrawCount / n,
    avgPDrawOnActualDraw: actualDrawCount > 0 ? pDrawSumOnActualDraw / actualDrawCount : null,
    homeHitRate: homeTotal > 0 ? homeHits / homeTotal : null,
    awayHitRate: awayTotal > 0 ? awayHits / awayTotal : null,
    homeN: homeTotal,
    awayN: awayTotal,
  };
}

function pct(v: number | null, decimals = 1): string {
  if (v === null) return 'n/a';
  return `${(v * 100).toFixed(decimals)}%`;
}

function fmt(v: number | null, decimals = 4): string {
  if (v === null) return 'n/a';
  return v.toFixed(decimals);
}

function delta(a: number | null, b: number | null, scale = 100, decimals = 1): string {
  if (a === null || b === null) return 'n/a';
  const d = (a - b) * scale;
  return `${d >= 0 ? '+' : ''}${d.toFixed(decimals)}pp`;
}

function deltaRaw(a: number | null, b: number | null, decimals = 4): string {
  if (a === null || b === null) return 'n/a';
  const d = a - b;
  return `${d >= 0 ? '+' : ''}${d.toFixed(decimals)}`;
}

// ── Formal decision logic ──────────────────────────────────────────────────

function computeDecision(
  baseline: Metrics,
  cti: Metrics,
  denominator: number,
): string {
  if (denominator < CHECKPOINT_2_THRESHOLD) {
    return 'FORWARD_CTI_INCONCLUSIVE — denominator < 100';
  }

  if (baseline.homeHitRate === null || cti.homeHitRate === null) {
    return 'FORWARD_CTI_INCONCLUSIVE — insufficient HOME samples';
  }
  if (baseline.awayHitRate === null || cti.awayHitRate === null) {
    return 'FORWARD_CTI_INCONCLUSIVE — insufficient AWAY samples';
  }

  const homeDeltaPp = (cti.homeHitRate - baseline.homeHitRate) * 100;
  const awayDeltaPp = (cti.awayHitRate - baseline.awayHitRate) * 100;
  const logLossDelta =
    cti.logLoss !== null && baseline.logLoss !== null
      ? cti.logLoss - baseline.logLoss
      : null;
  const drawGainPp =
    cti.predDrawRate !== null && baseline.predDrawRate !== null
      ? (cti.predDrawRate - baseline.predDrawRate) * 100
      : null;

  // REJECTED criteria
  if (homeDeltaPp < FORWARD_HOME_MIN_DELTA_PP) {
    return `FORWARD_CTI_REJECTED — HOME Δ=${homeDeltaPp.toFixed(1)}pp < ${FORWARD_HOME_MIN_DELTA_PP}pp threshold`;
  }
  if (awayDeltaPp < FORWARD_AWAY_MIN_DELTA_PP) {
    return `FORWARD_CTI_REJECTED — AWAY Δ=${awayDeltaPp.toFixed(1)}pp < ${FORWARD_AWAY_MIN_DELTA_PP}pp threshold`;
  }
  if (logLossDelta !== null && logLossDelta > FORWARD_LOGLOSS_MAX_DELTA) {
    return `FORWARD_CTI_REJECTED — ΔLogLoss=${logLossDelta.toFixed(4)} > ${FORWARD_LOGLOSS_MAX_DELTA} threshold`;
  }

  // ACCEPTABLE criteria
  const drawGainMet = drawGainPp !== null && drawGainPp >= FORWARD_DRAW_GAIN_MIN_PP;
  const predDrawPositive = (cti.predDrawCount ?? 0) > 0;
  if (drawGainMet || predDrawPositive) {
    return 'FORWARD_CTI_ACCEPTABLE — all thresholds met';
  }

  return 'FORWARD_CTI_INCONCLUSIVE — signals mixed, no threshold breached';
}

// ── Main ───────────────────────────────────────────────────────────────────

const STORE_PATH = path.resolve(process.cwd(), 'cache/predictions/forward-validation.json');
const store = new ForwardValidationStore(STORE_PATH);

const allRecords = store.findAll();
const baselineRecords = allRecords.filter((r) => r.variant === 'BASELINE_REFERENCE');
const ctiRecords = allRecords.filter((r) => r.variant === 'CTI_ALPHA_0_4');

const completedBaseline = baselineRecords.filter((r) => r.actual_result !== null);
const completedCTI = ctiRecords.filter((r) => r.actual_result !== null);
const pendingRecords = store.findPending();
const denominator = completedBaseline.length; // use BASELINE as the denominator

const fvEnabled = process.env.FORWARD_VALIDATION_ENABLED === 'true';
const fvCompetitions = (process.env.FORWARD_VALIDATION_COMPETITIONS ?? 'PD,PL,BL1').split(',');
const variants: string[] = ['BASELINE_REFERENCE', 'CTI_ALPHA_0_4'];

const baselineMetrics = computeMetrics(completedBaseline);
const ctiMetrics = computeMetrics(completedCTI);

// ── Competition breakdown ──────────────────────────────────────────────────

const competitionCodes = [...new Set(allRecords.map((r) => r.competition_code))];

// ── Print report ───────────────────────────────────────────────────────────

console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  H11 FORWARD VALIDATION CHECKPOINT REPORT');
console.log(`  Generated: ${new Date().toISOString()}`);
console.log('═══════════════════════════════════════════════════════════════════');

// ── SECTION 1: Operational Readiness ──────────────────────────────────────

console.log('');
console.log('SECTION 1 — Operational Readiness');
console.log('───────────────────────────────────────────────────────────────────');
console.log(`  FORWARD_VALIDATION_ENABLED : ${fvEnabled ? 'true (active)' : 'false (inactive)'}`);
console.log(`  Scoped competitions        : ${fvCompetitions.join(', ')}`);
console.log(`  Variants                   : ${variants.join(', ')}`);
console.log(`  Store file                 : ${STORE_PATH}`);
console.log(`  Total records in store     : ${store.count()}`);

// ── SECTION 2: Forward Cohort Status ──────────────────────────────────────

console.log('');
console.log('SECTION 2 — Forward Cohort Status');
console.log('───────────────────────────────────────────────────────────────────');
console.log(`  Total frozen (all variants)  : ${allRecords.length}`);
console.log(`    BASELINE frozen            : ${baselineRecords.length}`);
console.log(`    CTI_ALPHA_0_4 frozen       : ${ctiRecords.length}`);
console.log(`  Completed (result captured)  : ${completedBaseline.length} BASELINE, ${completedCTI.length} CTI`);
console.log(`  Pending (no result yet)      : ${pendingRecords.length}`);
console.log(`  Evaluation eligible          : ${completedBaseline.filter((r) => r.evaluation_eligible).length} BASELINE, ${completedCTI.filter((r) => r.evaluation_eligible).length} CTI`);

if (competitionCodes.length > 0) {
  console.log('');
  console.log('  By competition:');
  for (const code of competitionCodes.sort()) {
    const bRecs = baselineRecords.filter((r) => r.competition_code === code);
    const cRecs = ctiRecords.filter((r) => r.competition_code === code);
    const bDone = bRecs.filter((r) => r.actual_result !== null).length;
    const cDone = cRecs.filter((r) => r.actual_result !== null).length;
    console.log(
      `    ${code.padEnd(6)} BASELINE: ${String(bRecs.length).padStart(3)} frozen, ${String(bDone).padStart(3)} completed` +
      `  |  CTI: ${String(cRecs.length).padStart(3)} frozen, ${String(cDone).padStart(3)} completed`,
    );
  }
}

// ── SECTION 3: Comparative Forward Metrics ────────────────────────────────

console.log('');
console.log('SECTION 3 — Comparative Forward Metrics');
console.log('───────────────────────────────────────────────────────────────────');
console.log(`  Denominator (completed BASELINE evaluable): ${baselineMetrics.n}`);
console.log('');

if (baselineMetrics.n === 0) {
  console.log('  No completed evaluable records yet. Metrics will appear after matches resolve.');
} else {
  const header = '  Metric                     BASELINE        CTI_0.4         Δ (CTI−BASE)';
  console.log(header);
  console.log('  ' + '─'.repeat(header.length - 2));

  function row(label: string, bVal: string, cVal: string, dVal: string): void {
    console.log(
      `  ${label.padEnd(26)} ${bVal.padStart(14)}  ${cVal.padStart(14)}  ${dVal.padStart(14)}`,
    );
  }

  row('n (evaluable)',
    String(baselineMetrics.n), String(ctiMetrics.n), '');
  row('Accuracy',
    pct(baselineMetrics.accuracy), pct(ctiMetrics.accuracy),
    delta(ctiMetrics.accuracy, baselineMetrics.accuracy));
  row('Brier score',
    fmt(baselineMetrics.brierScore), fmt(ctiMetrics.brierScore),
    deltaRaw(ctiMetrics.brierScore, baselineMetrics.brierScore));
  row('Log loss',
    fmt(baselineMetrics.logLoss), fmt(ctiMetrics.logLoss),
    deltaRaw(ctiMetrics.logLoss, baselineMetrics.logLoss));
  row('Predicted DRAW count',
    String(baselineMetrics.predDrawCount), String(ctiMetrics.predDrawCount),
    `Δ=${ctiMetrics.predDrawCount - baselineMetrics.predDrawCount}`);
  row('Avg p_draw | actual DRAW',
    pct(baselineMetrics.avgPDrawOnActualDraw), pct(ctiMetrics.avgPDrawOnActualDraw),
    delta(ctiMetrics.avgPDrawOnActualDraw, baselineMetrics.avgPDrawOnActualDraw));
  row(`HOME hit rate (n=${baselineMetrics.homeN})`,
    pct(baselineMetrics.homeHitRate), pct(ctiMetrics.homeHitRate),
    delta(ctiMetrics.homeHitRate, baselineMetrics.homeHitRate));
  row(`AWAY hit rate (n=${baselineMetrics.awayN})`,
    pct(baselineMetrics.awayHitRate), pct(ctiMetrics.awayHitRate),
    delta(ctiMetrics.awayHitRate, baselineMetrics.awayHitRate));
}

// ── SECTION 4: Operational Stability ──────────────────────────────────────

console.log('');
console.log('SECTION 4 — Operational Stability');
console.log('───────────────────────────────────────────────────────────────────');

const totalExpectedPairs = Math.max(baselineRecords.length, ctiRecords.length);
const freezeSuccessRate = allRecords.length > 0
  ? (baselineRecords.length === ctiRecords.length ? 1.0 : 0.5)
  : null;
const closureRate = baselineRecords.length > 0
  ? completedBaseline.length / baselineRecords.length
  : null;
const excludedBaseline = completedBaseline.filter((r) => !r.evaluation_eligible).length;

console.log(`  Match pairs frozen (expect 2 records/match): ${totalExpectedPairs}`);
console.log(`  Variant parity (BASELINE=CTI count)        : ${baselineRecords.length === ctiRecords.length ? 'OK' : 'MISMATCH'}`);
console.log(`  Freeze success rate (variants matched)     : ${freezeSuccessRate !== null ? pct(freezeSuccessRate) : 'n/a'}`);
console.log(`  Result closure rate                        : ${closureRate !== null ? pct(closureRate) : 'n/a'}`);
console.log(`  Excluded from evaluation (BASELINE)        : ${excludedBaseline}`);
console.log(`  Source type integrity                      : ${allRecords.every((r) => r.source_type === 'FORWARD_OFFICIAL') ? 'OK (all FORWARD_OFFICIAL)' : 'ERROR — mixed source_types'}`);

// ── SECTION 5: Decision Table ──────────────────────────────────────────────

console.log('');
console.log('SECTION 5 — Decision Table');
console.log('───────────────────────────────────────────────────────────────────');

interface CheckpointRow {
  name: string;
  label: string;
  threshold: number;
  reached: boolean;
  decision: string;
}

// Per-league completed count (mirrors NEXUS minLiveShadowPerLeague condition)
const perLeagueCompleted: Record<string, number> = {};
for (const code of fvCompetitions) {
  const trimmed = code.trim();
  perLeagueCompleted[trimmed] = completedBaseline.filter(
    (r) => r.competition_code === trimmed && r.evaluation_eligible,
  ).length;
}
const allLeagueMet = fvCompetitions.every(
  (c) => (perLeagueCompleted[c.trim()] ?? 0) >= FORWARD_PER_LEAGUE_THRESHOLD,
);

const checkpoints: CheckpointRow[] = [
  {
    name: 'Checkpoint 1',
    label: 'EARLY_SANITY',
    threshold: CHECKPOINT_1_THRESHOLD,
    reached: denominator >= CHECKPOINT_1_THRESHOLD,
    decision:
      denominator >= CHECKPOINT_1_THRESHOLD
        ? computeDecision(baselineMetrics, ctiMetrics, denominator)
        : 'NOT_REACHED',
  },
  {
    name: 'Checkpoint 2',
    label: 'DECISION_GATE',
    threshold: CHECKPOINT_2_THRESHOLD,
    reached: allLeagueMet,
    decision: allLeagueMet
      ? computeDecision(baselineMetrics, ctiMetrics, denominator)
      : 'NOT_REACHED',
  },
];

for (const cp of checkpoints) {
  const status = cp.reached ? 'REACHED' : `PENDING`;
  console.log(`  ${cp.name} (${cp.label}, n≥${cp.threshold}/liga): ${status}`);
  if (cp.name === 'Checkpoint 2') {
    for (const code of fvCompetitions) {
      const c = code.trim();
      const n = perLeagueCompleted[c] ?? 0;
      const ok = n >= FORWARD_PER_LEAGUE_THRESHOLD;
      console.log(`    ${c.padEnd(6)}: ${String(n).padStart(3)} / ${FORWARD_PER_LEAGUE_THRESHOLD}  ${ok ? '✓' : `✗ (faltan ${FORWARD_PER_LEAGUE_THRESHOLD - n})`}`);
    }
  }
  console.log(`    Decision: ${cp.decision}`);
  console.log('');
}

// ── SECTION 6: Forward Classification at Current Denominator ──────────────

console.log('SECTION 6 — Forward Classification at Current Denominator');
console.log('───────────────────────────────────────────────────────────────────');
console.log(`  Current denominator: ${denominator}`);

const currentDecision = computeDecision(baselineMetrics, ctiMetrics, denominator);
console.log(`  Current classification: ${currentDecision}`);
console.log('');

if (denominator < CHECKPOINT_1_THRESHOLD) {
  console.log(`  Status: ACCUMULATION PHASE — collecting data (${denominator}/${CHECKPOINT_1_THRESHOLD} for Checkpoint 1)`);
} else if (denominator < CHECKPOINT_2_THRESHOLD) {
  console.log(`  Status: EARLY READS — Checkpoint 1 reached (${denominator}/${CHECKPOINT_2_THRESHOLD} for Checkpoint 2)`);
} else {
  console.log(`  Status: CHECKPOINT 2 REACHED — formal decision possible`);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  END OF REPORT');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');
