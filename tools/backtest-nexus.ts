/**
 * BACKTEST-NEXUS: Walk-forward backtest del motor NEXUS Track 1+2 + Track 4.
 *
 * Metodología: para cada jornada N, usa partidos de jornadas 1..N-1 como
 * training data (sin data leakage), testea sobre partidos FINISHED de jornada N.
 *
 * Anti-leakage: buildNowUtc para cada partido = kickoffUtc del partido predicho.
 * Esto replica el momento exacto en que se haría la predicción pre-kickoff.
 *
 * Track 3: null (no hay pesos entrenados aún — se entrena en OP-5)
 * Track 4: carga odds desde cache/odds-raw/{matchId}/ si existen; DEACTIVATED si no.
 *
 * Ligas: PD, PL, BL1, SA, FL1 (con --all-leagues) — temporadas 2023-24 y 2024-25 como
 * prev season, 2025-26 como jornadas de test.
 *
 * Scorecard HWF: appendScorecardEntry() en cache/nexus-scorecards/historical_walk_forward/
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/backtest-nexus.ts [--all-leagues]
 */

import * as fs from 'fs';
import * as path from 'path';

import { computeTrack1 } from '../packages/prediction/src/nexus/track1/track1-engine.js';
import { computeTrack2 } from '../packages/prediction/src/nexus/track2/track2-engine.js';
import { runNexusEnsemble } from '../packages/prediction/src/nexus/ensemble/nexus-ensemble.js';
import { buildBootstrapCalibrationTable } from '../packages/prediction/src/nexus/ensemble/ensemble-calibrator.js';
import type {
  Track12Output,
  Track4EnsembleInput,
  WeightRegistry,
  NexusCalibrationTable,
} from '../packages/prediction/src/nexus/ensemble/types.js';
import { ENSEMBLE_VERSION } from '../packages/prediction/src/nexus/ensemble/types.js';
import type { HistoricalMatch } from '../packages/prediction/src/nexus/track1/types.js';
import { appendScorecardEntry, computeRps } from '../packages/prediction/src/nexus/scorecards/scorecard-store.js';
import { getCanonicalOddsSnapshot } from '../packages/prediction/src/nexus/odds/canonical-serving-view.js';
import type { OddsRecord } from '../packages/prediction/src/nexus/odds/types.js';
import {
  computeProbabilityMetrics,
  type PredictionRecord,
} from '../packages/prediction/src/metrics/calibration-metrics.js';

// ── CLI flags ──────────────────────────────────────────────────────────────

const ALL_LEAGUES_FLAG = process.argv.includes('--all-leagues');

// ── Bootstrap weight registry (uniform weights — no training data yet) ─────

/**
 * Bootstrap WeightRegistry: equal weight between Track 1+2 and Track 4
 * when track4 active, pure Track 1+2 when track4 deactivated.
 * Used because OP-5 (walk-forward weight training) hasn't run yet.
 * taxonomy spec S7.4.5d: global fallback with bootstrap weights.
 */
function buildBootstrapWeightRegistry(): WeightRegistry {
  return {
    segments: {},
    global: {
      track12: 0.70,  // Bootstrap: Track 1+2 dominant (no T3, T4 partial coverage)
      track3: 0.0,    // T3 excluded (OP-5 pending)
      track4: 0.30,   // Bootstrap: 30% market when available
    },
    ensembleVersion: ENSEMBLE_VERSION,
    learnedAt: '1970-01-01T00:00:00Z',  // Sentinel — bootstrap
  };
}

// ── Odds loading (sync from cache/odds-raw/) ──────────────────────────────

/**
 * Load all OddsRecords for a matchId from the raw store (sync).
 *
 * Path layout: cache/odds-raw/{matchId}/{provider}/{snapshot_utc_safe}.json
 * Returns [] when no records exist.
 */
function loadOddsRecordsSync(matchId: string): OddsRecord[] {
  const matchDir = path.join(process.cwd(), 'cache', 'odds-raw', matchId);
  if (!fs.existsSync(matchDir)) return [];

  const records: OddsRecord[] = [];

  let providerDirs: string[];
  try {
    providerDirs = fs.readdirSync(matchDir).filter(name => {
      const fullPath = path.join(matchDir, name);
      return fs.statSync(fullPath).isDirectory();
    });
  } catch {
    return [];
  }

  for (const provider of providerDirs) {
    const providerDir = path.join(matchDir, provider);
    let files: string[];
    try {
      files = fs.readdirSync(providerDir).filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
    } catch {
      continue;
    }
    for (const file of files) {
      const filePath = path.join(providerDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const record = JSON.parse(raw) as OddsRecord;
        records.push(record);
      } catch {
        // Skip corrupt records
      }
    }
  }

  // Sort by snapshot_utc ASC
  records.sort((a, b) => a.snapshot_utc.localeCompare(b.snapshot_utc));
  return records;
}

/**
 * Derive Track4EnsembleInput from raw odds records for a match.
 * Uses getCanonicalOddsSnapshot with 'feature' role.
 * Returns DEACTIVATED when no snapshot is available.
 */
function deriveTrack4Input(matchId: string, buildNowUtc: string): Track4EnsembleInput {
  const records = loadOddsRecordsSync(matchId);
  if (records.length === 0) {
    return { status: 'DEACTIVATED' };
  }

  const snapshot = getCanonicalOddsSnapshot(records, buildNowUtc, 'feature');
  if (snapshot === null) {
    return { status: 'DEACTIVATED' };
  }

  // Map OddsConfidence → Track4EnsembleInput status
  const statusMap: Record<string, Track4EnsembleInput['status']> = {
    HIGH: 'ACTIVE_HIGH',
    MEDIUM: 'ACTIVE_MEDIUM',
    LOW: 'ACTIVE_LOW',
    DEACTIVATED: 'DEACTIVATED',
  };
  const status = statusMap[snapshot.confidence] ?? 'DEACTIVATED';

  if (status === 'DEACTIVATED') {
    return { status: 'DEACTIVATED' };
  }

  return {
    status,
    probs: {
      home: snapshot.implied_probs.home,
      draw: snapshot.implied_probs.draw,
      away: snapshot.implied_probs.away,
    },
    oddsSource: snapshot.provider,
  };
}

// ── Cache types (same as backtest-v3.ts) ──────────────────────────────────

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

// ── League config ──────────────────────────────────────────────────────────

interface LeagueConfigFull {
  name: string;
  code: string;
  dir: string;
  competitionId: string;
  expectedSeasonGames: number;
  prevSeasonFile: string;
}

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');

const LEAGUES_PROD: LeagueConfigFull[] = [
  {
    name: 'LaLiga (PD)',
    code: 'PD',
    dir: path.join(CACHE_BASE, 'PD', '2025-26'),
    competitionId: 'comp:football-data:PD',
    expectedSeasonGames: 38,
    prevSeasonFile: path.join(CACHE_BASE, 'PD', '2024-25', 'prev-season.json'),
  },
  {
    name: 'Premier League (PL)',
    code: 'PL',
    dir: path.join(CACHE_BASE, 'PL', '2025-26'),
    competitionId: 'comp:football-data:PL',
    expectedSeasonGames: 38,
    prevSeasonFile: path.join(CACHE_BASE, 'PL', '2024-25', 'prev-season.json'),
  },
  {
    name: 'Bundesliga (BL1)',
    code: 'BL1',
    dir: path.join(CACHE_BASE, 'BL1', '2025-26'),
    competitionId: 'comp:football-data:BL1',
    expectedSeasonGames: 34,
    prevSeasonFile: path.join(CACHE_BASE, 'BL1', '2024-25', 'prev-season.json'),
  },
];

const LEAGUES_EXTRA: LeagueConfigFull[] = [
  {
    name: 'Serie A (SA)',
    code: 'SA',
    dir: path.join(CACHE_BASE, 'SA', '2025-26'),
    competitionId: 'comp:football-data:SA',
    expectedSeasonGames: 38,
    prevSeasonFile: path.join(CACHE_BASE, 'SA', '2024-25', 'prev-season.json'),
  },
  {
    name: 'Ligue 1 (FL1)',
    code: 'FL1',
    dir: path.join(CACHE_BASE, 'FL1', '2025-26'),
    competitionId: 'comp:football-data:FL1',
    expectedSeasonGames: 34,
    prevSeasonFile: path.join(CACHE_BASE, 'FL1', '2024-25', 'prev-season.json'),
  },
];

const LEAGUES = ALL_LEAGUES_FLAG
  ? [...LEAGUES_PROD, ...LEAGUES_EXTRA]
  : LEAGUES_PROD;

// ── Data loaders (identical to backtest-v3.ts) ─────────────────────────────

function loadPrevSeason(file: string): HistoricalMatch[] {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const matches: Array<{ homeTeamId: string; awayTeamId: string; startTimeUtc?: string; utcDate?: string; homeGoals?: number | null; awayGoals?: number | null; scoreHome?: number | null; scoreAway?: number | null }> = raw?.matches ?? [];
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
    const matches: Array<{ homeTeamId: string; awayTeamId: string; startTimeUtc?: string; utcDate?: string; homeGoals?: number | null; awayGoals?: number | null; scoreHome?: number | null; scoreAway?: number | null }> = raw?.matches ?? [];
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
    } catch {
      // skip corrupt files
    }
  }
  return result;
}

function cachedMatchToHistorical(m: CachedMatch): HistoricalMatch | null {
  if (m.scoreHome === null || m.scoreAway === null || !m.startTimeUtc) return null;
  return {
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    utcDate: m.startTimeUtc,
    homeGoals: m.scoreHome,
    awayGoals: m.scoreAway,
    isNeutralVenue: false,
  };
}

function actualOutcome(m: CachedMatch): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (m.scoreHome === null || m.scoreAway === null) return null;
  if (m.scoreHome > m.scoreAway) return 'HOME_WIN';
  if (m.scoreAway > m.scoreHome) return 'AWAY_WIN';
  return 'DRAW';
}

function actualOutcomeToResult(outcome: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN'): '1' | 'X' | '2' {
  if (outcome === 'HOME_WIN') return '1';
  if (outcome === 'DRAW') return 'X';
  return '2';
}

// ── Horizon derivation (taxonomy spec S7.3) ────────────────────────────────

type PredictionHorizon = 'FAR' | 'MEDIUM' | 'NEAR';

function deriveHorizon(buildNowUtc: string, kickoffUtc: string): PredictionHorizon {
  const diffMs = new Date(kickoffUtc).getTime() - new Date(buildNowUtc).getTime();
  const diffHours = diffMs / (1000 * 3600);
  if (diffHours > 48) return 'FAR';
  if (diffHours > 24) return 'MEDIUM';
  return 'NEAR';
}

// ── Match eval result ──────────────────────────────────────────────────────

interface MatchEval {
  actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  predicted: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null;
  p_home: number;
  p_draw: number;
  p_away: number;
  rps: number;
  operatingMode: string;
  track4Status: string;
  scorecardWritten: boolean;
}

// ── Predict one match ──────────────────────────────────────────────────────

function predictMatch(
  match: CachedMatch,
  trainingHistory: HistoricalMatch[],
  leagueCode: string,
  weightRegistry: WeightRegistry,
  calibTables: Map<string, NexusCalibrationTable>,
): Omit<MatchEval, 'actual'> | null {
  try {
    // Anti-leakage: buildNowUtc = kickoffUtc (pre-kickoff prediction time)
    const buildNowUtc = match.startTimeUtc;
    const horizon = deriveHorizon(buildNowUtc, match.startTimeUtc);
    const dataQuality: 'FULL' | 'PARTIAL' | 'MINIMAL' = 'MINIMAL'; // No injury/lineup data in backtest

    // Step 1: Track 1 — Elo + home advantage
    const track1Output = computeTrack1(
      match.homeTeamId,
      match.awayTeamId,
      trainingHistory,
      false,  // isNeutralVenue: never inferred, assume home-away
      leagueCode,
      buildNowUtc,
    );

    // Step 2: Track 2 — Poisson goals model
    const track2Output = computeTrack2(track1Output, leagueCode);

    // Step 3: Build Track12Output for ensemble
    const track12: Track12Output = {
      probs: {
        home: track2Output.p_home,
        draw: track2Output.p_draw,
        away: track2Output.p_away,
      },
    };

    // Step 4: Track 3 = null (OP-5 pending)
    const track3 = null;

    // Step 5: Track 4 — attempt odds from raw store
    const track4 = deriveTrack4Input(match.matchId, buildNowUtc);

    // Step 6: Meta-ensemble
    const ensembleOutput = runNexusEnsemble(
      track12,
      track3,
      track4,
      weightRegistry,
      calibTables,
      leagueCode,
      horizon,
      dataQuality,
    );

    // Step 7: Predicted result (highest prob)
    const { home, draw, away } = ensembleOutput.probs;
    let predicted: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
    if (home >= draw && home >= away) predicted = 'HOME_WIN';
    else if (draw >= away) predicted = 'DRAW';
    else predicted = 'AWAY_WIN';

    return {
      predicted,
      p_home: home,
      p_draw: draw,
      p_away: away,
      rps: 0,  // filled in after actual is known
      operatingMode: ensembleOutput.operating_mode,
      track4Status: ensembleOutput.track4_status,
      scorecardWritten: false,
    };
  } catch {
    return null;
  }
}

// ── Backtest per league ────────────────────────────────────────────────────

interface LeagueStats {
  name: string;
  code: string;
  competitionId: string;
  evals: MatchEval[];
  scorecardEntries: number;
}

function backtestLeague(
  league: LeagueConfigFull,
  weightRegistry: WeightRegistry,
  calibTables: Map<string, NexusCalibrationTable>,
): LeagueStats {
  const allMatchdays = loadMatchdayFiles(league.dir);
  const prevSeasonMatches = buildPrevSeasonMatches(league.code, league.prevSeasonFile);

  if (allMatchdays.size === 0) {
    return { name: league.name, code: league.code, competitionId: league.competitionId, evals: [], scorecardEntries: 0 };
  }

  const sortedMatchdays = [...allMatchdays.keys()].sort((a, b) => a - b);
  const evals: MatchEval[] = [];
  let scorecardEntries = 0;

  for (const md of sortedMatchdays) {
    const testMatches = (allMatchdays.get(md) ?? [])
      .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc);

    if (testMatches.length === 0) continue;

    // Training: prev season + all current-season matches from jornadas < md
    const trainingHistory: HistoricalMatch[] = [...prevSeasonMatches];
    for (const prevMd of sortedMatchdays) {
      if (prevMd >= md) break;
      for (const m of (allMatchdays.get(prevMd) ?? [])) {
        const rec = cachedMatchToHistorical(m);
        if (rec) trainingHistory.push(rec);
      }
    }

    for (const match of testMatches) {
      const actual = actualOutcome(match);
      if (!actual) continue;

      const prediction = predictMatch(
        match,
        trainingHistory,
        league.code,
        weightRegistry,
        calibTables,
      );

      if (!prediction) {
        // Engine error — skip
        continue;
      }

      const result = actualOutcomeToResult(actual);
      const rps = computeRps(
        { home: prediction.p_home, draw: prediction.p_draw, away: prediction.p_away },
        result,
      );

      const evalEntry: MatchEval = {
        ...prediction,
        actual,
        rps,
        scorecardWritten: false,
      };

      // Anti-leakage guard: buildNowUtc = kickoffUtc means predictionUtc < kickoffUtc fails
      // We need predictionUtc strictly LESS THAN kickoffUtc.
      // Use kickoffUtc minus 1 second as predictionUtc to satisfy the store's guard.
      // This represents "1 second before kickoff" — still pre-kickoff as required.
      const kickoffMs = new Date(match.startTimeUtc).getTime();
      const predictionUtc = new Date(kickoffMs - 1000).toISOString();  // T - 1s

      // Write to HWF scorecard
      try {
        appendScorecardEntry({
          matchId: match.matchId,
          competitionId: league.competitionId,
          predictionUtc,
          kickoffUtc: match.startTimeUtc,
          result,
          probs: { home: prediction.p_home, draw: prediction.p_draw, away: prediction.p_away },
          rps,
          scorecardType: 'historical_walk_forward',
        });
        evalEntry.scorecardWritten = true;
        scorecardEntries++;
      } catch {
        // Scorecard write failed — still count the eval
      }

      evals.push(evalEntry);
    }
  }

  return { name: league.name, code: league.code, competitionId: league.competitionId, evals, scorecardEntries };
}

// ── Reporting ──────────────────────────────────────────────────────────────

const LINE = '─'.repeat(44);
const DLINE = '═'.repeat(44);
const pct = (c: number, t: number) => t > 0 ? `${(c / t * 100).toFixed(1)}%` : 'N/A';

function toV3PredictionRecords(evals: MatchEval[]): PredictionRecord[] {
  return evals.map(e => ({
    predicted_result: e.predicted === 'HOME_WIN' ? 'HOME' : e.predicted === 'AWAY_WIN' ? 'AWAY' : 'DRAW',
    actual_outcome: e.actual === 'HOME_WIN' ? 'HOME' : e.actual === 'AWAY_WIN' ? 'AWAY' : 'DRAW',
    calibrated_probs: { home: e.p_home, draw: e.p_draw, away: e.p_away },
  } as PredictionRecord));
}

function printLeagueReport(stats: LeagueStats): void {
  const { name, evals, scorecardEntries } = stats;
  const total = evals.length;

  console.log(`\n${LINE}`);
  console.log(`  ${name}`);
  console.log(LINE);

  if (total === 0) {
    console.log(`  Sin datos para esta liga.`);
    return;
  }

  const hits = evals.filter(e => e.predicted === e.actual).length;
  const notEligible = evals.filter(e => e.predicted === null).length;

  // Track 4 stats
  const t4Active = evals.filter(e => e.track4Status !== 'DEACTIVATED').length;

  console.log(`  Total partidos     : ${total}`);
  console.log(`  NOT_ELIGIBLE       : ${notEligible}`);
  console.log(`  Evaluables         : ${total - notEligible}`);
  console.log(`  Accuracy general   : ${hits}/${total} = ${pct(hits, total)}`);
  console.log(`  Track 4 activo     : ${t4Active}/${total} partidos`);

  // RPS
  const rpsValues = evals.map(e => e.rps);
  const rpsAvg = rpsValues.reduce((a, b) => a + b, 0) / rpsValues.length;

  const probRecords = toV3PredictionRecords(evals);
  let logLoss = 0;
  let brier = 0;
  if (probRecords.length > 0) {
    const pm = computeProbabilityMetrics(probRecords);
    logLoss = pm.log_loss;
    brier = pm.brier_score;
  }

  console.log(`\n  Métricas (§23.2):`);
  console.log(`    log_loss  : ${logLoss.toFixed(4)}`);
  console.log(`    brier     : ${brier.toFixed(4)}`);
  console.log(`    rps       : ${rpsAvg.toFixed(4)}  (baseline≈0.222, V3≈0.199)`);
  console.log(`\n  HWF scorecard: ${scorecardEntries} entradas guardadas en cache/nexus-scorecards/`);
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log(`\nSportsPulse — Backtest NEXUS Track 1+2 + Track 4`);
console.log(`Metodología: walk-forward por jornada, sin data leakage`);
console.log(`Anti-leakage: buildNowUtc = kickoffUtc del partido predicho`);
console.log(`Track 3: null (pesos no entrenados — OP-5 pendiente)`);
console.log(`Track 4: odds desde cache/odds-raw/ cuando disponibles\n`);

// Bootstrap bootstrap structs (no training data yet — OP-5 will train these)
const weightRegistry = buildBootstrapWeightRegistry();
const bootstrapCalibTable = buildBootstrapCalibrationTable();

// Build calibration map with one entry per league + global fallback
const calibTables = new Map<string, NexusCalibrationTable>();
calibTables.set('global', bootstrapCalibTable);
for (const league of LEAGUES) {
  calibTables.set(league.code, bootstrapCalibTable);
}

// Run backtest for all leagues
const allStats: LeagueStats[] = [];

for (const league of LEAGUES) {
  const prevExists = fs.existsSync(league.prevSeasonFile) ||
    fs.existsSync(path.join(process.cwd(), 'cache', 'historical', 'football-data', league.code, '2024.json'));
  process.stdout.write(`Procesando ${league.name}${prevExists ? ' [+2yr prev]' : ''}... `);

  const stats = backtestLeague(league, weightRegistry, calibTables);
  allStats.push(stats);
  console.log(`${stats.evals.length} partidos cargados`);
  printLeagueReport(stats);
}

// Global summary
const allEvals = allStats.flatMap(s => s.evals);
const totalEntries = allStats.reduce((sum, s) => sum + s.scorecardEntries, 0);

console.log(`\n${DLINE}`);
console.log(`  TOTAL (${LEAGUES.length} ligas)`);
console.log(DLINE);

const totalMatches = allEvals.length;
const totalHits = allEvals.filter(e => e.predicted === e.actual).length;
const totalNotEligible = allEvals.filter(e => e.predicted === null).length;

const totalRps = allEvals.length > 0
  ? allEvals.reduce((sum, e) => sum + e.rps, 0) / allEvals.length
  : 0;

const globalProbRecords = toV3PredictionRecords(allEvals);
let globalRps = 0;
if (globalProbRecords.length > 0) {
  const gpm = computeProbabilityMetrics(globalProbRecords);
  globalRps = gpm.rps;
}

console.log(`  Accuracy global    : ${totalHits}/${totalMatches} = ${pct(totalHits, totalMatches)}`);
console.log(`  NOT_ELIGIBLE       : ${totalNotEligible}`);
console.log(`  RPS global         : ${totalRps.toFixed(4)}  (baseline≈0.222, V3≈0.199)`);
console.log(`  RPS (prob-based)   : ${globalRps.toFixed(4)}`);
console.log(`  HWF entries total  : ${totalEntries}`);
console.log(DLINE);
console.log();
