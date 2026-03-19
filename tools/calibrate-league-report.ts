/**
 * calibrate-league-report.ts — Orquesta el pipeline completo de calibración
 * para una liga específica y genera un reporte con recomendación de estrategia.
 *
 * Este script es el punto de entrada del skill /calibrate-league.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/calibrate-league-report.ts \
 *     --comp {compId} [--xg] [--seasons N] [--dry-run]
 *
 * Flags:
 *   --comp {compId}   REQUERIDO. ej: comp:apifootball:262
 *   --xg              Activar xG augmentation (default: false)
 *   --seasons N       Cuántas temporadas hacia atrás para xG backfill (default: 2)
 *   --dry-run         Mostrar qué comandos correría sin ejecutarlos
 *
 * Qué hace:
 *   1. Resolver liga desde competition-registry
 *   2. Si --xg: correr xG backfill para las últimas N temporadas
 *   3. Correr gen-calibration --comp {compId} [--xg]
 *   4. Parsear [CALIBRATION_SUMMARY] del output
 *   5. Mostrar recomendación de estrategia
 *   6. Mostrar fragmento de código para calibration-selector.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { COMPETITION_REGISTRY } from '../server/competition-registry.js';

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const USE_XG  = args.includes('--xg');

const compIdx  = args.indexOf('--comp');
const COMP_ARG = compIdx !== -1 ? (args[compIdx + 1] ?? '') : '';

const seasonsIdx = args.indexOf('--seasons');
const SEASONS_N  = seasonsIdx !== -1 ? parseInt(args[seasonsIdx + 1] ?? '2', 10) : 2;

if (!COMP_ARG) {
  console.error('\nUSO: npx tsx --tsconfig tsconfig.server.json tools/calibrate-league-report.ts --comp {compId} [--xg] [--seasons N] [--dry-run]');
  console.error('Ejemplo: --comp comp:apifootball:262\n');
  process.exit(1);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface CalibrationMetrics {
  acc: number;
  drawRecall: number;
  evaluable: number;
}

interface CalibrationSummary {
  comp: string;
  slug: string;
  tuples: number;
  hasPerLigaTable: boolean;
  hasGlobalTable: boolean;
  raw:    CalibrationMetrics;
  global: CalibrationMetrics | null;
  perLg:  CalibrationMetrics | null;
}

// ── Resolve comp ──────────────────────────────────────────────────────────────

interface ResolvedLeague {
  compId: string;
  leagueId: number | null;
  slug: string;
  displayName: string;
  seasonKind: 'cross-year' | 'calendar';
  expectedSeasonGames: number;
}

function resolveLeague(compArg: string): ResolvedLeague | null {
  const afMatch = compArg.match(/^comp:apifootball:(\d+)$/);
  if (afMatch) {
    const leagueId = parseInt(afMatch[1]!, 10);
    const entry = COMPETITION_REGISTRY.find((e) => e.leagueId === leagueId);
    return {
      compId: compArg,
      leagueId,
      slug: entry?.slug ?? String(leagueId),
      displayName: entry?.displayName ?? `AF league ${leagueId}`,
      seasonKind: entry?.seasonKind ?? 'cross-year',
      expectedSeasonGames: entry?.expectedSeasonGames ?? 34,
    };
  }
  // Plain FD code
  const FD_META: Record<string, { displayName: string; expectedSeasonGames: number }> = {
    PD:  { displayName: 'LaLiga (PD)',         expectedSeasonGames: 38 },
    PL:  { displayName: 'Premier League (PL)', expectedSeasonGames: 38 },
    BL1: { displayName: 'Bundesliga (BL1)',     expectedSeasonGames: 34 },
    SA:  { displayName: 'Serie A (SA)',         expectedSeasonGames: 38 },
    FL1: { displayName: 'Ligue 1 (FL1)',        expectedSeasonGames: 34 },
  };
  if (FD_META[compArg]) {
    return {
      compId: compArg,
      leagueId: null,
      slug: compArg,
      displayName: FD_META[compArg]!.displayName,
      seasonKind: 'cross-year',
      expectedSeasonGames: FD_META[compArg]!.expectedSeasonGames,
    };
  }
  return null;
}

// ── Season labels for xG backfill ─────────────────────────────────────────────

function getBackfillSeasonYears(leagueId: number, seasonKind: 'cross-year' | 'calendar', count: number): number[] {
  const now = new Date();
  const year = now.getUTCFullYear();

  // For european leagues: AF season year = start year (2024 = 2024-25)
  // For calendar: year = calendar year (2024 = 2024 season)
  // We backfill N seasons back from the most recent COMPLETED season.
  const years: number[] = [];
  for (let i = 1; i <= count; i++) {
    years.push(year - i);
  }
  return years;
}

// ── Run subprocess ────────────────────────────────────────────────────────────

function runCmd(cmd: string, label: string): string {
  console.log(`\n${'─'.repeat(68)}`);
  console.log(`PASO: ${label}`);
  console.log(`CMD:  ${cmd}`);
  console.log('─'.repeat(68));

  if (DRY_RUN) {
    console.log('[DRY-RUN] Omitiendo ejecución');
    return '';
  }

  try {
    const output = execSync(cmd, {
      stdio: ['inherit', 'pipe', 'inherit'],
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
    process.stdout.write(output);
    return output;
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    console.error(`\n[ERROR] El comando falló con código ${error.status ?? 'desconocido'}`);
    console.error(error.message ?? String(err));
    process.exit(error.status ?? 1);
  }
}

// ── Parse calibration summary ─────────────────────────────────────────────────

function parseCalibrationSummary(output: string): CalibrationSummary | null {
  const marker = '[CALIBRATION_SUMMARY]';
  const idx = output.lastIndexOf(marker);
  if (idx === -1) return null;

  const rest = output.slice(idx + marker.length).trimStart();
  const lineEnd = rest.indexOf('\n');
  const jsonStr = lineEnd !== -1 ? rest.slice(0, lineEnd).trim() : rest.trim();

  try {
    return JSON.parse(jsonStr) as CalibrationSummary;
  } catch {
    return null;
  }
}

// ── Recommendation engine ─────────────────────────────────────────────────────

interface Recommendation {
  strategy: 'per-liga' | 'global' | 'global-only';
  reason: string;
  codeSnippet: string;
}

function buildRecommendation(summary: CalibrationSummary): Recommendation {
  const { tuples, global: gbl, perLg } = summary;

  // Not enough data for per-liga
  if (tuples < 300 || perLg === null) {
    return {
      strategy: 'global-only',
      reason: `Solo global disponible (${tuples} tuplas < 300 requerido para per-liga)`,
      codeSnippet: buildCodeSnippet(summary.slug, 'global'),
    };
  }

  // Both available — compare
  const deltaAcc = gbl !== null
    ? (perLg.acc - gbl.acc) * 100
    : 0;
  const deltaDrawRecall = gbl !== null
    ? (perLg.drawRecall - gbl.drawRecall) * 100
    : 0;

  if (gbl === null) {
    // No global table to compare
    return {
      strategy: 'per-liga',
      reason: 'No hay tabla global disponible — usando per-liga',
      codeSnippet: buildCodeSnippet(summary.slug, 'perLg'),
    };
  }

  if (tuples < 300) {
    return {
      strategy: 'global-only',
      reason: `Insuficiente histórico para per-liga (${tuples} tuplas < 300)`,
      codeSnippet: buildCodeSnippet(summary.slug, 'global'),
    };
  }

  if (deltaAcc >= 0.5 && deltaDrawRecall > -5) {
    return {
      strategy: 'per-liga',
      reason: `Per-liga mejora acc en ${deltaAcc.toFixed(1)}pp y DRAW recall en ${deltaDrawRecall.toFixed(1)}pp vs global`,
      codeSnippet: buildCodeSnippet(summary.slug, 'perLg'),
    };
  }

  if (deltaAcc >= 0.5 && deltaDrawRecall <= -5) {
    return {
      strategy: 'global',
      reason: `Per-liga mejora acc (${deltaAcc.toFixed(1)}pp) pero degrada DRAW recall en ${Math.abs(deltaDrawRecall).toFixed(1)}pp — per-liga over-corrige draws`,
      codeSnippet: buildCodeSnippet(summary.slug, 'global'),
    };
  }

  return {
    strategy: 'global',
    reason: `Ganancia insuficiente (Δacc=${deltaAcc.toFixed(1)}pp < 0.5pp) — global es suficiente`,
    codeSnippet: buildCodeSnippet(summary.slug, 'global'),
  };
}

function buildCodeSnippet(slug: string, strategy: 'perLg' | 'global'): string {
  return `// Agregar en calibration-selector.ts → MIXED_STRATEGY:
  ${slug}: '${strategy}',  // ${strategy === 'perLg' ? 'per-liga' : 'global'} (generado por calibrate-league-report)`;
}

// ── Formatting ────────────────────────────────────────────────────────────────

const SPC = '═'.repeat(68);
const LINE = '─'.repeat(68);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function printMetrics(label: string, m: CalibrationMetrics | null): void {
  if (!m) { console.log(`  ${label.padEnd(22)} N/A`); return; }
  console.log(
    `  ${label.padEnd(22)} acc=${pct(m.acc).padStart(6)}  DRAW recall=${pct(m.drawRecall).padStart(6)}  n=${m.evaluable}`
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const league = resolveLeague(COMP_ARG);
  if (!league) {
    console.error(`\n[ERROR] No se pudo resolver --comp "${COMP_ARG}"`);
    console.error('Formatos válidos: comp:apifootball:{leagueId}  o  PD / PL / BL1 / SA / FL1');
    process.exit(1);
  }

  console.log(`\n${SPC}`);
  console.log(`  SportPulse — Calibrate League Report`);
  console.log(SPC);
  console.log(`  Liga        : ${league.displayName}`);
  console.log(`  CompId      : ${league.compId}`);
  console.log(`  Slug        : ${league.slug}`);
  console.log(`  LeagueId    : ${league.leagueId ?? 'N/A (FD)'}`);
  console.log(`  SeasonKind  : ${league.seasonKind}`);
  console.log(`  ExpGames    : ${league.expectedSeasonGames}`);
  console.log(`  xG          : ${USE_XG ? 'SI (--xg)' : 'NO'}`);
  console.log(`  Seasons     : ${SEASONS_N}`);
  console.log(`  DryRun      : ${DRY_RUN ? 'SI' : 'NO'}`);
  console.log(SPC);

  const tsconfig = 'tsconfig.server.json';
  const baseCmd  = `npx tsx --tsconfig ${tsconfig}`;

  // ── PASO 1: Verify AF source availability for xG ──────────────────────────
  if (USE_XG && league.leagueId !== null) {
    const xgBase = path.join(process.cwd(), 'cache', 'xg', String(league.leagueId));
    if (fs.existsSync(xgBase)) {
      const dirs = fs.readdirSync(xgBase).filter((d) => /^\d{4}$/.test(d));
      console.log(`\n[XG] Cache existente: ${xgBase}`);
      console.log(`     Seasons disponibles: ${dirs.join(', ') || 'ninguna'}`);
    } else {
      console.log(`\n[XG] Sin cache previo para leagueId=${league.leagueId} — se creará en el backfill`);
    }

    // ── PASO 2: xG backfill ─────────────────────────────────────────────────
    const years = getBackfillSeasonYears(league.leagueId, league.seasonKind, SEASONS_N);
    for (const year of years) {
      const cmd = `${baseCmd} tools/xg-backfill-af.ts --comp ${league.leagueId} --season ${year} --resume`;
      runCmd(cmd, `xG backfill — AF leagueId=${league.leagueId}, season=${year}`);
    }
  } else if (USE_XG && league.leagueId === null) {
    // FD league: xG is resolved via FD_CODE_TO_AF_LEAGUE mapping inside gen-calibration
    console.log(`\n[XG] Liga FD (${league.slug}): xG se cargará vía FD_CODE_TO_AF_LEAGUE mapping`);
  }

  // ── PASO 3: gen-calibration ────────────────────────────────────────────────
  const xgFlag = USE_XG ? ' --xg' : '';
  const calCmd = `${baseCmd} tools/gen-calibration.ts --comp ${league.compId}${xgFlag}`;
  const calOutput = runCmd(calCmd, 'gen-calibration — generar y fitear tabla de calibración');

  // ── PASO 4: Parse summary ──────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Omitiendo análisis de resultados (no hubo output real)\n');
    console.log(SPC);
    console.log('  RECOMENDACION (simulada — requiere ejecucion real)');
    console.log(SPC);
    console.log('  Para ver la recomendacion, correr sin --dry-run');
    console.log(SPC);
    return;
  }

  const summary = parseCalibrationSummary(calOutput);

  if (!summary) {
    console.log('\n[WARN] No se encontro [CALIBRATION_SUMMARY] en el output de gen-calibration.');
    console.log('       Verifica que gen-calibration haya terminado correctamente.');
    return;
  }

  // ── PASO 5: Reporte comparativo ────────────────────────────────────────────
  console.log(`\n${SPC}`);
  console.log(`  REPORTE COMPARATIVO — ${league.displayName}`);
  console.log(SPC);
  console.log(`  Tuplas de calibración : ${summary.tuples}`);
  console.log(`  Tabla per-liga        : ${summary.hasPerLigaTable ? 'SI' : 'NO'}`);
  console.log(`  Tabla global          : ${summary.hasGlobalTable ? 'SI (cargada)' : 'NO (no disponible)'}`);
  console.log(LINE);
  printMetrics('SIN calibracion', summary.raw);
  printMetrics('CON cal global', summary.global);
  printMetrics(`CON cal ${summary.slug}`, summary.perLg);
  console.log(LINE);

  if (summary.global && summary.perLg) {
    const dAcc  = (summary.perLg.acc - summary.global.acc) * 100;
    const dDraw = (summary.perLg.drawRecall - summary.global.drawRecall) * 100;
    console.log(
      `  Per-liga vs Global: acc ${dAcc >= 0 ? '+' : ''}${dAcc.toFixed(1)}pp  ` +
      `DRAW recall ${dDraw >= 0 ? '+' : ''}${dDraw.toFixed(1)}pp`
    );
  }

  // ── PASO 6: Recomendación ──────────────────────────────────────────────────
  const rec = buildRecommendation(summary);

  console.log(`\n${SPC}`);
  console.log(`  RECOMENDACION`);
  console.log(SPC);

  const stratLabel =
    rec.strategy === 'per-liga'   ? 'RECOMENDADO: per-liga' :
    rec.strategy === 'global'     ? 'RECOMENDADO: global' :
                                    'SOLO global disponible';

  console.log(`  ${stratLabel}`);
  console.log(`  Razon: ${rec.reason}`);
  console.log(`\n  Agregar en calibration-selector.ts (MIXED_STRATEGY):`);
  console.log(`\n  ${rec.codeSnippet}`);
  console.log(`\n  Archivo generado:`);

  const calFile = path.join(
    process.cwd(), 'cache', 'calibration',
    `v3-iso-calibration-${summary.slug}${USE_XG ? '-xg' : ''}.json`
  );
  if (fs.existsSync(calFile)) {
    const sizeKB = (fs.statSync(calFile).size / 1024).toFixed(1);
    console.log(`    ${calFile} (${sizeKB} KB)`);
  } else {
    console.log(`    [WARN] Archivo no encontrado: ${calFile}`);
  }

  console.log(SPC);
}

main().catch((err) => {
  console.error('[ERROR FATAL]', err);
  process.exit(1);
});
