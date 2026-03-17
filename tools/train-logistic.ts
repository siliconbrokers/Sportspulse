/**
 * train-logistic.ts — §SP-V4-20: Entrenamiento del modelo logístico multinomial.
 *
 * Lee el historial de walk-forward del cache (misma metodología que backtest-v3.ts),
 * extrae features por partido usando extractLogisticFeatures, y entrena un modelo
 * de regresión logística multinomial con L2 via gradient descent.
 *
 * Usa input.collectIntermediates=true para obtener las variables intermedias
 * del pipeline V3 (lambdas, rest_days, H2H mults, absence scores, xg_coverage).
 *
 * Salida: cache/logistic-coefficients.json
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/train-logistic.ts
 *   npx tsx --tsconfig tsconfig.server.json tools/train-logistic.ts --max-iter 2000 --lr 0.005
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput } from '../packages/prediction/src/engine/v3/types.js';
import {
  extractLogisticFeatures,
  LOGISTIC_FEATURE_KEYS,
  type LogisticFeatureVector,
  type LogisticCoefficients,
} from '../packages/prediction/src/engine/v3/logistic-model.js';
import { buildOddsIndex, lookupOdds, oddsIndexStats, type OddsIndex } from './odds-lookup.js';

// ── Config ──────────────────────────────────────────────────────────────────

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');
const OUTPUT_PATH = path.join(process.cwd(), 'cache', 'logistic-coefficients.json');

// Training hyperparameters (may be overridden by CLI args)
let MAX_ITER  = 1000;
let LR        = 0.01;
const REG_LAMBDA = 0.01; // L2 regularization strength

// ── CLI argument parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max-iter' && args[i + 1]) MAX_ITER = parseInt(args[++i], 10);
  if (args[i] === '--lr'       && args[i + 1]) LR       = parseFloat(args[++i]);
}

// ── League config (same as backtest-v3.ts) ───────────────────────────────────

interface LeagueConfig {
  name:                string;
  dir:                 string;
  expectedSeasonGames: number;
  prevSeasonFile:      string;
  leagueCode:          string;
}

const LEAGUES: LeagueConfig[] = [
  { name: 'LaLiga (PD)',         leagueCode: 'PD',  dir: path.join(CACHE_BASE, 'PD',  '2025-26'), expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PD',  '2024-25', 'prev-season.json') },
  { name: 'Premier League (PL)', leagueCode: 'PL',  dir: path.join(CACHE_BASE, 'PL',  '2025-26'), expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PL',  '2024-25', 'prev-season.json') },
  { name: 'Bundesliga (BL1)',    leagueCode: 'BL1', dir: path.join(CACHE_BASE, 'BL1', '2025-26'), expectedSeasonGames: 34, prevSeasonFile: path.join(CACHE_BASE, 'BL1', '2024-25', 'prev-season.json') },
];

// ── Cache loading helpers (same as backtest-v3.ts) ───────────────────────────

interface CachedMatch {
  matchId:      string;
  matchday:     number;
  startTimeUtc: string;
  status:       string;
  homeTeamId:   string;
  awayTeamId:   string;
  scoreHome:    number | null;
  scoreAway:    number | null;
}

function loadPrevSeason(file: string): V3MatchRecord[] {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return raw?.matches ?? [];
  } catch { return []; }
}

function loadHistoricalCache(code: string, year: number): V3MatchRecord[] {
  const file = path.join(process.cwd(), 'cache', 'historical', 'football-data', code, `${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return raw?.matches ?? [];
  } catch { return []; }
}

function buildPrevSeasonMatches(code: string, prevSeasonFile: string): V3MatchRecord[] {
  const fromFetch = loadPrevSeason(prevSeasonFile);
  const from2024  = loadHistoricalCache(code, 2024);
  const from2023  = loadHistoricalCache(code, 2023);
  const prev2425  = from2024.length > 0 ? from2024 : fromFetch;
  return [...from2023, ...prev2425];
}

function loadMatchdayFiles(leagueDir: string): Map<number, CachedMatch[]> {
  const result = new Map<number, CachedMatch[]>();
  if (!fs.existsSync(leagueDir)) return result;
  const files = fs.readdirSync(leagueDir)
    .filter(f => f.match(/^matchday-\d+\.json$/))
    .sort();
  for (const file of files) {
    const num = parseInt(file.match(/(\d+)/)?.[1] ?? '0', 10);
    if (!num) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(leagueDir, file), 'utf-8'));
      const matches: CachedMatch[] = raw?.data?.matches ?? [];
      result.set(num, matches);
    } catch { /* skip corrupt files */ }
  }
  return result;
}

function toV3Record(m: CachedMatch): V3MatchRecord | null {
  if (m.scoreHome === null || m.scoreAway === null || !m.startTimeUtc) return null;
  return { homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, utcDate: m.startTimeUtc, homeGoals: m.scoreHome, awayGoals: m.scoreAway };
}

// ── Training data extraction ──────────────────────────────────────────────────

type Outcome = 0 | 1 | 2; // 0=HOME_WIN, 1=DRAW, 2=AWAY_WIN

interface TrainingExample {
  features: LogisticFeatureVector;
  label:    Outcome; // 0=HOME_WIN, 1=DRAW, 2=AWAY_WIN
  hasMarketOdds: boolean;
}

function extractTrainingExamples(league: LeagueConfig, oddsIndex: OddsIndex): TrainingExample[] {
  const allMatchdays    = loadMatchdayFiles(league.dir);
  const prevSeasonMatches = buildPrevSeasonMatches(league.leagueCode, league.prevSeasonFile);
  if (allMatchdays.size === 0) return [];

  const sortedMatchdays = [...allMatchdays.keys()].sort((a, b) => a - b);
  const examples: TrainingExample[] = [];

  for (const md of sortedMatchdays) {
    const testMatches = (allMatchdays.get(md) ?? [])
      .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc);

    if (testMatches.length === 0) continue;

    // Training data: all matches from prior matchdays
    const trainingRecords: V3MatchRecord[] = [];
    for (const prevMd of sortedMatchdays) {
      if (prevMd >= md) break;
      for (const m of (allMatchdays.get(prevMd) ?? [])) {
        const rec = toV3Record(m);
        if (rec) trainingRecords.push(rec);
      }
    }

    for (const m of testMatches) {
      const actual = m.scoreHome! > m.scoreAway! ? 0 : m.scoreHome! < m.scoreAway! ? 2 : 1;

      const engineInput: V3EngineInput = {
        homeTeamId:           m.homeTeamId,
        awayTeamId:           m.awayTeamId,
        kickoffUtc:           m.startTimeUtc,
        buildNowUtc:          m.startTimeUtc,
        currentSeasonMatches: trainingRecords,
        prevSeasonMatches,
        expectedSeasonGames:  league.expectedSeasonGames,
        leagueCode:           league.leagueCode,
        collectIntermediates: true,  // §SP-V4-20: collect intermediates for logistic training
      };

      const output = runV3Engine(engineInput);

      // Skip NOT_ELIGIBLE (not enough data to produce meaningful features)
      if (output.eligibility === 'NOT_ELIGIBLE') continue;
      if (!output._intermediates) continue;

      const inter = output._intermediates;

      // Lookup market odds (date + score matching)
      const oddsHit = lookupOdds(oddsIndex, league.leagueCode, m.startTimeUtc, m.scoreHome!, m.scoreAway!);

      const features = extractLogisticFeatures({
        lambdaHome:       inter.lambdaHome,
        lambdaAway:       inter.lambdaAway,
        restDaysHome:     inter.restDaysHome,
        restDaysAway:     inter.restDaysAway,
        h2hMultHome:      inter.h2hMultHome,
        h2hMultAway:      inter.h2hMultAway,
        absenceScoreHome: inter.absenceScoreHome,
        absenceScoreAway: inter.absenceScoreAway,
        xgCoverage:       inter.xgCoverage,
        leagueCode:       league.leagueCode,
        marketImpHome:    oddsHit?.impliedProbHome,
        marketImpDraw:    oddsHit?.impliedProbDraw,
        marketImpAway:    oddsHit?.impliedProbAway,
      });

      examples.push({ features, label: actual as Outcome, hasMarketOdds: oddsHit !== null });
    }
  }

  return examples;
}

/**
 * Extrae ejemplos de entrenamiento a partir de una temporada histórica completa
 * (cache/historical/football-data/{code}/{year}.json).
 *
 * Walk-forward por fecha: para cada partido, usa todos los partidos anteriores
 * en la misma temporada + prevSeasonMatches como historial.
 */
function extractHistoricalExamples(
  leagueCode:          string,
  expectedSeasonGames: number,
  currentSeasonMatches: V3MatchRecord[],
  prevSeasonMatches:    V3MatchRecord[],
  oddsIndex:            OddsIndex,
): TrainingExample[] {
  if (currentSeasonMatches.length === 0) return [];

  // Ordenar por fecha para walk-forward correcto
  const sorted = [...currentSeasonMatches].sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  const examples: TrainingExample[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (m.homeGoals === null || m.homeGoals === undefined ||
        m.awayGoals === null || m.awayGoals === undefined) continue;

    const actual: Outcome = m.homeGoals > m.awayGoals ? 0 : m.homeGoals < m.awayGoals ? 2 : 1;

    // Training context: todos los partidos anteriores a este
    const trainingRecords = sorted.slice(0, i);

    const engineInput: V3EngineInput = {
      homeTeamId:           m.homeTeamId,
      awayTeamId:           m.awayTeamId,
      kickoffUtc:           m.utcDate,
      buildNowUtc:          m.utcDate,
      currentSeasonMatches: trainingRecords,
      prevSeasonMatches,
      expectedSeasonGames,
      leagueCode,
      collectIntermediates: true,
    };

    const output = runV3Engine(engineInput);
    if (output.eligibility === 'NOT_ELIGIBLE') continue;
    if (!output._intermediates) continue;

    const inter = output._intermediates;
    const oddsHit = lookupOdds(oddsIndex, leagueCode, m.utcDate, m.homeGoals, m.awayGoals);

    const features = extractLogisticFeatures({
      lambdaHome:       inter.lambdaHome,
      lambdaAway:       inter.lambdaAway,
      restDaysHome:     inter.restDaysHome,
      restDaysAway:     inter.restDaysAway,
      h2hMultHome:      inter.h2hMultHome,
      h2hMultAway:      inter.h2hMultAway,
      absenceScoreHome: inter.absenceScoreHome,
      absenceScoreAway: inter.absenceScoreAway,
      xgCoverage:       inter.xgCoverage,
      leagueCode,
      marketImpHome:    oddsHit?.impliedProbHome,
      marketImpDraw:    oddsHit?.impliedProbDraw,
      marketImpAway:    oddsHit?.impliedProbAway,
    });

    examples.push({ features, label: actual, hasMarketOdds: oddsHit !== null });
  }

  return examples;
}

// ── Logistic regression training ─────────────────────────────────────────────

type ClassWeights = { bias: number; weights: Record<keyof LogisticFeatureVector, number> };

function makeZeroClassWeights(): ClassWeights {
  const w = {} as Record<keyof LogisticFeatureVector, number>;
  for (const k of LOGISTIC_FEATURE_KEYS) w[k] = 0;
  return { bias: 0, weights: w };
}

/** Softmax over 3 raw scores. Returns [p0, p1, p2]. */
function softmax(scores: [number, number, number]): [number, number, number] {
  const maxS = Math.max(...scores);
  const exps = scores.map(s => Math.exp(s - maxS)) as [number, number, number];
  const sum  = exps[0] + exps[1] + exps[2];
  return [exps[0] / sum, exps[1] / sum, exps[2] / sum];
}

/** Dot product of weight record with feature vector. */
function dotProduct(weights: Record<keyof LogisticFeatureVector, number>, fv: LogisticFeatureVector): number {
  let s = 0;
  for (const k of LOGISTIC_FEATURE_KEYS) s += (weights[k] ?? 0) * fv[k];
  return s;
}

/**
 * Computa class weights inversos a la frecuencia para compensar desequilibrio.
 * w[k] = n / (n_classes * count[k])
 * → la clase minoritaria recibe más peso para evitar que el modelo la ignore.
 */
function computeClassWeights(examples: TrainingExample[]): [number, number, number] {
  const n = examples.length;
  const counts = [0, 0, 0];
  for (const ex of examples) counts[ex.label]++;
  return [
    n / (3 * Math.max(counts[0], 1)),
    n / (3 * Math.max(counts[1], 1)),
    n / (3 * Math.max(counts[2], 1)),
  ];
}

/**
 * Trains multinomial logistic regression via full-batch gradient descent with
 * L2 regularization + class weights (fixes DRAW collapse on imbalanced data).
 * Labels: 0=HOME_WIN, 1=DRAW, 2=AWAY_WIN.
 */
function trainLogistic(
  examples:    TrainingExample[],
  maxIter:     number,
  lr:          number,
  regLambda:   number,
): { home: ClassWeights; draw: ClassWeights; away: ClassWeights } {
  const classes = ['home', 'draw', 'away'] as const;
  const params: Record<string, ClassWeights> = {
    home: makeZeroClassWeights(),
    draw: makeZeroClassWeights(),
    away: makeZeroClassWeights(),
  };

  const n = examples.length;
  if (n === 0) return { home: params.home, draw: params.draw, away: params.away };

  // Class weights: compensate for HOME_WIN > AWAY_WIN > DRAW imbalance
  const [wHome, wDraw, wAway] = computeClassWeights(examples);
  const classW = { home: wHome, draw: wDraw, away: wAway };
  const labelToClass = ['home', 'draw', 'away'] as const;

  for (let iter = 0; iter < maxIter; iter++) {
    const gradBias:    Record<string, number> = { home: 0, draw: 0, away: 0 };
    const gradWeights: Record<string, Record<keyof LogisticFeatureVector, number>> = {
      home: {} as Record<keyof LogisticFeatureVector, number>,
      draw: {} as Record<keyof LogisticFeatureVector, number>,
      away: {} as Record<keyof LogisticFeatureVector, number>,
    };
    for (const cls of classes) {
      for (const k of LOGISTIC_FEATURE_KEYS) gradWeights[cls][k] = 0;
    }

    let weightedN = 0;

    for (const ex of examples) {
      const exWeight = classW[labelToClass[ex.label]];
      weightedN += exWeight;

      const scoreHome = params.home.bias + dotProduct(params.home.weights, ex.features);
      const scoreDraw = params.draw.bias + dotProduct(params.draw.weights, ex.features);
      const scoreAway = params.away.bias + dotProduct(params.away.weights, ex.features);

      const [pH, pD, pA] = softmax([scoreHome, scoreDraw, scoreAway]);
      const probs = { home: pH, draw: pD, away: pA };

      const label = { home: ex.label === 0 ? 1 : 0, draw: ex.label === 1 ? 1 : 0, away: ex.label === 2 ? 1 : 0 };

      // Weighted gradient: scale by class weight
      for (const cls of classes) {
        const delta = exWeight * (probs[cls] - label[cls]);
        gradBias[cls] += delta;
        for (const k of LOGISTIC_FEATURE_KEYS) {
          gradWeights[cls][k] += delta * ex.features[k];
        }
      }
    }

    // Parameter update with L2 regularization (normalize by weighted sum)
    for (const cls of classes) {
      params[cls].bias -= lr * (gradBias[cls] / weightedN);
      for (const k of LOGISTIC_FEATURE_KEYS) {
        const grad = gradWeights[cls][k] / weightedN + regLambda * params[cls].weights[k];
        params[cls].weights[k] -= lr * grad;
      }
    }

    // Progress every 100 iterations
    if ((iter + 1) % 100 === 0) {
      let loss = 0;
      for (const ex of examples) {
        const sH = params.home.bias + dotProduct(params.home.weights, ex.features);
        const sD = params.draw.bias + dotProduct(params.draw.weights, ex.features);
        const sA = params.away.bias + dotProduct(params.away.weights, ex.features);
        const [pH, pD, pA] = softmax([sH, sD, sA]);
        loss -= Math.log(Math.max([pH, pD, pA][ex.label], 1e-15));
      }
      process.stdout.write(`  iter ${iter + 1}/${maxIter} — avg loss: ${(loss / n).toFixed(4)}\n`);
    }
  }

  return { home: params.home, draw: params.draw, away: params.away };
}

// ── Evaluation ───────────────────────────────────────────────────────────────

function evaluateLogistic(
  examples:    TrainingExample[],
  home:        ClassWeights,
  draw:        ClassWeights,
  away:        ClassWeights,
): { accuracy: number; confusionMatrix: number[][] } {
  let correct = 0;
  const cm = [[0,0,0],[0,0,0],[0,0,0]]; // cm[actual][predicted]

  for (const ex of examples) {
    const sH = home.bias + dotProduct(home.weights, ex.features);
    const sD = draw.bias + dotProduct(draw.weights, ex.features);
    const sA = away.bias + dotProduct(away.weights, ex.features);
    const [pH, pD, pA] = softmax([sH, sD, sA]);
    const probs = [pH, pD, pA];
    const predicted = probs.indexOf(Math.max(...probs)) as 0 | 1 | 2;
    if (predicted === ex.label) correct++;
    cm[ex.label][predicted]++;
  }

  return { accuracy: correct / examples.length, confusionMatrix: cm };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== SP-V4-20: Logistic Model Training ===\n');
  console.log(`Config: MAX_ITER=${MAX_ITER}, LR=${LR}, REG_LAMBDA=${REG_LAMBDA}`);
  console.log(`Output: ${OUTPUT_PATH}\n`);

  // ── Step 1: Load odds index ───────────────────────────────────────────────
  console.log('Loading market odds index (football-data.co.uk)...');
  const oddsIndex = buildOddsIndex(['PD', 'PL', 'BL1']);
  const oddsStats = oddsIndexStats(oddsIndex);
  console.log(`  ${oddsStats.total} records indexed — sources: ${JSON.stringify(oddsStats.bySource)}\n`);

  // ── Step 2: Extract training examples ───────────────────────────────────
  console.log('Extracting training examples...');
  const allExamples: TrainingExample[] = [];

  for (const league of LEAGUES) {
    console.log(`  [${league.leagueCode}] ${league.name}`);

    // 2a. Temporada actual (matchday files)
    if (fs.existsSync(league.dir)) {
      const examples = extractTrainingExamples(league, oddsIndex);
      const withOdds = examples.filter(e => e.hasMarketOdds).length;
      console.log(`    current season: ${examples.length} examples · odds: ${withOdds}/${examples.length} (${Math.round(100*withOdds/Math.max(examples.length,1))}%)`);
      allExamples.push(...examples);
    } else {
      console.log(`    current season: no cache dir, skipping`);
    }

    // 2b. Temporadas históricas (2023, 2024)
    const hist2023 = loadHistoricalCache(league.leagueCode, 2023);
    const hist2024 = loadHistoricalCache(league.leagueCode, 2024);

    // 2024-25: prevSeason = 2023-24
    if (hist2024.length > 0) {
      const ex = extractHistoricalExamples(league.leagueCode, league.expectedSeasonGames, hist2024, hist2023, oddsIndex);
      const wo = ex.filter(e => e.hasMarketOdds).length;
      console.log(`    2024-25: ${ex.length} examples · odds: ${wo}/${ex.length} (${Math.round(100*wo/Math.max(ex.length,1))}%)`);
      allExamples.push(...ex);
    }

    // 2023-24: prevSeason = [] (no tenemos 2022-23)
    if (hist2023.length > 0) {
      const ex = extractHistoricalExamples(league.leagueCode, league.expectedSeasonGames, hist2023, [], oddsIndex);
      const wo = ex.filter(e => e.hasMarketOdds).length;
      console.log(`    2023-24: ${ex.length} examples · odds: ${wo}/${ex.length} (${Math.round(100*wo/Math.max(ex.length,1))}%)`);
      allExamples.push(...ex);
    }
  }

  if (allExamples.length === 0) {
    console.warn('\nNo training examples found.');
    console.warn('Run the V3 backtest first to populate cache/football-data/<COMP>/<SEASON>/matchday-*.json or historical cache');
    console.warn('\nSaving default coefficients (all-zero → uniform 33.3%) to output.');

    const defaultCoeffs: LogisticCoefficients = {
      home: { bias: 0, weights: makeZeroClassWeights().weights },
      draw: { bias: 0, weights: makeZeroClassWeights().weights },
      away: { bias: 0, weights: makeZeroClassWeights().weights },
      trained_on_matches:    0,
      trained_at:            new Date().toISOString(),
      regularization_lambda: REG_LAMBDA,
    };

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(defaultCoeffs, null, 2), 'utf-8');
    console.log(`\nWrote default coefficients to: ${OUTPUT_PATH}`);
    return;
  }

  // Class distribution + odds coverage
  const classCounts = [0, 0, 0];
  let totalWithOdds = 0;
  for (const ex of allExamples) {
    classCounts[ex.label]++;
    if (ex.hasMarketOdds) totalWithOdds++;
  }
  console.log(`\nClass distribution:`);
  console.log(`  HOME_WIN : ${classCounts[0]} (${(100 * classCounts[0] / allExamples.length).toFixed(1)}%)`);
  console.log(`  DRAW     : ${classCounts[1]} (${(100 * classCounts[1] / allExamples.length).toFixed(1)}%)`);
  console.log(`  AWAY_WIN : ${classCounts[2]} (${(100 * classCounts[2] / allExamples.length).toFixed(1)}%)`);
  console.log(`  Total    : ${allExamples.length} examples`);
  console.log(`  Market odds coverage: ${totalWithOdds}/${allExamples.length} (${(100*totalWithOdds/allExamples.length).toFixed(1)}%)`);
  const [wH, wD, wA] = computeClassWeights(allExamples);
  console.log(`  Class weights: HOME=${wH.toFixed(3)} · DRAW=${wD.toFixed(3)} · AWAY=${wA.toFixed(3)}\n`);

  // ── Step 4: Train ────────────────────────────────────────────────────────
  console.log(`Training multinomial logistic regression (${MAX_ITER} iterations, class-weighted)...`);
  const { home, draw, away } = trainLogistic(allExamples, MAX_ITER, LR, REG_LAMBDA);

  // ── Step 5: Evaluate ─────────────────────────────────────────────────────
  const { accuracy, confusionMatrix: cm } = evaluateLogistic(allExamples, home, draw, away);
  console.log(`\nTraining-set accuracy: ${(100 * accuracy).toFixed(1)}%`);
  console.log('Confusion matrix (rows=actual, cols=predicted, order: HOME/DRAW/AWAY):');
  for (let r = 0; r < 3; r++) {
    const label = ['HOME_WIN', 'DRAW    ', 'AWAY_WIN'][r];
    console.log(`  ${label}: [${cm[r].join(', ')}]`);
  }

  // ── Step 6: Save coefficients ────────────────────────────────────────────
  const coefficients: LogisticCoefficients = {
    home: { bias: home.bias, weights: home.weights },
    draw: { bias: draw.bias, weights: draw.weights },
    away: { bias: away.bias, weights: away.weights },
    trained_on_matches:    allExamples.length,
    trained_at:            new Date().toISOString(),
    regularization_lambda: REG_LAMBDA,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(coefficients, null, 2), 'utf-8');
  console.log(`\nCoefficients saved to: ${OUTPUT_PATH}`);

  // ── Step 5: Summary ──────────────────────────────────────────────────────
  console.log('\n=== Summary ===');
  console.log(`  Matches trained on : ${allExamples.length}`);
  console.log(`  Training accuracy  : ${(100 * accuracy).toFixed(1)}%`);
  console.log(`  Note: training-set accuracy ≠ out-of-sample accuracy.`);
  console.log(`  For out-of-sample metrics, run the backtest after integrating`);
  console.log(`  the logistic model in SP-V4-23.`);
}

main().catch(err => {
  console.error('train-logistic failed:', err);
  process.exit(1);
});
