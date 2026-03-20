/**
 * analyze-blend-accuracy.ts — Computes blended accuracy for historical backtests.
 *
 * For each backtest snapshot:
 *   1. Look up historical pre-match odds from cached The Odds API data
 *   2. Apply production blend: p_blended = 0.35 × p_model + 0.65 × p_market
 *   3. Make decision from blended probs (same threshold as production)
 *   4. Compare to actual_result
 *
 * Output: comparative table showing Poisson-only vs Blended accuracy per league.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.server.json tools/analyze-blend-accuracy.ts
 *   npx tsx --tsconfig tsconfig.server.json tools/analyze-blend-accuracy.ts --comp PD
 *   npx tsx --tsconfig tsconfig.server.json tools/analyze-blend-accuracy.ts --verbose
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  HistoricalOddsStore,
  COMP_CODE_TO_SPORT_KEY,
} from '../server/prediction/historical-odds-store.js';

// ── Config ──────────────────────────────────────────────────────────────────

const BACKTEST_DIR = path.resolve(process.cwd(), 'cache/predictions');
const MARKET_WEIGHT = 0.65;  // Must match packages/prediction/src/engine/v3/constants.ts
// Decision threshold: predict HOME/AWAY only if margin >= TOO_CLOSE_THRESHOLD
const TOO_CLOSE_THRESHOLD = 0.05;

// ── Types ───────────────────────────────────────────────────────────────────

interface BacktestSnap {
  competition_code: string;
  kickoff_utc: string;
  actual_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null;
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  predicted_result: string | null;
  mode: string;
  home_team_id?: string;
  away_team_id?: string;
}

interface MatchStats {
  compCode: string;
  kickoff: string;
  actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  // Poisson model
  modelPred: string | null;
  modelCorrect: boolean | null;
  // Blended
  blendedPred: string | null;
  blendedCorrect: boolean | null;
  // Odds found?
  oddsFound: boolean;
  oddsBookmakers: number;
}

interface CompStats {
  compCode: string;
  total: number;
  evalModel: number;    // non-TOO_CLOSE predictions
  evalBlend: number;    // non-TOO_CLOSE blended predictions
  oddsFound: number;    // matches where odds were available
  modelCorrect: number;
  blendedCorrect: number;
}

// ── Blend logic ─────────────────────────────────────────────────────────────

function blendProbs(
  modelHome: number, modelDraw: number, modelAway: number,
  mktHome: number, mktDraw: number, mktAway: number,
): { home: number; draw: number; away: number } {
  const w = MARKET_WEIGHT;
  const m = 1 - w;
  return {
    home: m * modelHome + w * mktHome,
    draw: m * modelDraw + w * mktDraw,
    away: m * modelAway + w * mktAway,
  };
}

function makeDecision(home: number, draw: number, away: number): string {
  const max = Math.max(home, draw, away);
  let winner: 'HOME' | 'DRAW' | 'AWAY';
  if (max === home) winner = 'HOME';
  else if (max === away) winner = 'AWAY';
  else winner = 'DRAW';

  const second = [home, draw, away].filter((p) => p !== max)[0] ?? 0;
  if (max - second < TOO_CLOSE_THRESHOLD) return 'TOO_CLOSE';
  return winner;
}

function normalizeDecision(d: string | null): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (d === 'HOME') return 'HOME_WIN';
  if (d === 'AWAY') return 'AWAY_WIN';
  if (d === 'DRAW') return 'DRAW';
  return null;
}

// ── Load backtest snapshots ─────────────────────────────────────────────────

function loadAllSnapshots(compFilter: string | null): BacktestSnap[] {
  const result: BacktestSnap[] = [];
  if (!fs.existsSync(BACKTEST_DIR)) return result;

  const files = fs.readdirSync(BACKTEST_DIR).filter((f) => f.includes('backtest') && f.endsWith('.json'));

  for (const fname of files) {
    try {
      const raw = fs.readFileSync(path.join(BACKTEST_DIR, fname), 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      const snaps = (data['snapshots'] ?? data['records'] ?? []) as BacktestSnap[];

      for (const snap of snaps) {
        if (!snap.competition_code || !snap.kickoff_utc) continue;
        if (!snap.actual_result) continue;
        if (snap.mode === 'NOT_ELIGIBLE' || snap.mode === 'ERROR') continue;
        if (snap.p_home_win === null || snap.p_draw === null || snap.p_away_win === null) continue;
        if (compFilter && snap.competition_code !== compFilter) continue;
        // Only process if sport_key is known
        if (!COMP_CODE_TO_SPORT_KEY[snap.competition_code]) continue;

        result.push(snap);
      }
    } catch { /* skip bad files */ }
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const compFilter = args.find((a) => a.startsWith('--comp='))?.slice(7)
    ?? (args.indexOf('--comp') !== -1 ? args[args.indexOf('--comp') + 1] : null);

  console.log('=== Blend Accuracy Analysis ===');
  console.log(`MARKET_WEIGHT = ${MARKET_WEIGHT}`);
  if (compFilter) console.log(`Filter: comp "${compFilter}"`);

  const oddsStore = new HistoricalOddsStore();
  const coverage = oddsStore.coverageStats();
  if (coverage.length === 0) {
    console.error('\nNo cached odds found. Run tools/backfill-historical-odds.ts first.');
    process.exit(1);
  }
  console.log('\nOdds cache coverage:');
  for (const { sportKey, dates } of coverage) {
    console.log(`  ${sportKey}: ${dates} dates`);
  }

  const snapshots = loadAllSnapshots(compFilter);
  console.log(`\nLoaded ${snapshots.length} eligible backtest snapshots`);

  if (snapshots.length === 0) {
    console.log('No snapshots to analyze.');
    return;
  }

  // Analyze each snapshot
  const matchStats: MatchStats[] = [];
  let oddsNotFound = 0;

  for (const snap of snapshots) {
    const odds = oddsStore.lookup(snap.competition_code, snap.kickoff_utc);

    // Model prediction (original)
    const modelNorm = normalizeDecision(snap.predicted_result);
    const modelCorrect = modelNorm ? modelNorm === snap.actual_result : null;

    let blendedPred: string | null = null;
    let blendedCorrect: boolean | null = null;
    let oddsFound = false;
    let oddsBookmakers = 0;

    if (odds) {
      oddsFound = true;
      oddsBookmakers = odds.bookmakerCount;
      const blended = blendProbs(
        snap.p_home_win!, snap.p_draw!, snap.p_away_win!,
        odds.probHome, odds.probDraw, odds.probAway,
      );
      const rawDecision = makeDecision(blended.home, blended.draw, blended.away);
      blendedPred = normalizeDecision(rawDecision);
      blendedCorrect = blendedPred ? blendedPred === snap.actual_result! : null;
    } else {
      oddsNotFound++;
    }

    matchStats.push({
      compCode: snap.competition_code,
      kickoff: snap.kickoff_utc,
      actual: snap.actual_result!,
      modelPred: modelNorm,
      modelCorrect,
      blendedPred,
      blendedCorrect,
      oddsFound,
      oddsBookmakers,
    });
  }

  // Aggregate by comp
  const statsByComp = new Map<string, CompStats>();
  for (const m of matchStats) {
    if (!statsByComp.has(m.compCode)) {
      statsByComp.set(m.compCode, {
        compCode: m.compCode, total: 0,
        evalModel: 0, evalBlend: 0, oddsFound: 0,
        modelCorrect: 0, blendedCorrect: 0,
      });
    }
    const s = statsByComp.get(m.compCode)!;
    s.total++;
    if (m.oddsFound) s.oddsFound++;
    if (m.modelCorrect !== null) { s.evalModel++; if (m.modelCorrect) s.modelCorrect++; }
    if (m.blendedCorrect !== null) { s.evalBlend++; if (m.blendedCorrect) s.blendedCorrect++; }
  }

  // Print verbose sample
  if (verbose) {
    console.log('\nSample matches (first 20 with odds):');
    const sample = matchStats.filter((m) => m.oddsFound).slice(0, 20);
    for (const m of sample) {
      const modelMark = m.modelCorrect === true ? '✓' : m.modelCorrect === false ? '✗' : '~';
      const blendMark = m.blendedCorrect === true ? '✓' : m.blendedCorrect === false ? '✗' : '~';
      console.log(
        `  ${m.compCode} ${m.kickoff.slice(0, 10)} actual=${m.actual.padEnd(8)}` +
        ` model=${(m.modelPred ?? 'null').padEnd(8)}${modelMark}` +
        ` blend=${(m.blendedPred ?? 'null').padEnd(8)}${blendMark}` +
        ` bms=${m.oddsBookmakers}`
      );
    }
  }

  // Print comparative table
  console.log('\n' + '─'.repeat(88));
  console.log(
    'Comp'.padEnd(6) +
    'Total'.padStart(7) +
    'OddsFound'.padStart(11) +
    'Coverage'.padStart(10) +
    'ModelAcc'.padStart(10) +
    'BlendAcc'.padStart(10) +
    'Δacc'.padStart(7)
  );
  console.log('─'.repeat(88));

  const totals = { total: 0, oddsFound: 0, evalModel: 0, evalBlend: 0, modelCorrect: 0, blendedCorrect: 0 };

  for (const s of [...statsByComp.values()].sort((a, b) => a.compCode.localeCompare(b.compCode))) {
    const coverage = s.total > 0 ? (s.oddsFound / s.total * 100).toFixed(1) : '0.0';
    const modelAcc = s.evalModel > 0 ? (s.modelCorrect / s.evalModel * 100).toFixed(1) : 'N/A';
    const blendAcc = s.evalBlend > 0 ? (s.blendedCorrect / s.evalBlend * 100).toFixed(1) : 'N/A';
    const delta = s.evalModel > 0 && s.evalBlend > 0
      ? ((s.blendedCorrect / s.evalBlend - s.modelCorrect / s.evalModel) * 100).toFixed(1)
      : 'N/A';
    const deltaStr = delta !== 'N/A'
      ? (parseFloat(delta) >= 0 ? `+${delta}` : delta)
      : 'N/A';

    console.log(
      s.compCode.padEnd(6) +
      String(s.total).padStart(7) +
      String(s.oddsFound).padStart(11) +
      `${coverage}%`.padStart(10) +
      `${modelAcc}%`.padStart(10) +
      `${blendAcc}%`.padStart(10) +
      deltaStr.padStart(7)
    );

    totals.total += s.total;
    totals.oddsFound += s.oddsFound;
    totals.evalModel += s.evalModel;
    totals.evalBlend += s.evalBlend;
    totals.modelCorrect += s.modelCorrect;
    totals.blendedCorrect += s.blendedCorrect;
  }

  console.log('─'.repeat(88));
  const totalCoverage = totals.total > 0 ? (totals.oddsFound / totals.total * 100).toFixed(1) : '0.0';
  const totalModelAcc = totals.evalModel > 0 ? (totals.modelCorrect / totals.evalModel * 100).toFixed(1) : 'N/A';
  const totalBlendAcc = totals.evalBlend > 0 ? (totals.blendedCorrect / totals.evalBlend * 100).toFixed(1) : 'N/A';
  const totalDelta = totals.evalModel > 0 && totals.evalBlend > 0
    ? ((totals.blendedCorrect / totals.evalBlend - totals.modelCorrect / totals.evalModel) * 100).toFixed(1)
    : 'N/A';
  const totalDeltaStr = totalDelta !== 'N/A'
    ? (parseFloat(totalDelta) >= 0 ? `+${totalDelta}` : totalDelta)
    : 'N/A';

  console.log(
    'TOTAL '.padEnd(6) +
    String(totals.total).padStart(7) +
    String(totals.oddsFound).padStart(11) +
    `${totalCoverage}%`.padStart(10) +
    `${totalModelAcc}%`.padStart(10) +
    `${totalBlendAcc}%`.padStart(10) +
    totalDeltaStr.padStart(7)
  );
  console.log('─'.repeat(88));

  console.log(`\nNotes:`);
  console.log(`  MARKET_WEIGHT = ${MARKET_WEIGHT} (blend: ${(1-MARKET_WEIGHT)*100}% model + ${MARKET_WEIGHT*100}% market)`);
  console.log(`  ModelAcc = pure Poisson + calibration (no blend)`);
  console.log(`  BlendAcc = same model with market odds injected at production weight`);
  console.log(`  Δacc     = BlendAcc - ModelAcc (positive = blend improves accuracy)`);
  console.log(`  Coverage = % of snapshots where historical odds were found in cache`);
  if (oddsNotFound > 0) {
    console.log(`\n  ⚠️  ${oddsNotFound} snapshots had no odds in cache.`);
    console.log(`     Run tools/backfill-historical-odds.ts to fill gaps.`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
