/**
 * train-track3.ts — Walk-forward training of the NEXUS Track 3 logistic model.
 *
 * Methodology:
 *   For each matchday N (sorted ascending), uses all finished matches from
 *   previous seasons + matchdays 1..N-1 as training context (strict anti-lookahead).
 *   Builds Track3FeatureVector for each test match, collects (features, outcome) pairs,
 *   then trains multinomial logistic regression via gradient descent.
 *
 * Anti-lookahead: buildNowUtc for each match = match.startTimeUtc (pre-kickoff).
 *   Only matches with utcDate < buildNowUtc are visible inside buildTrack3FeatureVector.
 *
 * Output: cache/nexus-models/track3-weights-global.json
 *
 * Usage: npx dotenv -e .env -- tsx tools/train-track3.ts
 *        npx dotenv -e .env -- tsx tools/train-track3.ts --all-leagues
 *
 * @module tools/train-track3
 */

import * as fs from 'fs';
import * as path from 'path';

import { buildTrack3FeatureVector } from '../packages/prediction/src/nexus/track3/context-features.js';
import { MISSING } from '../packages/prediction/src/nexus/feature-store/types.js';
import type { FeatureValue } from '../packages/prediction/src/nexus/feature-store/types.js';
import type { LogisticWeights } from '../packages/prediction/src/nexus/track3/logistic-model.js';
import type { HistoricalMatch } from '../packages/prediction/src/nexus/track1/types.js';
import { computeTrack1 } from '../packages/prediction/src/nexus/track1/track1-engine.js';
import { COMPETITION_REGISTRY, resolveAfSeason } from '../server/competition-registry.js';

// ── CLI flags ──────────────────────────────────────────────────────────────

const ALL_LEAGUES_FLAG = process.argv.includes('--all-leagues');

// Parse --include-comp {compId}
let INCLUDE_COMP_ID: string | null = null;
{
  const idx = process.argv.indexOf('--include-comp');
  if (idx !== -1 && process.argv[idx + 1]) {
    INCLUDE_COMP_ID = process.argv[idx + 1];
  }
}

// ── Constants ──────────────────────────────────────────────────────────────

const LEARNING_RATE = 0.1;
const EPOCHS = 2000;
const L2_LAMBDA = 0.001;
const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');
const AF_CACHE_BASE = path.join(process.cwd(), 'cache', 'apifootball');
const AF_HIST_BASE = path.join(process.cwd(), 'cache', 'historical', 'apifootball');
const OUTPUT_DIR = path.join(process.cwd(), 'cache', 'nexus-models');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'track3-weights-global.json');

// ── League configuration ───────────────────────────────────────────────────

interface LeagueConfig {
  name: string;
  code: string;
  dir: string;
  prevSeasonFile: string;
  totalTeams: number;
}

const LEAGUES_PROD: LeagueConfig[] = [
  {
    name: 'LaLiga (PD)',
    code: 'PD',
    dir: path.join(CACHE_BASE, 'PD', '2025-26'),
    prevSeasonFile: path.join(CACHE_BASE, 'PD', '2024-25', 'prev-season.json'),
    totalTeams: 20,
  },
  {
    name: 'Premier League (PL)',
    code: 'PL',
    dir: path.join(CACHE_BASE, 'PL', '2025-26'),
    prevSeasonFile: path.join(CACHE_BASE, 'PL', '2024-25', 'prev-season.json'),
    totalTeams: 20,
  },
  {
    name: 'Bundesliga (BL1)',
    code: 'BL1',
    dir: path.join(CACHE_BASE, 'BL1', '2025-26'),
    prevSeasonFile: path.join(CACHE_BASE, 'BL1', '2024-25', 'prev-season.json'),
    totalTeams: 18,
  },
];

const LEAGUES_EXTRA: LeagueConfig[] = [
  {
    name: 'Serie A (SA)',
    code: 'SA',
    dir: path.join(CACHE_BASE, 'SA', '2025-26'),
    prevSeasonFile: path.join(CACHE_BASE, 'SA', '2024-25', 'prev-season.json'),
    totalTeams: 20,
  },
  {
    name: 'Ligue 1 (FL1)',
    code: 'FL1',
    dir: path.join(CACHE_BASE, 'FL1', '2025-26'),
    prevSeasonFile: path.join(CACHE_BASE, 'FL1', '2024-25', 'prev-season.json'),
    totalTeams: 18,
  },
];

const LEAGUES = ALL_LEAGUES_FLAG
  ? [...LEAGUES_PROD, ...LEAGUES_EXTRA]
  : LEAGUES_PROD;

// ── Data loading (identical pattern to backtest-nexus.ts) ──────────────────

interface CachedMatch {
  matchId: string;
  matchday: number;
  startTimeUtc: string;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
  scoreHome: number | null;
  scoreAway: number | null;
}

function loadPrevSeason(file: string): HistoricalMatch[] {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const matches: Array<{
      homeTeamId: string; awayTeamId: string;
      startTimeUtc?: string; utcDate?: string;
      homeGoals?: number | null; awayGoals?: number | null;
      scoreHome?: number | null; scoreAway?: number | null;
    }> = raw?.matches ?? [];
    return matches
      .filter(m => (m.homeGoals !== null && m.homeGoals !== undefined) || (m.scoreHome !== null && m.scoreHome !== undefined))
      .map(m => ({
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        utcDate: m.startTimeUtc ?? m.utcDate ?? '',
        homeGoals: m.homeGoals ?? m.scoreHome ?? 0,
        awayGoals: m.awayGoals ?? m.scoreAway ?? 0,
        isNeutralVenue: false,
      }));
  } catch { return []; }
}

function loadHistoricalCache(code: string, year: number): HistoricalMatch[] {
  const file = path.join(process.cwd(), 'cache', 'historical', 'football-data', code, `${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const matches: Array<{
      homeTeamId: string; awayTeamId: string;
      startTimeUtc?: string; utcDate?: string;
      homeGoals?: number | null; awayGoals?: number | null;
      scoreHome?: number | null; scoreAway?: number | null;
    }> = raw?.matches ?? [];
    return matches
      .filter(m => (m.homeGoals !== null && m.homeGoals !== undefined) || (m.scoreHome !== null && m.scoreHome !== undefined))
      .map(m => ({
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        utcDate: m.startTimeUtc ?? m.utcDate ?? '',
        homeGoals: m.homeGoals ?? m.scoreHome ?? 0,
        awayGoals: m.awayGoals ?? m.scoreAway ?? 0,
        isNeutralVenue: false,
      }));
  } catch { return []; }
}

function buildPrevSeasonMatches(code: string, prevSeasonFile: string): HistoricalMatch[] {
  const fromFetch = loadPrevSeason(prevSeasonFile);
  const from2024 = loadHistoricalCache(code, 2024);
  const from2023 = loadHistoricalCache(code, 2023);
  const prev2425 = from2024.length > 0 ? from2024 : fromFetch;
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
    } catch { /* skip corrupt */ }
  }
  return result;
}

/**
 * Load matchday files for an AF canonical competition.
 *
 * AF matchday files live at: cache/apifootball/{competitionId}/{season}/matchday-{NN}.json
 * Sub-tournament leagues also produce matchday-{NN}-{KEY}.json — both variants are loaded.
 * Matches from the same matchday number (across sub-tournament suffixes) are merged.
 */
function loadAfMatchdayFiles(competitionId: string, season: string): Map<number, CachedMatch[]> {
  const result = new Map<number, CachedMatch[]>();
  const leagueDir = path.join(AF_CACHE_BASE, competitionId, season);
  if (!fs.existsSync(leagueDir)) return result;

  // Match both matchday-07.json and matchday-07-CLAUSURA.json variants
  const files = fs.readdirSync(leagueDir)
    .filter(f => f.match(/^matchday-\d+(?:-[A-Z]+)?\.json$/))
    .sort();

  for (const file of files) {
    const numMatch = file.match(/^matchday-(\d+)/);
    if (!numMatch) continue;
    const num = parseInt(numMatch[1], 10);
    if (!num) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(leagueDir, file), 'utf-8'));
      const matches: CachedMatch[] = raw?.data?.matches ?? [];
      // Merge into existing matchday (handles sub-tournament split files)
      const existing = result.get(num) ?? [];
      result.set(num, [...existing, ...matches]);
    } catch { /* skip corrupt */ }
  }
  return result;
}

/**
 * Load AF historical matches for a given leagueId and year.
 * Cache path: cache/historical/apifootball/{leagueId}/{year}.json
 */
function loadAfHistoricalCache(leagueId: number, year: number): HistoricalMatch[] {
  const calendarFile = path.join(AF_HIST_BASE, String(leagueId), `${year}.json`);
  const europeanFile = path.join(AF_HIST_BASE, String(leagueId), `${year - 1}-${String(year).slice(-2)}.json`);
  const file = fs.existsSync(calendarFile) ? calendarFile
             : fs.existsSync(europeanFile) ? europeanFile
             : null;
  if (!file) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const matches: Array<{
      homeTeamId: string; awayTeamId: string;
      utcDate?: string; startTimeUtc?: string;
      homeGoals?: number | null; awayGoals?: number | null;
      scoreHome?: number | null; scoreAway?: number | null;
    }> = raw?.matches ?? [];
    return matches
      .filter(m => (m.homeGoals ?? m.scoreHome) !== null && (m.homeGoals ?? m.scoreHome) !== undefined)
      .map(m => ({
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        utcDate: m.utcDate ?? m.startTimeUtc ?? '',
        homeGoals: m.homeGoals ?? m.scoreHome ?? 0,
        awayGoals: m.awayGoals ?? m.scoreAway ?? 0,
        isNeutralVenue: false,
      }));
  } catch { return []; }
}

/**
 * Collect training samples from an AF canonical competition.
 *
 * Uses the same walk-forward methodology as collectSamples() for FD leagues.
 * Historical context: AF historical cache (prev year) + AF matchday files (current season).
 */
function collectSamplesAf(
  compId: string,
  leagueId: number,
  seasonKind: 'european' | 'calendar' | 'cross-year',
  totalTeams: number,
  code: string,
): TrainingSample[] {
  // Derive current season label to find cache directory
  const now = new Date().toISOString();
  const seasonYear = resolveAfSeason(now, seasonKind);
  const season = seasonKind !== 'calendar'
    ? `${seasonYear}-${String(seasonYear + 1).slice(2)}`
    : String(seasonYear);

  const allMatchdays = loadAfMatchdayFiles(String(leagueId), season);
  if (allMatchdays.size === 0) {
    console.log(`  [${code}] No AF matchday files found at cache/apifootball/${leagueId}/${season}/, skipping.`);
    return [];
  }

  // Historical context: AF historical cache for prev year
  const prevYear = seasonYear - 1;
  const prevSeasonMatches = loadAfHistoricalCache(leagueId, prevYear);
  console.log(`  [${code}] AF historical prev year (${prevYear}): ${prevSeasonMatches.length} matches`);

  const sortedMatchdays = [...allMatchdays.keys()].sort((a, b) => a - b);
  const samples: TrainingSample[] = [];
  let skipped = 0;

  for (const md of sortedMatchdays) {
    const testMatches = (allMatchdays.get(md) ?? [])
      .filter(m =>
        m.status === 'FINISHED' &&
        m.scoreHome !== null &&
        m.scoreAway !== null &&
        m.startTimeUtc,
      );

    if (testMatches.length === 0) continue;

    // Training history: prev season + all current-season matchdays < md
    const trainingHistory: HistoricalMatch[] = [...prevSeasonMatches];
    for (const prevMd of sortedMatchdays) {
      if (prevMd >= md) break;
      for (const m of (allMatchdays.get(prevMd) ?? [])) {
        if (m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc) {
          trainingHistory.push({
            homeTeamId: m.homeTeamId,
            awayTeamId: m.awayTeamId,
            utcDate: m.startTimeUtc,
            homeGoals: m.scoreHome,
            awayGoals: m.scoreAway,
            isNeutralVenue: false,
          });
        }
      }
    }

    for (const match of testMatches) {
      if (!match.startTimeUtc || match.scoreHome === null || match.scoreAway === null) continue;

      const buildNowUtc = match.startTimeUtc;

      try {
        const track1 = computeTrack1(
          match.homeTeamId,
          match.awayTeamId,
          trainingHistory,
          false,
          code,
          buildNowUtc,
        );

        const eloHome = track1.homeStrength.eloRating;
        const eloAway = track1.awayStrength.eloRating;

        const fv = buildTrack3FeatureVector(
          match.homeTeamId,
          match.awayTeamId,
          buildNowUtc,
          trainingHistory,
          eloHome,
          eloAway,
          0, // homePosition: unavailable in backtest
          0, // awayPosition: unavailable in backtest
          totalTeams,
          md,
        );

        const features = extractFeatureArray(fv);
        const label = outcomeToOneHot(match.scoreHome, match.scoreAway);
        samples.push({ features, label });
      } catch {
        skipped++;
      }
    }
  }

  console.log(`  [${code}] AF: Collected ${samples.length} samples (skipped: ${skipped})`);
  return samples;
}

// ── Feature scaling constants ─────────────────────────────────────────────
//
// We bring all features to a comparable scale before training.
// Weights are then pre-divided by the scale factor before saving, so that
// inference with raw (unscaled) feature values via predictLogistic() is correct:
//   score = w_scaled * (x / scale) = (w_scaled / scale) * x_raw = w_saved * x_raw
//
// Scale choices:
//   eloDiff:        400  — Elo scale constant (400 points ≈ 10× odds ratio in standard Elo)
//   restDays:       7    — typical range 3–14 days
//   congestion:     5    — typical range 2–10 matches in 4 weeks
//   form (pts/game): 3   — max = 3.0, so 3 brings range to [0, 1]
//
// INVARIANT: the same scale constants must be applied when baking weights into
// the saved file. No separate normalization step is needed at inference time.

const FEATURE_SCALES = [
  400,  // 0: eloDiff
  7,    // 1: restDaysHome
  7,    // 2: restDaysAway
  5,    // 3: congestionHome
  5,    // 4: congestionAway
  3,    // 5: formHome
  3,    // 6: formAway
  3,    // 7: homeFormHome
  3,    // 8: awayFormAway
];

// ── Feature extraction from Track3FeatureVector ───────────────────────────

/**
 * Extract the 9 numeric features used by predictLogistic() from a Track3FeatureVector.
 * Missing features → 0 (neutral imputation, same as logistic-model.ts).
 * Returns scaled features for training — weights are then un-scaled before saving.
 */
function extractFeatureArray(
  fv: ReturnType<typeof buildTrack3FeatureVector>,
): number[] {
  function num(f: FeatureValue<number>): number {
    if (f.value === MISSING) return 0;
    return f.value as number;
  }

  const raw = [
    fv.eloDiff,                          // 0: eloDiff
    num(fv.restDaysHome),                // 1: restDaysHome
    num(fv.restDaysAway),                // 2: restDaysAway
    num(fv.matchesLast4WeeksHome),       // 3: congestionHome
    num(fv.matchesLast4WeeksAway),       // 4: congestionAway
    num(fv.formHome_last5),              // 5: formHome
    num(fv.formAway_last5),              // 6: formAway
    num(fv.homeFormHome_last5),          // 7: homeFormHome
    num(fv.awayFormAway_last5),          // 8: awayFormAway
  ];

  // Guard: replace any NaN/Infinity with 0 (treat as MISSING neutral value).
  // NaN can arise from malformed timestamps producing Invalid Date in restDays computation.
  // Scale features to bring them to comparable magnitudes.
  return raw.map((x, i) => {
    const scaled = x / FEATURE_SCALES[i];
    return Number.isFinite(scaled) ? scaled : 0;
  });
}

// ── Outcome encoding ───────────────────────────────────────────────────────

/** One-hot encode outcome: HOME=0, DRAW=1, AWAY=2 */
function outcomeToOneHot(scoreHome: number, scoreAway: number): [number, number, number] {
  if (scoreHome > scoreAway) return [1, 0, 0];
  if (scoreHome === scoreAway) return [0, 1, 0];
  return [0, 0, 1];
}

// ── Training sample ────────────────────────────────────────────────────────

interface TrainingSample {
  features: number[];  // length 9
  label: [number, number, number]; // one-hot [home, draw, away]
}

// ── Softmax ────────────────────────────────────────────────────────────────

function softmax3(scores: [number, number, number]): [number, number, number] {
  const maxS = Math.max(scores[0], scores[1], scores[2]);
  const e = scores.map(s => Math.exp(s - maxS)) as [number, number, number];
  const sum = e[0] + e[1] + e[2];
  return [e[0] / sum, e[1] / sum, e[2] / sum];
}

// ── Weight vector representation ───────────────────────────────────────────

/**
 * Flat weight matrix: W[class][feature_idx]
 * Class 0=HOME, 1=DRAW, 2=AWAY
 * Feature order: [intercept, eloDiff, restHome, restAway, congHome, congAway, fHome, fAway, hfHome, afAway]
 * → 10 parameters per class = 30 total
 */
type WeightMatrix = [number[], number[], number[]]; // [home_weights, draw_weights, away_weights]

function initWeights(): WeightMatrix {
  // Initialize near zero — let gradient descent find optimal values
  // Intercepts initialized to log base rates: home~46%, draw~26%, away~28%
  const homeW = [Math.log(0.46 / 0.28), 0, 0, 0, 0, 0, 0, 0, 0, 0]; // [intercept, 9 features]
  const drawW = [Math.log(0.26 / 0.28), 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const awayW = [0.0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // reference class
  return [homeW, drawW, awayW];
}

/** Score for class k = intercept + sum(w_k[i] * x[i]) */
function classScore(weights: number[], features: number[]): number {
  let score = weights[0]; // intercept
  for (let i = 0; i < features.length; i++) {
    const term = weights[i + 1] * features[i];
    // Guard: skip NaN/Infinity terms (defensive against bad weight values during early training)
    if (Number.isFinite(term)) score += term;
  }
  return Number.isFinite(score) ? score : 0;
}

/** Forward pass: returns softmax probabilities for all 3 classes */
function forward(W: WeightMatrix, features: number[]): [number, number, number] {
  const scores: [number, number, number] = [
    classScore(W[0], features),
    classScore(W[1], features),
    classScore(W[2], features),
  ];
  return softmax3(scores);
}

/** Cross-entropy loss over all samples + L2 regularization */
function computeLoss(W: WeightMatrix, samples: TrainingSample[]): number {
  let loss = 0;
  for (const s of samples) {
    const probs = forward(W, s.features);
    // Cross-entropy: -sum(y * log(p))
    loss -= s.label[0] * Math.log(Math.max(probs[0], 1e-15));
    loss -= s.label[1] * Math.log(Math.max(probs[1], 1e-15));
    loss -= s.label[2] * Math.log(Math.max(probs[2], 1e-15));
  }
  loss /= samples.length;

  // L2 regularization (skip intercepts at index 0)
  for (let k = 0; k < 3; k++) {
    for (let i = 1; i < W[k].length; i++) {
      loss += (L2_LAMBDA / 2) * W[k][i] * W[k][i];
    }
  }
  return loss;
}

/** Gradient descent step — full batch */
function gradientStep(W: WeightMatrix, samples: TrainingSample[], lr: number): WeightMatrix {
  const N = samples.length;
  // Gradient accumulators: same shape as W
  const grads: WeightMatrix = [
    new Array(W[0].length).fill(0),
    new Array(W[1].length).fill(0),
    new Array(W[2].length).fill(0),
  ];

  for (const s of samples) {
    const probs = forward(W, s.features);
    // Guard: skip samples where forward() produced NaN (malformed features)
    if (!Number.isFinite(probs[0]) || !Number.isFinite(probs[1]) || !Number.isFinite(probs[2])) {
      continue;
    }

    // Gradient of cross-entropy: (p_k - y_k) for each class k
    const deltas: [number, number, number] = [
      probs[0] - s.label[0],
      probs[1] - s.label[1],
      probs[2] - s.label[2],
    ];

    for (let k = 0; k < 3; k++) {
      // Intercept gradient
      grads[k][0] += deltas[k];
      // Feature gradients
      for (let i = 0; i < s.features.length; i++) {
        const g = deltas[k] * s.features[i];
        if (Number.isFinite(g)) grads[k][i + 1] += g;
      }
    }
  }

  // Apply update: W -= lr * (grad/N + L2_reg)
  const newW: WeightMatrix = [
    [...W[0]],
    [...W[1]],
    [...W[2]],
  ];
  for (let k = 0; k < 3; k++) {
    newW[k][0] -= lr * (grads[k][0] / N); // intercept: no L2
    for (let i = 1; i < W[k].length; i++) {
      const l2term = L2_LAMBDA * W[k][i];
      newW[k][i] -= lr * (grads[k][i] / N + l2term);
    }
  }
  return newW;
}

/**
 * Convert flat weight matrix to LogisticWeights interface.
 *
 * Un-scales feature weights so they can be applied directly to raw (unscaled)
 * feature values at inference time via predictLogistic().
 *
 * Training was done on scaled features: x_scaled = x_raw / scale.
 * The learned weight w_trained satisfies: score += w_trained * x_scaled.
 * For inference on raw values: score += (w_trained / scale) * x_raw.
 * So the saved weight = w_trained / scale.
 *
 * Intercepts are not scaled (no feature multiplied into them).
 */
function matrixToLogisticWeights(W: WeightMatrix): LogisticWeights {
  // W[class][0] = intercept, W[class][1..9] = feature weights (scaled)
  // Feature order: [eloDiff, restHome, restAway, congHome, congAway, fHome, fAway, hfHome, afAway]
  const [home, draw, away] = W;

  // Un-scale helper: w_saved = w_trained / scale
  function unscale(classWeights: number[], featureIdx: number): number {
    // featureIdx is 1-based in classWeights (index 0 = intercept)
    const wTrained = classWeights[featureIdx];
    const scale = FEATURE_SCALES[featureIdx - 1];
    return wTrained / scale;
  }

  return {
    intercept_home: home[0],
    intercept_draw: draw[0],
    intercept_away: away[0],

    eloDiff_home: unscale(home, 1),
    eloDiff_draw: unscale(draw, 1),
    eloDiff_away: unscale(away, 1),

    restDaysHome_home: unscale(home, 2),
    restDaysHome_draw: unscale(draw, 2),
    restDaysHome_away: unscale(away, 2),

    restDaysAway_home: unscale(home, 3),
    restDaysAway_draw: unscale(draw, 3),
    restDaysAway_away: unscale(away, 3),

    congestionHome_home: unscale(home, 4),
    congestionHome_draw: unscale(draw, 4),
    congestionHome_away: unscale(away, 4),

    congestionAway_home: unscale(home, 5),
    congestionAway_draw: unscale(draw, 5),
    congestionAway_away: unscale(away, 5),

    formHome_home: unscale(home, 6),
    formHome_draw: unscale(draw, 6),
    formHome_away: unscale(away, 6),

    formAway_home: unscale(home, 7),
    formAway_draw: unscale(draw, 7),
    formAway_away: unscale(away, 7),

    homeFormHome_home: unscale(home, 8),
    homeFormHome_draw: unscale(draw, 8),
    homeFormHome_away: unscale(away, 8),

    awayFormAway_home: unscale(home, 9),
    awayFormAway_draw: unscale(draw, 9),
    awayFormAway_away: unscale(away, 9),
  };
}

/** Schema for the persisted weights file */
interface Track3WeightsFile {
  version: string;
  trainedAt: string;
  samples: number;
  leagues: string[];
  finalLoss: number;
  trainAccuracy: number;
  weights: LogisticWeights;
}

// ── Data collection: walk-forward per league ───────────────────────────────

function collectSamples(league: LeagueConfig): TrainingSample[] {
  const allMatchdays = loadMatchdayFiles(league.dir);
  if (allMatchdays.size === 0) {
    console.log(`  [${league.code}] No matchday files found, skipping.`);
    return [];
  }

  const prevSeasonMatches = buildPrevSeasonMatches(league.code, league.prevSeasonFile);
  const sortedMatchdays = [...allMatchdays.keys()].sort((a, b) => a - b);

  const samples: TrainingSample[] = [];
  let skipped = 0;

  for (const md of sortedMatchdays) {
    const testMatches = (allMatchdays.get(md) ?? [])
      .filter(m =>
        m.status === 'FINISHED' &&
        m.scoreHome !== null &&
        m.scoreAway !== null &&
        m.startTimeUtc,
      );

    if (testMatches.length === 0) continue;

    // Training history: prev season + all current-season matchdays < md
    const trainingHistory: HistoricalMatch[] = [...prevSeasonMatches];
    for (const prevMd of sortedMatchdays) {
      if (prevMd >= md) break;
      for (const m of (allMatchdays.get(prevMd) ?? [])) {
        if (m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc) {
          trainingHistory.push({
            homeTeamId: m.homeTeamId,
            awayTeamId: m.awayTeamId,
            utcDate: m.startTimeUtc,
            homeGoals: m.scoreHome,
            awayGoals: m.scoreAway,
            isNeutralVenue: false,
          });
        }
      }
    }

    for (const match of testMatches) {
      if (!match.startTimeUtc || match.scoreHome === null || match.scoreAway === null) continue;

      // Anti-lookahead: buildNowUtc = kickoffUtc (pre-kickoff prediction time)
      const buildNowUtc = match.startTimeUtc;

      try {
        // Get Elo estimates for home/away teams (Track 1 Elo replay)
        const track1 = computeTrack1(
          match.homeTeamId,
          match.awayTeamId,
          trainingHistory,
          false,
          league.code,
          buildNowUtc,
        );

        const eloHome = track1.homeStrength.eloRating;
        const eloAway = track1.awayStrength.eloRating;

        // Build Track 3 feature vector (anti-lookahead enforced inside)
        const fv = buildTrack3FeatureVector(
          match.homeTeamId,
          match.awayTeamId,
          buildNowUtc,
          trainingHistory,
          eloHome,
          eloAway,
          0, // homePosition: unavailable in backtest (no standings data)
          0, // awayPosition: unavailable in backtest
          league.totalTeams,
          md,
        );

        const features = extractFeatureArray(fv);
        const label = outcomeToOneHot(match.scoreHome, match.scoreAway);

        samples.push({ features, label });
      } catch {
        skipped++;
      }
    }
  }

  console.log(`  [${league.code}] Collected ${samples.length} samples (skipped: ${skipped})`);
  return samples;
}

// ── Main training loop ─────────────────────────────────────────────────────

function trainLogistic(samples: TrainingSample[]): {
  weights: WeightMatrix;
  finalLoss: number;
  trainAccuracy: number;
} {
  let W = initWeights();

  console.log(`\nTraining logistic regression: ${samples.length} samples, ${EPOCHS} epochs, lr=${LEARNING_RATE}, λ=${L2_LAMBDA}`);

  let prevLoss = Infinity;
  for (let epoch = 0; epoch <= EPOCHS; epoch++) {
    W = gradientStep(W, samples, LEARNING_RATE);

    if (epoch % 100 === 0 || epoch === EPOCHS) {
      const loss = computeLoss(W, samples);
      console.log(`  Epoch ${String(epoch).padStart(4)}: loss=${loss.toFixed(6)}`);
      prevLoss = loss;
    }
  }

  const finalLoss = computeLoss(W, samples);

  // Compute train accuracy
  let correct = 0;
  for (const s of samples) {
    const probs = forward(W, s.features);
    const predicted = probs.indexOf(Math.max(...probs));
    const actual = s.label.indexOf(1);
    if (predicted === actual) correct++;
  }
  const trainAccuracy = correct / samples.length;

  console.log(`\nFinal loss: ${finalLoss.toFixed(6)}`);
  console.log(`Train accuracy: ${(trainAccuracy * 100).toFixed(1)}% (${correct}/${samples.length})`);

  // Suppress unused variable warning
  void prevLoss;

  return { weights: W, finalLoss, trainAccuracy };
}

// ── Atomic file write ──────────────────────────────────────────────────────

function atomicWriteJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup */ }
    throw err;
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== NEXUS Track 3 — Walk-Forward Logistic Training ===');
  console.log(`Leagues: ${LEAGUES.map(l => l.code).join(', ')}`);
  if (INCLUDE_COMP_ID) console.log(`Extra AF comp: ${INCLUDE_COMP_ID}`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log('');

  // Validate --include-comp if provided
  let afEntry: typeof COMPETITION_REGISTRY[number] | null = null;
  if (INCLUDE_COMP_ID) {
    afEntry = COMPETITION_REGISTRY.find(e => e.id === INCLUDE_COMP_ID) ?? null;
    if (!afEntry) {
      console.error(`Error: --include-comp "${INCLUDE_COMP_ID}" not found in COMPETITION_REGISTRY.`);
      console.error(`Valid AF comp IDs: ${COMPETITION_REGISTRY.filter(e => e.id.startsWith('comp:apifootball:')).map(e => e.id).join(', ')}`);
      process.exit(1);
    }
    if (afEntry.isTournament) {
      console.error(`Error: --include-comp "${INCLUDE_COMP_ID}" is a tournament (isTournament=true). Only league competitions are supported.`);
      process.exit(1);
    }
  }

  // Collect training samples from all leagues
  const allSamples: TrainingSample[] = [];
  const leagueNames: string[] = [];

  for (const league of LEAGUES) {
    console.log(`Loading ${league.name}...`);
    const samples = collectSamples(league);
    allSamples.push(...samples);
    if (samples.length > 0) leagueNames.push(league.code);
  }

  // Collect samples from AF canonical competition if --include-comp provided
  if (afEntry) {
    console.log(`Loading AF canonical: ${afEntry.displayName} (${afEntry.id})...`);
    // Estimate totalTeams from expectedSeasonGames (38 games → 20 teams for round-robin)
    // For leagues without expectedSeasonGames, default to 18
    const expectedGames = afEntry.expectedSeasonGames ?? 30;
    const totalTeams = Math.round(expectedGames / (expectedGames >= 36 ? 1.9 : expectedGames >= 30 ? 1.8 : 1.7));
    const samples = collectSamplesAf(
      afEntry.id,
      afEntry.leagueId,
      afEntry.seasonKind,
      totalTeams,
      afEntry.slug,
    );
    allSamples.push(...samples);
    if (samples.length > 0) leagueNames.push(afEntry.slug);
  }

  if (allSamples.length === 0) {
    console.error('\nNo training samples collected. Check that matchday cache files exist.');
    console.error('Run the backtest first to ensure cache is populated.');
    process.exit(1);
  }

  // Count outcomes in training set
  const homeSamples = allSamples.filter(s => s.label[0] === 1).length;
  const drawSamples = allSamples.filter(s => s.label[1] === 1).length;
  const awaySamples = allSamples.filter(s => s.label[2] === 1).length;
  console.log(`\nTotal samples: ${allSamples.length}`);
  console.log(`  HOME: ${homeSamples} (${(100 * homeSamples / allSamples.length).toFixed(1)}%)`);
  console.log(`  DRAW: ${drawSamples} (${(100 * drawSamples / allSamples.length).toFixed(1)}%)`);
  console.log(`  AWAY: ${awaySamples} (${(100 * awaySamples / allSamples.length).toFixed(1)}%)`);

  // Train
  const { weights: W, finalLoss, trainAccuracy } = trainLogistic(allSamples);

  // Convert to LogisticWeights
  const logisticWeights = matrixToLogisticWeights(W);

  // Build output file
  const output: Track3WeightsFile = {
    version: '1.0.0',
    trainedAt: new Date().toISOString(),
    samples: allSamples.length,
    leagues: leagueNames,
    finalLoss,
    trainAccuracy,
    weights: logisticWeights,
  };

  // Save
  atomicWriteJson(OUTPUT_FILE, output);
  console.log(`\nWeights saved to: ${OUTPUT_FILE}`);

  // Print a summary of key weight values
  console.log('\nKey weights (eloDiff — strongest signal):');
  console.log(`  eloDiff_home: ${logisticWeights.eloDiff_home.toFixed(6)}`);
  console.log(`  eloDiff_draw: ${logisticWeights.eloDiff_draw.toFixed(6)}`);
  console.log(`  eloDiff_away: ${logisticWeights.eloDiff_away.toFixed(6)}`);
  console.log('\nIntercepts (base rates):');
  console.log(`  intercept_home: ${logisticWeights.intercept_home.toFixed(6)}`);
  console.log(`  intercept_draw: ${logisticWeights.intercept_draw.toFixed(6)}`);
  console.log(`  intercept_away: ${logisticWeights.intercept_away.toFixed(6)}`);
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Training failed:', err);
  process.exit(1);
});
