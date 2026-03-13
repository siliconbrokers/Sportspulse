/**
 * train-global-calibrator.ts — Trains the global post-hoc isotonic calibrator.
 *
 * Reads all v2-segmented-*.json backtest files from cache/, extracts ELIGIBLE
 * predictions (eligibility_status !== 'NOT_ELIGIBLE' && prob_home_win > 0),
 * fits OneVsRestCalibrators using PAVA, and saves the serialized artifact to:
 *   cache/calibration/global-isotonic-v1.json
 *
 * This artifact is loaded at server startup by global-calibrator-store.ts and
 * injected into PredictionService via CalibrationRegistry.
 *
 * Anti-leakage note:
 *   This is a post-hoc global calibrator trained on historical data, not used
 *   in walk-forward evaluation. The temporal guard uses Date.now() as cutoff —
 *   all historical match timestamps are guaranteed to be in the past.
 *
 * Usage:
 *   pnpm train:calibrator
 */

import 'dotenv/config';
import * as fs   from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fitOneVsRestCalibrators,
  serializeOneVsRestCalibrators,
  IsotonicCalibrator,
  type OneVsRestTrainingSample,
} from '@sportpulse/prediction';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'cache');
const OUT_DIR   = path.join(CACHE_DIR, 'calibration');
const OUT_FILE  = path.join(OUT_DIR, 'global-isotonic-v1.json');

// ── WFPrediction subset (only what we need) ────────────────────────────────

interface WFPredictionSlim {
  matchId:           string;
  utcDate:           string;
  prob_home_win:     number;
  prob_draw:         number;
  prob_away_win:     number;
  actual_outcome:    'H' | 'D' | 'A';
  eligibility_status: string;
}

interface BacktestDoc {
  competition:     string;
  season_year:     number;
  raw_predictions: WFPredictionSlim[];
}

// ── Main ───────────────────────────────────────────────────────────────────

function run(): void {
  // Collect all backtest JSON files
  const files = fs.readdirSync(CACHE_DIR)
    .filter(f => f.startsWith('v2-segmented-') && f.endsWith('.json'))
    .map(f => path.join(CACHE_DIR, f));

  if (files.length === 0) {
    console.error('No v2-segmented-*.json files found in cache/. Run validate:v2:segmented first.');
    process.exit(1);
  }

  console.log(`Found ${files.length} backtest files.`);

  const samples: OneVsRestTrainingSample[] = [];
  const seenMatchIds = new Set<string>();
  let totalPredictions = 0;
  let skippedNotEligible = 0;
  let skippedNullProb    = 0;
  let skippedDuplicate   = 0;

  for (const file of files) {
    const doc: BacktestDoc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const label = `${doc.competition}-${doc.season_year}`;

    let fileEligible = 0;

    for (const p of doc.raw_predictions) {
      totalPredictions++;

      if (p.eligibility_status === 'NOT_ELIGIBLE') {
        skippedNotEligible++;
        continue;
      }

      if (p.prob_home_win <= 0 || p.prob_draw <= 0 || p.prob_away_win <= 0) {
        skippedNullProb++;
        continue;
      }

      // Deduplicate across files (same match can appear in multiple datasets
      // if a league was backtested multiple times)
      if (seenMatchIds.has(p.matchId)) {
        skippedDuplicate++;
        continue;
      }
      seenMatchIds.add(p.matchId);

      const actual_outcome: 'HOME' | 'DRAW' | 'AWAY' =
        p.actual_outcome === 'H' ? 'HOME' :
        p.actual_outcome === 'A' ? 'AWAY' : 'DRAW';

      samples.push({
        raw_home:           p.prob_home_win,
        raw_draw:           p.prob_draw,
        raw_away:           p.prob_away_win,
        actual_outcome,
        match_timestamp_ms: new Date(p.utcDate).getTime(),
        match_id:           p.matchId,
      });

      fileEligible++;
    }

    console.log(`  ${label}: ${fileEligible} eligible samples collected`);
  }

  console.log(`\nTotal predictions scanned:     ${totalPredictions}`);
  console.log(`  Skipped (NOT_ELIGIBLE):      ${skippedNotEligible}`);
  console.log(`  Skipped (null/zero prob):    ${skippedNullProb}`);
  console.log(`  Skipped (duplicate matchId): ${skippedDuplicate}`);
  console.log(`  Training samples:            ${samples.length}`);

  if (samples.length < 100) {
    console.error(`\nInsufficient samples (${samples.length} < 100). Aborting.`);
    process.exit(1);
  }

  // Fit calibrators — use current timestamp as cutoff (all historical data)
  const predictionCutoffMs = Date.now();
  console.log(`\nFitting OneVsRestCalibrators on ${samples.length} samples...`);

  const calibrators = fitOneVsRestCalibrators(samples, predictionCutoffMs);
  const serialized  = serializeOneVsRestCalibrators(calibrators);

  // Build artifact with metadata
  const artifact = {
    version:              'global-isotonic-v1',
    trained_at:           new Date().toISOString(),
    n_samples:            samples.length,
    n_files:              files.length,
    prediction_cutoff_ms: predictionCutoffMs,
    calibrators:          serialized,
  };

  // Write artifact
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(artifact, null, 2), 'utf8');

  console.log(`\nArtifact written to: ${OUT_FILE}`);
  console.log(`  home breakpoints: ${serialized.home.x_breakpoints.length}`);
  console.log(`  draw breakpoints: ${serialized.draw.x_breakpoints.length}`);
  console.log(`  away breakpoints: ${serialized.away.x_breakpoints.length}`);

  // Sanity check: calibrate a typical home-favorite prediction
  const calHome = IsotonicCalibrator.fromSerialized(serialized.home);
  const calDraw = IsotonicCalibrator.fromSerialized(serialized.draw);
  const calAway = IsotonicCalibrator.fromSerialized(serialized.away);

  const rawH = 0.55, rawD = 0.25, rawA = 0.20;
  const cH = calHome.predict(rawH);
  const cD = calDraw.predict(rawD);
  const cA = calAway.predict(rawA);
  const tot = cH + cD + cA;

  console.log(`\nSanity check (${rawH.toFixed(2)} / ${rawD.toFixed(2)} / ${rawA.toFixed(2)} → renorm):`);
  console.log(`  home: ${rawH.toFixed(3)} → ${(cH/tot).toFixed(3)}`);
  console.log(`  draw: ${rawD.toFixed(3)} → ${(cD/tot).toFixed(3)}`);
  console.log(`  away: ${rawA.toFixed(3)} → ${(cA/tot).toFixed(3)}`);
  console.log(`  sum before renorm: ${tot.toFixed(4)}`);

  console.log('\nDone.');
}

run();
