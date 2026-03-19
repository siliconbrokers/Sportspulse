/**
 * nexus-shadow-reader.ts — Reads NEXUS shadow snapshots from disk and normalizes
 * them to the InspectionItem shape used by the inspection and evaluation endpoints.
 *
 * Responsibilities:
 *   - Scan cache/nexus-shadow/ recursively for all .json files
 *   - Parse each file as NexusShadowSnapshot
 *   - Normalize to NexusUnifiedItem (InspectionItem + engine_source: 'nexus')
 *   - Maintain an in-memory cache with 60s TTL to avoid repeated filesystem scans
 *
 * Error policy: corrupt/unreadable files are logged and skipped. Never throws.
 *
 * @module server/prediction/nexus-shadow-reader
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NexusShadowSnapshot } from './nexus-shadow-runner.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * InspectionItem fields replicated here to avoid a circular import with
 * inspection-route.ts. The interface is kept in sync with InspectionItem manually.
 */
interface InspectionItemBase {
  match_id: string;
  competition_id: string;
  generated_at: string;
  engine_version: string;
  kickoff_utc: string;
  generation_status: 'ok' | 'error';
  error_detail?: string;

  mode: string;
  calibration_mode: string | null;
  reasons: string[];
  degradation_notes: string[];

  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  predicted_result: string | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;

  favorite_margin: number | null;
  draw_risk: number | null;

  request_payload: unknown;
  response_payload: unknown;
}

export interface NexusUnifiedItem extends InspectionItemBase {
  engine_source: 'nexus';
}

// ── Argmax helper ─────────────────────────────────────────────────────────────

export function deriveArgmax(
  probs: { home: number; draw: number; away: number },
): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
  if (probs.home >= probs.draw && probs.home >= probs.away) return 'HOME_WIN';
  if (probs.draw >= probs.home && probs.draw >= probs.away) return 'DRAW';
  return 'AWAY_WIN';
}

// ── Normalization ─────────────────────────────────────────────────────────────

function normalizeSnapshot(nexus: NexusShadowSnapshot): NexusUnifiedItem {
  return {
    match_id:           nexus.matchId,
    competition_id:     nexus.competitionId,
    generated_at:       nexus.createdAtUtc,
    engine_version:     nexus.modelVersion,
    kickoff_utc:        nexus.kickoffUtc,
    generation_status:  'ok',

    mode:               `nexus:${nexus.ensembleConfidence}`,
    calibration_mode:   nexus.calibrationSource,
    reasons: [
      `track4=${nexus.track4Status}`,
      `calibration=${nexus.calibrationSource}`,
      `confidence=${nexus.ensembleConfidence}`,
    ],
    degradation_notes:  [],

    p_home_win:         nexus.probs.home,
    p_draw:             nexus.probs.draw,
    p_away_win:         nexus.probs.away,
    predicted_result:   deriveArgmax(nexus.probs),

    expected_goals_home: null,
    expected_goals_away: null,
    favorite_margin:     null,
    draw_risk:           null,

    request_payload: {
      homeTeamId:           nexus.homeTeamId,
      awayTeamId:           nexus.awayTeamId,
      kickoffUtc:           nexus.kickoffUtc,
      weights:              nexus.weights,
      featureSchemaVersion: nexus.featureSchemaVersion,
      datasetWindow:        nexus.datasetWindow,
    },
    response_payload: {
      probs:              nexus.probs,
      calibrationVersion: nexus.calibrationVersion,
      modelVersion:       nexus.modelVersion,
    },

    engine_source: 'nexus',
  };
}

// ── Filesystem scan ───────────────────────────────────────────────────────────

const NEXUS_SHADOW_BASE = path.join(process.cwd(), 'cache', 'nexus-shadow');

function scanNexusShadowDir(): NexusUnifiedItem[] {
  const items: NexusUnifiedItem[] = [];

  if (!fs.existsSync(NEXUS_SHADOW_BASE)) return items;

  let compDirs: string[];
  try {
    compDirs = fs.readdirSync(NEXUS_SHADOW_BASE);
  } catch (err) {
    console.error('[NexusShadowReader] Cannot read base dir:', err);
    return items;
  }

  for (const compDir of compDirs) {
    const compPath = path.join(NEXUS_SHADOW_BASE, compDir);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(compPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let files: string[];
    try {
      files = fs.readdirSync(compPath);
    } catch (err) {
      console.error(`[NexusShadowReader] Cannot read dir ${compPath}:`, err);
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(compPath, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as NexusShadowSnapshot;

        // Basic field validation
        if (
          typeof parsed.matchId !== 'string' ||
          typeof parsed.competitionId !== 'string' ||
          typeof parsed.probs !== 'object' ||
          parsed.probs === null
        ) {
          console.warn(`[NexusShadowReader] Skipping malformed file: ${filePath}`);
          continue;
        }

        items.push(normalizeSnapshot(parsed));
      } catch (err) {
        console.warn(`[NexusShadowReader] Skipping corrupt file ${filePath}:`, err);
      }
    }
  }

  return items;
}

// ── In-memory cache (TTL 60s) ─────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;

interface Cache {
  items: NexusUnifiedItem[];
  expiresAt: number;
}

let _cache: Cache | null = null;

function getAll(): NexusUnifiedItem[] {
  const now = Date.now();
  if (_cache !== null && now < _cache.expiresAt) {
    return _cache.items;
  }

  const items = scanNexusShadowDir();
  _cache = { items, expiresAt: now + CACHE_TTL_MS };
  return items;
}

// ── Public class ──────────────────────────────────────────────────────────────

export class NexusShadowReader {
  /**
   * Returns all NEXUS shadow snapshots, optionally capped to `limit`.
   * Sorted by generated_at descending (newest first).
   */
  findAll(limit?: number): NexusUnifiedItem[] {
    const all = getAll().slice().sort(
      (a, b) => b.generated_at.localeCompare(a.generated_at),
    );
    return limit !== undefined ? all.slice(0, limit) : all;
  }

  /**
   * Returns NEXUS snapshots for a specific competition.
   * The `safeCompId` directory name corresponds to
   * `competitionId.replace(/[^a-zA-Z0-9_.-]/g, '_')`.
   */
  findByCompetition(competitionId: string, limit?: number): NexusUnifiedItem[] {
    const all = getAll()
      .filter((item) => item.competition_id === competitionId)
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at));
    return limit !== undefined ? all.slice(0, limit) : all;
  }

  /**
   * Returns the NEXUS snapshot for a specific match, or null if not found.
   */
  findByMatch(matchId: string): NexusUnifiedItem | null {
    return getAll().find((item) => item.match_id === matchId) ?? null;
  }
}
