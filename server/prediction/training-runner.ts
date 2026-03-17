/**
 * training-runner.ts — Singleton job manager para el pipeline de entrenamiento logístico.
 *
 * Gestiona un único job a la vez: IDLE → RUNNING → COMPLETED | FAILED.
 * Spawna `tools/train-logistic.ts` via tsx como proceso hijo.
 * Captura stdout línea por línea para exponer progreso al frontend.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobStatus = 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface TrainingJob {
  status:      JobStatus;
  startedAt:   string | null;
  finishedAt:  string | null;
  durationMs:  number | null;
  exitCode:    number | null;
  lastLines:   string[];  // últimas N líneas de stdout/stderr
}

export interface CoefficientsMetadata {
  trainedAt:            string;
  trainedOnMatches:     number;
  regularizationLambda: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_LOG_LINES = 60;
const COEFFICIENTS_PATH = path.join(process.cwd(), 'cache', 'logistic-coefficients.json');
const TSX_BIN = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

// ── Singleton state ───────────────────────────────────────────────────────────

let job: TrainingJob = {
  status:     'IDLE',
  startedAt:  null,
  finishedAt: null,
  durationMs: null,
  exitCode:   null,
  lastLines:  [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pushLine(line: string): void {
  job.lastLines.push(line);
  if (job.lastLines.length > MAX_LOG_LINES) {
    job.lastLines.shift();
  }
}

export function getJob(): Readonly<TrainingJob> {
  return job;
}

export function getCoefficientsMetadata(): CoefficientsMetadata | null {
  if (!fs.existsSync(COEFFICIENTS_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(COEFFICIENTS_PATH, 'utf-8'));
    if (!raw.trained_at || !raw.trained_on_matches) return null;
    return {
      trainedAt:            raw.trained_at,
      trainedOnMatches:     raw.trained_on_matches,
      regularizationLambda: raw.regularization_lambda ?? 0.01,
    };
  } catch {
    return null;
  }
}

/**
 * Inicia el pipeline de entrenamiento si no hay un job en curso.
 * @param skipDownload  Si true, omite la descarga de odds (usa cache existente).
 * @returns true si el job fue iniciado, false si ya había uno corriendo.
 */
export function startTraining(skipDownload = true): boolean {
  if (job.status === 'RUNNING') return false;

  job = {
    status:     'RUNNING',
    startedAt:  new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    exitCode:   null,
    lastLines:  [],
  };

  const args = [
    '--tsconfig', 'tsconfig.server.json',
    'tools/train-logistic.ts',
  ];

  pushLine(`[runner] Iniciando entrenamiento (skip-download=${skipDownload})...`);
  pushLine(`[runner] tsx ${args.join(' ')}`);

  const child = spawn(TSX_BIN, args, {
    cwd:   process.cwd(),
    env:   { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(l => l.trim());
    for (const line of lines) pushLine(line);
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(l => l.trim());
    for (const line of lines) pushLine(`[stderr] ${line}`);
  });

  child.on('close', (code) => {
    const finishedAt = new Date().toISOString();
    const startMs    = new Date(job.startedAt!).getTime();
    job = {
      ...job,
      status:     code === 0 ? 'COMPLETED' : 'FAILED',
      finishedAt,
      durationMs: Date.now() - startMs,
      exitCode:   code,
    };
    pushLine(`[runner] Proceso terminado — exit code ${code} — ${finishedAt}`);
  });

  child.on('error', (err) => {
    job = {
      ...job,
      status:     'FAILED',
      finishedAt: new Date().toISOString(),
      durationMs: job.startedAt ? Date.now() - new Date(job.startedAt).getTime() : null,
      exitCode:   -1,
    };
    pushLine(`[runner] Error al iniciar proceso: ${err.message}`);
  });

  return true;
}
