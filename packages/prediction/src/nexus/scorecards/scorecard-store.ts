/**
 * scorecard-store.ts — NEXUS Scorecard Persistent Store.
 *
 * Spec authority:
 *   - evaluation-and-promotion spec S5.2.7: mutually exclusive origin slices
 *   - evaluation-and-promotion spec S6.2: live_shadow requires buildNowUtc < kickoffUtc
 *   - evaluation-and-promotion spec S11.3: immutability — completed evaluations not modified
 *   - evaluation-and-promotion spec S12.8: no-double-counting across origin slices
 *
 * Storage layout:
 *   cache/nexus-scorecards/{type}/{competitionId}/{matchId}.json
 *
 * Behavior:
 *   - Append-only: existing entries are never overwritten (idempotent by matchId).
 *   - Atomic write: .tmp → rename (same pattern as matchday-cache).
 *   - Pre-kickoff guard: rejects entries where predictionUtc >= kickoffUtc.
 *   - RPS formula: standard 3-outcome RPS per evaluation-and-promotion spec S2.1.
 *
 * @module nexus/scorecards/scorecard-store
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ScorecardEntry, ScorecardType, NexusScorecard } from './types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_BASE = path.join(process.cwd(), 'cache', 'nexus-scorecards');

// ── RPS computation ───────────────────────────────────────────────────────────

/**
 * Compute the Ranked Probability Score for a 3-outcome prediction.
 *
 * Standard RPS formula (evaluation-and-promotion spec S2.1):
 *   RPS = (1/2) * sum_r( (CDF_p(r) - CDF_o(r))^2 )
 *
 * For 3 outcomes ordered [home, draw, away]:
 *   CDF_p(1) = p_home
 *   CDF_p(2) = p_home + p_draw
 *   CDF_o(1) = o_home (1 if result='1', else 0)
 *   CDF_o(2) = o_home + o_draw
 *
 * @param probs  NEXUS predicted probabilities.
 * @param result Realized outcome: '1'=home, 'X'=draw, '2'=away.
 * @returns      RPS value in [0, 1]. Lower is better.
 */
export function computeRps(
  probs: { home: number; draw: number; away: number },
  result: '1' | 'X' | '2',
): number {
  // Outcome indicators
  const oHome = result === '1' ? 1 : 0;
  const oDraw = result === 'X' ? 1 : 0;

  // CDF differences at each cumulative step
  const d1 = probs.home - oHome;
  const d2 = probs.home + probs.draw - (oHome + oDraw);

  return 0.5 * (d1 * d1 + d2 * d2);
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function entryFilePath(type: ScorecardType, competitionId: string, matchId: string): string {
  // Sanitize competitionId for use as directory (e.g. "comp:football-data:PD" → safe)
  const safeCompId = competitionId.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const safeMatchId = matchId.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(CACHE_BASE, type, safeCompId, `${safeMatchId}.json`);
}

// ── Atomic write ──────────────────────────────────────────────────────────────

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

// ── Scorecard store API ───────────────────────────────────────────────────────

/**
 * Append a scorecard entry to the store.
 *
 * Rules:
 * 1. Pre-kickoff guard: entry is silently ignored if predictionUtc >= kickoffUtc.
 *    (evaluation-and-promotion spec S6.2, S6.6 — live_shadow must be pre-kickoff)
 * 2. Idempotent: if an entry for this matchId already exists in this type's partition,
 *    the existing entry is preserved (append-only, spec S11.3 immutability).
 * 3. Atomic write: .tmp → rename.
 *
 * @param entry  Scorecard entry to append.
 */
export function appendScorecardEntry(entry: ScorecardEntry): void {
  // Guard 1: strict pre-kickoff requirement
  if (entry.predictionUtc >= entry.kickoffUtc) {
    // Silently ignore post-kickoff predictions — they are ineligible
    return;
  }

  const filePath = entryFilePath(entry.scorecardType, entry.competitionId, entry.matchId);

  // Guard 2: idempotency — if file already exists, preserve existing entry
  if (fs.existsSync(filePath)) {
    return;
  }

  atomicWriteJson(filePath, entry);
}

/**
 * Load a scorecard aggregate for a given type and optional competition filter.
 *
 * Reads all entry files from the partition and aggregates them.
 * Returns an empty scorecard (n=0, rps_mean=0) when no entries exist.
 *
 * @param type          Scorecard type to load.
 * @param competitionId If provided, load only entries for this competition.
 * @returns             NexusScorecard aggregate.
 */
export function loadScorecard(
  type: ScorecardType,
  competitionId?: string,
): NexusScorecard {
  const entries: ScorecardEntry[] = [];

  const typeDir = path.join(CACHE_BASE, type);
  if (!fs.existsSync(typeDir)) {
    return buildEmptyScorecard(type);
  }

  // Enumerate competition directories
  let compDirs: string[];
  try {
    compDirs = fs.readdirSync(typeDir);
  } catch {
    return buildEmptyScorecard(type);
  }

  for (const compDir of compDirs) {
    // If filtering by competitionId, check the sanitized form
    if (competitionId !== undefined) {
      const safeCompId = competitionId.replace(/[^a-zA-Z0-9_.-]/g, '_');
      if (compDir !== safeCompId) continue;
    }

    const compPath = path.join(typeDir, compDir);
    let files: string[];
    try {
      files = fs.readdirSync(compPath).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(compPath, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const entry = JSON.parse(raw) as ScorecardEntry;
        entries.push(entry);
      } catch {
        // Corrupt or unreadable entry — skip
      }
    }
  }

  return aggregateEntries(type, entries);
}

// ── Aggregation helpers ───────────────────────────────────────────────────────

function buildEmptyScorecard(type: ScorecardType): NexusScorecard {
  return { type, entries: [], rps_mean: 0, n: 0, leagues: {} };
}

function aggregateEntries(type: ScorecardType, entries: ScorecardEntry[]): NexusScorecard {
  if (entries.length === 0) {
    return buildEmptyScorecard(type);
  }

  const rpsSum = entries.reduce((sum, e) => sum + e.rps, 0);
  const rps_mean = rpsSum / entries.length;

  // Per-league breakdown
  const leagueMap = new Map<string, { n: number; rpsSum: number }>();
  for (const e of entries) {
    const cur = leagueMap.get(e.competitionId) ?? { n: 0, rpsSum: 0 };
    cur.n += 1;
    cur.rpsSum += e.rps;
    leagueMap.set(e.competitionId, cur);
  }

  const leagues: Record<string, { n: number; rps_mean: number }> = {};
  for (const [compId, agg] of leagueMap) {
    leagues[compId] = { n: agg.n, rps_mean: agg.rpsSum / agg.n };
  }

  return { type, entries, rps_mean, n: entries.length, leagues };
}
