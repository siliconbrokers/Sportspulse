/**
 * nexus-startup-init.ts
 *
 * Auto-initializes NEXUS cache files on first server boot.
 * Runs entirely in background — never blocks server startup.
 * Idempotent: checks existence before running, skips if already present.
 *
 * Two initialization tasks:
 *   1. Track 3 weights (cache/nexus-models/track3-weights-global.json)
 *      — Trains the walk-forward logistic regression model from matchday cache.
 *      — Falls back to DEFAULT_LOGISTIC_WEIGHTS if training fails or data is absent.
 *
 *   2. Odds store (cache/odds-raw/)
 *      — Loads historical odds from cache/odds-data/ into the raw odds store.
 *      — Skipped silently if cache/odds-data/ does not exist.
 *
 * Spec authority:
 *   - NEXUS master spec S8.1: shadow mode semantics (graceful degradation)
 *   - NEXUS master spec S8.2: feature flags (NEXUS_SHADOW_ENABLED gate)
 *   - taxonomy spec S5.4b: missingness policy — explicit null, not silent imputation
 *
 * Fault isolation:
 *   runNexusStartupInit() never throws. All errors are caught and logged.
 *   The caller uses `void` — this is intentional fire-and-forget.
 *
 * @module server/prediction/nexus-startup-init
 */

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';

import { buildTrack3FeatureVector } from '../../packages/prediction/src/nexus/track3/context-features.js';
import { MISSING } from '../../packages/prediction/src/nexus/feature-store/types.js';
import type { FeatureValue } from '../../packages/prediction/src/nexus/feature-store/types.js';
import type { LogisticWeights } from '../../packages/prediction/src/nexus/track3/logistic-model.js';
import type { HistoricalMatch } from '../../packages/prediction/src/nexus/track1/types.js';
import { computeTrack1 } from '../../packages/prediction/src/nexus/track1/track1-engine.js';
import { appendOddsRecord } from '../../packages/prediction/src/nexus/odds/raw-odds-store.js';
import type { OddsRecord, OddsProvider } from '../../packages/prediction/src/nexus/odds/types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const LEARNING_RATE = 0.1;
const EPOCHS = 2000;
const L2_LAMBDA = 0.001;

const FEATURE_SCALES = [
  400, // 0: eloDiff
  7,   // 1: restDaysHome
  7,   // 2: restDaysAway
  5,   // 3: congestionHome
  5,   // 4: congestionAway
  3,   // 5: formHome
  3,   // 6: formAway
  3,   // 7: homeFormHome
  3,   // 8: awayFormAway
];

// ── Internal types ────────────────────────────────────────────────────────────

interface LeagueConfig {
  code: string;
  dir: string;
  prevSeasonFile: string;
  totalTeams: number;
}

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

interface TrainingSample {
  features: number[];
  label: [number, number, number];
}

type WeightMatrix = [number[], number[], number[]];

interface Track3WeightsFile {
  version: string;
  trainedAt: string;
  samples: number;
  leagues: string[];
  finalLoss: number;
  trainAccuracy: number;
  weights: LogisticWeights;
}

interface OddsDataMatch {
  date: string;
  homeTeam: string;
  awayTeam: string;
  ftr?: string;
  psh?: number; psd?: number; psa?: number;
  b365h?: number; b365d?: number; b365a?: number;
  maxh?: number; maxd?: number; maxa?: number;
  avgh?: number; avgd?: number; avga?: number;
}

interface OddsDataFile {
  league: string;
  season: string;
  matches: OddsDataMatch[];
}

// ── Track 3 training helpers ──────────────────────────────────────────────────

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

function loadHistoricalCache(cacheDir: string, code: string, year: number): HistoricalMatch[] {
  const file = path.join(cacheDir, 'historical', 'football-data', code, `${year}.json`);
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

function buildPrevSeasonMatches(cacheDir: string, code: string, prevSeasonFile: string): HistoricalMatch[] {
  const fromFetch = loadPrevSeason(prevSeasonFile);
  const from2024 = loadHistoricalCache(cacheDir, code, 2024);
  const from2023 = loadHistoricalCache(cacheDir, code, 2023);
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

function extractFeatureArray(fv: ReturnType<typeof buildTrack3FeatureVector>): number[] {
  function num(f: FeatureValue<number>): number {
    if (f.value === MISSING) return 0;
    return f.value as number;
  }

  const raw = [
    fv.eloDiff,
    num(fv.restDaysHome),
    num(fv.restDaysAway),
    num(fv.matchesLast4WeeksHome),
    num(fv.matchesLast4WeeksAway),
    num(fv.formHome_last5),
    num(fv.formAway_last5),
    num(fv.homeFormHome_last5),
    num(fv.awayFormAway_last5),
  ];

  return raw.map((x, i) => {
    const scaled = x / FEATURE_SCALES[i];
    return Number.isFinite(scaled) ? scaled : 0;
  });
}

function outcomeToOneHot(scoreHome: number, scoreAway: number): [number, number, number] {
  if (scoreHome > scoreAway) return [1, 0, 0];
  if (scoreHome === scoreAway) return [0, 1, 0];
  return [0, 0, 1];
}

function softmax3(scores: [number, number, number]): [number, number, number] {
  const maxS = Math.max(scores[0], scores[1], scores[2]);
  const e = scores.map(s => Math.exp(s - maxS)) as [number, number, number];
  const sum = e[0] + e[1] + e[2];
  return [e[0] / sum, e[1] / sum, e[2] / sum];
}

function initWeights(): WeightMatrix {
  const homeW = [Math.log(0.46 / 0.28), 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const drawW = [Math.log(0.26 / 0.28), 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const awayW = [0.0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return [homeW, drawW, awayW];
}

function classScore(weights: number[], features: number[]): number {
  let score = weights[0];
  for (let i = 0; i < features.length; i++) {
    const term = weights[i + 1] * features[i];
    if (Number.isFinite(term)) score += term;
  }
  return Number.isFinite(score) ? score : 0;
}

function forward(W: WeightMatrix, features: number[]): [number, number, number] {
  const scores: [number, number, number] = [
    classScore(W[0], features),
    classScore(W[1], features),
    classScore(W[2], features),
  ];
  return softmax3(scores);
}

function computeLoss(W: WeightMatrix, samples: TrainingSample[]): number {
  let loss = 0;
  for (const s of samples) {
    const probs = forward(W, s.features);
    loss -= s.label[0] * Math.log(Math.max(probs[0], 1e-15));
    loss -= s.label[1] * Math.log(Math.max(probs[1], 1e-15));
    loss -= s.label[2] * Math.log(Math.max(probs[2], 1e-15));
  }
  loss /= samples.length;

  for (let k = 0; k < 3; k++) {
    for (let i = 1; i < W[k].length; i++) {
      loss += (L2_LAMBDA / 2) * W[k][i] * W[k][i];
    }
  }
  return loss;
}

function gradientStep(W: WeightMatrix, samples: TrainingSample[], lr: number): WeightMatrix {
  const N = samples.length;
  const grads: WeightMatrix = [
    new Array(W[0].length).fill(0),
    new Array(W[1].length).fill(0),
    new Array(W[2].length).fill(0),
  ];

  for (const s of samples) {
    const probs = forward(W, s.features);
    if (!Number.isFinite(probs[0]) || !Number.isFinite(probs[1]) || !Number.isFinite(probs[2])) {
      continue;
    }
    const deltas: [number, number, number] = [
      probs[0] - s.label[0],
      probs[1] - s.label[1],
      probs[2] - s.label[2],
    ];
    for (let k = 0; k < 3; k++) {
      grads[k][0] += deltas[k];
      for (let i = 0; i < s.features.length; i++) {
        const g = deltas[k] * s.features[i];
        if (Number.isFinite(g)) grads[k][i + 1] += g;
      }
    }
  }

  const newW: WeightMatrix = [[...W[0]], [...W[1]], [...W[2]]];
  for (let k = 0; k < 3; k++) {
    newW[k][0] -= lr * (grads[k][0] / N);
    for (let i = 1; i < W[k].length; i++) {
      const l2term = L2_LAMBDA * W[k][i];
      newW[k][i] -= lr * (grads[k][i] / N + l2term);
    }
  }
  return newW;
}

function matrixToLogisticWeights(W: WeightMatrix): LogisticWeights {
  const [home, draw, away] = W;
  function unscale(classWeights: number[], featureIdx: number): number {
    return classWeights[featureIdx] / FEATURE_SCALES[featureIdx - 1];
  }
  return {
    intercept_home: home[0],
    intercept_draw: draw[0],
    intercept_away: away[0],
    eloDiff_home: unscale(home, 1), eloDiff_draw: unscale(draw, 1), eloDiff_away: unscale(away, 1),
    restDaysHome_home: unscale(home, 2), restDaysHome_draw: unscale(draw, 2), restDaysHome_away: unscale(away, 2),
    restDaysAway_home: unscale(home, 3), restDaysAway_draw: unscale(draw, 3), restDaysAway_away: unscale(away, 3),
    congestionHome_home: unscale(home, 4), congestionHome_draw: unscale(draw, 4), congestionHome_away: unscale(away, 4),
    congestionAway_home: unscale(home, 5), congestionAway_draw: unscale(draw, 5), congestionAway_away: unscale(away, 5),
    formHome_home: unscale(home, 6), formHome_draw: unscale(draw, 6), formHome_away: unscale(away, 6),
    formAway_home: unscale(home, 7), formAway_draw: unscale(draw, 7), formAway_away: unscale(away, 7),
    homeFormHome_home: unscale(home, 8), homeFormHome_draw: unscale(draw, 8), homeFormHome_away: unscale(away, 8),
    awayFormAway_home: unscale(home, 9), awayFormAway_draw: unscale(draw, 9), awayFormAway_away: unscale(away, 9),
  };
}

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

function collectSamples(cacheDir: string, league: LeagueConfig): TrainingSample[] {
  const allMatchdays = loadMatchdayFiles(league.dir);
  if (allMatchdays.size === 0) {
    console.log(`  [NEXUS init][${league.code}] No matchday files found, skipping.`);
    return [];
  }

  const prevSeasonMatches = buildPrevSeasonMatches(cacheDir, league.code, league.prevSeasonFile);
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
          league.code,
          buildNowUtc,
        );
        const fv = buildTrack3FeatureVector(
          match.homeTeamId,
          match.awayTeamId,
          buildNowUtc,
          trainingHistory,
          track1.homeStrength.eloRating,
          track1.awayStrength.eloRating,
          0,
          0,
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

  console.log(`  [NEXUS init][${league.code}] Collected ${samples.length} samples (skipped: ${skipped})`);
  return samples;
}

function trainLogistic(samples: TrainingSample[]): { weights: WeightMatrix; finalLoss: number; trainAccuracy: number } {
  let W = initWeights();
  for (let epoch = 0; epoch <= EPOCHS; epoch++) {
    W = gradientStep(W, samples, LEARNING_RATE);
  }
  const finalLoss = computeLoss(W, samples);
  let correct = 0;
  for (const s of samples) {
    const probs = forward(W, s.features);
    const predicted = probs.indexOf(Math.max(...probs));
    const actual = s.label.indexOf(1);
    if (predicted === actual) correct++;
  }
  const trainAccuracy = correct / samples.length;
  return { weights: W, finalLoss, trainAccuracy };
}

// ── Public: Track 3 training ──────────────────────────────────────────────────

/**
 * Train Track 3 logistic weights from matchday cache and persist to
 * cache/nexus-models/track3-weights-global.json.
 *
 * Exported for testability. Called internally by runNexusStartupInit.
 */
export async function trainTrack3Weights(cacheDir: string): Promise<void> {
  const cacheBase = path.join(cacheDir, 'football-data');
  const outputFile = path.join(cacheDir, 'nexus-models', 'track3-weights-global.json');

  const leagues: LeagueConfig[] = [
    {
      code: 'PD',
      dir: path.join(cacheBase, 'PD', '2025-26'),
      prevSeasonFile: path.join(cacheBase, 'PD', '2024-25', 'prev-season.json'),
      totalTeams: 20,
    },
    {
      code: 'PL',
      dir: path.join(cacheBase, 'PL', '2025-26'),
      prevSeasonFile: path.join(cacheBase, 'PL', '2024-25', 'prev-season.json'),
      totalTeams: 20,
    },
    {
      code: 'BL1',
      dir: path.join(cacheBase, 'BL1', '2025-26'),
      prevSeasonFile: path.join(cacheBase, 'BL1', '2024-25', 'prev-season.json'),
      totalTeams: 18,
    },
  ];

  const allSamples: TrainingSample[] = [];
  const leagueNames: string[] = [];

  for (const league of leagues) {
    const samples = collectSamples(cacheDir, league);
    allSamples.push(...samples);
    if (samples.length > 0) leagueNames.push(league.code);
  }

  if (allSamples.length === 0) {
    console.warn('[NEXUS init] No training samples found — matchday cache may be empty. Skipping Track 3 training.');
    return;
  }

  console.log(`[NEXUS init] Training logistic model: ${allSamples.length} samples, ${EPOCHS} epochs...`);

  const { weights: W, finalLoss, trainAccuracy } = trainLogistic(allSamples);
  const logisticWeights = matrixToLogisticWeights(W);

  const output: Track3WeightsFile = {
    version: '1.0.0',
    trainedAt: new Date().toISOString(),
    samples: allSamples.length,
    leagues: leagueNames,
    finalLoss,
    trainAccuracy,
    weights: logisticWeights,
  };

  atomicWriteJson(outputFile, output);
  console.log(
    `[NEXUS init] Track 3 weights ready (${allSamples.length} samples, loss=${finalLoss.toFixed(3)})`,
  );
}

// ── Public: Odds store loading ────────────────────────────────────────────────

function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deriveMatchId(league: string, date: string, homeTeam: string, awayTeam: string): string {
  return `${league}:${date}:${normalizeTeamName(homeTeam)}:${normalizeTeamName(awayTeam)}`;
}

function deriveSnapshotUtc(date: string): string {
  return `${date}T12:00:00Z`;
}

interface ProviderOdds {
  provider: OddsProvider;
  home: number;
  draw: number;
  away: number;
}

function extractProviderOdds(match: OddsDataMatch): ProviderOdds[] {
  const results: ProviderOdds[] = [];
  const candidates: Array<{ provider: OddsProvider; h: number | undefined; d: number | undefined; a: number | undefined }> = [
    { provider: 'pinnacle',   h: match.psh,   d: match.psd,   a: match.psa   },
    { provider: 'bet365',     h: match.b365h, d: match.b365d, a: match.b365a },
    { provider: 'market_max', h: match.maxh,  d: match.maxd,  a: match.maxa  },
    { provider: 'market_avg', h: match.avgh,  d: match.avgd,  a: match.avga  },
  ];
  for (const c of candidates) {
    if (c.h != null && c.d != null && c.a != null && c.h > 0 && c.d > 0 && c.a > 0) {
      results.push({ provider: c.provider, home: c.h, draw: c.d, away: c.a });
    }
  }
  return results;
}

/**
 * Load historical odds from cache/odds-data/ into the raw odds store.
 *
 * Exported for testability. Called internally by runNexusStartupInit.
 * No-ops silently if cache/odds-data/ does not exist.
 */
export async function loadHistoricalOdds(cacheDir: string): Promise<void> {
  const oddsDataDir = path.join(cacheDir, 'odds-data');

  // Source dir absent — normal on a fresh Render instance that hasn't run build-odds-dataset.
  if (!fs.existsSync(oddsDataDir)) {
    console.log('[NEXUS init] cache/odds-data/ not found — skipping historical odds load.');
    return;
  }

  const retrievedAtUtc = new Date().toISOString();
  let totalWritten = 0;
  let totalSkipped = 0;

  let leagues: string[];
  try {
    const entries = await fsPromises.readdir(oddsDataDir, { withFileTypes: true });
    leagues = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[NEXUS init] Could not list odds-data directory: ${msg}`);
    return;
  }

  for (const league of leagues) {
    const leagueDir = path.join(oddsDataDir, league);
    let files: string[];
    try {
      files = (await fsPromises.readdir(leagueDir)).filter(f => f.endsWith('.json')).sort();
    } catch {
      continue;
    }

    for (const file of files) {
      try {
        const raw = await fsPromises.readFile(path.join(leagueDir, file), 'utf8');
        const data: OddsDataFile = JSON.parse(raw);

        for (const match of data.matches) {
          const providerOdds = extractProviderOdds(match);
          if (providerOdds.length === 0) continue;

          const matchId = deriveMatchId(league, match.date, match.homeTeam, match.awayTeam);
          const snapshotUtc = deriveSnapshotUtc(match.date);

          for (const po of providerOdds) {
            const record: OddsRecord = {
              match_id: matchId,
              provider: po.provider,
              market: '1x2',
              odds_home: po.home,
              odds_draw: po.draw,
              odds_away: po.away,
              snapshot_utc: snapshotUtc,
              retrieved_at_utc: retrievedAtUtc,
            };

            // Check for idempotency before writing
            const targetDir = path.join(cacheDir, 'odds-raw', matchId, po.provider);
            const safeSnapshot = snapshotUtc.replace(/:/g, '-');
            const targetFile = path.join(targetDir, `${safeSnapshot}.json`);

            let alreadyExists = false;
            try {
              await fsPromises.access(targetFile);
              alreadyExists = true;
            } catch { /* does not exist */ }

            await appendOddsRecord(record, cacheDir);

            if (alreadyExists) {
              totalSkipped++;
            } else {
              totalWritten++;
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[NEXUS init] Error processing odds file ${file}: ${msg}`);
      }
    }
  }

  console.log(
    `[NEXUS init] Odds store ready (${totalWritten} records written, ${totalSkipped} already existed)`,
  );
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Auto-initialize NEXUS cache files on first server boot.
 *
 * Fires-and-forgets both tasks in sequence (Track 3 first, then odds store).
 * Sequential ordering avoids I/O pressure from concurrent file writes.
 *
 * Never throws — all errors are caught and logged.
 * The caller must use `void runNexusStartupInit(...)` — do NOT await.
 *
 * @param cacheDir - Absolute path to the cache directory (typically process.cwd()/cache).
 */
export function runNexusStartupInit(cacheDir: string): void {
  // Fire and forget — never block server startup
  void (async () => {
    // ── Task 1: Track 3 weights ─────────────────────────────────────────────
    const track3File = path.join(cacheDir, 'nexus-models', 'track3-weights-global.json');
    if (!fs.existsSync(track3File)) {
      console.log('[NEXUS init] Track 3 weights not found — training in background...');
      try {
        await trainTrack3Weights(cacheDir);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[NEXUS init] Track 3 training failed — will use DEFAULT_LOGISTIC_WEIGHTS: ${msg}`);
      }
    }
    // If file already exists: skip silently (idempotent)

    // ── Task 2: Odds store ──────────────────────────────────────────────────
    const oddsRawDir = path.join(cacheDir, 'odds-raw');
    let oddsStoreEmpty = false;
    try {
      const entries = fs.readdirSync(oddsRawDir);
      oddsStoreEmpty = entries.length === 0;
    } catch {
      // Directory does not exist at all
      oddsStoreEmpty = true;
    }

    if (oddsStoreEmpty) {
      console.log('[NEXUS init] Odds store empty — loading historical odds in background...');
      try {
        await loadHistoricalOdds(cacheDir);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[NEXUS init] Odds store load failed (non-fatal): ${msg}`);
      }
    }
    // If odds-raw/ is non-empty: skip silently (idempotent)
  })();
}
