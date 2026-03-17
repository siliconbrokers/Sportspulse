/**
 * analyze-errors.ts — Diagnóstico detallado del Motor Predictivo V4.3.
 *
 * Corre el walk-forward backtest y produce:
 *   1. Matriz de confusión global
 *   2. Accuracy por liga
 *   3. Accuracy por tipo de partido (favorito claro / leve / equilibrado) usando odds
 *   4. Accuracy del mercado como benchmark (argmax de probabilidades implícitas)
 *   5. Análisis de empates
 *   6. Partidos donde modelo y mercado divergen
 *   7. Análisis por confianza (favorite_margin)
 *   8. Distribución de resultados reales vs predichos
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/analyze-errors.ts
 */

import * as fs   from 'fs';
import * as path from 'path';
import { runV3Engine }                  from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput } from '../packages/prediction/src/engine/v3/types.js';
import { buildOddsIndex, lookupOdds, type OddsIndex } from './odds-lookup.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type Outcome = 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
type Predicted = Outcome | 'TOO_CLOSE' | null;

interface MatchRecord {
  league: string;            // 'PD' | 'PL' | 'BL1'
  actual:    Outcome;
  predicted: Predicted;
  eligibility: string;
  confidence: string;
  // model probs
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  favorite_margin: number | null;
  // market probs (null if no odds found)
  m_home: number | null;
  m_draw: number | null;
  m_away: number | null;
}

// ── Cache helpers (duplicated from backtest-v3 for standalone use) ────────────

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

interface LeagueConfigFull {
  name: string;
  code: string;
  dir: string;
  expectedSeasonGames: number;
  prevSeasonFile: string;
}

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');

const LEAGUES: LeagueConfigFull[] = [
  {
    name: 'LaLiga (PD)', code: 'PD',
    dir: path.join(CACHE_BASE, 'PD', '2025-26'),
    expectedSeasonGames: 38,
    prevSeasonFile: path.join(CACHE_BASE, 'PD', '2024-25', 'prev-season.json'),
  },
  {
    name: 'Premier League (PL)', code: 'PL',
    dir: path.join(CACHE_BASE, 'PL', '2025-26'),
    expectedSeasonGames: 38,
    prevSeasonFile: path.join(CACHE_BASE, 'PL', '2024-25', 'prev-season.json'),
  },
  {
    name: 'Bundesliga (BL1)', code: 'BL1',
    dir: path.join(CACHE_BASE, 'BL1', '2025-26'),
    expectedSeasonGames: 34,
    prevSeasonFile: path.join(CACHE_BASE, 'BL1', '2024-25', 'prev-season.json'),
  },
];

function loadMatchdayFiles(dir: string): Map<number, CachedMatch[]> {
  const result = new Map<number, CachedMatch[]>();
  if (!fs.existsSync(dir)) return result;
  const files = fs.readdirSync(dir)
    .filter(f => /^matchday-\d+\.json$/.test(f))
    .sort();
  for (const file of files) {
    const num = parseInt(file.match(/(\d+)/)?.[1] ?? '0', 10);
    if (!num) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      result.set(num, raw?.data?.matches ?? []);
    } catch { /* skip */ }
  }
  return result;
}

function loadPrevSeason(file: string): V3MatchRecord[] {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))?.matches ?? [];
  } catch { return []; }
}

function loadHistoricalCache(code: string, year: number): V3MatchRecord[] {
  const file = path.join(process.cwd(), 'cache', 'historical', 'football-data', code, `${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))?.matches ?? [];
  } catch { return []; }
}

function buildPrevSeasonMatches(code: string, prevSeasonFile: string): V3MatchRecord[] {
  const fromFetch = loadPrevSeason(prevSeasonFile);
  const from2024  = loadHistoricalCache(code, 2024);
  const from2023  = loadHistoricalCache(code, 2023);
  const prev2425  = from2024.length > 0 ? from2024 : fromFetch;
  return [...from2023, ...prev2425];
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

function actualOutcome(m: CachedMatch): Outcome | null {
  if (m.scoreHome === null || m.scoreAway === null) return null;
  if (m.scoreHome > m.scoreAway)  return 'HOME_WIN';
  if (m.scoreAway > m.scoreHome)  return 'AWAY_WIN';
  return 'DRAW';
}

// ── Walk-forward per league ────────────────────────────────────────────────────

function backtestLeague(league: LeagueConfigFull, oddsIndex: OddsIndex): MatchRecord[] {
  const allMatchdays   = loadMatchdayFiles(league.dir);
  const prevSeason     = buildPrevSeasonMatches(league.code, league.prevSeasonFile);
  const sortedMatchdays = [...allMatchdays.keys()].sort((a, b) => a - b);
  const records: MatchRecord[] = [];

  for (const md of sortedMatchdays) {
    const testMatches = (allMatchdays.get(md) ?? [])
      .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc);

    if (testMatches.length === 0) continue;

    // Training: all previous matchdays
    const trainingRecords: V3MatchRecord[] = [];
    for (const prevMd of sortedMatchdays) {
      if (prevMd >= md) break;
      for (const m of (allMatchdays.get(prevMd) ?? [])) {
        const rec = toV3Record(m);
        if (rec) trainingRecords.push(rec);
      }
    }

    for (const match of testMatches) {
      const actual = actualOutcome(match);
      if (!actual) continue;

      const oddsHit = lookupOdds(oddsIndex, league.code, match.startTimeUtc, match.scoreHome!, match.scoreAway!);
      const marketOdds = oddsHit
        ? { probHome: oddsHit.impliedProbHome, probDraw: oddsHit.impliedProbDraw, probAway: oddsHit.impliedProbAway, capturedAtUtc: match.startTimeUtc }
        : undefined;

      const input: V3EngineInput = {
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        kickoffUtc: match.startTimeUtc,
        buildNowUtc: match.startTimeUtc,
        currentSeasonMatches: trainingRecords,
        prevSeasonMatches: prevSeason,
        expectedSeasonGames: league.expectedSeasonGames,
        leagueCode: league.code,
        marketOdds,
      };

      let predicted: Predicted = null;
      let eligibility = 'NOT_ELIGIBLE';
      let confidence  = 'INSUFFICIENT';
      let p_home: number | null = null;
      let p_draw: number | null = null;
      let p_away: number | null = null;
      let favorite_margin: number | null = null;

      try {
        const out = runV3Engine(input);
        eligibility = out.eligibility;
        confidence  = out.confidence;
        p_home = out.prob_home_win;
        p_draw = out.prob_draw;
        p_away = out.prob_away_win;
        favorite_margin = out.favorite_margin;

        if (out.predicted_result !== null && out.predicted_result !== undefined) {
          predicted = out.predicted_result as Outcome;
        } else if (out.eligibility !== 'NOT_ELIGIBLE') {
          predicted = 'TOO_CLOSE';
        }
      } catch {
        eligibility = 'ERROR';
      }

      records.push({
        league: league.code,
        actual,
        predicted,
        eligibility,
        confidence,
        p_home,
        p_draw,
        p_away,
        favorite_margin,
        m_home: oddsHit?.impliedProbHome ?? null,
        m_draw: oddsHit?.impliedProbDraw ?? null,
        m_away: oddsHit?.impliedProbAway ?? null,
      });
    }
  }

  return records;
}

// ── Analysis helpers ───────────────────────────────────────────────────────────

/** Partidos evaluables: elegibles + con predicción definida (no null, no TOO_CLOSE) */
function evaluable(records: MatchRecord[]): MatchRecord[] {
  return records.filter(r =>
    r.eligibility !== 'NOT_ELIGIBLE' &&
    r.eligibility !== 'ERROR' &&
    r.predicted !== null &&
    r.predicted !== 'TOO_CLOSE',
  );
}

function pct(n: number, total: number, decimals = 1): string {
  if (total === 0) return 'N/A';
  return `${(n / total * 100).toFixed(decimals)}%`;
}

const LINE  = '─'.repeat(72);
const DLINE = '═'.repeat(72);

function argmaxMarket(r: MatchRecord): Outcome | null {
  if (r.m_home === null || r.m_draw === null || r.m_away === null) return null;
  const max = Math.max(r.m_home, r.m_draw, r.m_away);
  if (max === r.m_home) return 'HOME_WIN';
  if (max === r.m_away) return 'AWAY_WIN';
  return 'DRAW';
}

// ── Section 1: Confusion matrix ───────────────────────────────────────────────

function printConfusionMatrix(ev: MatchRecord[]): void {
  const labels: Outcome[] = ['HOME_WIN', 'DRAW', 'AWAY_WIN'];
  const predLabels = ['HOME', 'DRAW', 'AWAY', 'NULL'] as const;

  // counts[actual][predicted_bucket]
  const counts: Record<Outcome, Record<string, number>> = {
    HOME_WIN: { HOME: 0, DRAW: 0, AWAY: 0, NULL: 0 },
    DRAW:     { HOME: 0, DRAW: 0, AWAY: 0, NULL: 0 },
    AWAY_WIN: { HOME: 0, DRAW: 0, AWAY: 0, NULL: 0 },
  };

  // Also include TOO_CLOSE and not-eligible as NULL for display
  const allWithActual = ev.concat(
    // Add back TOO_CLOSE and not-eligible from full set — we only have ev here
    // We'll use ev as base (evaluable), and note that TOO_CLOSE/not-eligible are separate
  );

  // Using the evaluable set (predicted is always HOME/DRAW/AWAY here, not null or TOO_CLOSE)
  for (const r of ev) {
    const bucket =
      r.predicted === 'HOME_WIN' ? 'HOME'
      : r.predicted === 'DRAW'   ? 'DRAW'
      : r.predicted === 'AWAY_WIN' ? 'AWAY'
      : 'NULL';
    counts[r.actual][bucket]++;
  }

  console.log(`\n${'─'.repeat(72)}`);
  console.log('  1. MATRIZ DE CONFUSIÓN GLOBAL (solo partidos evaluables)');
  console.log('─'.repeat(72));
  console.log(`  Predicho →   ${'HOME'.padEnd(6)} ${'DRAW'.padEnd(6)} ${'AWAY'.padEnd(6)} ${'NULL'.padEnd(6)}  | Total real`);
  for (const actual of labels) {
    const row = counts[actual];
    const total = row.HOME + row.DRAW + row.AWAY + row.NULL;
    const label = actual === 'HOME_WIN' ? 'Real HOME   ' : actual === 'DRAW' ? 'Real DRAW   ' : 'Real AWAY   ';
    const hit = actual === 'HOME_WIN' ? row.HOME : actual === 'DRAW' ? row.DRAW : row.AWAY;
    console.log(
      `  ${label} ${String(row.HOME).padStart(6)} ${String(row.DRAW).padStart(6)} ${String(row.AWAY).padStart(6)} ${String(row.NULL).padStart(6)}  | ${total}  (${pct(hit, total)} recall)`,
    );
  }

  const totalHits = ev.filter(r => r.predicted === r.actual).length;
  console.log(`\n  Accuracy global (evaluables): ${totalHits}/${ev.length} = ${pct(totalHits, ev.length)}`);
}

// ── Section 2: Accuracy por liga ─────────────────────────────────────────────

function printLeagueAccuracy(all: MatchRecord[]): void {
  console.log(`\n${LINE}`);
  console.log('  2. ACCURACY POR LIGA');
  console.log(LINE);
  const leagues = ['PD', 'PL', 'BL1'] as const;
  const leagueNames: Record<string, string> = { PD: 'LaLiga (PD)', PL: 'Premier League (PL)', BL1: 'Bundesliga (BL1)' };
  for (const lg of leagues) {
    const ev = evaluable(all.filter(r => r.league === lg));
    const hits = ev.filter(r => r.predicted === r.actual).length;
    console.log(`  ${leagueNames[lg].padEnd(24)}: ${hits}/${ev.length} = ${pct(hits, ev.length)}`);
  }
}

// ── Section 3: Accuracy por tipo de partido ───────────────────────────────────

function printAccuracyByFavoriteStrength(all: MatchRecord[]): void {
  const ev = evaluable(all);
  const withOdds = ev.filter(r => r.m_home !== null);

  console.log(`\n${LINE}`);
  console.log('  3. ACCURACY POR TIPO DE PARTIDO (según probabilidad implícita del favorito)');
  console.log(LINE);
  console.log(`  Partidos con odds disponibles: ${withOdds.length}/${ev.length} (${pct(withOdds.length, ev.length)})`);

  interface Bucket { label: string; matches: MatchRecord[]; }
  const buckets: Bucket[] = [
    { label: 'Claro favorito  (max_impl > 0.60)', matches: [] },
    { label: 'Leve favorito   (0.45–0.60)       ', matches: [] },
    { label: 'Equilibrado     (max_impl < 0.45)  ', matches: [] },
  ];

  for (const r of withOdds) {
    const maxImpl = Math.max(r.m_home!, r.m_draw!, r.m_away!);
    if (maxImpl > 0.60) buckets[0].matches.push(r);
    else if (maxImpl >= 0.45) buckets[1].matches.push(r);
    else buckets[2].matches.push(r);
  }

  for (const b of buckets) {
    const hits = b.matches.filter(r => r.predicted === r.actual).length;
    const n    = b.matches.length;
    console.log(`  ${b.label}: ${hits}/${n} = ${pct(hits, n)}`);
  }
}

// ── Section 4: Market benchmark ───────────────────────────────────────────────

function printMarketBenchmark(all: MatchRecord[]): void {
  const ev = evaluable(all);
  const withOdds = ev.filter(r => r.m_home !== null);

  console.log(`\n${LINE}`);
  console.log('  4. ACCURACY DEL MERCADO COMO BENCHMARK (argmax implícitas)');
  console.log(LINE);

  const marketHits = withOdds.filter(r => argmaxMarket(r) === r.actual).length;
  const modelHitsOnSameSet = withOdds.filter(r => r.predicted === r.actual).length;

  console.log(`  Partidos con odds: ${withOdds.length}`);
  console.log(`  Accuracy mercado (argmax): ${marketHits}/${withOdds.length} = ${pct(marketHits, withOdds.length)}`);
  console.log(`  Accuracy modelo  (mismo subset): ${modelHitsOnSameSet}/${withOdds.length} = ${pct(modelHitsOnSameSet, withOdds.length)}`);
  const diff = withOdds.length > 0
    ? ((modelHitsOnSameSet - marketHits) / withOdds.length * 100).toFixed(1)
    : 'N/A';
  console.log(`  Diferencia modelo − mercado: ${diff}pp`);

  // Per outcome
  console.log(`\n  Por resultado real:`);
  for (const outcome of ['HOME_WIN', 'DRAW', 'AWAY_WIN'] as const) {
    const sub = withOdds.filter(r => r.actual === outcome);
    const mktHits = sub.filter(r => argmaxMarket(r) === outcome).length;
    const mdlHits = sub.filter(r => r.predicted === outcome).length;
    const label = outcome === 'HOME_WIN' ? 'HOME' : outcome === 'DRAW' ? 'DRAW' : 'AWAY';
    console.log(`    ${label.padEnd(6)}: mercado ${pct(mktHits, sub.length).padStart(6)}, modelo ${pct(mdlHits, sub.length).padStart(6)}  (n=${sub.length})`);
  }
}

// ── Section 5: Draw analysis ──────────────────────────────────────────────────

function printDrawAnalysis(all: MatchRecord[]): void {
  const ev = evaluable(all);
  const withOdds = ev.filter(r => r.m_home !== null);

  const actualDraws   = ev.filter(r => r.actual === 'DRAW').length;
  const modelDraws    = ev.filter(r => r.predicted === 'DRAW').length;
  const mktDraws      = withOdds.filter(r => argmaxMarket(r) === 'DRAW').length;
  const modelDrawHits = ev.filter(r => r.predicted === 'DRAW' && r.actual === 'DRAW').length;

  console.log(`\n${LINE}`);
  console.log('  5. ANÁLISIS DE EMPATES');
  console.log(LINE);
  console.log(`  Empates reales (frecuencia base)     : ${actualDraws}/${ev.length} = ${pct(actualDraws, ev.length)}`);
  console.log(`  Empates predichos por el modelo      : ${modelDraws}/${ev.length} = ${pct(modelDraws, ev.length)}`);
  console.log(`  Empates predichos por el mercado     : ${mktDraws}/${withOdds.length} = ${pct(mktDraws, withOdds.length)}`);
  console.log(`  DRAW recall (modelo)                 : ${modelDrawHits}/${actualDraws} = ${pct(modelDrawHits, actualDraws)}`);
  if (modelDraws > 0) {
    const precision = modelDrawHits / modelDraws;
    console.log(`  DRAW precision (modelo)              : ${modelDrawHits}/${modelDraws} = ${pct(modelDrawHits, modelDraws)}`);
  }

  // When model predicts DRAW correctly vs incorrectly — compare market implied draw prob
  const modelPredictsDraw = ev.filter(r => r.predicted === 'DRAW' && r.m_draw !== null);
  const drawCorrect   = modelPredictsDraw.filter(r => r.actual === 'DRAW');
  const drawIncorrect = modelPredictsDraw.filter(r => r.actual !== 'DRAW');

  if (modelPredictsDraw.length > 0) {
    const avgMktDrawCorrect   = drawCorrect.length   > 0 ? drawCorrect.reduce((s, r) => s + r.m_draw!, 0)   / drawCorrect.length   : NaN;
    const avgMktDrawIncorrect = drawIncorrect.length > 0 ? drawIncorrect.reduce((s, r) => s + r.m_draw!, 0) / drawIncorrect.length : NaN;

    console.log(`\n  Cuando modelo predice DRAW (con odds, n=${modelPredictsDraw.length}):`);
    console.log(`    Correcto   (n=${drawCorrect.length}): avg mercado p_draw = ${isNaN(avgMktDrawCorrect) ? 'N/A' : avgMktDrawCorrect.toFixed(3)}`);
    console.log(`    Incorrecto (n=${drawIncorrect.length}): avg mercado p_draw = ${isNaN(avgMktDrawIncorrect) ? 'N/A' : avgMktDrawIncorrect.toFixed(3)}`);
  }

  // Distribución de p_draw del modelo
  const withPDraw = ev.filter(r => r.p_draw !== null);
  if (withPDraw.length > 0) {
    const pDrawVals  = withPDraw.map(r => r.p_draw!);
    const avgPDraw   = pDrawVals.reduce((a, b) => a + b, 0) / pDrawVals.length;
    const maxPDraw   = Math.max(...pDrawVals);
    const over30     = pDrawVals.filter(v => v >= 0.30).length;
    const over35     = pDrawVals.filter(v => v >= 0.35).length;
    console.log(`\n  Distribución p_draw modelo (evaluables, n=${withPDraw.length}):`);
    console.log(`    Promedio   : ${avgPDraw.toFixed(3)}`);
    console.log(`    Máximo     : ${maxPDraw.toFixed(3)}`);
    console.log(`    p_draw ≥ 0.30: ${over30} partidos (${pct(over30, withPDraw.length)})`);
    console.log(`    p_draw ≥ 0.35: ${over35} partidos (${pct(over35, withPDraw.length)})`);
  }
}

// ── Section 6: Model vs market divergence ─────────────────────────────────────

function printModelVsMarketDivergence(all: MatchRecord[]): void {
  const ev = evaluable(all);
  const withOdds = ev.filter(r => r.m_home !== null);

  const divergent = withOdds.filter(r => {
    const mkt = argmaxMarket(r);
    return mkt !== null && r.predicted !== mkt;
  });
  const convergent = withOdds.filter(r => {
    const mkt = argmaxMarket(r);
    return mkt !== null && r.predicted === mkt;
  });

  console.log(`\n${LINE}`);
  console.log('  6. PARTIDOS DONDE MODELO Y MERCADO DIVERGEN');
  console.log(LINE);
  console.log(`  Total con odds       : ${withOdds.length}`);
  console.log(`  Convergentes         : ${convergent.length} (${pct(convergent.length, withOdds.length)})`);
  console.log(`  Divergentes          : ${divergent.length} (${pct(divergent.length, withOdds.length)})`);

  if (divergent.length > 0) {
    const divModelHits = divergent.filter(r => r.predicted === r.actual).length;
    const divMktHits   = divergent.filter(r => argmaxMarket(r) === r.actual).length;
    const convHits     = convergent.filter(r => r.predicted === r.actual).length;

    console.log(`\n  En partidos DIVERGENTES:`);
    console.log(`    Accuracy modelo  : ${divModelHits}/${divergent.length} = ${pct(divModelHits, divergent.length)}`);
    console.log(`    Accuracy mercado : ${divMktHits}/${divergent.length} = ${pct(divMktHits, divergent.length)}`);
    console.log(`\n  En partidos CONVERGENTES:`);
    console.log(`    Accuracy         : ${convHits}/${convergent.length} = ${pct(convHits, convergent.length)}`);

    // Breakdown divergente por tipo de discrepancia
    type DiscType = string;
    const discTypes: Record<DiscType, number> = {};
    for (const r of divergent) {
      const mkt = argmaxMarket(r)!;
      const key = `${r.predicted?.replace('_WIN','') ?? 'NULL'} vs ${mkt.replace('_WIN','')}`;
      discTypes[key] = (discTypes[key] ?? 0) + 1;
    }
    console.log(`\n  Tipos de divergencia (modelo vs mercado):`);
    for (const [k, v] of Object.entries(discTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(24)}: ${v}`);
    }
  }
}

// ── Section 7: Accuracy by confidence (favorite_margin) ──────────────────────

function printConfidenceAnalysis(all: MatchRecord[]): void {
  const ev = evaluable(all).filter(r => r.favorite_margin !== null);

  console.log(`\n${LINE}`);
  console.log('  7. ANÁLISIS POR CONFIANZA (favorite_margin)');
  console.log(LINE);

  if (ev.length === 0) {
    console.log('  Sin datos de favorite_margin.');
    return;
  }

  // Sort by margin ascending
  const sorted = [...ev].sort((a, b) => a.favorite_margin! - b.favorite_margin!);
  const n = sorted.length;
  const q25 = Math.floor(n * 0.25);
  const q75 = Math.floor(n * 0.75);

  const bottom25 = sorted.slice(0, q25);
  const middle50 = sorted.slice(q25, q75);
  const top25    = sorted.slice(q75);

  const hitsBottom = bottom25.filter(r => r.predicted === r.actual).length;
  const hitsMiddle = middle50.filter(r => r.predicted === r.actual).length;
  const hitsTop    = top25.filter(r => r.predicted === r.actual).length;

  const avgBottom = bottom25.length > 0 ? bottom25.reduce((s, r) => s + r.favorite_margin!, 0) / bottom25.length : 0;
  const avgMiddle = middle50.length > 0 ? middle50.reduce((s, r) => s + r.favorite_margin!, 0) / middle50.length : 0;
  const avgTop    = top25.length > 0    ? top25.reduce((s, r) => s + r.favorite_margin!, 0)    / top25.length    : 0;

  console.log(`  Partidos con favorite_margin: ${ev.length}`);
  console.log(`\n  Cuartil de confianza           n    accuracy   avg_margin`);
  console.log(`  BOTTOM 25% (menos confiados)  ${String(bottom25.length).padStart(4)}    ${pct(hitsBottom, bottom25.length).padStart(7)}    ${avgBottom.toFixed(3)}`);
  console.log(`  MIDDLE 50%                    ${String(middle50.length).padStart(4)}    ${pct(hitsMiddle, middle50.length).padStart(7)}    ${avgMiddle.toFixed(3)}`);
  console.log(`  TOP 25% (más confiados)       ${String(top25.length).padStart(4)}    ${pct(hitsTop, top25.length).padStart(7)}    ${avgTop.toFixed(3)}`);

  // Threshold sweep: is there a margin cutoff that improves accuracy?
  const thresholds = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
  console.log(`\n  Efecto de umbral de corte (solo predecir si margin >= threshold):`);
  console.log(`  threshold   n_above   accuracy_above   n_below   accuracy_below`);
  for (const t of thresholds) {
    const above = ev.filter(r => r.favorite_margin! >= t);
    const below = ev.filter(r => r.favorite_margin! <  t);
    const hAbove = above.filter(r => r.predicted === r.actual).length;
    const hBelow = below.filter(r => r.predicted === r.actual).length;
    console.log(
      `  ${String(t.toFixed(2)).padStart(9)}   ${String(above.length).padStart(7)}   ${pct(hAbove, above.length).padStart(15)}   ${String(below.length).padStart(7)}   ${pct(hBelow, below.length)}`
    );
  }
}

// ── Section 8: Distribution of results ───────────────────────────────────────

function printDistribution(all: MatchRecord[]): void {
  const ev    = evaluable(all);
  const total = all.length;

  const realHome = ev.filter(r => r.actual === 'HOME_WIN').length;
  const realDraw = ev.filter(r => r.actual === 'DRAW').length;
  const realAway = ev.filter(r => r.actual === 'AWAY_WIN').length;

  const predHome = ev.filter(r => r.predicted === 'HOME_WIN').length;
  const predDraw = ev.filter(r => r.predicted === 'DRAW').length;
  const predAway = ev.filter(r => r.predicted === 'AWAY_WIN').length;

  const tooClose  = all.filter(r => r.predicted === 'TOO_CLOSE').length;
  const notElig   = all.filter(r => r.eligibility === 'NOT_ELIGIBLE' || r.eligibility === 'ERROR').length;
  const nullPred  = tooClose + notElig;

  console.log(`\n${LINE}`);
  console.log('  8. DISTRIBUCIÓN DE RESULTADOS REALES vs PREDICHOS');
  console.log(LINE);
  console.log(`  Total partidos en dataset  : ${total}`);
  console.log(`  NOT_ELIGIBLE / ERROR       : ${notElig} (${pct(notElig, total)})`);
  console.log(`  TOO_CLOSE                  : ${tooClose} (${pct(tooClose, total)})`);
  console.log(`  Evaluables                 : ${ev.length} (${pct(ev.length, total)})`);
  console.log(`\n  ${'Resultado'.padEnd(12)} ${'Real'.padStart(8)} ${'Predicho'.padStart(10)}`);
  console.log(`  ${'HOME_WIN'.padEnd(12)} ${pct(realHome, ev.length).padStart(8)} ${pct(predHome, ev.length).padStart(10)}`);
  console.log(`  ${'DRAW'.padEnd(12)} ${pct(realDraw, ev.length).padStart(8)} ${pct(predDraw, ev.length).padStart(10)}`);
  console.log(`  ${'AWAY_WIN'.padEnd(12)} ${pct(realAway, ev.length).padStart(8)} ${pct(predAway, ev.length).padStart(10)}`);
  console.log(`  ${'NULL/SKIP'.padEnd(12)} ${'—'.padStart(8)} ${pct(nullPred, total).padStart(10)}`);

  // Sesgo sistemático: ¿cuánto sobreestima o subestima el modelo cada clase?
  console.log(`\n  Sesgo sistemático (predicho − real):`);
  console.log(`    HOME: ${((predHome / ev.length - realHome / ev.length) * 100).toFixed(1)}pp`);
  console.log(`    DRAW: ${((predDraw / ev.length - realDraw / ev.length) * 100).toFixed(1)}pp`);
  console.log(`    AWAY: ${((predAway / ev.length - realAway / ev.length) * 100).toFixed(1)}pp`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nSportsPulse — Diagnóstico de errores Motor PE v4.3`);
console.log(`Metodología: walk-forward sin data leakage, 3 ligas 2025-26\n`);

const oddsIndex = buildOddsIndex(['PD', 'PL', 'BL1']);
console.log(`[ODDS] Índice cargado: ${oddsIndex.size} registros\n`);

const allRecords: MatchRecord[] = [];

for (const league of LEAGUES) {
  process.stdout.write(`Procesando ${league.name}... `);
  const records = backtestLeague(league, oddsIndex);
  allRecords.push(...records);
  const ev = evaluable(records);
  const hits = ev.filter(r => r.predicted === r.actual).length;
  console.log(`${records.length} partidos | evaluables: ${ev.length} | accuracy: ${pct(hits, ev.length)}`);
}

const ev = evaluable(allRecords);
const hits = ev.filter(r => r.predicted === r.actual).length;

console.log(`\n${DLINE}`);
console.log(`  RESUMEN: ${allRecords.length} partidos totales | ${ev.length} evaluables | Accuracy: ${pct(hits, ev.length)}`);
console.log(DLINE);

// Run all analysis sections
printConfusionMatrix(ev);
printLeagueAccuracy(allRecords);
printAccuracyByFavoriteStrength(allRecords);
printMarketBenchmark(allRecords);
printDrawAnalysis(allRecords);
printModelVsMarketDivergence(allRecords);
printConfidenceAnalysis(allRecords);
printDistribution(allRecords);

console.log(`\n${DLINE}\n`);
