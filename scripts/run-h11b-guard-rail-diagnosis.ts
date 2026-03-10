/**
 * H11-b — Structural Guard-Rail Diagnosis for CTI(α=0.4)
 *
 * Goal: Determine whether CTI(α=0.4) can be made robust across all 6 leagues
 * by applying it only in principled pre-match regimes, rather than changing
 * alpha globally or excluding leagues.
 *
 * Context:
 *   - H10b result: CTI(α=0.4) is PARTIALLY_ROBUST — passes PD/PL/BL1/DED,
 *     FAILS SA and FL1 (HOME/AWAY damage > -5pp threshold)
 *   - Failure hypothesis: CTI redistributes mass toward DRAW in asymmetric
 *     matches, damaging the dominant-outcome channel in high-λ_gap leagues
 *
 * Hard constraints:
 *   - Pre-match only, offline historical analysis only
 *   - No portal rollout, no production changes
 *   - No calibration/decision-policy/TOO_CLOSE changes
 *   - No per-league alpha tuning
 *   - No new raw-generator families
 *   - Diagnosis only — no freezing of candidates in this step
 *
 * Guard-rail masks tested:
 *   G1: LAMBDA_GAP_MASK — |λ_h − λ_a| ≤ threshold
 *   G2: BASELINE_CONFIDENCE_MASK — max(p_home, p_draw, p_away) ≤ threshold
 *   G3: COMBINED_MASK — G1 AND G2 (focused grid)
 *   G4: ELO_GAP_MASK — |elo_home_pre − elo_away_pre| ≤ threshold (optional)
 *
 * Stores are pre-populated from H10b — no API calls in this script.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.server.json scripts/run-h11b-guard-rail-diagnosis.ts
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Frozen constants (from H8/H8b/H9) ───────────────────────────────────────

const ALPHA_FROZEN       = 0.4;
const CTI_SIGMA_BALANCE  = 0.5;
const CTI_LAMBDA_CRIT    = 3.0;
const CTI_SIGMA_INTENSITY = 1.0;
const TOO_CLOSE_THRESHOLD = 0.02;
const TRAIN_FRACTION      = 0.60;
const EPSILON_LL          = 1e-15;
const MAX_GOALS           = 7;

// Acceptance thresholds (frozen from H8b/H9/H10b)
const MAX_HOME_DELTA_PP = -5.0;
const MAX_AWAY_DELTA_PP = -5.0;
const MAX_LL_DELTA      = 0.10;
const MIN_DRAW_GAIN_PP  = 2.0;

// Guard-rail CTI-no-op threshold: if coverage < this, reject as no-op
const MIN_ACTIVE_COVERAGE = 0.25;

// ── League config ────────────────────────────────────────────────────────────

interface LeagueConfig {
  code: string;
  name: string;
  storeFile: string;
}

const LEAGUES: LeagueConfig[] = [
  { code: 'PD',  name: 'LaLiga (Spain)',       storeFile: 'cache/predictions/historical-backtest.json'      },
  { code: 'PL',  name: 'Premier League',       storeFile: 'cache/predictions/historical-backtest-pl.json'   },
  { code: 'BL1', name: 'Bundesliga (Germany)', storeFile: 'cache/predictions/historical-backtest-bl1.json'  },
  { code: 'SA',  name: 'Serie A (Italy)',      storeFile: 'cache/predictions/historical-backtest-sa.json'   },
  { code: 'FL1', name: 'Ligue 1 (France)',     storeFile: 'cache/predictions/historical-backtest-fl1.json'  },
  { code: 'DED', name: 'Eredivisie (Holland)', storeFile: 'cache/predictions/historical-backtest-ded.json'  },
];

// ── Types ────────────────────────────────────────────────────────────────────

type Outcome = 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';

interface EvalRecord {
  actual: Outcome;
  kickoff_utc: string;
  raw_home: number;
  raw_draw: number;
  raw_away: number;
  lambda_home: number;
  lambda_away: number;
  elo_home_pre: number;
  elo_away_pre: number;
}

interface Probs1x2 { home: number; draw: number; away: number; }

interface VariantResult {
  label: string;
  n_eval: number;
  brier: number;
  log_loss: number;
  pred_dist: Record<Outcome, number>;
  n_too_close: number;
  home_hit_rate: number | null;
  away_hit_rate: number | null;
  draw_pred_count: number;
  draw_p_avg: number | null;   // avg p_draw on ACTUAL draw matches
  active_count: number;        // matches where mask was active (CTI applied)
  active_by_top1: Record<Outcome, number>;  // which predicted classes were active
  active_by_actual: Record<Outcome, number>; // which actual-result classes were active
}

interface MaskSpec {
  id: string;
  label: string;
  description: string;
  fn: (r: EvalRecord) => boolean;
}

// ── Poisson / CTI (frozen from H8) ──────────────────────────────────────────

const _logFact: number[] = [0];
for (let k = 1; k <= 20; k++) _logFact.push(_logFact[k - 1]! + Math.log(k));

function poissonLogPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 0 : -Infinity;
  if (k > 20) return -Infinity;
  return k * Math.log(lambda) - lambda - _logFact[k]!;
}

function buildMatrix(lH: number, lA: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i <= MAX_GOALS; i++) {
    const row: number[] = [];
    for (let j = 0; j <= MAX_GOALS; j++) {
      row.push(Math.exp(poissonLogPmf(i, lH) + poissonLogPmf(j, lA)));
    }
    m.push(row);
  }
  return m;
}

function matrix1x2(m: number[][]): Probs1x2 {
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const v = m[i]![j]!;
      if (i > j) home += v;
      else if (i === j) draw += v;
      else away += v;
    }
  }
  const s = home + draw + away;
  return s > 0 ? { home: home / s, draw: draw / s, away: away / s }
                : { home: 1/3, draw: 1/3, away: 1/3 };
}

function ctiGate(lH: number, lA: number): number {
  const diff = lH - lA;
  const gB = Math.exp(-diff * diff / (2 * CTI_SIGMA_BALANCE * CTI_SIGMA_BALANCE));
  const gI = 1 / (1 + Math.exp((lH + lA - CTI_LAMBDA_CRIT) / CTI_SIGMA_INTENSITY));
  return gB * gI;
}

function applyCTI(lH: number, lA: number, alpha: number): Probs1x2 {
  const gate = ctiGate(lH, lA);
  const eff = alpha * gate;
  const m = buildMatrix(lH, lA);
  if (eff <= 0) return matrix1x2(m);
  const mod = m.map((row) => [...row]);
  for (const k of [0, 1, 2]) {
    if (k + 1 <= MAX_GOALS) {
      const s1 = mod[k + 1]![k]!;
      const s2 = mod[k]![k + 1]!;
      const t1 = eff * s1;
      const t2 = eff * s2;
      mod[k + 1]![k]! = s1 - t1;
      mod[k]![k + 1]! = s2 - t2;
      mod[k]![k]! += t1 + t2;
    }
  }
  return matrix1x2(mod);
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function brierScore(p: Probs1x2, actual: Outcome): number {
  const dH = p.home - (actual === 'HOME_WIN' ? 1 : 0);
  const dD = p.draw - (actual === 'DRAW'     ? 1 : 0);
  const dA = p.away - (actual === 'AWAY_WIN' ? 1 : 0);
  return dH*dH + dD*dD + dA*dA;
}

function logLoss(p: Probs1x2, actual: Outcome): number {
  const pA = actual === 'HOME_WIN' ? p.home : actual === 'DRAW' ? p.draw : p.away;
  return -Math.log(Math.max(pA, EPSILON_LL));
}

function top1(p: Probs1x2): Outcome {
  if (p.home >= p.draw && p.home >= p.away) return 'HOME_WIN';
  if (p.draw >= p.home && p.draw >= p.away) return 'DRAW';
  return 'AWAY_WIN';
}

function avgArr(a: number[]): number | null {
  return a.length === 0 ? null : a.reduce((s, v) => s + v, 0) / a.length;
}

// ── Evaluate with mask ────────────────────────────────────────────────────────

function evaluate(
  label: string,
  evalSet: EvalRecord[],
  maskFn: (r: EvalRecord) => boolean,  // true → apply CTI; false → use baseline
): VariantResult {
  const predDist: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  const activeByTop1: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  const activeByActual: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  let brierSum = 0, llSum = 0, nTooClose = 0, activeCount = 0;
  const homeHits: boolean[] = [];
  const awayHits: boolean[] = [];
  const drawPOnActualDraw: number[] = [];

  for (const r of evalSet) {
    const maskActive = maskFn(r);
    if (maskActive) {
      activeCount++;
      activeByActual[r.actual]++;
    }

    // Probabilities: CTI if mask active, baseline otherwise
    const p = maskActive
      ? applyCTI(r.lambda_home, r.lambda_away, ALPHA_FROZEN)
      : { home: r.raw_home, draw: r.raw_draw, away: r.raw_away };

    brierSum += brierScore(p, r.actual);
    llSum    += logLoss(p, r.actual);

    // top-1 for coverage tracking
    const bTop1 = top1({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away });
    if (maskActive) activeByTop1[bTop1]++;

    // decision prediction
    const pairs: [Outcome, number][] = [
      ['HOME_WIN', p.home], ['DRAW', p.draw], ['AWAY_WIN', p.away],
    ];
    pairs.sort((a, b) => b[1] - a[1]);
    const margin = pairs[0]![1] - pairs[1]![1];
    const cls = margin < TOO_CLOSE_THRESHOLD ? null : pairs[0]![0];

    if (cls === null) nTooClose++;
    else predDist[cls]++;

    if (r.actual === 'HOME_WIN') homeHits.push(cls === 'HOME_WIN');
    else if (r.actual === 'AWAY_WIN') awayHits.push(cls === 'AWAY_WIN');
    else drawPOnActualDraw.push(p.draw);
  }

  const n = evalSet.length;
  return {
    label,
    n_eval: n,
    brier:    n === 0 ? 0 : brierSum / n,
    log_loss: n === 0 ? 0 : llSum / n,
    pred_dist: predDist,
    n_too_close: nTooClose,
    home_hit_rate: homeHits.length === 0 ? null : homeHits.filter(Boolean).length / homeHits.length,
    away_hit_rate: awayHits.length === 0 ? null : awayHits.filter(Boolean).length / awayHits.length,
    draw_pred_count: predDist.DRAW,
    draw_p_avg: avgArr(drawPOnActualDraw),
    active_count: activeCount,
    active_by_top1: activeByTop1,
    active_by_actual: activeByActual,
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

function pct(v: number | null, d = 1): string {
  return v === null ? '  n/a' : (v * 100).toFixed(d).padStart(5) + '%';
}
function pp(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(1) + 'pp';
}
function dNum(v: number, d = 4): string {
  return (v >= 0 ? '+' : '') + v.toFixed(d);
}
function pad(s: string | number, w: number, left = false): string {
  return left ? String(s).padEnd(w) : String(s).padStart(w);
}

// ── Store loading ─────────────────────────────────────────────────────────────

interface StoreSnap {
  competition_code: string;
  kickoff_utc: string;
  actual_result: string;
  raw_p_home_win?: number | null;
  raw_p_draw?: number | null;
  raw_p_away_win?: number | null;
  lambda_home?: number | null;
  lambda_away?: number | null;
  elo_home_pre?: number | null;
  elo_away_pre?: number | null;
  build_status: string;
}

function loadStore(storeFile: string, code: string): EvalRecord[] {
  const absPath = path.resolve(process.cwd(), storeFile);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Store file not found: ${absPath}`);
  }
  const raw = fs.readFileSync(absPath, 'utf-8');
  const doc = JSON.parse(raw) as { version: number; snapshots: StoreSnap[] };
  const snaps = doc.snapshots.filter((s) => s.competition_code === code);
  const records: EvalRecord[] = [];
  for (const s of snaps) {
    if (
      s.build_status === 'SUCCESS' &&
      s.raw_p_home_win != null && s.raw_p_draw != null && s.raw_p_away_win != null &&
      s.lambda_home != null && s.lambda_away != null && s.kickoff_utc
    ) {
      const actual: Outcome =
        s.actual_result === 'HOME_WIN' ? 'HOME_WIN' :
        s.actual_result === 'AWAY_WIN' ? 'AWAY_WIN' : 'DRAW';
      records.push({
        actual, kickoff_utc: s.kickoff_utc,
        raw_home: s.raw_p_home_win, raw_draw: s.raw_p_draw, raw_away: s.raw_p_away_win,
        lambda_home: s.lambda_home, lambda_away: s.lambda_away,
        elo_home_pre: s.elo_home_pre ?? 1500,
        elo_away_pre: s.elo_away_pre ?? 1500,
      });
    }
  }
  records.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
  return records;
}

// ── Build mask catalog ────────────────────────────────────────────────────────

function buildMasks(): MaskSpec[] {
  const masks: MaskSpec[] = [
    // BASELINE — CTI never active
    {
      id: 'BASELINE',
      label: 'BASELINE',
      description: 'Pure Poisson, no CTI',
      fn: () => false,
    },
    // CTI_ALWAYS — CTI always active (reference)
    {
      id: 'CTI_ALWAYS',
      label: 'CTI(α=0.4) always',
      description: 'CTI α=0.4, no guard-rail (H10b reference)',
      fn: () => true,
    },
  ];

  // G1: LAMBDA_GAP_MASK — CTI active only when |λ_h − λ_a| ≤ threshold
  for (const thr of [0.10, 0.15, 0.20, 0.25, 0.30]) {
    masks.push({
      id: `G1_LG${(thr * 100).toFixed(0)}`,
      label: `G1_LG${(thr * 100).toFixed(0)}`,
      description: `λ_gap ≤ ${thr.toFixed(2)}`,
      fn: (r) => Math.abs(r.lambda_home - r.lambda_away) <= thr,
    });
  }

  // G2: BASELINE_CONFIDENCE_MASK — CTI active only when max(p1x2) ≤ threshold
  for (const thr of [0.45, 0.50, 0.55, 0.60]) {
    masks.push({
      id: `G2_BC${(thr * 100).toFixed(0)}`,
      label: `G2_BC${(thr * 100).toFixed(0)}`,
      description: `max_p ≤ ${thr.toFixed(2)}`,
      fn: (r) => Math.max(r.raw_home, r.raw_draw, r.raw_away) <= thr,
    });
  }

  // G3: COMBINED — both G1 AND G2 (focused 3×2 grid)
  for (const lgThr of [0.20, 0.25, 0.30]) {
    for (const bcThr of [0.50, 0.55]) {
      masks.push({
        id: `G3_LG${(lgThr * 100).toFixed(0)}_BC${(bcThr * 100).toFixed(0)}`,
        label: `G3_LG${(lgThr * 100).toFixed(0)}+BC${(bcThr * 100).toFixed(0)}`,
        description: `λ_gap ≤ ${lgThr.toFixed(2)} AND max_p ≤ ${bcThr.toFixed(2)}`,
        fn: (r) =>
          Math.abs(r.lambda_home - r.lambda_away) <= lgThr &&
          Math.max(r.raw_home, r.raw_draw, r.raw_away) <= bcThr,
      });
    }
  }

  // G4: ELO_GAP_MASK — CTI active only when |elo_home − elo_away| ≤ threshold
  for (const thr of [50, 100, 150]) {
    masks.push({
      id: `G4_EG${thr}`,
      label: `G4_EG${thr}`,
      description: `|Elo_gap| ≤ ${thr}`,
      fn: (r) => Math.abs(r.elo_home_pre - r.elo_away_pre) <= thr,
    });
  }

  return masks;
}

// ── Per-league evaluation for all masks ──────────────────────────────────────

interface LeagueEval {
  code: string;
  name: string;
  n_eval: number;
  actual_dist: Record<Outcome, number>;
  results: Map<string, VariantResult>;
  eval_set: EvalRecord[];
}

function evalLeague(cfg: LeagueConfig, masks: MaskSpec[]): LeagueEval {
  const allRecords = loadStore(cfg.storeFile, cfg.code);
  const N = allRecords.length;
  if (N < 20) throw new Error(`${cfg.code}: only ${N} evaluable records`);

  const nTrain = Math.floor(N * TRAIN_FRACTION);
  const evalSet = allRecords.slice(nTrain);

  const actualDist: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  for (const r of evalSet) actualDist[r.actual]++;

  const results = new Map<string, VariantResult>();
  for (const mask of masks) {
    results.set(mask.id, evaluate(mask.label, evalSet, mask.fn));
  }

  return {
    code: cfg.code,
    name: cfg.name,
    n_eval: evalSet.length,
    actual_dist: actualDist,
    results,
    eval_set: evalSet,
  };
}

// ── Deltas helper ─────────────────────────────────────────────────────────────

function deltas(v: VariantResult, base: VariantResult) {
  return {
    dBrier:   v.brier    - base.brier,
    dLogLoss: v.log_loss - base.log_loss,
    dPredD:   v.draw_pred_count - base.draw_pred_count,
    dPDrawAvg: ((v.draw_p_avg ?? 0) - (base.draw_p_avg ?? 0)) * 100,
    dHome: ((v.home_hit_rate ?? 0) - (base.home_hit_rate ?? 0)) * 100,
    dAway: ((v.away_hit_rate ?? 0) - (base.away_hit_rate ?? 0)) * 100,
  };
}

function verdictFromDeltas(
  d: ReturnType<typeof deltas>,
  drawPredCount: number,
): 'PASS' | 'FAIL' {
  const drawOk = d.dPDrawAvg >= MIN_DRAW_GAIN_PP || drawPredCount > 0;
  if (d.dHome < MAX_HOME_DELTA_PP) return 'FAIL';
  if (d.dAway < MAX_AWAY_DELTA_PP) return 'FAIL';
  if (d.dLogLoss > MAX_LL_DELTA)    return 'FAIL';
  if (!drawOk)                      return 'FAIL';
  return 'PASS';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  H11-b — Structural Guard-Rail Diagnosis for CTI(α=0.4)                    ║');
  console.log('║  Leagues: PD · PL · BL1 · SA · FL1 · DED   (6 leagues, pre-populated)     ║');
  console.log('║  Masks: G1(λ_gap) · G2(conf) · G3(combined) · G4(Elo_gap)                 ║');
  console.log('║  Alpha frozen: 0.4 | Gate frozen: σ_b=0.5, λ_crit=3.0, σ_i=1.0           ║');
  console.log('║  Hard constraint: NO alpha retuning | NO per-league masks                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  const masks = buildMasks();
  const leagueEvals: LeagueEval[] = [];

  // ── Load and evaluate all leagues ──────────────────────────────────────────
  for (const cfg of LEAGUES) {
    process.stdout.write(`  Loading + evaluating ${cfg.code} (${cfg.name})... `);
    try {
      const le = evalLeague(cfg, masks);
      leagueEvals.push(le);
      const base = le.results.get('BASELINE')!;
      const ctiAlways = le.results.get('CTI_ALWAYS')!;
      const d = deltas(ctiAlways, base);
      const v10 = verdictFromDeltas(d, ctiAlways.draw_pred_count);
      console.log(`n=${le.n_eval}, H10b=${v10} (HOME:${pp(d.dHome)}, AWAY:${pp(d.dAway)})`);
    } catch (err) {
      console.error(`\n  ERROR: ${String(err)}`);
      process.exit(1);
    }
  }

  console.log(`\n  Total leagues loaded: ${leagueEvals.length}`);
  console.log(`  Total mask variants: ${masks.length} (incl. BASELINE + CTI_ALWAYS)`);

  // ── SECTION 1: Per-League Results per Mask ─────────────────────────────────
  console.log('\n\n' + '═'.repeat(90));
  console.log('SECTION 1 — PER-LEAGUE RESULTS BY MASK VARIANT');
  console.log('═'.repeat(90));
  console.log('(Only mask variants — BASELINE and CTI_ALWAYS shown as anchors)');

  for (const le of leagueEvals) {
    const base = le.results.get('BASELINE')!;
    const ctiAlways = le.results.get('CTI_ALWAYS')!;
    const dAlways = deltas(ctiAlways, base);
    const vAlways = verdictFromDeltas(dAlways, ctiAlways.draw_pred_count);

    console.log(`\n  ┌─ ${le.code} — ${le.name} — eval n=${le.n_eval}`);
    console.log(
      `  │  Actual dist: HOME=${le.actual_dist.HOME_WIN}` +
      ` DRAW=${le.actual_dist.DRAW}` +
      ` AWAY=${le.actual_dist.AWAY_WIN}`,
    );
    console.log(`  │  H10b CTI_ALWAYS verdict: ${vAlways}`);
    console.log(`  │`);
    console.log(
      `  │  ${'Variant'.padEnd(30)}  ${'Cov%'.padStart(5)}  ${'ΔBrier'.padStart(8)}` +
      `  ${'ΔLogLoss'.padStart(8)}  ${'ΔpredD'.padStart(6)}  ${'ΔHOME'.padStart(8)}` +
      `  ${'ΔAWAY'.padStart(8)}  ${'Verdict'.padStart(7)}`,
    );
    console.log(`  │  ${'─'.repeat(90)}`);

    for (const mask of masks) {
      const v = le.results.get(mask.id)!;
      const d = deltas(v, base);
      const verd = mask.id === 'BASELINE' ? '  ─base' :
                   verdictFromDeltas(d, v.draw_pred_count);
      const cov = mask.id === 'BASELINE' ? '  0.0%' :
                  mask.id === 'CTI_ALWAYS' ? '100.0%' :
                  pct(v.active_count / le.n_eval);
      const homeFlag = d.dHome < MAX_HOME_DELTA_PP ? '!' : ' ';
      const awayFlag = d.dAway < MAX_AWAY_DELTA_PP ? '!' : ' ';

      console.log(
        `  │  ${mask.label.padEnd(30)}  ${cov.padStart(5)}` +
        `  ${dNum(d.dBrier, 4).padStart(8)}  ${dNum(d.dLogLoss, 4).padStart(8)}` +
        `  ${(d.dPredD >= 0 ? '+' : '') + d.dPredD.toString().padStart(5)}` +
        `  ${pp(d.dHome).padStart(7)}${homeFlag}` +
        `  ${pp(d.dAway).padStart(7)}${awayFlag}` +
        `  ${String(verd).padStart(7)}`,
      );
    }
    console.log(`  └${'─'.repeat(92)}`);
  }

  // ── SECTION 2: Regime Coverage by Mask ────────────────────────────────────
  console.log('\n\n' + '═'.repeat(90));
  console.log('SECTION 2 — REGIME COVERAGE BY MASK');
  console.log('═'.repeat(90));
  console.log('Active% = share of eval matches where CTI is applied under this mask\n');

  // Header
  const header = ['Mask ID'.padEnd(30), ...leagueEvals.map((le) => le.code.padStart(7)), 'Global'.padStart(7)].join('  ');
  console.log('  ' + header);
  console.log('  ' + '─'.repeat(header.length));

  for (const mask of masks) {
    if (mask.id === 'BASELINE') continue;
    const parts = [mask.id.padEnd(30)];
    let totalActive = 0, totalN = 0;
    for (const le of leagueEvals) {
      const v = le.results.get(mask.id)!;
      const coveragePct = mask.id === 'CTI_ALWAYS' ? 100.0 : v.active_count / le.n_eval * 100;
      totalActive += mask.id === 'CTI_ALWAYS' ? le.n_eval : v.active_count;
      totalN += le.n_eval;
      parts.push((coveragePct.toFixed(1) + '%').padStart(7));
    }
    const globalCov = totalN === 0 ? 0 : (totalActive / totalN * 100);
    parts.push((globalCov.toFixed(1) + '%').padStart(7));
    console.log('  ' + parts.join('  '));
  }

  // Coverage breakdown by baseline top-1 class (for non-trivial masks)
  console.log('\n  Coverage by baseline predicted class (HOME_WIN / DRAW / AWAY_WIN):');
  console.log('  (Global aggregate across all leagues)\n');
  console.log('  ' + ['Mask ID'.padEnd(30), 'HOME_W%'.padStart(8), 'DRAW%'.padStart(7), 'AWAY_W%'.padStart(8)].join('  '));
  console.log('  ' + '─'.repeat(60));

  for (const mask of masks) {
    if (mask.id === 'BASELINE' || mask.id === 'CTI_ALWAYS') continue;
    let aH = 0, aD = 0, aA = 0;
    let totH = 0, totD = 0, totA = 0;
    for (const le of leagueEvals) {
      const v = le.results.get(mask.id)!;
      aH += v.active_by_top1.HOME_WIN;
      aD += v.active_by_top1.DRAW;
      aA += v.active_by_top1.AWAY_WIN;
      // Count total per top-1 class using baseline
      const base = le.results.get('BASELINE')!;
      totH += base.pred_dist.HOME_WIN + (le.actual_dist.HOME_WIN - (base.pred_dist.HOME_WIN)); // approx actual
      // Use actual dist as denominator for top-1 baseline class
    }
    // Use actual n from baseline predicted distributions across all leagues
    for (const le of leagueEvals) {
      const bv = le.results.get('BASELINE')!;
      // Re-count top-1 from raw probs in eval set
      for (const r of le.eval_set) {
        const t = top1({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away });
        if (t === 'HOME_WIN') totH++;
        else if (t === 'DRAW') totD++;
        else totA++;
      }
    }
    // Avoid double-count: only count once
    break; // We'll compute this differently below
  }

  // Recompute top-1 totals once
  const globalTop1: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  for (const le of leagueEvals) {
    for (const r of le.eval_set) {
      const t = top1({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away });
      globalTop1[t]++;
    }
  }

  for (const mask of masks) {
    if (mask.id === 'BASELINE' || mask.id === 'CTI_ALWAYS') continue;
    let aH = 0, aD = 0, aA = 0;
    for (const le of leagueEvals) {
      const v = le.results.get(mask.id)!;
      aH += v.active_by_top1.HOME_WIN;
      aD += v.active_by_top1.DRAW;
      aA += v.active_by_top1.AWAY_WIN;
    }
    const covH = globalTop1.HOME_WIN > 0 ? (aH / globalTop1.HOME_WIN * 100).toFixed(1) + '%' : 'n/a';
    const covD = globalTop1.DRAW > 0 ? (aD / globalTop1.DRAW * 100).toFixed(1) + '%' : 'n/a';
    const covA = globalTop1.AWAY_WIN > 0 ? (aA / globalTop1.AWAY_WIN * 100).toFixed(1) + '%' : 'n/a';
    console.log('  ' + [mask.id.padEnd(30), covH.padStart(8), covD.padStart(7), covA.padStart(8)].join('  '));
  }

  // ── SECTION 3: Draw Recovery ───────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(90));
  console.log('SECTION 3 — DRAW RECOVERY (avg p_draw delta on actual DRAW matches)');
  console.log('═'.repeat(90));
  console.log('  Δp_draw_avg = avg p_draw under variant − avg p_draw under BASELINE (on actual DRAWs)\n');

  const dr_header = ['Mask ID'.padEnd(30), ...leagueEvals.map((le) => le.code.padStart(9)), 'Global'.padStart(9)].join('  ');
  console.log('  ' + dr_header);
  console.log('  ' + '─'.repeat(dr_header.length));

  for (const mask of masks) {
    if (mask.id === 'BASELINE') continue;
    const parts = [mask.id.padEnd(30)];
    let globalDelta = 0, globalLeagues = 0;
    for (const le of leagueEvals) {
      const v = le.results.get(mask.id)!;
      const base = le.results.get('BASELINE')!;
      const delta = ((v.draw_p_avg ?? 0) - (base.draw_p_avg ?? 0)) * 100;
      globalDelta += delta;
      globalLeagues++;
      parts.push((pp(delta)).padStart(9));
    }
    parts.push((pp(globalDelta / Math.max(1, globalLeagues))).padStart(9));
    console.log('  ' + parts.join('  '));
  }

  // Also: predicted DRAW count per league
  console.log('\n  Predicted DRAW count (absolute):');
  const dc_header = ['Mask ID'.padEnd(30), ...leagueEvals.map((le) => le.code.padStart(6)), 'Total'.padStart(6)].join('  ');
  console.log('  ' + dc_header);
  console.log('  ' + '─'.repeat(dc_header.length));
  for (const mask of masks) {
    if (mask.id === 'BASELINE') continue;
    const parts = [mask.id.padEnd(30)];
    let total = 0;
    for (const le of leagueEvals) {
      const v = le.results.get(mask.id)!;
      parts.push(String(v.draw_pred_count).padStart(6));
      total += v.draw_pred_count;
    }
    parts.push(String(total).padStart(6));
    console.log('  ' + parts.join('  '));
  }

  // ── SECTION 4: SA and FL1 Failure Suppression ─────────────────────────────
  console.log('\n\n' + '═'.repeat(90));
  console.log('SECTION 4 — SA / FL1 FAILURE SUPPRESSION ANALYSIS');
  console.log('═'.repeat(90));
  console.log('  Focus: does each mask remove the HOME/AWAY damage in SA and FL1?\n');

  for (const targetCode of ['SA', 'FL1']) {
    const le = leagueEvals.find((x) => x.code === targetCode);
    if (!le) { console.log(`  ${targetCode}: not found\n`); continue; }
    const base = le.results.get('BASELINE')!;

    console.log(`  ${le.code} — ${le.name} (eval n=${le.n_eval})`);
    console.log(
      `  ${'Mask ID'.padEnd(30)}  ${'Cov%'.padStart(5)}  ${'ΔBrier'.padStart(8)}` +
      `  ${'ΔHOME'.padStart(8)}  ${'ΔAWAY'.padStart(8)}  ${'HOME_ok'.padStart(7)}  ${'AWAY_ok'.padStart(7)}  ${'Brier_ok'.padStart(8)}`,
    );
    console.log('  ' + '─'.repeat(90));

    for (const mask of masks) {
      if (mask.id === 'BASELINE') continue;
      const v = le.results.get(mask.id)!;
      const d = deltas(v, base);
      const cov = mask.id === 'CTI_ALWAYS' ? 100.0 : v.active_count / le.n_eval * 100;
      const homeOk = d.dHome >= MAX_HOME_DELTA_PP;
      const awayOk = d.dAway >= MAX_AWAY_DELTA_PP;
      const brierOk = d.dBrier <= 0;
      console.log(
        `  ${mask.id.padEnd(30)}  ${(cov.toFixed(1) + '%').padStart(5)}` +
        `  ${dNum(d.dBrier, 4).padStart(8)}` +
        `  ${pp(d.dHome).padStart(8)}  ${pp(d.dAway).padStart(8)}` +
        `  ${(homeOk ? 'PASS' : 'FAIL').padStart(7)}` +
        `  ${(awayOk ? 'PASS' : 'FAIL').padStart(7)}` +
        `  ${(brierOk ? 'PASS' : 'FAIL').padStart(8)}`,
      );
    }
    console.log();
  }

  // ── SECTION 5: Comparative Table ──────────────────────────────────────────
  console.log('\n' + '═'.repeat(90));
  console.log('SECTION 5 — CROSS-MASK COMPARISON TABLE');
  console.log('═'.repeat(90));
  console.log('  One row per mask. Acceptance = PASS if SA+FL1 improve AND PD/PL/BL1/DED retain gains.\n');

  interface MaskSummary {
    id: string;
    label: string;
    description: string;
    globalCovPct: number;
    nPassLeagues: number;
    nFailLeagues: number;
    failLeagues: string[];
    avgDeltaBrier: number;
    avgDeltaLogLoss: number;
    totalPredDDelta: number;
    maxHomeDamage: number;
    maxAwayDamage: number;
    saHomeDelta: number;
    saAwayDelta: number;
    fl1HomeDelta: number;
    fl1AwayDelta: number;
    saVerdict: 'PASS' | 'FAIL';
    fl1Verdict: 'PASS' | 'FAIL';
    isPromising: boolean;
    promiseReason: string;
  }

  const summaries: MaskSummary[] = [];

  for (const mask of masks) {
    if (mask.id === 'BASELINE') continue;

    let totalActive = 0, totalN = 0;
    let brierDeltaSum = 0, llDeltaSum = 0, predDDeltaSum = 0;
    let nPassLeagues = 0, nFailLeagues = 0;
    const failLeagues: string[] = [];
    let maxHomeDamage = 0, maxAwayDamage = 0;
    let saHomeDelta = 0, saAwayDelta = 0;
    let fl1HomeDelta = 0, fl1AwayDelta = 0;
    let saVerdict: 'PASS' | 'FAIL' = 'FAIL';
    let fl1Verdict: 'PASS' | 'FAIL' = 'FAIL';

    for (const le of leagueEvals) {
      const v = le.results.get(mask.id)!;
      const base = le.results.get('BASELINE')!;
      const d = deltas(v, base);
      const verd = verdictFromDeltas(d, v.draw_pred_count);

      totalActive += mask.id === 'CTI_ALWAYS' ? le.n_eval : v.active_count;
      totalN += le.n_eval;
      brierDeltaSum += d.dBrier;
      llDeltaSum += d.dLogLoss;
      predDDeltaSum += d.dPredD;

      if (verd === 'PASS') nPassLeagues++;
      else { nFailLeagues++; failLeagues.push(le.code); }

      if (d.dHome < maxHomeDamage) maxHomeDamage = d.dHome;
      if (d.dAway < maxAwayDamage) maxAwayDamage = d.dAway;

      if (le.code === 'SA') {
        saHomeDelta = d.dHome; saAwayDelta = d.dAway; saVerdict = verd;
      }
      if (le.code === 'FL1') {
        fl1HomeDelta = d.dHome; fl1AwayDelta = d.dAway; fl1Verdict = verd;
      }
    }

    const globalCovPct = totalN === 0 ? 0 : totalActive / totalN * 100;
    const avgDeltaBrier = brierDeltaSum / leagueEvals.length;
    const avgDeltaLogLoss = llDeltaSum / leagueEvals.length;

    // Compute CTI_ALWAYS max HOME damage for comparison
    let ctiAlwaysMaxHomeDamage = 0;
    for (const le of leagueEvals) {
      const v = le.results.get('CTI_ALWAYS')!;
      const base = le.results.get('BASELINE')!;
      const d = deltas(v, base);
      if (d.dHome < ctiAlwaysMaxHomeDamage) ctiAlwaysMaxHomeDamage = d.dHome;
    }

    // Promising criteria:
    // 1. SA and FL1 HOME/AWAY damage both ≥ -5pp (i.e., fixed)
    // 2. PD/PL/BL1/DED not all losing gains (at least 3/4 still PASS or retain >50% Brier gain)
    // 3. Global coverage ≥ 25%
    // 4. Total predDDelta is not deeply negative (DRAW recovery preserved globally)
    const saFixed = saVerdict === 'PASS';
    const fl1Fixed = fl1Verdict === 'PASS';
    const notNoOp = globalCovPct >= MIN_ACTIVE_COVERAGE * 100;
    const passLeaguesOtherThanFailing = leagueEvals
      .filter((le) => le.code !== 'SA' && le.code !== 'FL1')
      .map((le) => {
        const v = le.results.get(mask.id)!;
        const base = le.results.get('BASELINE')!;
        return verdictFromDeltas(deltas(v, base), v.draw_pred_count);
      })
      .filter((v) => v === 'PASS').length;
    const retainsGains = passLeaguesOtherThanFailing >= 3; // at least 3 of 4 other leagues still PASS

    const isPromising = saFixed && fl1Fixed && notNoOp && retainsGains;
    const reasons: string[] = [];
    if (!saFixed) reasons.push('SA still failing');
    if (!fl1Fixed) reasons.push('FL1 still failing');
    if (!notNoOp) reasons.push(`no-op (cov=${globalCovPct.toFixed(1)}%)`);
    if (!retainsGains) reasons.push(`only ${passLeaguesOtherThanFailing}/4 non-failing leagues pass`);

    summaries.push({
      id: mask.id, label: mask.label, description: mask.description,
      globalCovPct, nPassLeagues, nFailLeagues, failLeagues,
      avgDeltaBrier, avgDeltaLogLoss, totalPredDDelta: predDDeltaSum,
      maxHomeDamage, maxAwayDamage,
      saHomeDelta, saAwayDelta, fl1HomeDelta, fl1AwayDelta,
      saVerdict, fl1Verdict, isPromising,
      promiseReason: reasons.length === 0 ? 'PROMISING' : reasons.join(', '),
    });
  }

  // Print summary table
  console.log(
    '  ' + [
      'Mask ID'.padEnd(30),
      'Cov%'.padStart(6),
      'Pass'.padStart(5),
      'Fail'.padStart(5),
      'ΔBrier'.padStart(8),
      'ΔLL'.padStart(8),
      'ΔpredD'.padStart(7),
      'maxHOME'.padStart(8),
      'maxAWAY'.padStart(8),
      'SA_H'.padStart(7),
      'FL1_H'.padStart(7),
      'Status'.padStart(12),
    ].join('  '),
  );
  console.log('  ' + '─'.repeat(130));

  for (const s of summaries) {
    const status = s.isPromising ? '*** PROMISING' : s.promiseReason.slice(0, 12);
    console.log(
      '  ' + [
        s.id.padEnd(30),
        (s.globalCovPct.toFixed(1) + '%').padStart(6),
        String(s.nPassLeagues).padStart(5),
        String(s.nFailLeagues).padStart(5),
        dNum(s.avgDeltaBrier, 4).padStart(8),
        dNum(s.avgDeltaLogLoss, 4).padStart(8),
        ((s.totalPredDDelta >= 0 ? '+' : '') + s.totalPredDDelta).padStart(7),
        pp(s.maxHomeDamage).padStart(8),
        pp(s.maxAwayDamage).padStart(8),
        pp(s.saHomeDelta).padStart(7),
        pp(s.fl1HomeDelta).padStart(7),
        status.padStart(12),
      ].join('  '),
    );
  }

  // ── Final Classification ───────────────────────────────────────────────────
  const promisingMasks = summaries.filter((s) => s.isPromising && s.id !== 'CTI_ALWAYS');
  let classification: string;
  if (promisingMasks.length === 0) {
    classification = 'NO_GUARD_RAIL_PROMISING';
  } else if (promisingMasks.length === 1) {
    classification = 'ONE_GUARD_RAIL_PROMISING';
  } else {
    classification = 'MULTIPLE_GUARD_RAILS_PROMISING';
  }

  console.log('\n\n' + '═'.repeat(90));
  console.log('FINAL CLASSIFICATION');
  console.log('═'.repeat(90));
  console.log(`\n  ${classification}`);
  if (promisingMasks.length > 0) {
    console.log('\n  Promising guard-rail(s):');
    for (const s of promisingMasks) {
      console.log(`    - ${s.id} (${s.description})`);
      console.log(
        `      Coverage: ${s.globalCovPct.toFixed(1)}%` +
        `  Pass: ${s.nPassLeagues}/6` +
        `  SA: HOME${pp(s.saHomeDelta)} AWAY${pp(s.saAwayDelta)} [${s.saVerdict}]` +
        `  FL1: HOME${pp(s.fl1HomeDelta)} AWAY${pp(s.fl1AwayDelta)} [${s.fl1Verdict}]`,
      );
      console.log(
        `      ΔBrier_avg: ${dNum(s.avgDeltaBrier, 4)}` +
        `  ΔLL_avg: ${dNum(s.avgDeltaLogLoss, 4)}` +
        `  Total ΔpredD: ${s.totalPredDDelta > 0 ? '+' : ''}${s.totalPredDDelta}`,
      );
    }
  }

  // ── Final Recommendation ───────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(90));
  console.log('FINAL RECOMMENDATION');
  console.log('═'.repeat(90));

  // Compute regime analysis data for recommendation
  const saLe = leagueEvals.find((x) => x.code === 'SA');
  const fl1Le = leagueEvals.find((x) => x.code === 'FL1');
  const saLambdaGaps = saLe?.eval_set.map((r) => Math.abs(r.lambda_home - r.lambda_away)) ?? [];
  const fl1LambdaGaps = fl1Le?.eval_set.map((r) => Math.abs(r.lambda_home - r.lambda_away)) ?? [];
  const pdLe = leagueEvals.find((x) => x.code === 'PD');
  const pdLambdaGaps = pdLe?.eval_set.map((r) => Math.abs(r.lambda_home - r.lambda_away)) ?? [];

  const avgGap = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
  const saAvgGap = avgGap(saLambdaGaps);
  const fl1AvgGap = avgGap(fl1LambdaGaps);
  const pdAvgGap = avgGap(pdLambdaGaps);

  const saConf = saLe?.eval_set.map((r) => Math.max(r.raw_home, r.raw_draw, r.raw_away)) ?? [];
  const fl1Conf = fl1Le?.eval_set.map((r) => Math.max(r.raw_home, r.raw_draw, r.raw_away)) ?? [];
  const saAvgConf = avgGap(saConf);
  const fl1AvgConf = avgGap(fl1Conf);
  const pdConf = pdLe?.eval_set.map((r) => Math.max(r.raw_home, r.raw_draw, r.raw_away)) ?? [];
  const pdAvgConf = avgGap(pdConf);

  console.log(`
  REGIME ANALYSIS (regime asymmetry evidence):
  ─────────────────────────────────────────────
  League  avg|λ_gap|  avg_max_conf
  PD      ${pdAvgGap.toFixed(3).padStart(9)}  ${(pdAvgConf * 100).toFixed(1)}%
  SA      ${saAvgGap.toFixed(3).padStart(9)}  ${(saAvgConf * 100).toFixed(1)}%
  FL1     ${fl1AvgGap.toFixed(3).padStart(9)}  ${(fl1AvgConf * 100).toFixed(1)}%

  1. Is the failure mode truly regime-based?
  ─────────────────────────────────────────
  Hypothesis: CTI fails in SA/FL1 because those leagues have higher average
  λ_gap (more asymmetric matches), causing the CTI mass redistribution to
  damage the dominant-outcome channel above the -5pp threshold.
  Evidence:
    - SA avg|λ_gap|=${saAvgGap.toFixed(3)} vs PD avg|λ_gap|=${pdAvgGap.toFixed(3)}
    - SA avg_max_conf=${(saAvgConf*100).toFixed(1)}% vs PD avg_max_conf=${(pdAvgConf*100).toFixed(1)}%
    - FL1 avg|λ_gap|=${fl1AvgGap.toFixed(3)} vs PD avg|λ_gap|=${pdAvgGap.toFixed(3)}
  If these values are materially higher for SA/FL1, the regime hypothesis is
  supported and guard-rail masks are a principled structural fix.

  2. Which guard-rail best preserves gains while removing failure mode?
  ─────────────────────────────────────────────────────────────────────`);

  if (promisingMasks.length === 0) {
    console.log(`
  RESULT: No guard-rail variant passes all 4 criteria simultaneously.
  The failure mode may be real but the tested regime boundaries are either:
    (a) Too restrictive — CTI coverage drops so low that gains vanish globally
    (b) Too permissive — SA/FL1 damage persists because high-λ_gap matches
        remain in scope even after masking
  Recommend investigating whether the gate function itself needs modification
  (σ_b tightening) rather than a hard binary mask.`);
  } else {
    console.log(`
  RESULT: Guard-rail(s) found that pass all 4 criteria.
  Best candidate(s):`);
    for (const s of promisingMasks) {
      console.log(`    ${s.id}: ${s.description}`);
      console.log(`      → SA fixed: ${s.saVerdict}, FL1 fixed: ${s.fl1Verdict}`);
      console.log(`      → ${s.nPassLeagues}/6 leagues pass`);
      console.log(`      → Coverage ${s.globalCovPct.toFixed(1)}% (not a no-op)`);
    }
  }

  console.log(`
  3. Is CTI still blocked from forward validation?
  ─────────────────────────────────────────────────
  CTI(α=0.4) ALWAYS-ON remains blocked (CTI_ALPHA_0_4_PARTIALLY_ROBUST).
  A guarded CTI candidate requires one additional offline confirmation pass
  before forward validation can proceed.

  4. Recommended next steps:
  ──────────────────────────`);

  if (promisingMasks.length === 0) {
    console.log(`
    RECOMMENDED: H12 — Structural revision
      CTI gate function may need tightening (σ_b reduction from 0.5→0.3)
      rather than binary mask. Binary masks cannot cleanly separate regimes
      without either becoming no-ops or leaving damage in-scope.
      Alternative: accept PARTIALLY_ROBUST status and restrict production
      deployment to PD/PL/BL1/DED (where CTI passes), treating SA/FL1
      as out-of-scope for CTI until further analysis.`);
  } else {
    console.log(`
    RECOMMENDED: 3-step path to forward validation
      (a) Freeze CTI + ${promisingMasks[0]!.id} guard-rail as new candidate
          (replaces CTI_ALWAYS as the reference candidate)
      (b) Run one final offline confirmation pass (H12) with the frozen
          candidate on fresh holdout data (if available) or cross-validate
          against the full-season out-of-sample set
      (c) After H12 confirms, proceed to controlled forward validation
          (shadow deployment on next live matchday, no portal UI impact)

    IMPORTANT: Guard-rail adds one binary condition per prediction call —
    cost is O(1) and fully deterministic. No additional spec changes needed
    beyond the match-input-adapter and prediction-service integration.`);
  }

  console.log('\n' + '═'.repeat(90));
  console.log(`  H11-b complete. Classification: ${classification}`);
  console.log('═'.repeat(90) + '\n');
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
