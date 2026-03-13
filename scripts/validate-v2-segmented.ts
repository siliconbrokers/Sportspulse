/**
 * validate-v2-segmented.ts — Backtest segmentado del Motor Predictivo V2.
 *
 * Extiende el walk-forward estándar con:
 *   - Segmentación temporal: EARLY / MID / LATE (tercios cronológicos)
 *   - Segmentación por operating mode: FULL / LIMITED
 *   - Comparación V1 vs V2 por segmento (solo cuando COMPARABLE)
 *   - Conclusiones automáticas: WIN_V2 / WIN_V1 / INCONCLUSIVE / NOT_COMPARABLE
 *   - Salida: JSON + Markdown en cache/
 *
 * Uso:
 *   pnpm validate:v2:segmented PD 2024
 *   pnpm validate:v2:segmented PL 2024
 *   pnpm validate:v2:segmented PD,PL 2024
 *
 * Requiere: FOOTBALL_DATA_TOKEN en .env
 *
 * LIMITACIONES CONOCIDAS:
 *   - Frontera de temporada July 1 UTC es heurística para ligas europeas.
 *   - V2 produce probabilidades SIN calibrar (Poisson crudo).
 *   - Segmentación temporal usa tercios cronológicos (no matchday real).
 *     Para ligas de 38 jornadas, EARLY ≈ jornadas 1–13, MID ≈ 14–25, LATE ≈ 26–38
 *     (no coincide exactamente con la partición 1–8 / 9–26 / 27+ por matchday).
 *   - WIN_V2 requiere mejora simultánea en Log Loss Y Brier, con coverage ≥ MEDIUM
 *     y sin degradación material de draw bias (tolerancia 5pp).
 *
 * Para generar datos V1: correr primero run-backtest.ts.
 */

import 'dotenv/config';
import * as fs   from 'node:fs';
import * as path from 'node:path';

import { loadHistoricalMatches } from '../server/prediction/historical-match-loader.js';
import {
  loadHistoricalMatchesSportsDB,
  SPORTSDB_PROVIDER_KEY,
} from '../server/prediction/historical-match-loader-sportsdb.js';
import {
  runWalkForward,
  computeAllMetrics,
  NAIVE_LOG_LOSS,
  NAIVE_BRIER,
  type MetricBundle,
  type WFCalibrationBucket,
  type WFPrediction,
  type WalkForwardOptions,
} from '@sportpulse/prediction';
import type { HistoricalBacktestSnapshot } from '../server/prediction/historical-backtest-store.js';

// ── Shared types ──────────────────────────────────────────────────────────────

type TemporalTramo    = 'EARLY' | 'MID' | 'LATE';
type Conclusion       = 'WIN_V2' | 'WIN_V1' | 'INCONCLUSIVE' | 'NOT_COMPARABLE';
type ComparisonStatus   = 'COMPARABLE' | 'NOT_COMPARABLE';
type ComparisonCoverage = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
type ComparisonBasis    =
  | 'RAW_INTERSECTION_ONLY'
  | 'V2_CALIBRATED_VS_V1_RAW'
  | 'CALIBRATED_INTERSECTION_ONLY'
  | 'NONE';

interface SeasonBoundaryReport {
  policy:        'JULY_1_UTC_HEURISTIC' | 'JANUARY_1_UTC';
  boundary_date: string;
  applicability: 'KNOWN_EUROPEAN_CALENDARS' | 'SPORTSDB_CALENDAR_YEAR' | 'UNKNOWN_CALENDAR';
  warning:       string | null;
}

interface ComparabilityResult {
  comparison_status:     ComparisonStatus;
  comparison_coverage:   ComparisonCoverage;
  comparison_basis:      ComparisonBasis;
  n_v2_evaluated:        number;
  n_v1_eligible:         number;
  n_intersection:        number;
  v1_has_raw_probs:      boolean;
  not_comparable_reason: string | null;
}

/** Métricas comparables entre V1 y V2 (intersección). */
interface SimpleMetrics {
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

interface SegmentResult {
  n_total:                  number;
  n_evaluated:              number;
  /** null cuando n_evaluated === 0 */
  metrics:                  MetricBundle | null;
  /** Métricas V2 con probabilidades calibradas (isotónica online). null cuando n_evaluated === 0. */
  calib_metrics:            MetricBundle | null;
  comparability:            ComparabilityResult;
  v2_inter_metrics:         SimpleMetrics | null;
  /** V2 calibrado (isotónica online) sobre la intersección. */
  v2_calib_inter_metrics:   SimpleMetrics | null;
  v1_inter_metrics:         SimpleMetrics | null;
  conclusion:               Conclusion;
  conclusion_detail:        string;
}

interface SegmentedReportDoc {
  competition:           string;
  season_year:           number;
  generated_at:          string;
  season_boundary:       SeasonBoundaryReport;
  /**
   * Estrategia usada para los tramos temporales.
   * CHRONOLOGICAL_THIRDS = los partidos se ordenan por utcDate y se dividen en 3 partes iguales.
   * Para obtener la partición exacta por jornada se necesitan datos de matchday.
   */
  segmentation_strategy: 'CHRONOLOGICAL_THIRDS';
  naive_baselines:       { log_loss: number; brier_score: number };
  global: SegmentResult & {
    n_not_eligible:  number;
    n_limited:       number;
    better_on_inter: 'V2' | 'V2_CALIB' | 'V1' | 'MIXED' | null;
  };
  by_tramo: Record<TemporalTramo, SegmentResult>;
  by_mode:  { FULL: SegmentResult; LIMITED: SegmentResult };
  raw_predictions: WFPrediction[];
}

// ── Season boundary ───────────────────────────────────────────────────────────

const EUROPEAN_LEAGUE_JULY1_COMPAT = new Set([
  'PD', 'PL', 'BL1', 'BL2', 'SA', 'FL1', 'FL2', 'PPL', 'DED', 'CL', 'EL', 'EC',
]);

/** Competitions that use TheSportsDB and January 1 season boundary. */
const SPORTSDB_COMPS: Record<string, { leagueId: string; name: string }> = {
  URU: { leagueId: '4432', name: 'Uruguayan Primera Division' },
};

function seasonBoundaryIso(comp: string, year: number): string {
  if (comp in SPORTSDB_COMPS) {
    // Calendar year boundary: January 1
    return new Date(Date.UTC(year, 0, 1)).toISOString();
  }
  return new Date(Date.UTC(year, 6, 1)).toISOString();
}

function seasonNextBoundaryIso(comp: string, year: number): string {
  return seasonBoundaryIso(comp, year + 1);
}

function checkSeasonBoundary(comp: string, year: number): SeasonBoundaryReport {
  const isSDB = comp in SPORTSDB_COMPS;
  const boundary = seasonBoundaryIso(comp, year);
  const known    = isSDB || EUROPEAN_LEAGUE_JULY1_COMPAT.has(comp);
  return {
    policy:        isSDB ? 'JANUARY_1_UTC' : 'JULY_1_UTC_HEURISTIC',
    boundary_date: boundary.slice(0, 10),
    applicability: known ? (isSDB ? 'SPORTSDB_CALENDAR_YEAR' : 'KNOWN_EUROPEAN_CALENDARS') : 'UNKNOWN_CALENDAR',
    warning: known
      ? null
      : `'${comp}' no está en calendarios conocidos. ` +
        `La heurística puede no aplicar para esta liga.`,
  };
}

// ── V1 loader ─────────────────────────────────────────────────────────────────

interface V1Snapshot extends HistoricalBacktestSnapshot {}

function loadV1Backtest(competitionCode: string, seasonStartYear?: number): V1Snapshot[] {
  const p = path.resolve(process.cwd(), 'cache/predictions/historical-backtest.json');
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const doc = JSON.parse(raw) as { snapshots?: V1Snapshot[] };
    const lo = seasonStartYear != null ? `${seasonStartYear}-07-01` : null;
    const hi = seasonStartYear != null ? `${seasonStartYear + 1}-07-01` : null;
    return (doc.snapshots ?? []).filter((s) => {
      if (s.competition_code !== competitionCode) return false;
      if (s.p_home_win === null) return false;
      if (lo != null && s.kickoff_utc < lo) return false;
      if (hi != null && s.kickoff_utc >= hi) return false;
      return true;
    });
  } catch {
    return [];
  }
}

// ── Comparability ─────────────────────────────────────────────────────────────

function checkComparability(
  predictions: WFPrediction[],
  v1Snapshots: V1Snapshot[],
): ComparabilityResult {
  const v2Evaluated = predictions.filter((p) => p.eligibility_status !== 'NOT_ELIGIBLE');
  const n_v2        = v2Evaluated.length;

  if (v1Snapshots.length === 0) {
    return {
      comparison_status:     'NOT_COMPARABLE',
      comparison_coverage:   'NONE',
      comparison_basis:      'NONE',
      n_v2_evaluated:        n_v2,
      n_v1_eligible:         0,
      n_intersection:        0,
      v1_has_raw_probs:      false,
      not_comparable_reason: 'Sin datos V1. Ejecutar run-backtest.ts para generar.',
    };
  }

  const v1Eligible = v1Snapshots.filter(
    (s) => s.mode !== 'NOT_ELIGIBLE' && s.p_home_win !== null,
  );
  const n_v1 = v1Eligible.length;

  const v1ByKey = new Map<string, V1Snapshot>();
  for (const s of v1Eligible) {
    v1ByKey.set(`${s.home_team_id}:${s.away_team_id}:${s.kickoff_utc}`, s);
  }

  let n_intersection = 0;
  for (const p of v2Evaluated) {
    if (v1ByKey.has(p.matchId)) n_intersection++;
  }

  const maxUniverse = Math.max(n_v2, n_v1);
  const covFraction = maxUniverse > 0 ? n_intersection / maxUniverse : 0;
  const coverage: ComparisonCoverage =
    n_intersection === 0 ? 'NONE' :
    covFraction >= 0.70  ? 'HIGH'   :
    covFraction >= 0.30  ? 'MEDIUM' : 'LOW';

  const v1HasRaw = v1Eligible.some((s) => s.raw_p_home_win != null);

  if (!v1HasRaw) {
    return {
      comparison_status:     'NOT_COMPARABLE',
      comparison_coverage:   coverage,
      comparison_basis:      n_intersection > 0 ? 'CALIBRATED_INTERSECTION_ONLY' : 'NONE',
      n_v2_evaluated:        n_v2,
      n_v1_eligible:         n_v1,
      n_intersection,
      v1_has_raw_probs:      false,
      not_comparable_reason:
        'V1 solo tiene probabilidades calibradas (isotonic regression sobre Elo). ' +
        'V2 es Poisson sin calibrar. Escala distinta — comparación de Log Loss/Brier inválida.',
    };
  }

  if (n_intersection === 0) {
    return {
      comparison_status:     'NOT_COMPARABLE',
      comparison_coverage:   'NONE',
      comparison_basis:      'NONE',
      n_v2_evaluated:        n_v2,
      n_v1_eligible:         n_v1,
      n_intersection:        0,
      v1_has_raw_probs:      true,
      not_comparable_reason:
        'Intersección vacía. Universos de partidos no solapan ' +
        '(frontera de temporada distinta o team IDs inconsistentes).',
    };
  }

  return {
    comparison_status:     'COMPARABLE',
    comparison_coverage:   coverage,
    comparison_basis:      'RAW_INTERSECTION_ONLY',
    n_v2_evaluated:        n_v2,
    n_v1_eligible:         n_v1,
    n_intersection,
    v1_has_raw_probs:      true,
    not_comparable_reason: null,
  };
}

// ── Calibrated probs helper ───────────────────────────────────────────────────

/**
 * Crea una copia de cada WFPrediction donde prob_* = cal_prob_*.
 * Permite reutilizar todas las funciones de métricas sin modificarlas.
 */
function remapToCalibrated(preds: WFPrediction[]): WFPrediction[] {
  return preds.map((p) => ({
    ...p,
    prob_home_win: p.cal_prob_home_win,
    prob_draw:     p.cal_prob_draw,
    prob_away_win: p.cal_prob_away_win,
  }));
}

// ── Intersection metrics ──────────────────────────────────────────────────────

/**
 * Computa métricas V2 raw, V2 calibrado y V1 raw sobre los partidos de la
 * intersección exacta. Garantiza que los tres modelos se evalúan sobre
 * exactamente los mismos partidos.
 */
function computeIntersectionMetrics(
  predictions: WFPrediction[],
  v1Snapshots: V1Snapshot[],
): { v2: SimpleMetrics | null; v2Calib: SimpleMetrics | null; v1: SimpleMetrics | null } {
  const v1ByKey = new Map<string, V1Snapshot>();
  for (const s of v1Snapshots.filter((s) => s.mode !== 'NOT_ELIGIBLE' && s.p_home_win !== null)) {
    v1ByKey.set(`${s.home_team_id}:${s.away_team_id}:${s.kickoff_utc}`, s);
  }

  const v2Inter = predictions.filter(
    (p) => p.eligibility_status !== 'NOT_ELIGIBLE' && v1ByKey.has(p.matchId),
  );
  const v1Inter = v2Inter.map((p) => v1ByKey.get(p.matchId)!).filter(Boolean);

  if (v2Inter.length === 0) return { v2: null, v2Calib: null, v1: null };

  const EPSILON = 1e-7;

  function interMetrics(
    preds: WFPrediction[],
    probKey: 'raw' | 'calibrated',
  ): SimpleMetrics {
    let ll = 0, bs = 0, correct = 0, sumDraw = 0;
    for (const p of preds) {
      const pH = probKey === 'calibrated' ? p.cal_prob_home_win : p.prob_home_win;
      const pD = probKey === 'calibrated' ? p.cal_prob_draw     : p.prob_draw;
      const pA = probKey === 'calibrated' ? p.cal_prob_away_win : p.prob_away_win;
      const pActual = p.actual_outcome === 'H' ? pH : p.actual_outcome === 'D' ? pD : pA;
      ll += Math.log(Math.max(pActual, EPSILON));
      const iH = p.actual_outcome === 'H' ? 1 : 0;
      const iD = p.actual_outcome === 'D' ? 1 : 0;
      const iA = p.actual_outcome === 'A' ? 1 : 0;
      bs += (pH - iH) ** 2 + (pD - iD) ** 2 + (pA - iA) ** 2;
      const pred = pH >= pD && pH >= pA ? 'H' : pD >= pA ? 'D' : 'A';
      if (pred === p.actual_outcome) correct++;
      sumDraw += pD;
    }
    const n = preds.length;
    return {
      n,
      log_loss:       -(ll / n),
      brier_score:    bs / n,
      accuracy:       correct / n,
      draw_rate_pred: sumDraw / n,
      draw_rate_act:  preds.filter((p) => p.actual_outcome === 'D').length / n,
      goals_pred:     preds.reduce((s, p) => s + p.lambda_home + p.lambda_away, 0) / n,
      goals_act:      preds.reduce((s, p) => s + p.actual_home_goals + p.actual_away_goals, 0) / n,
      prob_source:    probKey,
    };
  }

  const n2 = v2Inter.length;
  const v2m    = interMetrics(v2Inter, 'raw');
  const v2Calibm = interMetrics(v2Inter, 'calibrated');

  // V1 metrics sobre la misma intersección
  let ll1 = 0, bs1 = 0, correct1 = 0, sumDraw1 = 0, sumGoals1 = 0, sumActGoals1 = 0;
  let usedRaw = false;

  for (const s of v1Inter) {
    const canRaw = s.raw_p_home_win != null && s.raw_p_draw != null && s.raw_p_away_win != null;
    const pH = canRaw ? s.raw_p_home_win! : s.p_home_win!;
    const pD = canRaw ? s.raw_p_draw!     : s.p_draw!;
    const pA = canRaw ? s.raw_p_away_win! : s.p_away_win!;
    if (canRaw) usedRaw = true;

    const outcome  = s.actual_result;
    const pActual  = outcome === 'HOME_WIN' ? pH : outcome === 'DRAW' ? pD : pA;
    ll1 += Math.log(Math.max(pActual, EPSILON));

    const iH = outcome === 'HOME_WIN' ? 1 : 0;
    const iD = outcome === 'DRAW'     ? 1 : 0;
    const iA = outcome === 'AWAY_WIN' ? 1 : 0;
    bs1 += (pH - iH) ** 2 + (pD - iD) ** 2 + (pA - iA) ** 2;

    const pred = pH >= pD && pH >= pA ? 'HOME_WIN' : pD >= pA ? 'DRAW' : 'AWAY_WIN';
    if (pred === outcome) correct1++;

    sumDraw1     += pD;
    sumGoals1    += (s.expected_goals_home ?? 0) + (s.expected_goals_away ?? 0);
    sumActGoals1 += s.home_goals + s.away_goals;
  }

  const n1 = v1Inter.length;
  const v1m: SimpleMetrics = {
    n:              n1,
    log_loss:       -(ll1 / n1),
    brier_score:    bs1 / n1,
    accuracy:       correct1 / n1,
    draw_rate_pred: sumDraw1 / n1,
    draw_rate_act:  v1Inter.filter((s) => s.actual_result === 'DRAW').length / n1,
    goals_pred:     sumGoals1 / n1,
    goals_act:      sumActGoals1 / n1,
    prob_source:    usedRaw ? 'raw' : 'calibrated',
  };

  return { v2: v2m, v2Calib: v2Calibm, v1: v1m };
}

// ── Temporal segmentation ─────────────────────────────────────────────────────

/**
 * Asigna tramos temporales dividiendo los partidos en 3 tercios cronológicos.
 *
 * Estrategia: CHRONOLOGICAL_THIRDS.
 * Los partidos se ordenan por utcDate y se dividen en partes iguales:
 *   EARLY = primer tercio (índice 0..N/3)
 *   MID   = segundo tercio
 *   LATE  = tercer tercio
 *
 * Nota: para ligas de 38 jornadas esto equivale aprox. a jornadas 1–13 / 14–25 / 26–38.
 * La partición exacta 1–8 / 9–26 / 27+ requiere datos de matchday no disponibles en V2.
 */
function assignTemporalTramos(predictions: WFPrediction[]): Map<string, TemporalTramo> {
  const sorted = [...predictions].sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  const n      = sorted.length;
  const map    = new Map<string, TemporalTramo>();
  sorted.forEach((p, i) => {
    const frac = n > 0 ? i / n : 0;
    map.set(p.matchId, frac < 1 / 3 ? 'EARLY' : frac < 2 / 3 ? 'MID' : 'LATE');
  });
  return map;
}

// ── Conclusion rules ──────────────────────────────────────────────────────────

/**
 * Deriva la conclusión automática para un segmento.
 *
 * WIN_V2: V2 mejora Log Loss Y Brier, coverage ≥ MEDIUM,
 *         draw bias V2 no supera draw bias V1 por más de 5pp.
 * WIN_V1: V1 supera V2 en LL y Brier.
 * INCONCLUSIVE: resultados mixtos o coverage LOW.
 * NOT_COMPARABLE: comparación metodológicamente inválida.
 */
function deriveConclusion(
  v2m:    SimpleMetrics | null,
  v1m:    SimpleMetrics | null,
  compat: ComparabilityResult,
): { conclusion: Conclusion; detail: string } {
  if (compat.comparison_status !== 'COMPARABLE' || !v2m || !v1m) {
    return {
      conclusion: 'NOT_COMPARABLE',
      detail:     compat.not_comparable_reason ?? 'Sin datos comparables.',
    };
  }

  if (compat.comparison_coverage === 'LOW') {
    return {
      conclusion: 'INCONCLUSIVE',
      detail:     `Coverage LOW (N=${compat.n_intersection}). Muestra insuficiente para conclusión robusta.`,
    };
  }

  const llBetter    = v2m.log_loss    < v1m.log_loss;
  const brierBetter = v2m.brier_score < v1m.brier_score;
  const biasV2      = Math.abs(v2m.draw_rate_pred - v2m.draw_rate_act);
  const biasV1      = Math.abs(v1m.draw_rate_pred - v1m.draw_rate_act);
  const drawNotWorse = biasV2 <= biasV1 + 0.05;

  if (llBetter && brierBetter && drawNotWorse) {
    const dl = (v1m.log_loss    - v2m.log_loss).toFixed(3);
    const db = (v1m.brier_score - v2m.brier_score).toFixed(3);
    return {
      conclusion: 'WIN_V2',
      detail:     `V2 mejora LL en +${dl} y Brier en +${db}. Draw bias sin degradación material.`,
    };
  }

  if (!llBetter && !brierBetter) {
    const dl = (v2m.log_loss    - v1m.log_loss).toFixed(3);
    const db = (v2m.brier_score - v1m.brier_score).toFixed(3);
    return {
      conclusion: 'WIN_V1',
      detail:     `V1 supera V2 en LL (+${dl}) y Brier (+${db}).`,
    };
  }

  return {
    conclusion: 'INCONCLUSIVE',
    detail:
      `Resultados mixtos: Log Loss → ${llBetter ? 'V2' : 'V1'}, ` +
      `Brier → ${brierBetter ? 'V2' : 'V1'}.`,
  };
}

// ── better_on_intersection ────────────────────────────────────────────────────

function betterOnInter(
  v2: SimpleMetrics | null,
  _v2Calib: SimpleMetrics | null,
  v1: SimpleMetrics | null,
): 'V2' | 'V2_CALIB' | 'V1' | 'MIXED' | null {
  if (!v2 || !v1) return null;
  let v2w = 0, v1w = 0;
  if (v2.log_loss    < v1.log_loss)    v2w++; else if (v2.log_loss    > v1.log_loss)    v1w++;
  if (v2.brier_score < v1.brier_score) v2w++; else if (v2.brier_score > v1.brier_score) v1w++;
  if (v2.accuracy    > v1.accuracy)    v2w++; else if (v2.accuracy    < v1.accuracy)    v1w++;
  if (v2w === 3) return 'V2';
  if (v1w === 3) return 'V1';
  return 'MIXED';
}

// ── Segment builder ───────────────────────────────────────────────────────────

function buildSegmentResult(
  preds:       WFPrediction[],
  v1Snapshots: V1Snapshot[],
): SegmentResult {
  const n_total     = preds.length;
  const n_evaluated = preds.filter((p) => p.eligibility_status !== 'NOT_ELIGIBLE').length;
  const metrics       = n_evaluated > 0 ? computeAllMetrics(preds) : null;
  const calibPreds    = remapToCalibrated(preds);
  const calib_metrics = n_evaluated > 0 ? computeAllMetrics(calibPreds) : null;
  const compat        = checkComparability(preds, v1Snapshots);

  let v2m: SimpleMetrics | null = null;
  let v2CalibM: SimpleMetrics | null = null;
  let v1m: SimpleMetrics | null = null;
  if (compat.comparison_status === 'COMPARABLE') {
    const inter = computeIntersectionMetrics(preds, v1Snapshots);
    v2m      = inter.v2;
    v2CalibM = inter.v2Calib;
    v1m      = inter.v1;
  }

  // Conclusión primaria: V2 raw vs V1.
  // V2 calibrado disponible en v2_calib_inter_metrics para diagnóstico.
  const { conclusion, detail } = deriveConclusion(v2m, v1m, compat);

  return {
    n_total,
    n_evaluated,
    metrics,
    calib_metrics,
    comparability:          compat,
    v2_inter_metrics:       v2m,
    v2_calib_inter_metrics: v2CalibM,
    v1_inter_metrics:       v1m,
    conclusion,
    conclusion_detail: detail,
  };
}

// ── Markdown helpers ──────────────────────────────────────────────────────────

const fmtNum  = (v: number, d = 3): string => isNaN(v) ? '—' : v.toFixed(d);
const fmtPct  = (v: number, d = 1): string => isNaN(v) ? '—' : (v * 100).toFixed(d) + '%';
const fmtDiff = (v: number, d = 3): string =>
  isNaN(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d);

function calMACE(buckets: WFCalibrationBucket[]): number {
  const ne = buckets.filter((b) => b.n_pairs > 0);
  if (ne.length === 0) return NaN;
  return ne.reduce((s, b) => s + Math.abs(b.mean_predicted_prob - b.actual_hit_rate), 0) / ne.length;
}

function calMeanBias(buckets: WFCalibrationBucket[]): number {
  const ne = buckets.filter((b) => b.n_pairs > 0);
  if (ne.length === 0) return NaN;
  return ne.reduce((s, b) => s + (b.mean_predicted_prob - b.actual_hit_rate), 0) / ne.length;
}

function biasLabel(bias: number): string {
  if (isNaN(bias)) return '—';
  if (bias > 0.04) return 'Sobreestimación';
  if (bias < -0.04) return 'Subestimación';
  return 'Calibrado';
}

function conclusionEmoji(c: Conclusion): string {
  switch (c) {
    case 'WIN_V2':        return '✅ WIN\_V2';
    case 'WIN_V1':        return '❌ WIN\_V1';
    case 'INCONCLUSIVE':  return '⚠️ INCONCLUSIVE';
    case 'NOT_COMPARABLE': return '— NOT\_COMPARABLE';
  }
}

// ── Markdown generation ───────────────────────────────────────────────────────

function generateMarkdown(doc: SegmentedReportDoc): string {
  const lines: string[] = [];

  const push    = (...s: string[]) => lines.push(...s);
  const pushLn  = (s = '')        => lines.push(s);
  const h       = (n: number, t: string) => { push(`${'#'.repeat(n)} ${t}`); pushLn(); };
  const mdTable = (headers: string[], rows: string[][]): void => {
    push('| ' + headers.join(' | ') + ' |');
    push('| ' + headers.map(() => '---').join(' | ') + ' |');
    rows.forEach((row) => push('| ' + row.join(' | ') + ' |'));
    pushLn();
  };

  const { competition: comp, season_year: year } = doc;

  // ── Header ────────────────────────────────────────────────────────────────
  h(1, `Backtest Segmentado — ${comp} ${year}-${year + 1}`);
  push(
    `**Generado:** ${doc.generated_at.slice(0, 19).replace('T', ' ')} UTC  ` +
    `**Estrategia:** ${doc.segmentation_strategy}  ` +
    `**Frontera:** ${doc.season_boundary.boundary_date}`,
  );
  pushLn();
  if (doc.season_boundary.warning) {
    push(`> ⚠️ **Season boundary:** ${doc.season_boundary.warning}`);
    pushLn();
  }

  // ── Resumen ejecutivo ─────────────────────────────────────────────────────
  h(2, 'Resumen Ejecutivo');

  const summaryRows: string[][] = [
    ['Global',       `${doc.global.n_evaluated} eval`,                   conclusionEmoji(doc.global.conclusion),       doc.global.conclusion_detail],
    ['EARLY',        `${doc.by_tramo.EARLY.n_evaluated} eval`,           conclusionEmoji(doc.by_tramo.EARLY.conclusion), doc.by_tramo.EARLY.conclusion_detail],
    ['MID',          `${doc.by_tramo.MID.n_evaluated} eval`,             conclusionEmoji(doc.by_tramo.MID.conclusion),   doc.by_tramo.MID.conclusion_detail],
    ['LATE',         `${doc.by_tramo.LATE.n_evaluated} eval`,            conclusionEmoji(doc.by_tramo.LATE.conclusion),  doc.by_tramo.LATE.conclusion_detail],
    ['FULL mode',    `${doc.by_mode.FULL.n_evaluated} eval`,             conclusionEmoji(doc.by_mode.FULL.conclusion),    doc.by_mode.FULL.conclusion_detail],
    ['LIMITED mode', `${doc.by_mode.LIMITED.n_evaluated} eval`,          conclusionEmoji(doc.by_mode.LIMITED.conclusion), doc.by_mode.LIMITED.conclusion_detail],
  ];
  mdTable(['Dimensión', 'N', 'Conclusión', 'Detalle'], summaryRows);

  // ── Métricas globales ─────────────────────────────────────────────────────
  h(2, 'Métricas Globales (V2 Poisson — raw)');

  const gm = doc.global.metrics;
  if (gm) {
    mdTable(
      ['Métrica', 'V2', 'Naive', 'vs Naive'],
      [
        [
          'Log Loss 1X2',
          fmtNum(gm.log_loss),
          fmtNum(doc.naive_baselines.log_loss),
          fmtDiff(gm.log_loss - doc.naive_baselines.log_loss),
        ],
        [
          'Brier 1X2 `[0,2]`',
          fmtNum(gm.brier_score),
          fmtNum(doc.naive_baselines.brier_score),
          fmtDiff(gm.brier_score - doc.naive_baselines.brier_score),
        ],
        ['Accuracy', fmtPct(gm.accuracy), '—', '—'],
        [
          'Draw pred / real',
          `${fmtPct(gm.draw_rate.predicted_mean)} / ${fmtPct(gm.draw_rate.actual_rate)}`,
          '—',
          fmtDiff(gm.draw_rate.predicted_mean - gm.draw_rate.actual_rate),
        ],
        [
          'Goals pred / real (por partido)',
          `${fmtNum(gm.goals.predicted_total_pg, 2)} / ${fmtNum(gm.goals.actual_total_pg, 2)}`,
          '—',
          fmtDiff(gm.goals.predicted_total_pg - gm.goals.actual_total_pg, 2),
        ],
      ],
    );
    push(`> Brier multiclase 1X2: rango \`[0, 2]\`. Naive uniforme = ${fmtNum(doc.naive_baselines.brier_score)}. Valor menor = mejor.`);
    pushLn();
  } else {
    push('Sin datos evaluables para métricas globales.');
    pushLn();
  }

  // ── Segmentación temporal ─────────────────────────────────────────────────
  h(2, 'Segmentación Temporal (CHRONOLOGICAL_THIRDS)');
  push(
    'Los partidos se ordenan cronológicamente y se dividen en 3 partes iguales: ' +
    '**EARLY** (primer tercio), **MID** (segundo tercio), **LATE** (tercer tercio).  \n' +
    'Para ligas de 38 jornadas: EARLY ≈ J1–J13, MID ≈ J14–J25, LATE ≈ J26–J38.',
  );
  pushLn();

  mdTable(
    ['Tramo', 'N total', 'N eval', 'Log Loss', 'Brier', 'Accuracy', 'Draw Δ', 'Conclusión'],
    (['EARLY', 'MID', 'LATE'] as TemporalTramo[]).map((t) => {
      const seg = doc.by_tramo[t];
      const m   = seg.metrics;
      return [
        `**${t}**`,
        String(seg.n_total),
        String(seg.n_evaluated),
        m ? fmtNum(m.log_loss) : '—',
        m ? fmtNum(m.brier_score) : '—',
        m ? fmtPct(m.accuracy) : '—',
        m ? fmtDiff(m.draw_rate.predicted_mean - m.draw_rate.actual_rate) : '—',
        conclusionEmoji(seg.conclusion),
      ];
    }),
  );

  // ── Segmentación por operating mode ──────────────────────────────────────
  h(2, 'Segmentación por Operating Mode');

  const totalPreds = doc.raw_predictions.length;
  const nFull    = doc.raw_predictions.filter((p) => p.eligibility_status === 'ELIGIBLE').length;
  const nLimited = doc.raw_predictions.filter((p) => p.eligibility_status === 'LIMITED').length;
  const nNotElig = doc.raw_predictions.filter((p) => p.eligibility_status === 'NOT_ELIGIBLE').length;

  mdTable(
    ['Mode', 'N', '%', 'Log Loss', 'Brier', 'Accuracy', 'Conclusión'],
    [
      (() => {
        const seg = doc.by_mode.FULL;
        const m   = seg.metrics;
        return [
          'FULL',
          String(nFull),
          fmtPct(nFull / totalPreds),
          m ? fmtNum(m.log_loss) : '—',
          m ? fmtNum(m.brier_score) : '—',
          m ? fmtPct(m.accuracy) : '—',
          conclusionEmoji(seg.conclusion),
        ];
      })(),
      (() => {
        const seg = doc.by_mode.LIMITED;
        const m   = seg.metrics;
        return [
          'LIMITED',
          String(nLimited),
          fmtPct(nLimited / totalPreds),
          m ? fmtNum(m.log_loss) : '—',
          m ? fmtNum(m.brier_score) : '—',
          m ? fmtPct(m.accuracy) : '—',
          conclusionEmoji(seg.conclusion),
        ];
      })(),
      ['NOT\_ELIGIBLE', String(nNotElig), fmtPct(nNotElig / totalPreds), '—', '—', '—', '—'],
    ],
  );

  // ── V1 vs V2 comparación global ───────────────────────────────────────────
  h(2, 'Comparación V1 vs V2 (Intersección Exacta)');

  const gc = doc.global.comparability;
  push(
    `**comparison_status:** \`${gc.comparison_status}\`  ` +
    `**coverage:** \`${gc.comparison_coverage}\`  ` +
    `**basis:** \`${gc.comparison_basis}\``,
  );
  push(
    `V2 evaluados: ${gc.n_v2_evaluated}  |  V1 elegibles: ${gc.n_v1_eligible}  |  Intersección: ${gc.n_intersection}`,
  );
  pushLn();

  if (gc.comparison_status === 'NOT_COMPARABLE') {
    push(`> ⚠️ ${gc.not_comparable_reason}`);
    pushLn();
  } else if (doc.global.v2_inter_metrics && doc.global.v1_inter_metrics) {
    const v2i    = doc.global.v2_inter_metrics;
    const v2ci   = doc.global.v2_calib_inter_metrics;
    const v1i    = doc.global.v1_inter_metrics;
    const hasCalib = v2ci != null;
    const primaryV2 = v2i;  // V2 raw es el primario
    mdTable(
      ['Métrica', 'V2 raw', ...(hasCalib ? ['V2 calib'] : []), 'V1 raw', 'Δ (V2−V1)'],
      [
        ['Log Loss',
          fmtNum(v2i.log_loss),
          ...(hasCalib ? [fmtNum(v2ci!.log_loss)] : []),
          fmtNum(v1i.log_loss),
          fmtDiff(primaryV2.log_loss - v1i.log_loss)],
        ['Brier 1X2',
          fmtNum(v2i.brier_score),
          ...(hasCalib ? [fmtNum(v2ci!.brier_score)] : []),
          fmtNum(v1i.brier_score),
          fmtDiff(primaryV2.brier_score - v1i.brier_score)],
        ['Accuracy',
          fmtPct(v2i.accuracy),
          ...(hasCalib ? [fmtPct(v2ci!.accuracy)] : []),
          fmtPct(v1i.accuracy),
          fmtDiff(primaryV2.accuracy - v1i.accuracy)],
        ['Draw pred / real',
          `${fmtPct(v2i.draw_rate_pred)} / ${fmtPct(v2i.draw_rate_act)}`,
          ...(hasCalib ? [`${fmtPct(v2ci!.draw_rate_pred)} / ${fmtPct(v2ci!.draw_rate_act)}`] : []),
          `${fmtPct(v1i.draw_rate_pred)} / ${fmtPct(v1i.draw_rate_act)}`,
          '—'],
        ['Goals pred / real',
          `${fmtNum(v2i.goals_pred, 2)} / ${fmtNum(v2i.goals_act, 2)}`,
          ...(hasCalib ? [`${fmtNum(v2ci!.goals_pred, 2)} / ${fmtNum(v2ci!.goals_act, 2)}`] : []),
          `${fmtNum(v1i.goals_pred, 2)} / ${fmtNum(v1i.goals_act, 2)}`,
          '—'],
      ],
    );
    if (hasCalib) {
      push(`> _Primario = V2 calib (isotónica online). Δ mide mejora del primario sobre V1._`);
      pushLn();
    }
    if (doc.global.better_on_inter) {
      push(`**Ganador en intersección (LL + Brier + Accuracy):** \`${doc.global.better_on_inter}\``);
      pushLn();
    }
  }

  // ── Per-class calibration (global) ───────────────────────────────────────
  h(2, 'Calibración por Clase — Global (V2 raw)');
  push(
    'MACE = Mean Absolute Calibration Error por bucket no vacío.  \n' +
    'Sesgo medio = media(predicho − real): positivo → sobreestimación, negativo → subestimación.  \n' +
    'Poisson crudo tiende a sobreestimar draws (sesgo D positivo típico). ' +
    'La calibración isotónica online corrige este sesgo en la comparación V1/V2.',
  );
  pushLn();

  if (gm) {
    const pc = gm.per_class_calibration_buckets;
    mdTable(
      ['Clase', 'N pares', 'MACE', 'Sesgo medio', 'Diagnóstico'],
      [
        ['Home (H)', String(pc.home.reduce((s, b) => s + b.n_pairs, 0)), fmtNum(calMACE(pc.home), 3), fmtDiff(calMeanBias(pc.home), 3), biasLabel(calMeanBias(pc.home))],
        ['Draw (D)', String(pc.draw.reduce((s, b) => s + b.n_pairs, 0)), fmtNum(calMACE(pc.draw), 3), fmtDiff(calMeanBias(pc.draw), 3), biasLabel(calMeanBias(pc.draw))],
        ['Away (A)', String(pc.away.reduce((s, b) => s + b.n_pairs, 0)), fmtNum(calMACE(pc.away), 3), fmtDiff(calMeanBias(pc.away), 3), biasLabel(calMeanBias(pc.away))],
      ],
    );
  } else {
    push('Sin datos.');
    pushLn();
  }

  // ── Advertencias ──────────────────────────────────────────────────────────
  h(2, 'Advertencias y Limitaciones');

  const warns: string[] = [];
  if (doc.season_boundary.warning) {
    warns.push(`**SEASON BOUNDARY:** ${doc.season_boundary.warning}`);
  }
  warns.push(
    '**V2 CALIBRACIÓN ONLINE (§17.1):** Las métricas globales usan probabilidades Poisson crudas. ' +
    'La comparación V1 vs V2 usa V2-calibrado (isotónica online con mínimo 30 muestras previas) como métrica primaria. ' +
    'Con <30 predicciones ELIGIBLE anteriores, la calibración es identity (bootstrap). ' +
    'Ver "Calibración por Clase" para diagnosticar el sesgo raw.',
  );
  warns.push(
    '**BRIER MULTICLASE:** Este Brier Score 1X2 tiene rango `[0, 2]`, no `[0, 1]`. ' +
    'No comparar con literatura que use Brier binario.',
  );
  warns.push(
    '**SEGMENTACIÓN TEMPORAL:** Los tramos son tercios cronológicos, no jornadas reales. ' +
    'Para la partición exacta por jornada se requieren datos de matchday no disponibles en V2.',
  );
  warns.push(
    '**WIN_V2:** Requiere mejora simultánea en Log Loss Y Brier, coverage ≥ MEDIUM, ' +
    'y draw bias V2 no más de 5pp peor que V1. Con coverage LOW la conclusión es INCONCLUSIVE.',
  );

  warns.forEach((w, i) => {
    push(`${i + 1}. ${w}`);
  });
  pushLn();

  return lines.join('\n');
}

// ── Stdout summary ────────────────────────────────────────────────────────────

function printSummary(doc: SegmentedReportDoc): void {
  const SEP  = '─'.repeat(72);
  const SEP2 = '═'.repeat(72);

  console.log(`\n${SEP2}`);
  console.log(`  BACKTEST SEGMENTADO V2 — ${doc.competition} ${doc.season_year}-${doc.season_year + 1}`);
  console.log(`  Estrategia: ${doc.segmentation_strategy}`);
  console.log(SEP2);

  // Global
  const gm = doc.global.metrics;
  if (gm) {
    const llDelta    = gm.log_loss    - doc.naive_baselines.log_loss;
    const brierDelta = gm.brier_score - doc.naive_baselines.brier_score;
    console.log(`\n  GLOBAL  (N=${doc.global.n_evaluated} eval / ${doc.global.n_total} total,  NOT_ELIG=${doc.global.n_not_eligible}  LIMITED=${doc.global.n_limited})`);
    console.log(`    Log Loss   ${gm.log_loss.toFixed(4).padStart(8)}  naive ${doc.naive_baselines.log_loss.toFixed(4)}  Δ ${(llDelta >= 0 ? '+' : '') + llDelta.toFixed(4)}`);
    console.log(`    Brier[0,2] ${gm.brier_score.toFixed(4).padStart(8)}  naive ${doc.naive_baselines.brier_score.toFixed(4)}  Δ ${(brierDelta >= 0 ? '+' : '') + brierDelta.toFixed(4)}`);
    console.log(`    Accuracy   ${(gm.accuracy * 100).toFixed(1).padStart(7)}%`);
    console.log(`    Draw pred/real  ${(gm.draw_rate.predicted_mean * 100).toFixed(1)}% / ${(gm.draw_rate.actual_rate * 100).toFixed(1)}%`);
  }
  console.log(SEP);

  // Temporal tramos
  console.log(`\n  TEMPORAL (CHRONOLOGICAL_THIRDS)`);
  console.log(`  ${'Tramo'.padEnd(8)}  ${'N eval'.padStart(7)}  ${'Log Loss'.padStart(9)}  ${'Brier'.padStart(7)}  ${'Acc'.padStart(6)}  ${'Draw Δ'.padStart(7)}  Conclusión`);
  for (const t of ['EARLY', 'MID', 'LATE'] as TemporalTramo[]) {
    const seg = doc.by_tramo[t];
    const m   = seg.metrics;
    const drDelta = m ? (m.draw_rate.predicted_mean - m.draw_rate.actual_rate) * 100 : NaN;
    console.log(
      `  ${t.padEnd(8)}  ${String(seg.n_evaluated).padStart(7)}  ` +
      `${m ? m.log_loss.toFixed(4).padStart(9) : '       n/a'}  ` +
      `${m ? m.brier_score.toFixed(4).padStart(7) : '    n/a'}  ` +
      `${m ? (m.accuracy * 100).toFixed(1).padStart(5) + '%' : '   n/a'}  ` +
      `${isNaN(drDelta) ? '    n/a' : ((drDelta >= 0 ? '+' : '') + drDelta.toFixed(1) + 'pp').padStart(7)}  ` +
      seg.conclusion,
    );
  }
  console.log(SEP);

  // Operating mode
  console.log(`\n  OPERATING MODE`);
  console.log(`  ${'Mode'.padEnd(12)}  ${'N'.padStart(7)}  ${'Log Loss'.padStart(9)}  ${'Brier'.padStart(7)}  ${'Acc'.padStart(6)}  Conclusión`);
  for (const [mode, seg] of [
    ['FULL',    doc.by_mode.FULL]    as const,
    ['LIMITED', doc.by_mode.LIMITED] as const,
  ]) {
    const m = seg.metrics;
    console.log(
      `  ${mode.padEnd(12)}  ${String(seg.n_evaluated).padStart(7)}  ` +
      `${m ? m.log_loss.toFixed(4).padStart(9) : '       n/a'}  ` +
      `${m ? m.brier_score.toFixed(4).padStart(7) : '    n/a'}  ` +
      `${m ? (m.accuracy * 100).toFixed(1).padStart(5) + '%' : '   n/a'}  ` +
      seg.conclusion,
    );
  }
  console.log(SEP);

  // Comparabilidad
  const gc = doc.global.comparability;
  console.log(`\n  COMPARABILIDAD V1 vs V2`);
  console.log(`    status:    ${gc.comparison_status}`);
  console.log(`    coverage:  ${gc.comparison_coverage}`);
  console.log(`    basis:     ${gc.comparison_basis}`);
  console.log(`    N V2:      ${gc.n_v2_evaluated}   N V1: ${gc.n_v1_eligible}   intersección: ${gc.n_intersection}`);
  if (gc.not_comparable_reason) {
    console.log(`    Razón:     ${gc.not_comparable_reason}`);
  }
  if (doc.global.v2_inter_metrics && doc.global.v1_inter_metrics) {
    const v2i  = doc.global.v2_inter_metrics;
    const v2ci = doc.global.v2_calib_inter_metrics;
    const v1i  = doc.global.v1_inter_metrics;
    const primaryV2 = v2i;  // V2 raw es el primario
    const hasCalib  = v2ci != null;
    console.log(`\n    Intersección (N=${v2i.n})   ${hasCalib ? 'V2 raw / V2 calib / V1 raw' : 'V2 raw / V1 raw'}`);
    console.log(`    ${''.padEnd(20)}  ${'V2 raw'.padStart(8)}${hasCalib ? '  ' + 'V2 calib'.padStart(8) : ''}  ${'V1 raw'.padStart(8)}  ${'Δ V2-V1'.padStart(10)}`);
    const row3 = (lbl: string, a: number, ac: number | undefined, b: number) => {
      const delta = ((primaryV2 === v2ci ? (ac ?? a) : a) - b);
      console.log(
        `    ${lbl.padEnd(20)}  ${a.toFixed(4).padStart(8)}` +
        (hasCalib ? `  ${(ac ?? NaN).toFixed(4).padStart(8)}` : '') +
        `  ${b.toFixed(4).padStart(8)}  ${(delta >= 0 ? '+' : '') + delta.toFixed(4).padStart(10)}`,
      );
    };
    row3('Log Loss',  v2i.log_loss,    v2ci?.log_loss,    v1i.log_loss);
    row3('Brier',     v2i.brier_score, v2ci?.brier_score, v1i.brier_score);
    row3('Accuracy',  v2i.accuracy,    v2ci?.accuracy,    v1i.accuracy);
    if (doc.global.better_on_inter) {
      console.log(`    better_on_inter: ${doc.global.better_on_inter}`);
    }
  }
  console.log(SEP);

  // Conclusiones
  console.log(`\n  CONCLUSIONES AUTOMÁTICAS`);
  const rows: [string, Conclusion, string][] = [
    ['Global',       doc.global.conclusion,              doc.global.conclusion_detail],
    ['EARLY',        doc.by_tramo.EARLY.conclusion,      doc.by_tramo.EARLY.conclusion_detail],
    ['MID',          doc.by_tramo.MID.conclusion,        doc.by_tramo.MID.conclusion_detail],
    ['LATE',         doc.by_tramo.LATE.conclusion,       doc.by_tramo.LATE.conclusion_detail],
    ['FULL mode',    doc.by_mode.FULL.conclusion,        doc.by_mode.FULL.conclusion_detail],
    ['LIMITED mode', doc.by_mode.LIMITED.conclusion,     doc.by_mode.LIMITED.conclusion_detail],
  ];
  for (const [label, concl, detail] of rows) {
    const marker = concl === 'WIN_V2' ? '✓' : concl === 'WIN_V1' ? '✗' : concl === 'INCONCLUSIVE' ? '~' : '-';
    console.log(`    ${marker} ${label.padEnd(14)} ${concl.padEnd(16)} ${detail}`);
  }
  console.log(SEP2);
}

// ── File output ───────────────────────────────────────────────────────────────

function saveFiles(doc: SegmentedReportDoc): { jsonPath: string; mdPath: string } {
  const outDir = path.resolve(process.cwd(), 'cache');
  fs.mkdirSync(outDir, { recursive: true });
  const base     = `v2-segmented-${doc.competition}-${doc.season_year}`;
  const jsonPath = path.join(outDir, `${base}.json`);
  const mdPath   = path.join(outDir, `${base}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2), 'utf-8');
  fs.writeFileSync(mdPath,   generateMarkdown(doc),        'utf-8');
  return { jsonPath, mdPath };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apiToken    = process.env.FOOTBALL_DATA_TOKEN ?? '';
  const sportsdbKey = process.env.SPORTSDB_API_KEY ?? '1';

  const comps = (process.argv[2] ?? 'PD').split(',').map((c) => c.trim().toUpperCase());
  const seasonYear = parseInt(
    process.argv[3] ??
      String(new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0)),
    10,
  );

  console.log(`\nV2 Segmented Backtest`);
  console.log(`Competencias: ${comps.join(', ')}   Temporada: ${seasonYear}`);

  for (const comp of comps) {
    const sdbConfig  = SPORTSDB_COMPS[comp];
    const isSportsDB = sdbConfig != null;
    const boundary     = seasonBoundaryIso(comp, seasonYear);
    const nextBoundary = seasonNextBoundaryIso(comp, seasonYear);

    console.log(`\n[${comp}] Cargando histórico... (${isSportsDB ? 'TheSportsDB' : 'football-data.org'})`);
    console.log(`Frontera: ${boundary.slice(0, 10)}  (${isSportsDB ? 'January 1 UTC' : 'July 1 UTC heuristic'})`);

    let allMatches;
    try {
      if (isSportsDB) {
        allMatches = await loadHistoricalMatchesSportsDB(sdbConfig.leagueId, seasonYear, {
          apiKey: sportsdbKey,
        });
      } else {
        if (!apiToken) {
          console.error(`[${comp}] ERROR: FOOTBALL_DATA_TOKEN no configurado`);
          continue;
        }
        allMatches = await loadHistoricalMatches(comp, seasonYear, { apiToken });
      }
    } catch (err) {
      console.error(`[${comp}] ERROR cargando histórico:`, err);
      continue;
    }

    console.log(`[${comp}] ${allMatches.length} partidos cargados`);

    const current  = allMatches.filter((r) => r.utcDate >= boundary && r.utcDate < nextBoundary);
    const prev     = allMatches.filter((r) => r.utcDate <  boundary);

    console.log(`[${comp}] Temporada ${seasonYear}: ${current.length}  |  Anterior: ${prev.length}`);

    if (current.length === 0) {
      console.warn(`[${comp}] Sin partidos en temporada ${seasonYear}. Verifica el año.`);
      continue;
    }

    // Walk-forward — calibración intra-season disponible en WFPrediction.cal_prob_* (diagnóstico)
    // pero V2 raw se usa como métrica primaria de comparación vs V1
    const wfOptions: WalkForwardOptions = {};
    console.log(`[${comp}] Walk-forward (${current.length} predicciones)...`);
    const predictions = runWalkForward(
      current.map((r) => ({
        homeTeamId: r.homeTeamId,
        awayTeamId: r.awayTeamId,
        utcDate:    r.utcDate,
        homeGoals:  r.homeGoals,
        awayGoals:  r.awayGoals,
      })),
      prev.map((r) => ({
        homeTeamId: r.homeTeamId,
        awayTeamId: r.awayTeamId,
        utcDate:    r.utcDate,
        homeGoals:  r.homeGoals,
        awayGoals:  r.awayGoals,
      })),
      wfOptions,
    );

    // V1 data
    const v1Snapshots = loadV1Backtest(comp, seasonYear);
    console.log(`[${comp}] V1 snapshots disponibles: ${v1Snapshots.length}`);

    // Temporal segmentation
    const tramoMap = assignTemporalTramos(predictions);
    const byTramo: Record<TemporalTramo, WFPrediction[]> = {
      EARLY: predictions.filter((p) => tramoMap.get(p.matchId) === 'EARLY'),
      MID:   predictions.filter((p) => tramoMap.get(p.matchId) === 'MID'),
      LATE:  predictions.filter((p) => tramoMap.get(p.matchId) === 'LATE'),
    };

    // Operating mode segmentation
    // V2EligibilityStatus: 'ELIGIBLE' | 'LIMITED' | 'NOT_ELIGIBLE' (ver types.ts)
    const byMode = {
      FULL:    predictions.filter((p) => p.eligibility_status === 'ELIGIBLE'),
      LIMITED: predictions.filter((p) => p.eligibility_status === 'LIMITED'),
    };

    console.log(
      `[${comp}] Segmentos: EARLY=${byTramo.EARLY.length}  MID=${byTramo.MID.length}  LATE=${byTramo.LATE.length}` +
      `  |  FULL=${byMode.FULL.length}  LIMITED=${byMode.LIMITED.length}`,
    );

    // Build segments
    console.log(`[${comp}] Computando métricas por segmento...`);
    const globalResult = buildSegmentResult(predictions, v1Snapshots);

    const tramoResults: Record<TemporalTramo, SegmentResult> = {
      EARLY: buildSegmentResult(byTramo.EARLY, v1Snapshots),
      MID:   buildSegmentResult(byTramo.MID,   v1Snapshots),
      LATE:  buildSegmentResult(byTramo.LATE,  v1Snapshots),
    };

    const modeResults = {
      FULL:    buildSegmentResult(byMode.FULL,    v1Snapshots),
      LIMITED: buildSegmentResult(byMode.LIMITED, v1Snapshots),
    };

    // Assemble doc
    const boundaryReport = checkSeasonBoundary(comp, seasonYear);
    const doc: SegmentedReportDoc = {
      competition:           comp,
      season_year:           seasonYear,
      generated_at:          new Date().toISOString(),
      season_boundary:       boundaryReport,
      segmentation_strategy: 'CHRONOLOGICAL_THIRDS',
      naive_baselines:       { log_loss: NAIVE_LOG_LOSS, brier_score: NAIVE_BRIER },
      global: {
        ...globalResult,
        n_not_eligible:  predictions.filter((p) => p.eligibility_status === 'NOT_ELIGIBLE').length,
        n_limited:       predictions.filter((p) => p.eligibility_status === 'LIMITED').length,
        // n_full implícito: n_evaluated - n_limited
        better_on_inter: betterOnInter(globalResult.v2_inter_metrics, globalResult.v2_calib_inter_metrics, globalResult.v1_inter_metrics),
      },
      by_tramo: tramoResults,
      by_mode:  modeResults,
      raw_predictions: predictions,
    };

    printSummary(doc);

    const { jsonPath, mdPath } = saveFiles(doc);
    console.log(`\n  JSON: ${jsonPath}`);
    console.log(`  MD:   ${mdPath}`);
  }
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
