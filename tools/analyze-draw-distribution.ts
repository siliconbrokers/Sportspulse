/**
 * analyze-draw-distribution.ts — SP-DRAW-00: Diagnóstico de distribución de p_draw.
 *
 * Objetivo: analizar la distribución de p_draw post-calibración (sin DrawAffinity)
 * para determinar si hay señal estadística de empate que justifique la Solución A
 * del plan SP-DRAW-V1.
 *
 * Metodología: walk-forward idéntica a backtest-v3.ts — para cada jornada N,
 * usa partidos de jornadas 1..N-1 como training data (sin data leakage).
 *
 * Output:
 *   Consola: estadísticas de p_draw por outcome, distribución por rangos, calibración.
 *   Disco:   cache/draw-diagnostics.json
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/analyze-draw-distribution.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput, CalibrationTable } from '../packages/prediction/src/engine/v3/types.js';
import { buildOddsIndex, lookupOdds, type OddsIndex } from './odds-lookup.js';

// ── Tipos ──────────────────────────────────────────────────────────────────────

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

interface DrawSample {
  p_draw:           number;
  p_home:           number;
  p_away:           number;
  outcome:          'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  leagueCode:       string;
  favorite_margin:  number;
}

// ── Config de ligas ─────────────────────────────────────────────────────────────

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');

interface LeagueConfig {
  name:                string;
  code:                string;
  dir:                 string;
  expectedSeasonGames: number;
  prevSeasonFile:      string;
}

const LEAGUES: LeagueConfig[] = [
  { name: 'LaLiga (PD)',         code: 'PD',  dir: path.join(CACHE_BASE, 'PD',  '2025-26'), expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PD',  '2024-25', 'prev-season.json') },
  { name: 'Premier League (PL)', code: 'PL',  dir: path.join(CACHE_BASE, 'PL',  '2025-26'), expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PL',  '2024-25', 'prev-season.json') },
  { name: 'Bundesliga (BL1)',    code: 'BL1', dir: path.join(CACHE_BASE, 'BL1', '2025-26'), expectedSeasonGames: 34, prevSeasonFile: path.join(CACHE_BASE, 'BL1', '2024-25', 'prev-season.json') },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

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
    } catch { /* skip corrupt */ }
  }
  return result;
}

function toV3Record(m: CachedMatch): V3MatchRecord | null {
  if (m.scoreHome === null || m.scoreAway === null || !m.startTimeUtc) return null;
  return { homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, utcDate: m.startTimeUtc, homeGoals: m.scoreHome, awayGoals: m.scoreAway };
}

function actualOutcome(m: CachedMatch): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (m.scoreHome === null || m.scoreAway === null) return null;
  if (m.scoreHome > m.scoreAway) return 'HOME_WIN';
  if (m.scoreAway > m.scoreHome) return 'AWAY_WIN';
  return 'DRAW';
}

function loadCalibrationTable(filePath: string): CalibrationTable | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CalibrationTable; }
  catch { return undefined; }
}

function getCalibrationTable(code: string): CalibrationTable | undefined {
  const calDir = path.join(process.cwd(), 'cache', 'calibration');
  const MIXED_STRATEGY: Record<string, 'perLg' | 'global'> = { PD: 'perLg', PL: 'global', BL1: 'global' };
  if ((MIXED_STRATEGY[code] ?? 'global') === 'perLg') {
    const tbl = loadCalibrationTable(path.join(calDir, `v3-iso-calibration-${code}.json`));
    if (tbl) return tbl;
  }
  return loadCalibrationTable(path.join(calDir, 'v3-iso-calibration.json'));
}

// ── Estadísticas ────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ── Recolección de muestras walk-forward ──────────────────────────────────────

function collectSamples(oddsIndex: OddsIndex): DrawSample[] {
  const all: DrawSample[] = [];

  for (const league of LEAGUES) {
    const allMatchdays    = loadMatchdayFiles(league.dir);
    if (allMatchdays.size === 0) {
      console.log(`  [${league.code}] sin datos de jornada`);
      continue;
    }
    const prevSeasonMatches = buildPrevSeasonMatches(league.code, league.prevSeasonFile);
    const calibrationTable  = getCalibrationTable(league.code);
    const sortedMatchdays   = [...allMatchdays.keys()].sort((a, b) => a - b);

    for (const md of sortedMatchdays) {
      const testMatches = (allMatchdays.get(md) ?? [])
        .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc);
      if (testMatches.length === 0) continue;

      // Training: jornadas anteriores (anti-leakage)
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

        const oddsHit    = lookupOdds(oddsIndex, league.code, match.startTimeUtc, match.scoreHome!, match.scoreAway!);
        const marketOdds = oddsHit
          ? { probHome: oddsHit.impliedProbHome, probDraw: oddsHit.impliedProbDraw, probAway: oddsHit.impliedProbAway, capturedAtUtc: match.startTimeUtc }
          : undefined;

        const input: V3EngineInput = {
          homeTeamId:           match.homeTeamId,
          awayTeamId:           match.awayTeamId,
          kickoffUtc:           match.startTimeUtc,
          buildNowUtc:          match.startTimeUtc,
          currentSeasonMatches: trainingRecords,
          prevSeasonMatches,
          expectedSeasonGames:  league.expectedSeasonGames,
          leagueCode:           league.code,
          marketOdds,
          ...(calibrationTable ? { calibrationTable } : {}),
          // SP-DRAW-00: forzar DRAW_AFFINITY_ENABLED=false y DRAW_FLOOR_ENABLED=false
          // para obtener p_draw "honesta" — sin boost artificial de DrawAffinity.
          _overrideConstants: {
            DRAW_AFFINITY_ENABLED: false,
            DRAW_FLOOR_ENABLED:    false,
          },
        };

        try {
          const out = runV3Engine(input);
          if (out.eligibility === 'NOT_ELIGIBLE') continue;
          if (out.prob_draw === null || out.prob_home_win === null || out.prob_away_win === null) continue;

          const maxOther = Math.max(out.prob_home_win, out.prob_away_win);

          all.push({
            p_draw:          out.prob_draw,
            p_home:          out.prob_home_win,
            p_away:          out.prob_away_win,
            outcome:         actual,
            leagueCode:      league.code,
            favorite_margin: maxOther - out.prob_draw,
          });
        } catch {
          // skip engine errors
        }
      }
    }

    const leagueSamples = all.filter(s => s.leagueCode === league.code).length;
    console.log(`  [${league.code}] ${leagueSamples} muestras recolectadas`);
  }

  return all;
}

// ── Análisis ─────────────────────────────────────────────────────────────────

interface OutcomeStats {
  n:      number;
  mean:   number;
  p25:    number;
  median: number;
  p75:    number;
  p90:    number;
}

function computeStats(vals: number[]): OutcomeStats {
  const sorted = [...vals].sort((a, b) => a - b);
  return {
    n:      sorted.length,
    mean:   mean(sorted),
    p25:    percentile(sorted, 25),
    median: percentile(sorted, 50),
    p75:    percentile(sorted, 75),
    p90:    percentile(sorted, 90),
  };
}

interface RangeBucket {
  label:      string;
  lo:         number;
  hi:         number;
  n_total:    number;
  n_draw:     number;
  draw_rate:  number;   // % of bucket that ended DRAW (calibration check)
  draw_pct:   number;   // % of all real DRAWs captured in this bucket
}

interface LeagueDrawStats {
  code:             string;
  median_draw_real: number;
  median_draw_nonreal: number;
  gap:              number;
}

interface DrawDiagnostics {
  analyzed_at:   string;
  n_total:       number;
  n_draw:        number;
  n_home:        number;
  n_away:        number;
  draw_rate_real: number;
  signal_present: boolean;
  signal_gap:    number;
  stats_by_outcome: {
    DRAW:     OutcomeStats;
    HOME_WIN: OutcomeStats;
    AWAY_WIN: OutcomeStats;
  };
  range_distribution: RangeBucket[];
  per_league: LeagueDrawStats[];
  recommendation: string;
}

function analyzeSamples(samples: DrawSample[]): DrawDiagnostics {
  const byOutcome: Record<string, DrawSample[]> = {
    DRAW:     samples.filter(s => s.outcome === 'DRAW'),
    HOME_WIN: samples.filter(s => s.outcome === 'HOME_WIN'),
    AWAY_WIN: samples.filter(s => s.outcome === 'AWAY_WIN'),
  };

  const statsBy = {
    DRAW:     computeStats(byOutcome.DRAW.map(s => s.p_draw)),
    HOME_WIN: computeStats(byOutcome.HOME_WIN.map(s => s.p_draw)),
    AWAY_WIN: computeStats(byOutcome.AWAY_WIN.map(s => s.p_draw)),
  };

  // B. Separación estadística
  const medianDrawReal    = statsBy.DRAW.median;
  const medianDrawNonReal = percentile(
    [...byOutcome.HOME_WIN.map(s => s.p_draw), ...byOutcome.AWAY_WIN.map(s => s.p_draw)].sort((a, b) => a - b),
    50,
  );
  const gap = medianDrawReal - medianDrawNonReal;
  const signalPresent = gap >= 0.02;

  // C+D. Distribución por rangos y calibración
  const RANGES: Array<{ lo: number; hi: number; label: string }> = [
    { lo: 0.00, hi: 0.20, label: 'p_draw < 0.20' },
    { lo: 0.20, hi: 0.25, label: '0.20 – 0.25' },
    { lo: 0.25, hi: 0.28, label: '0.25 – 0.28' },
    { lo: 0.28, hi: 0.30, label: '0.28 – 0.30' },
    { lo: 0.30, hi: 0.33, label: '0.30 – 0.33' },
    { lo: 0.33, hi: 1.00, label: '> 0.33' },
  ];

  const totalDrawReal = byOutcome.DRAW.length;

  const rangeBuckets: RangeBucket[] = RANGES.map(r => {
    const inRange  = samples.filter(s => s.p_draw >= r.lo && s.p_draw < r.hi);
    const nDraw    = inRange.filter(s => s.outcome === 'DRAW').length;
    const nTotal   = inRange.length;
    return {
      label:     r.label,
      lo:        r.lo,
      hi:        r.hi,
      n_total:   nTotal,
      n_draw:    nDraw,
      draw_rate: nTotal > 0 ? nDraw / nTotal : 0,
      draw_pct:  totalDrawReal > 0 ? nDraw / totalDrawReal : 0,
    };
  });

  // E. Por liga
  const LEAGUE_CODES = ['PD', 'PL', 'BL1'];
  const perLeague: LeagueDrawStats[] = LEAGUE_CODES.map(code => {
    const lgSamples    = samples.filter(s => s.leagueCode === code);
    const lgDraw       = lgSamples.filter(s => s.outcome === 'DRAW').map(s => s.p_draw).sort((a, b) => a - b);
    const lgNonDraw    = lgSamples.filter(s => s.outcome !== 'DRAW').map(s => s.p_draw).sort((a, b) => a - b);
    const medDraw    = percentile(lgDraw, 50);
    const medNonDraw = percentile(lgNonDraw, 50);
    return {
      code,
      median_draw_real:    medDraw,
      median_draw_nonreal: medNonDraw,
      gap:                 medDraw - medNonDraw,
    };
  });

  // Recomendación
  let recommendation: string;
  if (signalPresent) {
    recommendation = `Señal presente (gap=${gap.toFixed(3)}pp >= 0.020). Proceder con SP-DRAW-01: crear sweep DRAW_FLOOR x DRAW_MARGIN sin DrawAffinity.`;
  } else if (gap >= 0.01) {
    recommendation = `Señal débil (gap=${gap.toFixed(3)}pp ∈ [0.010, 0.020)). Crear el sweep de todos modos — el sweep confirmará empíricamente si FLOOR/MARGIN puede encontrar un punto dulce.`;
  } else {
    recommendation = `Sin señal (gap=${gap.toFixed(3)}pp < 0.010). La calibración comprime p_draw — no hay separación entre empates reales y no-empates. Considerar saltar directamente a Solución B (features logísticas).`;
  }

  return {
    analyzed_at:   new Date().toISOString(),
    n_total:       samples.length,
    n_draw:        byOutcome.DRAW.length,
    n_home:        byOutcome.HOME_WIN.length,
    n_away:        byOutcome.AWAY_WIN.length,
    draw_rate_real: totalDrawReal / samples.length,
    signal_present: signalPresent,
    signal_gap:    gap,
    stats_by_outcome: statsBy,
    range_distribution: rangeBuckets,
    per_league:    perLeague,
    recommendation,
  };
}

// ── Formateo de consola ─────────────────────────────────────────────────────────

function printReport(d: DrawDiagnostics): void {
  const LINE = '─'.repeat(80);
  const pct  = (v: number) => (v * 100).toFixed(1) + '%';
  const fmt  = (v: number) => v.toFixed(3);

  console.log(`\n${'═'.repeat(80)}`);
  console.log('  SP-DRAW-00: Diagnóstico distribución p_draw post-calibración (sin DrawAffinity)');
  console.log('═'.repeat(80));
  console.log(`  Partidos analizados: ${d.n_total}  (DRAW: ${d.n_draw} ${pct(d.draw_rate_real)}, HOME: ${d.n_home}, AWAY: ${d.n_away})`);

  // A. Estadísticas globales por outcome
  console.log(`\n${LINE}`);
  console.log('  A. Estadísticas de p_draw por outcome real:');
  console.log(`${LINE}`);
  console.log('  Outcome       n       p25    median   p75    p90    mean');
  console.log(LINE);
  for (const [key, s] of Object.entries(d.stats_by_outcome) as Array<[string, OutcomeStats]>) {
    const label = key === 'HOME_WIN' ? 'HOME_WIN    ' : key === 'AWAY_WIN' ? 'AWAY_WIN    ' : 'DRAW        ';
    console.log(
      `  ${label} ${String(s.n).padStart(4)}    ${fmt(s.p25)}   ${fmt(s.median)}   ${fmt(s.p75)}   ${fmt(s.p90)}   ${fmt(s.mean)}`,
    );
  }

  // B. Separación estadística
  console.log(`\n${LINE}`);
  console.log('  B. Separación estadística:');
  console.log(`${LINE}`);
  console.log(`  Mediana p_draw cuando outcome=DRAW     : ${fmt(d.stats_by_outcome.DRAW.median)}`);
  console.log(`  Mediana p_draw cuando outcome!=DRAW    : ${fmt(percentile(
    [...d.range_distribution.flatMap(() => [])],
    50,
  ))}`);
  const nonDrawMedian = percentile(
    [
      ...d.stats_by_outcome.HOME_WIN ? Array(d.stats_by_outcome.HOME_WIN.n).fill(d.stats_by_outcome.HOME_WIN.median) : [],
    ].concat(
      d.stats_by_outcome.AWAY_WIN ? Array(d.stats_by_outcome.AWAY_WIN.n).fill(d.stats_by_outcome.AWAY_WIN.median) : [],
    ).sort((a, b) => a - b),
    50,
  );
  // Use the gap computed in analyzeSamples (more accurate)
  console.log(`  Mediana p_draw cuando outcome!=DRAW    : ${(d.stats_by_outcome.DRAW.median - d.signal_gap).toFixed(3)}`);
  console.log(`  Gap (DRAW − no-DRAW)                   : ${d.signal_gap.toFixed(3)} pp`);
  if (d.signal_gap >= 0.02) {
    console.log('  → SEÑAL PRESENTE: gap >= 0.020 → hay información en p_draw');
  } else if (d.signal_gap >= 0.01) {
    console.log('  → SEÑAL DÉBIL: gap in [0.010, 0.020) → señal moderada');
  } else {
    console.log('  → SIN SEÑAL: gap < 0.010 → p_draw no discrimina empates');
  }

  // C. Distribución por rangos
  console.log(`\n${LINE}`);
  console.log('  C. Distribución de p_draw en rangos:');
  console.log(`${LINE}`);
  console.log('  Rango            N_total  N_draw  Draw%_bucket  Draw%_real');
  console.log(LINE);
  for (const b of d.range_distribution) {
    console.log(
      `  ${b.label.padEnd(16)} ${String(b.n_total).padStart(7)}  ${String(b.n_draw).padStart(6)}  ${pct(b.draw_rate).padStart(12)}  ${pct(b.draw_pct).padStart(10)}`,
    );
  }

  // D. Calibración de p_draw por rango
  console.log(`\n${LINE}`);
  console.log('  D. Calibración de p_draw por rango:');
  console.log('     (si p_draw=0.30 y 30% termina en empate → bien calibrado)');
  console.log(`${LINE}`);
  for (const b of d.range_distribution) {
    if (b.n_total < 5) continue;
    const midpoint  = b.hi === 1.0 ? 0.35 : (b.lo + b.hi) / 2;
    const diff      = b.draw_rate - midpoint;
    const calibTag  = Math.abs(diff) < 0.05 ? 'BIEN CALIBRADO' : diff > 0 ? 'SOBRE-estima empates' : 'INFRA-estima empates';
    console.log(
      `  ${b.label.padEnd(16)} predict=${fmt(midpoint)} actual=${pct(b.draw_rate).padStart(7)} diff=${diff > 0 ? '+' : ''}${(diff * 100).toFixed(1)}pp  → ${calibTag}`,
    );
  }

  // E. Por liga
  console.log(`\n${LINE}`);
  console.log('  E. Señal de p_draw por liga:');
  console.log(`${LINE}`);
  console.log('  Liga   median_draw_real  median_not_draw  gap      señal');
  console.log(LINE);
  for (const l of d.per_league) {
    const tag = l.gap >= 0.02 ? 'PRESENTE' : l.gap >= 0.01 ? 'DÉBIL' : 'AUSENTE';
    console.log(
      `  ${l.code.padEnd(6)} ${fmt(l.median_draw_real).padStart(15)}  ${fmt(l.median_draw_nonreal).padStart(15)}  ${l.gap.toFixed(3).padStart(7)}  ${tag}`,
    );
  }

  // Resumen y recomendación
  console.log(`\n${'═'.repeat(80)}`);
  console.log('  DIAGNÓSTICO:');
  console.log(`  ${d.recommendation}`);
  console.log('═'.repeat(80));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\nSP-DRAW-00: Analizando distribución de p_draw...');
  console.log('DRAW_AFFINITY_ENABLED=false, DRAW_FLOOR_ENABLED=false (p_draw honesta)\n');

  // Cargar índice de odds (paridad con backtest-v3.ts)
  let oddsIndex: OddsIndex;
  try {
    oddsIndex = buildOddsIndex(['PD', 'PL', 'BL1']);
    console.log(`[ODDS] Índice cargado: ${oddsIndex.size} registros`);
  } catch {
    console.warn('[WARN] Error building odds index — proceeding without market odds');
    oddsIndex = new Map();
  }

  // Recolectar muestras
  console.log('\nRecolectando muestras walk-forward (sin data leakage)...');
  const samples = collectSamples(oddsIndex);
  console.log(`\nTotal muestras: ${samples.length}`);

  if (samples.length === 0) {
    console.error('ERROR: sin muestras — verificar que cache/football-data existe');
    process.exit(1);
  }

  // Analizar
  const diagnostics = analyzeSamples(samples);

  // Imprimir reporte
  printReport(diagnostics);

  // Guardar en disco
  const cacheDir = path.join(process.cwd(), 'cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  const outputFile = path.join(cacheDir, 'draw-diagnostics.json');
  fs.writeFileSync(outputFile, JSON.stringify(diagnostics, null, 2));
  console.log(`\nResultados guardados en: ${outputFile}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
