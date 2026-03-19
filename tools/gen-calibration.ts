/**
 * gen-calibration.ts — Genera y valida tabla de calibración isotónica para PE v3.
 *
 * PASO 1: Walk-forward sobre 2 temporadas históricas
 *         → tuplas (p_home, p_draw, p_away, actual)
 *         - Temporada T-2: sin prevSeason → LIMITED mode
 *         - Temporada T-1: prevSeason = T-2 → ELIGIBLE mode
 *
 * PASO 2: Fit isotonic regression por clase (one-vs-rest, PAVA)
 *
 * PASO 3: Guardar tabla en cache/calibration/
 *         - Global: v3-iso-calibration[sufijo].json
 *         - Per-liga: v3-iso-calibration-{code}[sufijo].json
 *         - Con --comp: v3-iso-calibration-{slug}[sufijo].json
 *
 * PASO 4: Backtest temporada actual SIN y CON calibración → medir delta accuracy
 *
 * Flags:
 *   --ensemble   Activar ENSEMBLE_ENABLED=true durante generación de tuplas.
 *                Carga coeficientes logísticos desde cache/logistic-coefficients.json.
 *                Las tablas se guardan con sufijo -ensemble.json.
 *   --xg         Activar xG augmentation. Carga xG desde cache/xg/{leagueId}/{year}/
 *                (formato AF: cada archivo = {fixtureId, homeTeamId, awayTeamId, xgHome, xgAway, utcDate}).
 *                Las tablas se guardan con sufijo -xg.json.
 *                Requiere backfill previo: npx tsx tools/xg-backfill-af.ts
 *   --comp {id}  Procesar solo la liga especificada. Soporta:
 *                - comp:apifootball:{leagueId}  → provider AF-canonical
 *                - PD / PL / BL1               → provider football-data (compat)
 *                Genera tabla per-liga como v3-iso-calibration-{slug}.json
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/gen-calibration.ts [--ensemble] [--xg] [--comp {id}]
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput, CalibrationTable, CalibrationPoint, XgRecord } from '../packages/prediction/src/engine/v3/types.js';
import type { LogisticCoefficients } from '../packages/prediction/src/engine/v3/logistic-model.js';
import { fitIsotonicRegression, applyIsoCalibration } from '../packages/prediction/src/calibration/iso-calibrator.js';
import { COMPETITION_REGISTRY } from '../server/competition-registry.js';

// ── CLI flags ─────────────────────────────────────────────────────────────────

const USE_ENSEMBLE = process.argv.includes('--ensemble');
const USE_XG       = process.argv.includes('--xg');

const COMP_ARG: string | undefined = (() => {
  const idx = process.argv.indexOf('--comp');
  return idx !== -1 ? (process.argv[idx + 1] ?? undefined) : undefined;
})();

/** Carga coeficientes logísticos desde cache/logistic-coefficients.json. */
function loadLogisticCoefficients(): LogisticCoefficients | undefined {
  const file = path.join(process.cwd(), 'cache', 'logistic-coefficients.json');
  if (!fs.existsSync(file)) {
    console.warn('  [WARN] cache/logistic-coefficients.json no encontrado — usando DEFAULT_LOGISTIC_COEFFICIENTS');
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as LogisticCoefficients;
  } catch (err) {
    console.warn('  [WARN] Error leyendo logistic-coefficients.json:', err);
    return undefined;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface CachedMatchday {
  data?: { matches?: CachedMatch[] };
  matches?: CachedMatch[];
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

interface CalibrationTuple {
  p_home: number;
  p_draw: number;
  p_away: number;
  actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  season: string;
  leagueCode: string;
}

interface BacktestEval {
  actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  predicted: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | 'TOO_CLOSE' | null;
  eligibility: string;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
}

// ── Provider resolution ───────────────────────────────────────────────────────

type ProviderKind = 'football-data' | 'apifootball';

interface ResolvedComp {
  provider: ProviderKind;
  /** League code for football-data (e.g. PD), or string leagueId for AF */
  code: string;
  /** AF league ID (numeric) — used for xG cache */
  afLeagueId: number | undefined;
  /** Human-readable name */
  name: string;
  /** Slug for output filenames */
  slug: string;
  expectedSeasonGames: number;
  /** 'cross-year' | 'calendar' */
  seasonKind: 'cross-year' | 'calendar';
}

/** FD codes handled natively */
const FD_CODES = new Set(['PD', 'PL', 'BL1', 'SA', 'FL1']);

/** FD code → AF league ID mapping for xG lookup */
const FD_CODE_TO_AF_LEAGUE: Record<string, number> = {
  PD:  140,
  PL:  39,
  BL1: 78,
  SA:  135,
  FL1: 61,
};

/** Default expectedSeasonGames per FD code */
const FD_EXPECTED_GAMES: Record<string, number> = {
  PD: 38, PL: 38, BL1: 34, SA: 38, FL1: 34,
};

/**
 * Resolve a --comp argument into a ResolvedComp descriptor.
 * Returns null if the compId is unrecognized.
 */
function resolveComp(compId: string): ResolvedComp | null {
  // comp:apifootball:{leagueId} pattern
  const afMatch = compId.match(/^comp:apifootball:(\d+)$/);
  if (afMatch) {
    const leagueId = parseInt(afMatch[1]!, 10);
    const entry = COMPETITION_REGISTRY.find((e) => e.leagueId === leagueId);
    return {
      provider: 'apifootball',
      code: String(leagueId),
      afLeagueId: leagueId,
      name: entry?.displayName ?? `AF league ${leagueId}`,
      slug: entry?.slug ?? String(leagueId),
      expectedSeasonGames: entry?.expectedSeasonGames ?? 34,
      seasonKind: entry?.seasonKind ?? 'cross-year',
    };
  }

  // Plain FD codes: PD, PL, BL1, SA, FL1
  if (FD_CODES.has(compId)) {
    return {
      provider: 'football-data',
      code: compId,
      afLeagueId: FD_CODE_TO_AF_LEAGUE[compId],
      name: compId,
      slug: compId,
      expectedSeasonGames: FD_EXPECTED_GAMES[compId] ?? 34,
      seasonKind: 'cross-year',
    };
  }

  return null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_FD_BASE  = path.join(process.cwd(), 'cache', 'football-data');
const CACHE_AF_BASE  = path.join(process.cwd(), 'cache', 'apifootball');
const HIST_FD_BASE   = path.join(process.cwd(), 'cache', 'historical', 'football-data');
const HIST_AF_BASE   = path.join(process.cwd(), 'cache', 'historical', 'apifootball');
const XG_BASE        = path.join(process.cwd(), 'cache', 'xg');
const CAL_OUT_DIR    = path.join(process.cwd(), 'cache', 'calibration');
// With --ensemble flag: save to separate files so baseline tables are preserved.
// With --xg flag: also add '-xg' suffix so xG-aware tables don't overwrite baseline.
const CAL_SUFFIX     = [USE_ENSEMBLE ? '-ensemble' : '', USE_XG ? '-xg' : ''].join('');
const CAL_OUT_FILE   = path.join(CAL_OUT_DIR, `v3-iso-calibration${CAL_SUFFIX}.json`);

interface LeagueConfig {
  name: string;
  code: string;
  expectedSeasonGames: number;
}

// Ligas de producción — usadas para entrenar la tabla GLOBAL y sus propias tablas per-liga.
// SA y FL1 están en FD_CODE_TO_AF_LEAGUE para xG lookup, pero NO en LEAGUES:
//   añadirlas a la tabla global empeora PL/BL1 (sesgo de draw distinto). Ver SP-V4-37.
const LEAGUES: LeagueConfig[] = [
  { name: 'LaLiga (PD)',         code: 'PD',  expectedSeasonGames: 38 },
  { name: 'Premier League (PL)', code: 'PL',  expectedSeasonGames: 38 },
  { name: 'Bundesliga (BL1)',    code: 'BL1', expectedSeasonGames: 34 },
];

// ── Season enumeration ────────────────────────────────────────────────────────

/**
 * Returns an array of season labels to use as calibration history for AF-canonical.
 * For cross-year: ['2023-24', '2022-23']
 * For calendar: ['2024', '2023']
 *
 * Also attempts to detect available dirs under the cache base.
 */
function getAfSeasonLabels(leagueId: number, seasonKind: 'cross-year' | 'calendar'): string[] {
  const base = path.join(CACHE_AF_BASE, String(leagueId));
  const histBase = path.join(HIST_AF_BASE, String(leagueId));

  // Try to detect dirs from cache on disk
  const existing = new Set<string>();
  for (const dir of [base, histBase]) {
    if (fs.existsSync(dir)) {
      for (const rawEntry of fs.readdirSync(dir)) {
        const entry = rawEntry.endsWith('.json') ? rawEntry.slice(0, -5) : rawEntry;
        if (seasonKind === 'cross-year' && /^\d{4}-\d{2}$/.test(entry)) existing.add(entry);
        if (seasonKind === 'calendar' && /^\d{4}$/.test(entry)) existing.add(entry);
      }
    }
  }

  if (existing.size > 0) {
    return [...existing].sort().reverse();
  }

  // Fallback: build last 3 seasons from current year
  const now = new Date();
  const year = now.getUTCFullYear();
  if (seasonKind === 'cross-year') {
    return [
      `${year - 1}-${String(year).slice(2)}`,
      `${year - 2}-${String(year - 1).slice(2)}`,
    ];
  } else {
    return [String(year - 1), String(year - 2)];
  }
}

/**
 * For AF-canonical, return the "current" season label (the one to backtest).
 * This is the most recent season available in cache.
 */
function getCurrentAfSeasonLabel(leagueId: number, seasonKind: 'cross-year' | 'calendar'): string {
  const labels = getAfSeasonLabels(leagueId, seasonKind);
  // Current = most recent; calibration = the ones before it
  return labels[0] ?? (seasonKind === 'cross-year' ? '2025-26' : '2026');
}

// ── Data loading ──────────────────────────────────────────────────────────────

/** Load historical matches for a FD-sourced league. */
function loadHistoricalFD(code: string, year: number): V3MatchRecord[] {
  const file = path.join(HIST_FD_BASE, code, `${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return (raw?.matches as V3MatchRecord[]) ?? [];
  } catch { return []; }
}

/** Load historical matches for an AF-canonical league. */
function loadHistoricalAF(leagueId: number, seasonLabel: string): V3MatchRecord[] {
  // Try historical archive first
  const histFile = path.join(HIST_AF_BASE, String(leagueId), `${seasonLabel}.json`);
  if (fs.existsSync(histFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(histFile, 'utf-8'));
      const matches: V3MatchRecord[] = (raw?.matches as V3MatchRecord[]) ?? [];
      if (matches.length > 0) return matches;
    } catch { /* fall through */ }
  }

  // Fall back to matchday cache files
  const seasonDir = path.join(CACHE_AF_BASE, String(leagueId), seasonLabel);
  if (!fs.existsSync(seasonDir)) return [];

  const byMatchday = loadMatchdayFiles(seasonDir);
  const records: V3MatchRecord[] = [];
  for (const matches of byMatchday.values()) {
    for (const m of matches) {
      if (m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null) {
        const rec = toV3Record(m);
        if (rec) records.push(rec);
      }
    }
  }
  return records;
}

/**
 * Carga xG records desde cache/xg/{leagueId}/{year}/*.json.
 * Cada archivo tiene formato: { fixtureId, utcDate, homeTeamId, awayTeamId, xgHome, xgAway }
 * Retorna [] si no hay datos (cobertura parcial es OK).
 */
function loadXgForSeason(afLeagueId: number, year: number): XgRecord[] {
  const dir = path.join(XG_BASE, String(afLeagueId), String(year));
  if (!fs.existsSync(dir)) return [];
  const records: XgRecord[] = [];
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('fixture-list'));
    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as {
          utcDate: string;
          homeTeamId: string;
          awayTeamId: string;
          xgHome: number;
          xgAway: number;
        };
        if (raw.utcDate && raw.homeTeamId && raw.awayTeamId &&
            typeof raw.xgHome === 'number' && typeof raw.xgAway === 'number') {
          records.push({
            utcDate:    raw.utcDate,
            homeTeamId: raw.homeTeamId,
            awayTeamId: raw.awayTeamId,
            xgHome:     raw.xgHome,
            xgAway:     raw.xgAway,
          });
        }
      } catch { /* skip */ }
    }
  } catch { return []; }
  return records;
}

/** Load xG for FD-sourced league (uses AF ID for cache lookup). */
function loadXgForSeasonFD(fdCode: string, year: number): XgRecord[] {
  const afId = FD_CODE_TO_AF_LEAGUE[fdCode];
  if (afId === undefined) return [];
  return loadXgForSeason(afId, year);
}

/** Load matchday files for a given season directory. */
function loadMatchdayFiles(seasonDir: string): Map<number, CachedMatch[]> {
  const result = new Map<number, CachedMatch[]>();
  if (!fs.existsSync(seasonDir)) return result;
  const files = fs.readdirSync(seasonDir)
    .filter((f) => /^matchday-\d+\.json$/.test(f))
    .sort();
  for (const file of files) {
    const num = parseInt(file.match(/(\d+)/)?.[1] ?? '0', 10);
    if (!num) continue;
    try {
      const raw: CachedMatchday = JSON.parse(
        fs.readFileSync(path.join(seasonDir, file), 'utf-8'),
      );
      const matches: CachedMatch[] = raw?.data?.matches ?? raw?.matches ?? [];
      result.set(num, matches);
    } catch { /* skip corrupt files */ }
  }
  return result;
}

function toV3Record(m: CachedMatch): V3MatchRecord | null {
  if (m.scoreHome === null || m.scoreAway === null || !m.startTimeUtc) return null;
  return {
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    utcDate: m.startTimeUtc,
    homeGoals: m.scoreHome,
    awayGoals: m.scoreAway,
  };
}

function actualOutcome(scoreHome: number, scoreAway: number): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
  if (scoreHome > scoreAway) return 'HOME_WIN';
  if (scoreAway > scoreHome) return 'AWAY_WIN';
  return 'DRAW';
}

// ── PASO 1: Walk-forward sobre temporada histórica ────────────────────────────

interface EnsembleOverride {
  enabled: boolean;
  logisticCoefficients?: LogisticCoefficients;
}

/**
 * Genera tuplas de calibración walk-forward sobre una temporada completa.
 *
 * Para cada partido, usa solo los partidos ANTERIORES en esa temporada
 * como training (anti-lookahead estricto).
 *
 * @param seasonMatches  Todos los partidos de la temporada a evaluar
 * @param prevSeasonMatches  Temporada anterior (puede ser vacío si no hay datos)
 * @param league  Config de la liga
 * @param seasonLabel  Label para logging (ej: "2023-24")
 * @param ensembleOverride  Si se debe activar ENSEMBLE_ENABLED y con qué coeficientes
 */
function generateCalibrationTuplesForSeason(
  seasonMatches: V3MatchRecord[],
  prevSeasonMatches: V3MatchRecord[],
  league: LeagueConfig,
  seasonLabel: string,
  ensembleOverride?: EnsembleOverride,
  historicalXg?: XgRecord[],
): CalibrationTuple[] {
  if (seasonMatches.length === 0) {
    console.log(`    [WARN] Sin datos para ${league.code} ${seasonLabel}`);
    return [];
  }

  // Filtrar solo partidos con resultado (homeGoals y awayGoals definidos)
  const withResult = seasonMatches.filter(
    (m) => m.homeGoals !== undefined && m.homeGoals !== null &&
            m.awayGoals !== undefined && m.awayGoals !== null,
  );

  // Ordenar cronológicamente para walk-forward correcto
  const sorted = [...withResult].sort((a, b) => a.utcDate.localeCompare(b.utcDate));

  const tuples: CalibrationTuple[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const match = sorted[i]!;
    const actual = actualOutcome(match.homeGoals!, match.awayGoals!);

    // Training = partidos anteriores en esta temporada (anti-lookahead)
    const currentSeasonMatches = sorted.slice(0, i);

    const engineInput: V3EngineInput = {
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      kickoffUtc: match.utcDate,
      buildNowUtc: match.utcDate,
      currentSeasonMatches,
      prevSeasonMatches,
      expectedSeasonGames: league.expectedSeasonGames,
      // Calibration tuples must use pre-DrawAffinity probabilities so the
      // calibration is trained on the same space it is applied to at inference.
      _skipDrawAffinity: true,
      // xG augmentation: pass full season xG so engine can find records for
      // currentSeasonMatches (anti-lookahead is enforced by the engine itself).
      ...(historicalXg !== undefined ? { historicalXg } : {}),
      ...(ensembleOverride?.enabled === true
        ? {
            _overrideConstants: { ENSEMBLE_ENABLED: true },
            logisticCoefficients: ensembleOverride.logisticCoefficients,
          }
        : {}),
    };

    try {
      const out = runV3Engine(engineInput);
      if (
        out.eligibility !== 'NOT_ELIGIBLE' &&
        out.prob_home_win !== null &&
        out.prob_draw !== null &&
        out.prob_away_win !== null
      ) {
        tuples.push({
          p_home: out.prob_home_win,
          p_draw: out.prob_draw,
          p_away: out.prob_away_win,
          actual,
          season: seasonLabel,
          leagueCode: league.code,
        });
      }
    } catch {
      // Skip engine errors silently
    }
  }

  return tuples;
}

// ── PASO 2: Fit isotonic regression one-vs-rest ──────────────────────────────

function fitCalibrationTable(tuples: CalibrationTuple[], fittedAt: string): CalibrationTable {
  const sortedByHome = [...tuples].sort((a, b) => a.p_home - b.p_home);
  const sortedByDraw = [...tuples].sort((a, b) => a.p_draw - b.p_draw);
  const sortedByAway = [...tuples].sort((a, b) => a.p_away - b.p_away);

  const homePoints: CalibrationPoint[] = fitIsotonicRegression(
    sortedByHome.map((t) => ({ rawProb: t.p_home, isActual: t.actual === 'HOME_WIN' ? 1 : 0 })),
  );

  const drawPoints: CalibrationPoint[] = fitIsotonicRegression(
    sortedByDraw.map((t) => ({ rawProb: t.p_draw, isActual: t.actual === 'DRAW' ? 1 : 0 })),
  );

  const awayPoints: CalibrationPoint[] = fitIsotonicRegression(
    sortedByAway.map((t) => ({ rawProb: t.p_away, isActual: t.actual === 'AWAY_WIN' ? 1 : 0 })),
  );

  return {
    home: homePoints,
    draw: drawPoints,
    away: awayPoints,
    nCalibrationMatches: tuples.length,
    fittedAt,
  };
}

// ── PASO 4: Backtest season ───────────────────────────────────────────────────

/**
 * Backtest for FD-sourced leagues (uses CACHE_FD_BASE / HIST_FD_BASE).
 * Season tested = 2025-26; prevSeason = 2023 + 2024 historical.
 */
function backtestLeagueFD(
  league: LeagueConfig,
  calibrationTable?: CalibrationTable,
  ensembleOverride?: EnsembleOverride,
): BacktestEval[] {
  const seasonDir = path.join(CACHE_FD_BASE, league.code, '2025-26');
  const allMatchdays = loadMatchdayFiles(seasonDir);
  if (allMatchdays.size === 0) return [];

  const prevSeasonMatches = [
    ...loadHistoricalFD(league.code, 2023),
    ...loadHistoricalFD(league.code, 2024),
  ];

  return runBacktest(allMatchdays, prevSeasonMatches, league, calibrationTable, ensembleOverride);
}

/**
 * Backtest for AF-canonical leagues.
 * Uses the most recent season as test set, prior seasons as prevSeason.
 */
function backtestLeagueAF(
  comp: ResolvedComp,
  calibrationTable?: CalibrationTable,
  ensembleOverride?: EnsembleOverride,
): BacktestEval[] {
  const seasonLabels = getAfSeasonLabels(comp.afLeagueId!, comp.seasonKind);
  if (seasonLabels.length === 0) return [];

  const currentLabel = seasonLabels[0]!;
  const seasonDir = path.join(CACHE_AF_BASE, comp.code, currentLabel);
  const allMatchdays = loadMatchdayFiles(seasonDir);
  if (allMatchdays.size === 0) return [];

  // prevSeason = all seasons before current
  const prevSeasonMatches: V3MatchRecord[] = [];
  for (const label of seasonLabels.slice(1)) {
    prevSeasonMatches.push(...loadHistoricalAF(comp.afLeagueId!, label));
  }

  const league: LeagueConfig = {
    name: comp.name,
    code: comp.slug,
    expectedSeasonGames: comp.expectedSeasonGames,
  };
  return runBacktest(allMatchdays, prevSeasonMatches, league, calibrationTable, ensembleOverride);
}

/** Shared backtest runner used by both FD and AF paths. */
function runBacktest(
  allMatchdays: Map<number, CachedMatch[]>,
  prevSeasonMatches: V3MatchRecord[],
  league: LeagueConfig,
  calibrationTable?: CalibrationTable,
  ensembleOverride?: EnsembleOverride,
): BacktestEval[] {
  const sortedMatchdays = [...allMatchdays.keys()].sort((a, b) => a - b);
  const evals: BacktestEval[] = [];

  for (const md of sortedMatchdays) {
    const testMatches = (allMatchdays.get(md) ?? []).filter(
      (m) => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc,
    );
    if (testMatches.length === 0) continue;

    const trainingRecords: V3MatchRecord[] = [];
    for (const prevMd of sortedMatchdays) {
      if (prevMd >= md) break;
      for (const m of allMatchdays.get(prevMd) ?? []) {
        const rec = toV3Record(m);
        if (rec) trainingRecords.push(rec);
      }
    }

    for (const match of testMatches) {
      const actual = actualOutcome(match.scoreHome!, match.scoreAway!);

      const input: V3EngineInput = {
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        kickoffUtc: match.startTimeUtc,
        buildNowUtc: match.startTimeUtc,
        currentSeasonMatches: trainingRecords,
        prevSeasonMatches,
        expectedSeasonGames: league.expectedSeasonGames,
        calibrationTable,
        leagueCode: league.code,
        ...(ensembleOverride?.enabled === true
          ? {
              _overrideConstants: { ENSEMBLE_ENABLED: true },
              logisticCoefficients: ensembleOverride.logisticCoefficients,
            }
          : {}),
      };

      let predicted: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | 'TOO_CLOSE' | null = null;
      let eligibility = 'NOT_ELIGIBLE';
      let p_home: number | null = null;
      let p_draw: number | null = null;
      let p_away: number | null = null;

      try {
        const out = runV3Engine(input);
        eligibility = out.eligibility;
        p_home = out.prob_home_win;
        p_draw = out.prob_draw;
        p_away = out.prob_away_win;
        if (out.predicted_result !== null && out.predicted_result !== undefined) {
          predicted = out.predicted_result as typeof predicted;
        } else if (out.eligibility !== 'NOT_ELIGIBLE') {
          predicted = 'TOO_CLOSE';
        }
      } catch {
        eligibility = 'ERROR';
      }

      evals.push({ actual, predicted, eligibility, p_home, p_draw, p_away });
    }
  }

  return evals;
}

// ── Reporting ─────────────────────────────────────────────────────────────────

const pct = (n: number, total: number) =>
  total > 0 ? `${((n / total) * 100).toFixed(1)}%` : 'N/A';
const LINE = '─'.repeat(68);

interface AccuracyReport {
  total: number;
  evaluable: number;
  accuracy: number;
  drawRecall: number;
  drawPrecision: number;
  predictedDrawCount: number;
  actualDrawCount: number;
  homeRecall: number;
  awayRecall: number;
}

function computeAccuracy(evals: BacktestEval[]): AccuracyReport {
  const evaluable = evals.filter(
    (e) =>
      e.eligibility !== 'NOT_ELIGIBLE' &&
      e.eligibility !== 'ERROR' &&
      e.predicted !== null &&
      e.predicted !== 'TOO_CLOSE',
  );

  const hits      = evaluable.filter((e) => e.predicted === e.actual).length;
  const actualDraw  = evaluable.filter((e) => e.actual === 'DRAW').length;
  const predictedDraw = evaluable.filter((e) => e.predicted === 'DRAW').length;
  const hitDraw   = evaluable.filter((e) => e.predicted === 'DRAW' && e.actual === 'DRAW').length;
  const actualHome  = evaluable.filter((e) => e.actual === 'HOME_WIN').length;
  const hitHome   = evaluable.filter((e) => e.predicted === 'HOME_WIN' && e.actual === 'HOME_WIN').length;
  const actualAway  = evaluable.filter((e) => e.actual === 'AWAY_WIN').length;
  const hitAway   = evaluable.filter((e) => e.predicted === 'AWAY_WIN' && e.actual === 'AWAY_WIN').length;

  return {
    total: evals.length,
    evaluable: evaluable.length,
    accuracy:      evaluable.length > 0 ? hits / evaluable.length : 0,
    drawRecall:    actualDraw > 0    ? hitDraw / actualDraw : 0,
    drawPrecision: predictedDraw > 0 ? hitDraw / predictedDraw : 0,
    predictedDrawCount: predictedDraw,
    actualDrawCount: actualDraw,
    homeRecall: actualHome > 0 ? hitHome / actualHome : 0,
    awayRecall: actualAway > 0 ? hitAway / actualAway : 0,
  };
}

function printCompactReport(label: string, r: AccuracyReport): void {
  const acc  = pct(Math.round(r.accuracy * r.evaluable), r.evaluable);
  const draw = `${(r.drawRecall * 100).toFixed(1)}%`;
  const prec = `${(r.drawPrecision * 100).toFixed(1)}%`;
  const away = `${(r.awayRecall * 100).toFixed(1)}%`;
  console.log(
    `  ${label.padEnd(22)} acc=${acc.padStart(6)}  ` +
    `DRAW recall=${draw.padStart(6)}  prec=${prec.padStart(6)}  AWAY recall=${away.padStart(6)}`,
  );
}

// ── SINGLE COMP MODE ─────────────────────────────────────────────────────────

async function mainSingleComp(compArg: string): Promise<void> {
  const comp = resolveComp(compArg);
  if (!comp) {
    console.error(`\n  ERROR: No se pudo resolver --comp "${compArg}".`);
    console.error(`  Formatos válidos: comp:apifootball:{leagueId}  o  PD / PL / BL1 / SA / FL1`);
    process.exit(1);
  }

  const xgLabel   = USE_XG ? ' + xG augmentation' : '';
  const modeLabel = USE_ENSEMBLE ? 'ENSEMBLE activo' : 'Poisson puro';
  console.log(`\nSportPulse — Calibración Isotónica PE v3 — SINGLE COMP: ${comp.name} — ${modeLabel}${xgLabel}\n`);
  console.log('='.repeat(68));
  console.log(`  Provider : ${comp.provider}`);
  console.log(`  Code     : ${comp.code}`);
  console.log(`  Slug     : ${comp.slug}`);
  console.log(`  SeasonKind : ${comp.seasonKind}`);
  console.log(`  AfLeagueId : ${comp.afLeagueId ?? 'N/A'}`);
  console.log(`  ExpectedSeasonGames : ${comp.expectedSeasonGames}`);

  let ensembleOverride: EnsembleOverride | undefined;
  if (USE_ENSEMBLE) {
    const coefficients = loadLogisticCoefficients();
    ensembleOverride = { enabled: true, logisticCoefficients: coefficients };
  }

  const league: LeagueConfig = {
    name: comp.name,
    code: comp.slug,
    expectedSeasonGames: comp.expectedSeasonGames,
  };

  // ── PASO 1: Walk-forward 2 temporadas ──────────────────────────────────
  console.log('\nPASO 1: Generando tuplas de calibración (walk-forward)...\n');

  let allTuples: CalibrationTuple[] = [];

  if (comp.provider === 'football-data') {
    // FD path: same as global but for single code
    const season2324 = loadHistoricalFD(comp.code, 2023);
    const xg2324 = USE_XG ? loadXgForSeasonFD(comp.code, 2023) : undefined;
    if (USE_XG) console.log(`    [xG] 2023-24: ${xg2324?.length ?? 0} records`);
    const tuples2324 = generateCalibrationTuplesForSeason(
      season2324, [], league, '2023-24', ensembleOverride, xg2324,
    );
    console.log(`    2023-24 (sin prevSeason): ${tuples2324.length} tuplas`);

    const season2425 = loadHistoricalFD(comp.code, 2024);
    const xg2425 = USE_XG ? loadXgForSeasonFD(comp.code, 2024) : undefined;
    if (USE_XG) console.log(`    [xG] 2024-25: ${xg2425?.length ?? 0} records`);
    const tuples2425 = generateCalibrationTuplesForSeason(
      season2425, season2324, league, '2024-25', ensembleOverride, xg2425,
    );
    console.log(`    2024-25 (prevSeason=2023-24): ${tuples2425.length} tuplas`);
    allTuples = [...tuples2324, ...tuples2425];
  } else {
    // AF-canonical path
    const seasonLabels = getAfSeasonLabels(comp.afLeagueId!, comp.seasonKind);
    console.log(`    Temporadas disponibles: ${seasonLabels.join(', ')}`);

    // Use last 2 seasons for training (skip most recent, which is for backtesting)
    const trainingLabels = seasonLabels.slice(1, 3);
    for (let i = 0; i < trainingLabels.length; i++) {
      const label = trainingLabels[i]!;
      const seasonMatches = loadHistoricalAF(comp.afLeagueId!, label);
      const prevMatches = i + 1 < trainingLabels.length
        ? loadHistoricalAF(comp.afLeagueId!, trainingLabels[i + 1]!)
        : [];

      // xG: extract year from season label
      let xgRecs: XgRecord[] | undefined;
      if (USE_XG && comp.afLeagueId !== undefined) {
        const year = parseInt(label.slice(0, 4), 10);
        xgRecs = loadXgForSeason(comp.afLeagueId, year);
        console.log(`    [xG] ${label}: ${xgRecs?.length ?? 0} records`);
      }

      const prevLabel = trainingLabels[i + 1] ?? 'none';
      const tuples = generateCalibrationTuplesForSeason(
        seasonMatches, prevMatches, league, label, ensembleOverride, xgRecs,
      );
      console.log(`    ${label} (prevSeason=${prevLabel}): ${tuples.length} tuplas`);
      allTuples.push(...tuples);
    }
  }

  console.log(`\n  Total tuplas de calibración : ${allTuples.length}`);
  const byClass = {
    HOME: allTuples.filter((t) => t.actual === 'HOME_WIN').length,
    DRAW: allTuples.filter((t) => t.actual === 'DRAW').length,
    AWAY: allTuples.filter((t) => t.actual === 'AWAY_WIN').length,
  };
  console.log(`  Por clase  →  HOME: ${byClass.HOME}  DRAW: ${byClass.DRAW}  AWAY: ${byClass.AWAY}`);

  if (allTuples.length < 100) {
    console.log(`\n  [WARN] Solo ${allTuples.length} tuplas — insuficiente para calibración per-liga confiable.`);
    console.log(`         Se necesitan ≥300 para intermediate, ≥1000 para segmented.`);
    if (allTuples.length === 0) {
      console.log('  ERROR: Cero tuplas. Verifica que hay datos en cache para esta liga.');
      process.exit(1);
    }
  }

  // ── PASO 2: Fit isotonic regression ──────────────────────────────────
  console.log('\nPASO 2: Fitting isotonic regression (PAVA, one-vs-rest)...\n');
  const fittedAt = new Date().toISOString();

  let lgTable: CalibrationTable | null = null;
  if (allTuples.length >= 100) {
    lgTable = fitCalibrationTable(allTuples, fittedAt);
    console.log(`  [${comp.slug}]  HOME:${lgTable.home.length}pts  DRAW:${lgTable.draw.length}pts  AWAY:${lgTable.away.length}pts  (${allTuples.length} tuples)`);
  } else {
    console.log(`  [${comp.slug}] SKIP fit — insufficient tuples (${allTuples.length} < 100)`);
  }

  // Bias diagnosis
  if (allTuples.length > 0) {
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const n = allTuples.length;
    const avgH = avg(allTuples.map((t) => t.p_home));
    const avgD = avg(allTuples.map((t) => t.p_draw));
    const avgA = avg(allTuples.map((t) => t.p_away));
    const rH = allTuples.filter((t) => t.actual === 'HOME_WIN').length / n;
    const rD = allTuples.filter((t) => t.actual === 'DRAW').length / n;
    const rA = allTuples.filter((t) => t.actual === 'AWAY_WIN').length / n;
    const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(3);
    const interpretBias = (v: number) => {
      const a = Math.abs(v);
      if (a < 0.03) return '✓';
      if (a < 0.08) return '⚠';
      return '❌';
    };
    const bH = avgH - rH, bD = avgD - rD, bA = avgA - rA;
    console.log(`\n  Bias (pred_avg - real_rate):  [✓<0.03 pequeño  ⚠ 0.03-0.08 moderado  ❌>0.08 grande]`);
    console.log(`  ${comp.slug.padEnd(8)}  HOME:${fmt(bH)} ${interpretBias(bH)}  DRAW:${fmt(bD)} ${interpretBias(bD)}  AWAY:${fmt(bA)} ${interpretBias(bA)}`);
    console.log(`  Real rates →  HOME:${(rH*100).toFixed(1)}%  DRAW:${(rD*100).toFixed(1)}%  AWAY:${(rA*100).toFixed(1)}%`);
  }

  // ── PASO 3: Guardar tabla ──────────────────────────────────────────────
  console.log(`\nPASO 3: Guardando tabla...\n`);
  fs.mkdirSync(CAL_OUT_DIR, { recursive: true });

  if (lgTable !== null) {
    const lgFile = path.join(CAL_OUT_DIR, `v3-iso-calibration-${comp.slug}${CAL_SUFFIX}.json`);
    fs.writeFileSync(lgFile, JSON.stringify(lgTable, null, 2));
    console.log(`  [${comp.slug}] ${lgFile} (${(fs.statSync(lgFile).size / 1024).toFixed(1)} KB)`);
  }

  // ── PASO 4: Backtest ────────────────────────────────────────────────────
  console.log(`\nPASO 4: Backtest (SIN / global / per-liga)...\n`);
  console.log(LINE);

  let evalsRaw: BacktestEval[];
  let evalsGlobal: BacktestEval[];
  let evalsPerLg: BacktestEval[];

  // Load global calibration table
  const globalCalFile = path.join(CAL_OUT_DIR, `v3-iso-calibration${CAL_SUFFIX}.json`);
  const globalTable: CalibrationTable | undefined = fs.existsSync(globalCalFile)
    ? (() => { try { return JSON.parse(fs.readFileSync(globalCalFile, 'utf-8')) as CalibrationTable; } catch { return undefined; } })()
    : undefined;

  if (comp.provider === 'football-data') {
    evalsRaw    = backtestLeagueFD(league, undefined, ensembleOverride);
    evalsGlobal = backtestLeagueFD(league, globalTable, ensembleOverride);
    evalsPerLg  = lgTable ? backtestLeagueFD(league, lgTable, ensembleOverride) : evalsGlobal;
  } else {
    evalsRaw    = backtestLeagueAF(comp, undefined, ensembleOverride);
    evalsGlobal = backtestLeagueAF(comp, globalTable, ensembleOverride);
    evalsPerLg  = lgTable ? backtestLeagueAF(comp, lgTable, ensembleOverride) : evalsGlobal;
  }

  const rRaw = computeAccuracy(evalsRaw);
  const rGlb = computeAccuracy(evalsGlobal);
  const rPL  = computeAccuracy(evalsPerLg);

  // Determine test season label for context
  let testSeasonLabel = '?';
  if (comp.provider !== 'football-data' && comp.afLeagueId !== undefined) {
    const allLabels = getAfSeasonLabels(comp.afLeagueId, comp.seasonKind);
    testSeasonLabel = allLabels[0] ?? '?';
  } else {
    testSeasonLabel = '2025-26';
  }

  const noEvaluable = rRaw.evaluable === 0;
  console.log(`  ${comp.name.padEnd(30)} ${rRaw.evaluable} partidos evaluables (temporada test: ${testSeasonLabel})`);
  if (noEvaluable) {
    console.log(`\n  [BACKTEST N/A] La temporada ${testSeasonLabel} aún no tiene partidos FINISHED en caché.`);
    console.log(`  El backtest estará disponible cuando avance la temporada actual.`);
    console.log(`  La tabla de calibración se generó correctamente con datos históricos (ver bias arriba).`);
  } else {
    printCompactReport('  SIN calibración', rRaw);
    if (globalTable) printCompactReport('  CON cal global', rGlb);
    else console.log('  [INFO] Tabla global no disponible — solo per-liga');
    if (lgTable) printCompactReport(`  CON cal ${comp.slug}`, rPL);
    else console.log(`  [INFO] Sin tabla per-liga (insuficientes tuplas)`);

    const d = (a: number, b: number) => (a >= b ? '+' : '') + (a - b).toFixed(1) + 'pp';
    console.log('');
    if (globalTable && lgTable) {
      console.log(`  Per-liga vs Global: acc ${d(rPL.accuracy*100, rGlb.accuracy*100)}  DRAW recall ${d(rPL.drawRecall*100, rGlb.drawRecall*100)}`);
    }
  }
  console.log('='.repeat(68));

  // Summary metrics for calibrate-league-report.ts to parse
  console.log('\n[CALIBRATION_SUMMARY]');
  console.log(JSON.stringify({
    comp: compArg,
    slug: comp.slug,
    tuples: allTuples.length,
    hasPerLigaTable: lgTable !== null,
    hasGlobalTable: globalTable !== undefined,
    raw:    { acc: rRaw.accuracy, drawRecall: rRaw.drawRecall, evaluable: rRaw.evaluable },
    global: globalTable ? { acc: rGlb.accuracy, drawRecall: rGlb.drawRecall, evaluable: rGlb.evaluable } : null,
    perLg:  lgTable ? { acc: rPL.accuracy, drawRecall: rPL.drawRecall, evaluable: rPL.evaluable } : null,
  }));
}

// ── GLOBAL MODE (original behavior) ──────────────────────────────────────────

async function mainGlobal(): Promise<void> {
  const xgLabel      = USE_XG ? ' + xG augmentation' : '';
  const modeLabel    = USE_ENSEMBLE ? 'ENSEMBLE activo' : 'Poisson puro (ENSEMBLE_ENABLED=false)';
  console.log(`\nSportPulse — Calibración Isotónica PE v3 (2 temporadas) — ${modeLabel}${xgLabel}\n`);
  console.log('='.repeat(68));

  // Preparar ensemble override si aplica
  let ensembleOverride: EnsembleOverride | undefined;
  if (USE_ENSEMBLE) {
    const coefficients = loadLogisticCoefficients();
    ensembleOverride = { enabled: true, logisticCoefficients: coefficients };
    const trainedOn = (coefficients as { trained_on_matches?: number })?.trained_on_matches ?? '?';
    console.log(`  [ENSEMBLE] Coeficientes logísticos cargados (trained_on_matches=${trainedOn})`);
    console.log(`  [ENSEMBLE] Tablas se guardarán con sufijo '-ensemble'\n`);
  }

  // ── PASO 1: Walk-forward 2 temporadas ────────────────────────────────────
  console.log('\nPASO 1: Generando tuplas de calibración (walk-forward)...\n');

  const allTuples: CalibrationTuple[] = [];

  for (const league of LEAGUES) {
    console.log(`  ${league.name}`);

    // Temporada 2023-24: sin prevSeason (no hay 2022-23 cacheado)
    const season2324 = loadHistoricalFD(league.code, 2023);
    const xg2324 = USE_XG ? loadXgForSeasonFD(league.code, 2023) : undefined;
    if (USE_XG) console.log(`    [xG] 2023-24: ${xg2324?.length ?? 0} records`);
    const tuples2324 = generateCalibrationTuplesForSeason(
      season2324, [], league, '2023-24', ensembleOverride, xg2324,
    );
    console.log(`    2023-24 (sin prevSeason): ${tuples2324.length} tuplas`);

    // Temporada 2024-25: prevSeason = 2023-24
    const season2425 = loadHistoricalFD(league.code, 2024);
    const prevSeason2425 = loadHistoricalFD(league.code, 2023);
    const xg2425 = USE_XG ? loadXgForSeasonFD(league.code, 2024) : undefined;
    if (USE_XG) console.log(`    [xG] 2024-25: ${xg2425?.length ?? 0} records`);
    const tuples2425 = generateCalibrationTuplesForSeason(
      season2425, prevSeason2425, league, '2024-25', ensembleOverride, xg2425,
    );
    console.log(`    2024-25 (prevSeason=2023-24): ${tuples2425.length} tuplas`);

    allTuples.push(...tuples2324, ...tuples2425);
  }

  console.log(`\n  Total tuplas de calibración : ${allTuples.length}`);

  const byClass = {
    HOME: allTuples.filter((t) => t.actual === 'HOME_WIN').length,
    DRAW: allTuples.filter((t) => t.actual === 'DRAW').length,
    AWAY: allTuples.filter((t) => t.actual === 'AWAY_WIN').length,
  };
  console.log(`  Por clase  →  HOME: ${byClass.HOME}  DRAW: ${byClass.DRAW}  AWAY: ${byClass.AWAY}`);

  if (allTuples.length < 500) {
    console.log('\n  ERROR: Pocas tuplas para calibración confiable (mínimo ~500).');
    process.exit(1);
  }

  // ── PASO 2: Fit isotonic regression ──────────────────────────────────────
  console.log('\nPASO 2: Fitting isotonic regression (PAVA, one-vs-rest)...\n');

  const fittedAt = new Date().toISOString();
  const table = fitCalibrationTable(allTuples, fittedAt);

  console.log(`  [GLOBAL]  HOME:${table.home.length}pts  DRAW:${table.draw.length}pts  AWAY:${table.away.length}pts`);

  // Per-league tables
  const perLeagueTables = new Map<string, CalibrationTable>();
  for (const lg of LEAGUES) {
    const lgTuples = allTuples.filter((t) => t.leagueCode === lg.code);
    if (lgTuples.length < 100) {
      console.log(`  [${lg.code}]  SKIP — insufficient tuples (${lgTuples.length} < 100)`);
      continue;
    }
    const lgTable = fitCalibrationTable(lgTuples, fittedAt);
    perLeagueTables.set(lg.code, lgTable);
    console.log(`  [${lg.code}]   HOME:${lgTable.home.length}pts  DRAW:${lgTable.draw.length}pts  AWAY:${lgTable.away.length}pts  (${lgTuples.length} tuples)`);
  }

  // Diagnóstico: sesgo sistemático que la calibración corrige
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  function printBias(label: string, tuples: typeof allTuples): void {
    const n = tuples.length;
    if (n === 0) return;
    const avgH = avg(tuples.map((t) => t.p_home));
    const avgD = avg(tuples.map((t) => t.p_draw));
    const avgA = avg(tuples.map((t) => t.p_away));
    const rH = tuples.filter((t) => t.actual === 'HOME_WIN').length / n;
    const rD = tuples.filter((t) => t.actual === 'DRAW').length / n;
    const rA = tuples.filter((t) => t.actual === 'AWAY_WIN').length / n;
    const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(3);
    console.log(`  ${label.padEnd(8)}  HOME:${fmt(avgH-rH)}  DRAW:${fmt(avgD-rD)}  AWAY:${fmt(avgA-rA)}`);
  }

  console.log(`\n  Bias (pred_avg - real_rate):`);
  printBias('GLOBAL', allTuples);
  for (const lg of LEAGUES) {
    printBias(lg.code, allTuples.filter((t) => t.leagueCode === lg.code));
  }

  // Muestreo tabla DRAW para verificar dirección de la corrección
  if (table.draw.length > 0) {
    console.log(`\n  Muestreo tabla DRAW (8 puntos):`);
    const step = Math.max(1, Math.floor(table.draw.length / 8));
    for (let i = 0; i < table.draw.length; i += step) {
      const pt = table.draw[i]!;
      const dir = pt.calProb > pt.rawProb ? '↑' : pt.calProb < pt.rawProb ? '↓' : '=';
      console.log(`    raw=${pt.rawProb.toFixed(3)} → cal=${pt.calProb.toFixed(3)} ${dir}`);
    }
  }

  // ── PASO 3: Guardar tablas ────────────────────────────────────────────────
  console.log(`\nPASO 3: Guardando tablas...\n`);

  fs.mkdirSync(CAL_OUT_DIR, { recursive: true });

  // Global
  fs.writeFileSync(CAL_OUT_FILE, JSON.stringify(table, null, 2));
  console.log(`  [GLOBAL] ${CAL_OUT_FILE} (${(fs.statSync(CAL_OUT_FILE).size / 1024).toFixed(1)} KB)`);

  // Per-league
  for (const [code, lgTable] of perLeagueTables) {
    const lgFile = path.join(CAL_OUT_DIR, `v3-iso-calibration-${code}${CAL_SUFFIX}.json`);
    fs.writeFileSync(lgFile, JSON.stringify(lgTable, null, 2));
    console.log(`  [${code}]    ${lgFile} (${(fs.statSync(lgFile).size / 1024).toFixed(1)} KB)`);
  }

  // ── PASO 4: Backtest 2025-26 — 3 variantes ───────────────────────────────
  console.log(`\nPASO 4: Backtest 2025-26 (SIN / global / per-liga)...\n`);
  console.log(LINE);

  const allEvalsRaw: BacktestEval[] = [];
  const allEvalsGlobal: BacktestEval[] = [];
  const allEvalsPerLeague: BacktestEval[] = [];
  // Per-league eval sets (needed to build mixed strategy)
  const evalsByLeague = new Map<string, { raw: BacktestEval[]; global: BacktestEval[]; perLg: BacktestEval[] }>();

  for (const league of LEAGUES) {
    process.stdout.write(`  ${league.name.padEnd(25)} ... `);
    const evalsRaw      = backtestLeagueFD(league, undefined, ensembleOverride);
    const evalsGlobal   = backtestLeagueFD(league, table, ensembleOverride);
    const lgTable       = perLeagueTables.get(league.code);
    const evalsPerLeague = backtestLeagueFD(league, lgTable, ensembleOverride);

    allEvalsRaw.push(...evalsRaw);
    allEvalsGlobal.push(...evalsGlobal);
    allEvalsPerLeague.push(...evalsPerLeague);
    evalsByLeague.set(league.code, { raw: evalsRaw, global: evalsGlobal, perLg: evalsPerLeague });

    const rRaw = computeAccuracy(evalsRaw);
    const rGlb = computeAccuracy(evalsGlobal);
    const rPL  = computeAccuracy(evalsPerLeague);
    console.log(`${evalsRaw.length} partidos`);
    printCompactReport('  SIN cal', rRaw);
    printCompactReport('  CON cal global', rGlb);
    printCompactReport(`  CON cal ${league.code}`, rPL);
    console.log('');
  }

  // ── Estrategia mixta: elegir la mejor tabla por liga ─────────────────────
  // PD: per-league (+4.5pp acc, +6.4pp DRAW recall vs global)
  // PL: global (PL-specific bias is tiny; global cross-league correction helps more)
  // BL1: global (per-league over-corrects → 64% DRAW recall, low precision)
  const MIXED_STRATEGY: Record<string, 'perLg' | 'global'> = {
    PD: 'perLg',
    PL: 'global',
    BL1: 'global',
  };

  const allEvalsMixed: BacktestEval[] = [];
  for (const [code, sets] of evalsByLeague) {
    const strategy = MIXED_STRATEGY[code] ?? 'global';
    allEvalsMixed.push(...(strategy === 'perLg' ? sets.perLg : sets.global));
  }
  const rMixed = computeAccuracy(allEvalsMixed);

  // ── Resultado global ──────────────────────────────────────────────────────
  const rRawAll    = computeAccuracy(allEvalsRaw);
  const rGlobalAll = computeAccuracy(allEvalsGlobal);
  const rPerLgAll  = computeAccuracy(allEvalsPerLeague);

  const d = (a: number, b: number) => (a >= b ? '+' : '') + (a - b).toFixed(1) + 'pp';

  console.log('='.repeat(68));
  console.log(`  TOTAL (${LEAGUES.length} ligas, 2025-26)`);
  console.log('='.repeat(68));
  console.log(`  Nº tuplas: ${allTuples.length} global | ${[...LEAGUES].map((lg) => `${lg.code}:${allTuples.filter((t) => t.leagueCode === lg.code).length}`).join(' ')}\n`);
  printCompactReport('SIN calibración', rRawAll);
  printCompactReport('CON cal global', rGlobalAll);
  printCompactReport('CON cal per-liga', rPerLgAll);
  printCompactReport('CON cal MIXTA *', rMixed);
  const mixtaDesc = Object.entries(MIXED_STRATEGY).map(([c, s]) => `${c}=${s === 'perLg' ? 'per-liga' : 'global'}`).join(', ');
  console.log(`  * Mixta: ${mixtaDesc} (resto=global)\n`);
  console.log(`  Global vs SIN:  acc ${d(rGlobalAll.accuracy*100, rRawAll.accuracy*100)}  DRAW recall ${d(rGlobalAll.drawRecall*100, rRawAll.drawRecall*100)}  prec ${d(rGlobalAll.drawPrecision*100, rRawAll.drawPrecision*100)}`);
  console.log(`  Mixta  vs SIN:  acc ${d(rMixed.accuracy*100, rRawAll.accuracy*100)}  DRAW recall ${d(rMixed.drawRecall*100, rRawAll.drawRecall*100)}  prec ${d(rMixed.drawPrecision*100, rRawAll.drawPrecision*100)}`);
  console.log(`  Mixta  vs Glb:  acc ${d(rMixed.accuracy*100, rGlobalAll.accuracy*100)}  DRAW recall ${d(rMixed.drawRecall*100, rGlobalAll.drawRecall*100)}  prec ${d(rMixed.drawPrecision*100, rGlobalAll.drawPrecision*100)}`);
  console.log('='.repeat(68));

  // Alias for sweep section below (use mixed strategy evals)
  const allEvalsCal = allEvalsMixed;

  // ── SWEEP: encontrar FLOOR/MARGIN óptimo para espacio calibrado ───────────
  console.log('\nSWEEP — DRAW_FLOOR × DRAW_MARGIN con calibración activa\n');
  console.log(`  ${'FLOOR'.padEnd(7)} ${'MARGIN'.padEnd(8)} ${'Accuracy'.padEnd(10)} ${'DRAW recall'.padEnd(13)} ${'DRAW prec'.padEnd(11)} ${'AWAY recall'}`);
  console.log('  ' + '─'.repeat(62));

  // p_draw distribution in calibrated evals
  const calDrawProbs = allEvalsCal
    .filter((e) => e.p_draw !== null)
    .map((e) => e.p_draw as number)
    .sort((a, b) => a - b);
  const p50 = calDrawProbs[Math.floor(calDrawProbs.length * 0.5)] ?? 0;
  const p75 = calDrawProbs[Math.floor(calDrawProbs.length * 0.75)] ?? 0;
  const p90 = calDrawProbs[Math.floor(calDrawProbs.length * 0.9)] ?? 0;
  console.log(`\n  Distribución p_draw calibrado: p50=${p50.toFixed(3)} p75=${p75.toFixed(3)} p90=${p90.toFixed(3)}\n`);

  const FLOORS  = [0.20, 0.22, 0.24, 0.26, 0.28, 0.30, 0.32];
  const MARGINS = [0.06, 0.08, 0.10, 0.12, 0.15];

  // Build a helper that re-scores calibrated evals with different FLOOR/MARGIN
  function rescore(
    evals: BacktestEval[],
    floor: number,
    margin: number,
  ): AccuracyReport {
    const rescored: BacktestEval[] = evals.map((e) => {
      if (
        e.eligibility === 'NOT_ELIGIBLE' ||
        e.eligibility === 'ERROR' ||
        e.p_home === null || e.p_draw === null || e.p_away === null
      ) return e;

      // Apply floor rule on calibrated probs
      let predicted = e.predicted;
      if (e.p_draw >= floor) {
        const maxOther = Math.max(e.p_home, e.p_away);
        // TOO_CLOSE guard: if margin between top-2 is < 0.05 → null (keep as-is)
        const probs = [e.p_home, e.p_draw, e.p_away].sort((a, b) => b - a);
        const topMargin = probs[0]! - probs[1]!;
        if (topMargin >= 0.05 && maxOther - e.p_draw <= margin) {
          predicted = 'DRAW';
        }
      }
      return { ...e, predicted };
    });
    return computeAccuracy(rescored);
  }

  let bestScore = -Infinity;
  let bestConfig = { floor: 0, margin: 0 };

  for (const floor of FLOORS) {
    for (const margin of MARGINS) {
      const r = rescore(allEvalsCal, floor, margin);
      const score = r.accuracy * 0.6 + r.drawRecall * 0.4; // composite metric
      if (score > bestScore) {
        bestScore = score;
        bestConfig = { floor, margin };
      }
      const acc  = pct(Math.round(r.accuracy * r.evaluable), r.evaluable);
      const drec = `${(r.drawRecall * 100).toFixed(1)}%`;
      const dprc = `${(r.drawPrecision * 100).toFixed(1)}%`;
      const arec = `${(r.awayRecall * 100).toFixed(1)}%`;
      console.log(
        `  ${floor.toFixed(2).padEnd(7)} ${margin.toFixed(2).padEnd(8)} ${acc.padStart(8)}   ${drec.padStart(10)}   ${dprc.padStart(9)}   ${arec.padStart(9)}`
      );
    }
  }

  console.log('');
  console.log(`  Mejor config (acc×0.6 + DRAW recall×0.4): FLOOR=${bestConfig.floor} MARGIN=${bestConfig.margin}`);
  const rBest = rescore(allEvalsCal, bestConfig.floor, bestConfig.margin);
  printCompactReport('  Mejor config', rBest);
  console.log('='.repeat(68));
  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (COMP_ARG) {
    await mainSingleComp(COMP_ARG);
  } else {
    await mainGlobal();
  }
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
