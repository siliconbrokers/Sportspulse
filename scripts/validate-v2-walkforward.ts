/**
 * validate-v2-walkforward.ts — Walk-forward validation del Motor Predictivo V2 (§17).
 *
 * Ejecuta el engine V2 sobre partidos históricos FINISHED con anti-lookahead
 * estricto (solo pasado disponible en cada predicción) y reporta métricas reales.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json scripts/validate-v2-walkforward.ts [COMP] [YEAR]
 *
 * Ejemplos:
 *   npx tsx --tsconfig tsconfig.server.json scripts/validate-v2-walkforward.ts PD 2024
 *   npx tsx --tsconfig tsconfig.server.json scripts/validate-v2-walkforward.ts PL 2024
 *   npx tsx --tsconfig tsconfig.server.json scripts/validate-v2-walkforward.ts PD,PL 2024
 *
 * Requiere: FOOTBALL_DATA_TOKEN en entorno o .env
 *
 * Salida:
 *   - Reporte en stdout (texto formateado)
 *   - JSON en cache/v2-walkforward-{COMP}-{YEAR}.json
 *
 * V1 vs V2 comparison:
 *   V1 tiene su propio backtest en HistoricalBacktestStore (cache/predictions/historical-backtest.json).
 *   Este script intenta cargar esos datos y verificar si la comparación es metodológicamente
 *   válida antes de mostrarla. Ver sección COMPARABILIDAD en el reporte.
 *
 * LIMITACIONES CONOCIDAS:
 *   - La frontera de temporada July 1 UTC es heurística para ligas europeas.
 *     Para ligas con otra temporada (MLS, Liga Uruguaya, etc.) puede ser incorrecta.
 *   - V2 produce probabilidades SIN calibrar (Poisson crudo).
 *     Si V1 solo tiene probabilidades calibradas, la comparación de Log Loss / Brier
 *     no está en la misma escala y se marca como NO COMPARABLE.
 *   - El Brier Score multiclase 1X2 tiene rango [0, 2], no [0, 1].
 *     El baseline naive uniforme (1/3 cada outcome) produce Brier = 2/3 ≈ 0.667.
 *
 * Para generar datos V1: correr primero run-backtest.ts.
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { loadHistoricalMatches } from '../server/prediction/historical-match-loader.js';
import {
  runWalkForward,
  computeAllMetrics,
  NAIVE_LOG_LOSS,
  NAIVE_BRIER,
  type MetricBundle,
  type WFCalibrationBucket,
  type WFPrediction,
} from '@sportpulse/prediction';
import type { HistoricalBacktestSnapshot } from '../server/prediction/historical-backtest-store.js';

// ── Ligas compatibles con frontera July 1 UTC ─────────────────────────────────

/**
 * Ligas cuya temporada comienza entre julio y agosto.
 * La heurística July 1 UTC es válida para estas.
 * Para cualquier otra liga, se emite un warning en el reporte.
 */
const EUROPEAN_LEAGUE_JULY1_COMPAT = new Set([
  'PD',  // LaLiga
  'PL',  // Premier League
  'BL1', // Bundesliga
  'BL2', // Bundesliga 2
  'SA',  // Serie A
  'FL1', // Ligue 1
  'FL2', // Ligue 2
  'PPL', // Primeira Liga
  'DED', // Eredivisie
  'CL',  // Champions League
  'EL',  // Europa League
  'EC',  // Conference League
]);

// ── Helpers de formato ────────────────────────────────────────────────────────

const pct  = (v: number, d = 1) =>
  isNaN(v) ? '   n/a' : (v * 100).toFixed(d).padStart(6) + '%';
const num  = (v: number, d = 3) =>
  isNaN(v) ? '  n/a ' : v.toFixed(d).padStart(7);
const sign = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(3);
const SEP  = '─'.repeat(62);
const SEP2 = '═'.repeat(62);

// ── Frontera de temporada ─────────────────────────────────────────────────────

function seasonBoundaryIso(year: number): string {
  return new Date(Date.UTC(year, 6, 1)).toISOString(); // 1 julio UTC
}

// ── Season boundary report ────────────────────────────────────────────────────

interface SeasonBoundaryReport {
  policy:          'JULY_1_UTC_HEURISTIC';
  boundary_date:   string;
  /** Ámbito de aplicabilidad de la heurística. */
  applicability:   'KNOWN_EUROPEAN_CALENDARS' | 'UNKNOWN_CALENDAR';
  warning:         string | null;
}

function checkSeasonBoundary(comp: string, year: number): SeasonBoundaryReport {
  const boundary = seasonBoundaryIso(year);
  const known    = EUROPEAN_LEAGUE_JULY1_COMPAT.has(comp);
  return {
    policy:        'JULY_1_UTC_HEURISTIC',
    boundary_date: boundary.slice(0, 10),
    applicability: known ? 'KNOWN_EUROPEAN_CALENDARS' : 'UNKNOWN_CALENDAR',
    warning: known
      ? null
      : `'${comp}' no está en calendarios europeos conocidos ` +
        `[${[...EUROPEAN_LEAGUE_JULY1_COMPAT].join(', ')}]. ` +
        `La heurística julio 1 UTC puede no aplicar para esta liga. ` +
        `Verificar el calendario real antes de interpretar resultados.`,
  };
}

// ── V1 loader ─────────────────────────────────────────────────────────────────

interface V1Snapshot extends HistoricalBacktestSnapshot {}

function loadV1Backtest(competitionCode: string): V1Snapshot[] {
  const p = path.resolve(process.cwd(), 'cache/predictions/historical-backtest.json');
  if (!fs.existsSync(p)) return [];
  try {
    const raw  = fs.readFileSync(p, 'utf-8');
    const doc  = JSON.parse(raw) as { snapshots?: V1Snapshot[] };
    const all  = doc.snapshots ?? [];
    return all.filter(
      (s) => s.competition_code === competitionCode && s.p_home_win !== null,
    );
  } catch {
    return [];
  }
}

// ── Comparabilidad V1 vs V2 ───────────────────────────────────────────────────

/**
 * Validez metodológica de la comparación.
 * COMPARABLE solo cuando ambos modelos usan la misma escala de probabilidad.
 * La cobertura de la intersección se reporta por separado en comparison_coverage.
 */
type ComparisonStatus = 'COMPARABLE' | 'NOT_COMPARABLE';

/**
 * Cobertura de la intersección respecto al universo mayor.
 * Independiente de comparison_status — puede haber HIGH coverage y NOT_COMPARABLE.
 */
type ComparisonCoverage = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

/**
 * Base exacta de la comparación, para que quede imposible malinterpretar
 * qué fue (o habría sido) comparado.
 */
type ComparisonBasis =
  | 'RAW_INTERSECTION_ONLY'        // V2 raw vs V1 raw Poisson — misma escala
  | 'CALIBRATED_INTERSECTION_ONLY' // V2 raw vs V1 calibrado — escala distinta, no se muestra
  | 'NONE';                        // sin intersección, sin datos V1, o escala distinta sin cobertura

interface ComparabilityResult {
  /** Validez metodológica: COMPARABLE solo si misma escala de probabilidad. */
  comparison_status:   ComparisonStatus;
  /** Tamaño relativo de la intersección. Independiente de comparison_status. */
  comparison_coverage: ComparisonCoverage;
  /** Qué se comparó exactamente (o qué se habría comparado si fuera válido). */
  comparison_basis:    ComparisonBasis;
  n_v2_evaluated:      number;
  n_v1_eligible:       number;
  n_intersection:      number;
  v1_has_raw_probs:    boolean;
  /** Razón por la que comparison_status es NOT_COMPARABLE, si aplica. */
  not_comparable_reason: string | null;
}

/**
 * Verifica si la comparación V1 vs V2 es metodológicamente válida.
 *
 * comparison_status (escala):
 *   COMPARABLE    = V1 tiene raw probs (misma escala Poisson que V2)
 *   NOT_COMPARABLE = V1 solo tiene calibradas, o sin datos, o sin intersección
 *
 * comparison_coverage (intersección):
 *   HIGH   ≥ 70% del universo mayor
 *   MEDIUM 30-69%
 *   LOW    < 30% pero > 0
 *   NONE   0 partidos comunes o sin datos V1
 */
function checkComparability(
  predictions: WFPrediction[],
  v1Snapshots: V1Snapshot[],
): ComparabilityResult {
  const v2Evaluated = predictions.filter((p) => p.eligibility_status !== 'NOT_ELIGIBLE');
  const n_v2        = v2Evaluated.length;

  if (v1Snapshots.length === 0) {
    return {
      comparison_status:    'NOT_COMPARABLE',
      comparison_coverage:  'NONE',
      comparison_basis:     'NONE',
      n_v2_evaluated:       n_v2,
      n_v1_eligible:        0,
      n_intersection:       0,
      v1_has_raw_probs:     false,
      not_comparable_reason: 'Sin datos V1 (cache/predictions/historical-backtest.json no encontrado). ' +
                             'Ejecutar run-backtest.ts para generar.',
    };
  }

  const v1Eligible = v1Snapshots.filter((s) => s.mode !== 'NOT_ELIGIBLE' && s.p_home_win !== null);
  const n_v1       = v1Eligible.length;

  // Build key set para V1 — mismo formato que matchId en V2
  const v1ByKey = new Map<string, V1Snapshot>();
  for (const s of v1Eligible) {
    v1ByKey.set(`${s.home_team_id}:${s.away_team_id}:${s.kickoff_utc}`, s);
  }

  let n_intersection = 0;
  for (const p of v2Evaluated) {
    if (v1ByKey.has(p.matchId)) n_intersection++;
  }

  // Cobertura: independiente de escala
  const maxUniverse = Math.max(n_v2, n_v1);
  const covFraction = maxUniverse > 0 ? n_intersection / maxUniverse : 0;
  const coverage: ComparisonCoverage =
    n_intersection === 0 ? 'NONE' :
    covFraction >= 0.70  ? 'HIGH'   :
    covFraction >= 0.30  ? 'MEDIUM' : 'LOW';

  // ¿V1 tiene raw probs? → determina escala
  const v1HasRaw = v1Eligible.some((s) => s.raw_p_home_win != null);

  if (!v1HasRaw) {
    return {
      comparison_status:    'NOT_COMPARABLE',
      comparison_coverage:  coverage,
      comparison_basis:     n_intersection > 0 ? 'CALIBRATED_INTERSECTION_ONLY' : 'NONE',
      n_v2_evaluated:       n_v2,
      n_v1_eligible:        n_v1,
      n_intersection,
      v1_has_raw_probs:     false,
      not_comparable_reason:
        'V1 solo tiene probabilidades calibradas (isotonic regression sobre Elo). ' +
        'V2 es Poisson sin calibrar. Log Loss y Brier miden calidad probabilística: ' +
        'la calibración mejora ambas métricas estructuralmente. ' +
        'Comparar valores absolutos no refleja diferencias en el modelo subyacente.',
    };
  }

  if (n_intersection === 0) {
    return {
      comparison_status:    'NOT_COMPARABLE',
      comparison_coverage:  'NONE',
      comparison_basis:     'NONE',
      n_v2_evaluated:       n_v2,
      n_v1_eligible:        n_v1,
      n_intersection:       0,
      v1_has_raw_probs:     true,
      not_comparable_reason:
        'Intersección vacía. Los universos de partidos no solapan ' +
        '(frontera de temporada distinta o team IDs inconsistentes entre los dos engines).',
    };
  }

  return {
    comparison_status:    'COMPARABLE',
    comparison_coverage:  coverage,
    comparison_basis:     'RAW_INTERSECTION_ONLY',
    n_v2_evaluated:       n_v2,
    n_v1_eligible:        n_v1,
    n_intersection,
    v1_has_raw_probs:     true,
    not_comparable_reason: null,
  };
}

// ── V1 metrics ────────────────────────────────────────────────────────────────

interface V1Metrics {
  n:              number;
  log_loss:       number;
  brier_score:    number;
  accuracy:       number;
  draw_rate_pred: number;
  draw_rate_act:  number;
  goals_pred:     number;
  goals_act:      number;
  prob_source:    'raw' | 'calibrated';
}

/**
 * Computa métricas V1 sobre los snapshots elegibles.
 *
 * @param useRaw Si true y hay raw_p_* disponibles, usa esas en vez de las calibradas.
 *               Esto permite comparar V1 raw vs V2 en la misma escala.
 */
function computeV1Metrics(
  snapshots: V1Snapshot[],
  useRaw = false,
): V1Metrics | null {
  const ev = snapshots.filter(
    (s) => s.mode !== 'NOT_ELIGIBLE' && s.p_home_win !== null,
  );
  if (ev.length === 0) return null;

  const EPSILON = 1e-7;
  let ll = 0, bs = 0, correct = 0, sumDraw = 0;
  let sumPredHome = 0, sumPredAway = 0, sumActHome = 0, sumActAway = 0;
  let usedRaw = false;

  for (const s of ev) {
    // Elegir fuente de probs: raw si está disponible y se pidió
    const canUseRaw = useRaw && s.raw_p_home_win != null && s.raw_p_draw != null && s.raw_p_away_win != null;
    const pH = canUseRaw ? s.raw_p_home_win! : s.p_home_win!;
    const pD = canUseRaw ? s.raw_p_draw!     : s.p_draw!;
    const pA = canUseRaw ? s.raw_p_away_win! : s.p_away_win!;
    if (canUseRaw) usedRaw = true;

    const outcome = s.actual_result;
    const pActual = outcome === 'HOME_WIN' ? pH : outcome === 'DRAW' ? pD : pA;
    ll += Math.log(Math.max(pActual, EPSILON));

    const iH = outcome === 'HOME_WIN' ? 1 : 0;
    const iD = outcome === 'DRAW'     ? 1 : 0;
    const iA = outcome === 'AWAY_WIN' ? 1 : 0;
    bs += (pH - iH) ** 2 + (pD - iD) ** 2 + (pA - iA) ** 2;

    const pred = pH >= pD && pH >= pA ? 'HOME_WIN' : pD >= pA ? 'DRAW' : 'AWAY_WIN';
    if (pred === outcome) correct++;

    sumDraw     += pD;
    sumPredHome += s.expected_goals_home ?? 0;
    sumPredAway += s.expected_goals_away ?? 0;
    sumActHome  += s.home_goals;
    sumActAway  += s.away_goals;
  }

  const n = ev.length;
  return {
    n,
    log_loss:       -(ll / n),
    brier_score:    bs / n,
    accuracy:       correct / n,
    draw_rate_pred: sumDraw / n,
    draw_rate_act:  ev.filter((s) => s.actual_result === 'DRAW').length / n,
    goals_pred:     (sumPredHome + sumPredAway) / n,
    goals_act:      (sumActHome  + sumActAway)  / n,
    prob_source:    usedRaw ? 'raw' : 'calibrated',
  };
}

// ── Comparabilidad: filtrar a intersección ────────────────────────────────────

/**
 * Dado el comparability result COMPARABLE_*, computa métricas V1 y V2
 * SOLO sobre los partidos de la intersección.
 *
 * Esto garantiza que ambos modelos son evaluados sobre exactamente los
 * mismos partidos.
 */
function computeIntersectionMetrics(
  predictions: WFPrediction[],
  v1Snapshots: V1Snapshot[],
  useRaw:      boolean,
): { v2: V1Metrics | null; v1: V1Metrics | null } {
  // Build V1 map
  const v1ByKey = new Map<string, V1Snapshot>();
  for (const s of v1Snapshots.filter((s) => s.mode !== 'NOT_ELIGIBLE' && s.p_home_win !== null)) {
    v1ByKey.set(`${s.home_team_id}:${s.away_team_id}:${s.kickoff_utc}`, s);
  }

  // Filtrar V2 a intersección
  const v2Inter = predictions.filter(
    (p) => p.eligibility_status !== 'NOT_ELIGIBLE' && v1ByKey.has(p.matchId),
  );
  const v1Inter = v2Inter
    .map((p) => v1ByKey.get(p.matchId)!)
    .filter(Boolean);

  if (v2Inter.length === 0) return { v2: null, v1: null };

  // V2 metrics sobre la intersección (reusar computeAllMetrics pero necesitamos V1Metrics shape)
  const EPSILON = 1e-7;
  let ll2 = 0, bs2 = 0, correct2 = 0, sumDraw2 = 0;
  for (const p of v2Inter) {
    const pActual = p.actual_outcome === 'H' ? p.prob_home_win
                  : p.actual_outcome === 'D' ? p.prob_draw
                  : p.prob_away_win;
    ll2 += Math.log(Math.max(pActual, EPSILON));
    const iH = p.actual_outcome === 'H' ? 1 : 0;
    const iD = p.actual_outcome === 'D' ? 1 : 0;
    const iA = p.actual_outcome === 'A' ? 1 : 0;
    bs2 += (p.prob_home_win - iH) ** 2 + (p.prob_draw - iD) ** 2 + (p.prob_away_win - iA) ** 2;
    const pred = p.prob_home_win >= p.prob_draw && p.prob_home_win >= p.prob_away_win ? 'H'
               : p.prob_draw >= p.prob_away_win ? 'D' : 'A';
    if (pred === p.actual_outcome) correct2++;
    sumDraw2 += p.prob_draw;
  }
  const n2 = v2Inter.length;
  const v2m: V1Metrics = {
    n:              n2,
    log_loss:       -(ll2 / n2),
    brier_score:    bs2 / n2,
    accuracy:       correct2 / n2,
    draw_rate_pred: sumDraw2 / n2,
    draw_rate_act:  v2Inter.filter((p) => p.actual_outcome === 'D').length / n2,
    goals_pred:     v2Inter.reduce((s, p) => s + p.lambda_home + p.lambda_away, 0) / n2,
    goals_act:      v2Inter.reduce((s, p) => s + p.actual_home_goals + p.actual_away_goals, 0) / n2,
    prob_source:    'raw',
  };

  const v1m = computeV1Metrics(v1Inter, useRaw);
  return { v2: v2m, v1: v1m };
}

// ── Reporte en texto ──────────────────────────────────────────────────────────

function printCalibrationClass(
  label:   string,
  buckets: WFCalibrationBucket[],
): void {
  const nonEmpty = buckets.filter((b) => b.n_pairs > 0);
  if (nonEmpty.length === 0) {
    console.log(`    (sin datos)`);
    return;
  }
  for (const b of nonEmpty) {
    const diff = b.mean_predicted_prob - b.actual_hit_rate;
    const flag = Math.abs(diff) > 0.10 ? ' !' : '';
    console.log(
      `    ${label} ${b.bucket_label.padEnd(12)}  ${String(b.n_pairs).padStart(5)}  ` +
      `${pct(b.mean_predicted_prob, 1).padStart(7)}  ${pct(b.actual_hit_rate, 1).padStart(7)}  ` +
      `${sign(diff).padStart(7)}${flag}`,
    );
  }
}

/**
 * Cuántas métricas gana V2 vs V1 en la intersección.
 * Solo tiene sentido cuando comparison_status === COMPARABLE.
 */
function summaryBetterModel(
  v2: V1Metrics,
  v1: V1Metrics,
): 'V2' | 'V1' | 'MIXED' {
  let v2wins = 0, v1wins = 0;
  // Log Loss y Brier: menor es mejor
  if (v2.log_loss    < v1.log_loss)    v2wins++; else if (v2.log_loss    > v1.log_loss)    v1wins++;
  if (v2.brier_score < v1.brier_score) v2wins++; else if (v2.brier_score > v1.brier_score) v1wins++;
  // Accuracy: mayor es mejor
  if (v2.accuracy    > v1.accuracy)    v2wins++; else if (v2.accuracy    < v1.accuracy)    v1wins++;
  if (v2wins === 3) return 'V2';
  if (v1wins === 3) return 'V1';
  return 'MIXED';
}

function printReport(
  comp:          string,
  year:          number,
  m:             MetricBundle,
  boundary:      SeasonBoundaryReport,
  compat:        ComparabilityResult,
  interMetrics:  { v2: V1Metrics | null; v1: V1Metrics | null } | null,
): void {
  console.log(`\n${SEP2}`);
  console.log(`  WALK-FORWARD VALIDATION V2 — ${comp} ${year}-${year + 1}`);
  console.log(SEP2);

  // ── Universo ──────────────────────────────────────────────────────────────
  console.log(`  Partidos total:      ${m.n_total}`);
  console.log(`  Evaluados (V2):      ${m.n_evaluated}  (ELIGIBLE + LIMITED)`);
  console.log(`  NOT_ELIGIBLE (V2):   ${m.n_not_eligible}`);
  console.log(`  LIMITED (V2):        ${m.n_limited}`);
  console.log(SEP);

  // ── Frontera de temporada ─────────────────────────────────────────────────
  console.log(`  FRONTERA DE TEMPORADA`);
  console.log(`    Política:         ${boundary.policy}`);
  console.log(`    Frontera:         ${boundary.boundary_date}`);
  console.log(`    Aplicabilidad:    ${boundary.applicability}`);
  if (boundary.warning) {
    console.log(`    Aviso:            ${boundary.warning}`);
  }
  console.log(SEP);

  // ── Distribución de resultados reales ────────────────────────────────────
  const d = m.outcome_distribution;
  console.log('  Distribución real:');
  console.log(`    H = ${d.H} (${pct(d.H_pct)})   D = ${d.D} (${pct(d.D_pct)})   A = ${d.A} (${pct(d.A_pct)})`);
  console.log(SEP);

  // ── Métricas V2 con baselines ─────────────────────────────────────────────
  console.log('  MÉTRICAS PREDICTIVAS V2  (Poisson sin calibrar)');
  console.log(`  ${''.padStart(22)}  ${'V2'.padStart(8)}  ${'naive'.padStart(8)}`);
  console.log(`    ${'Log Loss 1X2'.padEnd(20)}  ${num(m.log_loss)}  ${num(NAIVE_LOG_LOSS)}`);
  console.log(`    ${'Brier 1X2 (**)'.padEnd(20)}  ${num(m.brier_score)}  ${num(NAIVE_BRIER)}`);
  console.log(`    ${'Accuracy'.padEnd(20)}  ${num(m.accuracy)}`);
  console.log(`  (**) Brier multiclase 1X2: rango [0, 2]. Baseline naive uniforme = ${NAIVE_BRIER.toFixed(4)}.`);
  console.log(`       Un valor menor que ${NAIVE_BRIER.toFixed(3)} indica mejora sobre azar uniforme.`);
  console.log(SEP);

  // ── Comparabilidad V1 vs V2 ───────────────────────────────────────────────
  console.log(`  COMPARACIÓN V1 vs V2`);
  console.log(`    comparison_status:   ${compat.comparison_status}`);
  console.log(`    comparison_coverage: ${compat.comparison_coverage}`);
  console.log(`    comparison_basis:    ${compat.comparison_basis}`);
  console.log(`    V2 evaluados:        ${compat.n_v2_evaluated}`);
  console.log(`    V1 elegibles:        ${compat.n_v1_eligible}`);
  console.log(`    Intersección:        ${compat.n_intersection}`);
  console.log(`    Raw probs V1:        ${compat.v1_has_raw_probs ? 'SÍ (raw_p_*)' : 'NO (solo calibradas)'}`);
  if (compat.not_comparable_reason) {
    console.log(`    Razón:               ${compat.not_comparable_reason}`);
  }

  if (compat.comparison_status === 'COMPARABLE' && interMetrics?.v2 && interMetrics?.v1) {
    const { v2: v2i, v1: v1i } = interMetrics;
    const better = summaryBetterModel(v2i, v1i);
    console.log(`\n    Métricas sobre intersección (N=${v2i.n} partidos, base: ${compat.comparison_basis}):`);
    console.log(`    ${''.padStart(22)}  ${'V2 raw'.padStart(8)}  ${'V1 raw'.padStart(8)}  ${'diff'.padStart(8)}`);
    const row = (label: string, v2v: number, v1v: number) =>
      console.log(`    ${label.padEnd(20)}  ${num(v2v)}  ${num(v1v)}  ${sign(v2v - v1v)}`);
    row('Log Loss 1X2',  v2i.log_loss,    v1i.log_loss);
    row('Brier 1X2',     v2i.brier_score, v1i.brier_score);
    row('Accuracy',      v2i.accuracy,    v1i.accuracy);
    console.log(`    better_on_intersection: ${better}`);
  } else if (compat.comparison_status === 'NOT_COMPARABLE') {
    console.log(`\n    Métricas de comparación no mostradas (comparison_status = NOT_COMPARABLE).`);
  }
  console.log(SEP);

  // ── Draw rate ─────────────────────────────────────────────────────────────
  console.log('  DRAW RATE');
  const dr = m.draw_rate;
  console.log(`    Predicha media:  ${pct(dr.predicted_mean)}`);
  console.log(`    Real:            ${pct(dr.actual_rate)}`);
  console.log(`    Diferencia:      ${sign(dr.predicted_mean - dr.actual_rate)}`);
  console.log(SEP);

  // ── Goles esperados vs reales ─────────────────────────────────────────────
  console.log('  GOLES ESPERADOS VS REALES (por partido)');
  const g = m.goals;
  console.log(`    Home pred / real:  ${g.predicted_home_pg.toFixed(3)} / ${g.actual_home_pg.toFixed(3)}   diff: ${sign(g.predicted_home_pg - g.actual_home_pg)}`);
  console.log(`    Away pred / real:  ${g.predicted_away_pg.toFixed(3)} / ${g.actual_away_pg.toFixed(3)}   diff: ${sign(g.predicted_away_pg - g.actual_away_pg)}`);
  console.log(`    Total pred / real: ${g.predicted_total_pg.toFixed(3)} / ${g.actual_total_pg.toFixed(3)}   diff: ${sign(g.predicted_total_pg - g.actual_total_pg)}`);
  console.log(SEP);

  // ── Calibración por clase ─────────────────────────────────────────────────
  console.log('  CALIBRACIÓN POR CLASE (prob predicha vs tasa real)');
  console.log(`  ${'Clase + Bucket'.padEnd(22)}  ${'N'.padStart(5)}  ${'Pred%'.padStart(7)}  ${'Real%'.padStart(7)}  ${'Diff'.padStart(7)}`);

  const { per_class_calibration_buckets: pc } = m;
  printCalibrationClass('H', pc.home);
  printCalibrationClass('D', pc.draw);
  printCalibrationClass('A', pc.away);
  console.log(SEP);

  // ── Calibración global (referencia) ──────────────────────────────────────
  console.log('  CALIBRACIÓN GLOBAL (3 outcomes mezclados)');
  console.log(`  ${'Bucket'.padEnd(12)}  ${'N'.padStart(5)}  ${'Pred%'.padStart(7)}  ${'Real%'.padStart(7)}  ${'Diff'.padStart(7)}`);
  for (const b of m.calibration_buckets) {
    if (b.n_pairs === 0) continue;
    const diff  = b.mean_predicted_prob - b.actual_hit_rate;
    const flag  = Math.abs(diff) > 0.10 ? ' !' : '';
    console.log(
      `  ${b.bucket_label.padEnd(12)}  ${String(b.n_pairs).padStart(5)}  ` +
      `${pct(b.mean_predicted_prob, 1).padStart(7)}  ${pct(b.actual_hit_rate, 1).padStart(7)}  ` +
      `${sign(diff).padStart(7)}${flag}`,
    );
  }
  console.log(SEP);

  // ── Advertencias ──────────────────────────────────────────────────────────
  const warnings: string[] = [];

  if (boundary.warning) {
    warnings.push(`SEASON BOUNDARY: ${boundary.warning}`);
  }

  if (compat.not_comparable_reason) {
    warnings.push(`V1 VS V2: ${compat.not_comparable_reason}`);
  }

  warnings.push(
    `BRIER SCORE: Esta implementación usa Brier multiclase 1X2 con rango [0, 2]. ` +
    `El Brier binario estándar tiene rango [0, 1]. No comparar directamente con ` +
    `literatura que use Brier binario.`,
  );

  warnings.push(
    `V2 SIN CALIBRAR: Las probabilidades V2 son Poisson crudas, sin isotonic regression. ` +
    `Los valores absolutos pueden estar sesgados (ej: subdivisión de draws es habitual ` +
    `en Poisson básico). Ver calibración por clase arriba para diagnosticar.`,
  );

  console.log(`  ⚠ ADVERTENCIAS Y LIMITACIONES`);
  warnings.forEach((w, i) => {
    const lines = w.match(/.{1,70}(\s|$)/g) ?? [w];
    lines.forEach((line, j) =>
      console.log(`  ${j === 0 ? String(i + 1) + '.' : '  '} ${line.trim()}`),
    );
  });
  console.log(SEP2);
}

// ── JSON output ───────────────────────────────────────────────────────────────

interface ReportDoc {
  competition:             string;
  season_year:             number;
  generated_at:            string;
  season_boundary:         SeasonBoundaryReport;
  /** Contrato de comparabilidad V1 vs V2 — leer comparison_status, coverage y basis. */
  comparability:           ComparabilityResult;
  v2_metrics:              MetricBundle;
  naive_baselines:         { log_loss: number; brier_score: number };
  /**
   * Métricas de V2 y V1 calculadas sobre la intersección exacta de match IDs.
   * Solo presentes cuando comparability.comparison_status === 'COMPARABLE'.
   * La base exacta de la comparación está en comparability.comparison_basis.
   */
  v2_intersection_metrics: V1Metrics | null;
  v1_intersection_metrics: V1Metrics | null;
  /** Resumen: qué modelo ganó en la intersección, o null si no comparable. */
  better_on_intersection:  'V2' | 'V1' | 'MIXED' | null;
  raw_predictions:         WFPrediction[];
}

function saveReport(doc: ReportDoc): string {
  const outDir = path.resolve(process.cwd(), 'cache');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `v2-walkforward-${doc.competition}-${doc.season_year}.json`);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2), 'utf-8');
  return file;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apiToken = process.env.FOOTBALL_DATA_TOKEN ?? '';
  if (!apiToken) {
    console.error('ERROR: FOOTBALL_DATA_TOKEN not set');
    process.exit(1);
  }

  const comps      = (process.argv[2] ?? 'PD').split(',').map((c) => c.trim().toUpperCase());
  const seasonYear = parseInt(process.argv[3] ?? String(
    new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0),
  ), 10);

  console.log(`\nV2 Walk-Forward Validation`);
  console.log(`Competencias: ${comps.join(', ')}   Temporada: ${seasonYear}-${seasonYear + 1}`);
  console.log(`Frontera: ${seasonBoundaryIso(seasonYear).slice(0, 10)}  (July 1 UTC heuristic)`);

  for (const comp of comps) {
    console.log(`\n[${comp}] Cargando histórico...`);

    let allMatches;
    try {
      allMatches = await loadHistoricalMatches(comp, seasonYear, { apiToken });
    } catch (err) {
      console.error(`[${comp}] ERROR cargando histórico:`, err);
      continue;
    }

    console.log(`[${comp}] ${allMatches.length} partidos cargados total`);

    // Separar temporadas usando la frontera July 1 UTC
    const boundary             = seasonBoundaryIso(seasonYear);
    const currentSeasonMatches = allMatches.filter((r) => r.utcDate >= boundary);
    const prevSeasonMatches    = allMatches.filter((r) => r.utcDate <  boundary);

    console.log(`[${comp}] Temporada actual: ${currentSeasonMatches.length} partidos`);
    console.log(`[${comp}] Temporada anterior: ${prevSeasonMatches.length} partidos`);

    if (currentSeasonMatches.length === 0) {
      console.warn(`[${comp}] Sin partidos en la temporada ${seasonYear}. Verifica el año.`);
      continue;
    }

    // Walk-forward
    console.log(`[${comp}] Ejecutando walk-forward (${currentSeasonMatches.length} predicciones)...`);
    const predictions = runWalkForward(
      currentSeasonMatches.map((r) => ({
        homeTeamId: r.homeTeamId,
        awayTeamId: r.awayTeamId,
        utcDate:    r.utcDate,
        homeGoals:  r.homeGoals,
        awayGoals:  r.awayGoals,
      })),
      prevSeasonMatches.map((r) => ({
        homeTeamId: r.homeTeamId,
        awayTeamId: r.awayTeamId,
        utcDate:    r.utcDate,
        homeGoals:  r.homeGoals,
        awayGoals:  r.awayGoals,
      })),
    );

    const metrics = computeAllMetrics(predictions);

    // Season boundary report
    const boundaryReport = checkSeasonBoundary(comp, seasonYear);

    // V1 comparability
    const v1Snapshots  = loadV1Backtest(comp);
    const comparability = checkComparability(predictions, v1Snapshots);
    console.log(`[${comp}] V1 data: ${v1Snapshots.length} snapshots. Comparabilidad: ${comparability.status}`);

    // Intersection metrics — solo si comparison_status === COMPARABLE
    let interMetrics: { v2: V1Metrics | null; v1: V1Metrics | null } | null = null;
    if (comparability.comparison_status === 'COMPARABLE') {
      interMetrics = computeIntersectionMetrics(predictions, v1Snapshots, true /* useRaw */);
      console.log(`[${comp}] Métricas de intersección: ${interMetrics.v2?.n ?? 0} partidos comunes`);
    }

    const betterOnIntersection: 'V2' | 'V1' | 'MIXED' | null =
      interMetrics?.v2 && interMetrics?.v1
        ? summaryBetterModel(interMetrics.v2, interMetrics.v1)
        : null;

    // Print
    printReport(comp, seasonYear, metrics, boundaryReport, comparability, interMetrics);

    // Save JSON
    const doc: ReportDoc = {
      competition:             comp,
      season_year:             seasonYear,
      generated_at:            new Date().toISOString(),
      season_boundary:         boundaryReport,
      comparability,
      v2_metrics:              metrics,
      naive_baselines:         { log_loss: NAIVE_LOG_LOSS, brier_score: NAIVE_BRIER },
      v2_intersection_metrics: interMetrics?.v2 ?? null,
      v1_intersection_metrics: interMetrics?.v1 ?? null,
      better_on_intersection:  betterOnIntersection,
      raw_predictions:         predictions,
    };
    const outFile = saveReport(doc);
    console.log(`\n  Reporte JSON guardado: ${outFile}`);
  }
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
