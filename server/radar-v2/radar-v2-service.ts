/**
 * Radar SportPulse v2 — Service Orchestrator
 * Spec: spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md §10, §11
 *
 * Orchestrates the full v2 lifecycle: build -> live refresh -> post-match resolve.
 * NO predictor integration. NO PredictionStore. NO V3PredictionOutput.
 */

import type { DataSource } from '@sportpulse/snapshot';
import type {
  RadarV2Snapshot,
  RadarV2DataQuality,
  RadarV2EvidenceTier,
} from './radar-v2-types.js';
import type { PredictionFetcher } from './radar-v2-prediction-fetcher.js';
import {
  RADAR_V2_SCHEMA_VERSION,
  RADAR_V2_GENERATOR_VERSION,
} from './radar-v2-types.js';
import { evaluateV2Candidates } from './radar-v2-candidate-evaluator.js';
import { resolveV2Cards } from './radar-v2-card-resolver.js';
import { validateSnapshot } from './radar-v2-validator.js';
import { writeV2Snapshot, updateV2SnapshotVerdicts } from './radar-v2-snapshot-writer.js';
import { readV2Snapshot } from './radar-v2-snapshot-reader.js';
import { radarV2ScopeDir } from './radar-v2-snapshot-writer.js';
import { resolveEvidenceTier } from '../radar/radar-evidence-tier.js';
import { resolveV2Verdict, supportsV2Verdict } from './radar-v2-verdict-resolver.js';

export interface BuildRadarV2Input {
  competitionKey: string;
  seasonKey: string;
  matchday: number;
  competitionId: string;
  dataSource: DataSource;
  buildNowUtc: string;
  force?: boolean;
  /** Fetcher opcional del motor predictivo. null → predictionContext = null en todas las cards. */
  predictionFetcher?: PredictionFetcher | null;
}

/**
 * Builds or retrieves the v2 Radar snapshot for a given scope.
 */
export async function buildOrGetV2Snapshot(
  input: BuildRadarV2Input,
): Promise<RadarV2Snapshot | null> {
  const { competitionKey, seasonKey, matchday, competitionId, dataSource, buildNowUtc, force } = input;

  // Return existing snapshot unless force rebuild
  if (!force) {
    const { snapshot, corrupt } = await readV2Snapshot(competitionKey, seasonKey, matchday);
    if (snapshot && !corrupt) {
      return snapshot;
    }
    if (corrupt) {
      console.error(`[RadarV2Service] Corrupt snapshot for ${competitionKey}:${matchday}, rebuilding`);
    }
  }

  return buildV2Snapshot(input);
}

async function buildV2Snapshot(input: BuildRadarV2Input): Promise<RadarV2Snapshot | null> {
  const { competitionKey, seasonKey, matchday, competitionId, dataSource, buildNowUtc, force, predictionFetcher } = input;

  const seasonId = dataSource.getSeasonId?.(competitionId);
  if (!seasonId) {
    console.warn(`[RadarV2Service] No seasonId for ${competitionId}`);
    return null;
  }

  const matches = dataSource.getMatches(seasonId);
  const standings = dataSource.getStandings?.(competitionId) ?? [];

  const evidenceTier = resolveEvidenceTier(matchday) as RadarV2EvidenceTier;
  const isHistoricalRebuild = force === true;

  // Evaluate candidates with v2 family-level scoring
  const evaluated = evaluateV2Candidates({
    competitionKey,
    seasonKey,
    matchday,
    matches,
    standings,
    buildNowUtc,
  });

  // Resolve cards (includes diversity filter, text rendering, reasons, prediction context)
  const cards = resolveV2Cards({ evaluated, predictionFetcher });

  // Determine data quality
  const dataQuality = resolveDataQuality(evidenceTier, standings.length);

  // Determine snapshot status
  const status = cards.length > 0 ? 'READY' as const : 'EMPTY' as const;

  const snapshot: RadarV2Snapshot = {
    schemaVersion: RADAR_V2_SCHEMA_VERSION,
    competitionKey,
    seasonKey,
    matchday,
    generatedAt: buildNowUtc,
    generatorVersion: RADAR_V2_GENERATOR_VERSION,
    status,
    dataQuality,
    isHistoricalRebuild,
    evidenceTier,
    cards,
  };

  // Validate before persisting
  const errors = validateSnapshot(snapshot);
  if (errors.length > 0) {
    console.error('[RadarV2Service] Validation errors:', errors);
    // Write a FAILED snapshot instead
    const failedSnapshot: RadarV2Snapshot = {
      ...snapshot,
      status: 'FAILED',
      cards: [],
    };
    const dir = radarV2ScopeDir(competitionKey, seasonKey, matchday);
    await writeV2Snapshot(failedSnapshot, dir);
    return failedSnapshot;
  }

  // Atomic write
  const dir = radarV2ScopeDir(competitionKey, seasonKey, matchday);
  await writeV2Snapshot(snapshot, dir);

  return snapshot;
}

/**
 * Resolves post-match verdicts for cards in a v2 snapshot.
 * Verdict is APPEND-ONLY: preMatchText is never modified.
 */
export async function resolveV2Verdicts(
  competitionKey: string,
  seasonKey: string,
  matchday: number,
  matchResults: Map<string, { scoreHome: number; scoreAway: number; status: string; favoriteSide?: 'HOME' | 'AWAY' | null }>,
  resolvedAt: string,
): Promise<void> {
  const dir = radarV2ScopeDir(competitionKey, seasonKey, matchday);

  await updateV2SnapshotVerdicts(dir, (snapshot) => {
    const updatedCards = snapshot.cards.map((card) => {
      const result = matchResults.get(card.matchId);
      if (!result) return card;
      if (result.status !== 'FINISHED') return card;
      if (card.verdict !== null) return card; // already resolved

      const verdict = resolveV2Verdict(
        card,
        result.scoreHome,
        result.scoreAway,
        result.favoriteSide ?? null,
        resolvedAt,
      );

      if (!verdict) return card;

      return { ...card, verdict };
    });

    return { ...snapshot, cards: updatedCards };
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveDataQuality(
  evidenceTier: RadarV2EvidenceTier,
  standingsCount: number,
): RadarV2DataQuality {
  if (evidenceTier === 'BOOTSTRAP' || standingsCount === 0) return 'DEGRADED';
  if (evidenceTier === 'EARLY' || standingsCount < 10) return 'PARTIAL';
  return 'OK';
}
