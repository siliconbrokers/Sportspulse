/**
 * training-route.ts — Endpoints para el Lab de Entrenamiento del modelo logístico.
 *
 * GET  /api/internal/training/status  — estado del job actual + metadata de últimos coeficientes
 * POST /api/internal/training/run     — inicia el pipeline de entrenamiento (si no corre ya)
 *
 * Gateado por PREDICTION_INTERNAL_VIEW_ENABLED (misma var que otros labs internos).
 * Cache-Control: no-store en todos los endpoints.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import {
  getJob,
  getCoefficientsMetadata,
  startTraining,
} from './training-runner.js';
import { NexusShadowReader } from './nexus-shadow-reader.js';

const COEFFICIENTS_PATH = path.join(process.cwd(), 'cache', 'logistic-coefficients.json');

function isEnabled(): boolean {
  const val = process.env.PREDICTION_INTERNAL_VIEW_ENABLED;
  return typeof val === 'string' && val.trim().length > 0;
}

export function registerTrainingRoute(app: FastifyInstance, nexusReader: NexusShadowReader): void {

  // ── GET /api/internal/training/status ──────────────────────────────────────
  app.get('/api/internal/training/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');

    if (!isEnabled()) {
      return reply.code(404).send({ error: 'Not available. Set PREDICTION_INTERNAL_VIEW_ENABLED.' });
    }

    const job  = getJob();
    const meta = getCoefficientsMetadata();

    return reply.send({
      job: {
        status:     job.status,
        startedAt:  job.startedAt,
        finishedAt: job.finishedAt,
        durationMs: job.durationMs,
        exitCode:   job.exitCode,
        lastLines:  job.lastLines,
      },
      lastCoefficients: meta
        ? {
            trainedAt:            meta.trainedAt,
            trainedOnMatches:     meta.trainedOnMatches,
            regularizationLambda: meta.regularizationLambda,
          }
        : null,
    });
  });

  // ── POST /api/internal/training/run ────────────────────────────────────────
  app.post('/api/internal/training/run', async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');

    if (!isEnabled()) {
      return reply.code(404).send({ error: 'Not available. Set PREDICTION_INTERNAL_VIEW_ENABLED.' });
    }

    const body        = (req.body ?? {}) as Record<string, unknown>;
    const skipDownload = body.skipDownload !== false; // default true

    const started = startTraining(skipDownload);

    if (!started) {
      return reply.code(409).send({ started: false, reason: 'Job already running' });
    }

    return reply.send({ started: true });
  });

  // ── GET /api/internal/training/coefficients ────────────────────────────────
  app.get('/api/internal/training/coefficients', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');

    if (!isEnabled()) {
      return reply.code(404).send({ error: 'Not available. Set PREDICTION_INTERNAL_VIEW_ENABLED.' });
    }

    if (!fs.existsSync(COEFFICIENTS_PATH)) {
      return reply.code(404).send({ error: 'No coefficients file found. Run training first.' });
    }

    try {
      const raw = fs.readFileSync(COEFFICIENTS_PATH, 'utf-8');
      return reply.header('Content-Type', 'application/json').send(raw);
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to read coefficients file.' });
    }
  });

  // ── GET /api/internal/training/nexus-info ──────────────────────────────────
  app.get('/api/internal/training/nexus-info', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');

    if (!isEnabled()) return reply.code(404).send({ error: 'Not available.' });

    const all = nexusReader.findAll();
    if (all.length === 0) {
      return reply.send({ available: false, snapshotCount: 0 });
    }

    const latest = all[0]; // findAll() returns sorted desc

    const competitionIds = [...new Set(all.map((s) => s.competition_id))];

    // Extract fields from request_payload
    const reqPayload = latest.request_payload as Record<string, unknown> | null;
    const ensembleWeights = (reqPayload?.['weights'] as Record<string, number> | undefined) ?? null;
    const featureSchemaVersion = (reqPayload?.['featureSchemaVersion'] as string | undefined) ?? null;
    const datasetWindow = (reqPayload?.['datasetWindow'] as Record<string, unknown> | undefined) ?? null;

    // Extract fields from response_payload
    const resPayload = latest.response_payload as Record<string, unknown> | null;
    const calibrationVersion = (resPayload?.['calibrationVersion'] as string | undefined) ?? null;

    return reply.send({
      available: true,
      snapshotCount: all.length,
      mostRecentAt: latest.generated_at,
      competitionIds,
      modelVersion: latest.engine_version,
      calibrationVersion,
      calibrationSource: latest.calibration_mode,
      featureSchemaVersion,
      datasetWindow,
      ensembleWeights,
    });
  });
}
