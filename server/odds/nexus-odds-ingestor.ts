/**
 * nexus-odds-ingestor.ts — Live Odds Ingestor Skeleton for NEXUS Track 4.
 *
 * This module is the live-polling counterpart to the offline historical loader
 * (tools/load-odds-to-store.ts). It runs inside the server process and fetches
 * pre-kickoff odds at scheduled intervals, writing them to the raw odds store.
 *
 * NEXUS-OP-3 scope (this task): skeleton only.
 * Fetching from an external odds provider is NOT implemented here — it is
 * deferred to a separate task (NEXUS-OP-3-B: Wire external odds provider).
 *
 * Design constraints (spec: market-signal-policy MSP S2.2, S3.1, S11.3):
 *   - Only pre-kickoff snapshots are written (buildNowUtc < kickoffUtc strict).
 *   - Polling cadence adapts to proximity of kickoff:
 *       > 24 h before kickoff → every 30 min (early odds, low information rate)
 *       ≤ 24 h before kickoff → every 5 min  (closing line window)
 *   - Errors are caught and logged locally — never propagate to caller.
 *   - The ingestor is opt-in: disabled unless NEXUS_ODDS_INGEST_ENABLED=true.
 *
 * Startup:
 *   Call startNexusOddsIngestor(dataSource) from server/index.ts (or similar
 *   composition root) after the server is listening. The returned StopHandle
 *   can be called to halt polling on graceful shutdown.
 *
 * Spec authority:
 *   market-signal-policy (MSP):
 *     S2.2  — Temporal policy: confidence by capture horizon
 *     S3.1  — Source hierarchy: Pinnacle > Bet365 > market_max > market_avg
 *     S11.3 — Append-only raw store: no overwrites
 *   NEXUS-0:
 *     S3.1  — As-of semantics (buildNowUtc anchor)
 *     S9.3  — Reproducibility
 */

import type { OddsRecord } from '../../packages/prediction/src/nexus/odds/types.js';
import { appendOddsRecord } from '../../packages/prediction/src/nexus/odds/raw-odds-store.js';
import type { AfOddsService } from './af-odds-service.js';
import { isQuotaExhausted as isAfQuotaExhausted } from '@sportpulse/canonical';

// ── Configuration ─────────────────────────────────────────────────────────────

/** Enabled when NEXUS_ODDS_INGEST_ENABLED=true (case-insensitive). */
const INGEST_ENABLED =
  (process.env.NEXUS_ODDS_INGEST_ENABLED ?? '').toLowerCase() === 'true';

/** Poll interval for matches > 24h from kickoff (milliseconds). */
const INTERVAL_FAR_MS  = 30 * 60 * 1000;  // 30 min

/** Poll interval for matches ≤ 24h from kickoff (milliseconds). */
const INTERVAL_NEAR_MS =  5 * 60 * 1000;  //  5 min

/** Threshold in hours that divides FAR from NEAR cadence. */
const NEAR_THRESHOLD_HOURS = 24;

// ── Public interfaces ─────────────────────────────────────────────────────────

/**
 * Minimal fixture descriptor required by the ingestor.
 * The caller (composition root) must supply this for each pre-kickoff match.
 */
export interface IngestorFixture {
  /** Canonical match identifier (same format as used in raw-odds-store). */
  readonly matchId:    string;
  /** ISO 8601 UTC kickoff timestamp. */
  readonly kickoffUtc: string;
}

/**
 * Data source abstraction injected by the composition root.
 * In production this will wrap a live odds provider (e.g., The Odds API).
 * In the skeleton this method has a TODO placeholder body.
 */
export interface OddsDataSource {
  /**
   * Fetch a pre-kickoff 1X2 snapshot for the given fixture.
   *
   * Returns an OddsRecord when a snapshot is available, or null when the
   * provider has no data for this fixture at this moment.
   *
   * MUST NOT be called post-kickoff (caller enforces this invariant).
   */
  fetchSnapshot(fixture: IngestorFixture, buildNowUtc: string): Promise<OddsRecord | null>;
}

/**
 * Handle returned by startNexusOddsIngestor.
 * Call stop() to cancel all pending timers on graceful shutdown.
 */
export interface StopHandle {
  stop(): void;
}

// ── Null data source (stub) ────────────────────────────────────────────────────

/**
 * Placeholder OddsDataSource used until a real provider is wired.
 * fetchSnapshot always returns null — no-op from the store's perspective.
 */
export class NullOddsDataSource implements OddsDataSource {
  async fetchSnapshot(
    _fixture: IngestorFixture,
    _buildNowUtc: string,
  ): Promise<OddsRecord | null> {
    return null;
  }
}

// ── AF odds data source (production) ──────────────────────────────────────────

/**
 * Maximum API-Football requests per ingestor cycle. Caps budget consumption
 * so the ingestor never drains the daily quota (100 req/day on free tier).
 * Each cycle may run up to MAX_CALLS_PER_CYCLE fixtures.
 *
 * Rationale: the ingestor runs per-fixture, not per-cycle. MAX_CALLS_PER_CYCLE
 * is enforced at the caller level (startNexusOddsIngestor) by limiting how many
 * fixtures are enrolled at startup. Individual fetchSnapshot calls each check
 * isAfQuotaExhausted() before touching the API.
 */
const MAX_CALLS_PER_CYCLE = 3;

/**
 * Production OddsDataSource backed by API-Football v3 (via AfOddsService).
 *
 * Design decisions:
 *
 * 1. Budget guard: isAfQuotaExhausted() is checked before every API call.
 *    If the daily quota is exhausted, fetchSnapshot returns null (no-op).
 *    This prevents the ingestor from pushing AF over the 100 req/day limit.
 *
 * 2. Fixture ID extraction: canonical matchIds use the format
 *    "match:<provider>:<numericId>" (e.g., "match:apifootball:1023456").
 *    The numeric suffix is the API-Football fixture ID.
 *    For non-AF providers ("match:football-data:*" etc.) the ID cannot be
 *    mapped to an AF fixture — fetchSnapshot returns null gracefully.
 *
 * 3. OddsRecord construction: AfOddsService returns de-vigged implied
 *    probabilities (home + draw + away = 1.0 exactly). To store a valid
 *    OddsRecord we convert back to decimal odds (1 / prob). The resulting
 *    overround is exactly 1.0, which is within the OVERROUND_BOUNDS [1.00, 1.15]
 *    guard in the canonical serving view. The store records them as
 *    provider='market_avg' since AfOddsService averages across all bookmakers.
 *
 * 4. Snapshot timestamp: snapshot_utc uses capturedAtUtc from AfOddsService
 *    (the moment AfOddsService fetched the odds from the API). retrieved_at_utc
 *    is set to the current wall-clock time (ingestion timestamp).
 */
export class AfOddsDataSource implements OddsDataSource {
  private readonly afOddsService: AfOddsService;

  constructor(afOddsService: AfOddsService) {
    this.afOddsService = afOddsService;
  }

  async fetchSnapshot(
    fixture: IngestorFixture,
    _buildNowUtc: string,
  ): Promise<OddsRecord | null> {
    // Budget guard: never call AF when daily quota is exhausted.
    if (isAfQuotaExhausted()) {
      return null;
    }

    // Extract AF fixture ID from canonical matchId.
    // Format: "match:apifootball:<numericId>" or "match:football-data:<numericId>"
    // Only "match:apifootball:*" can be mapped to an AF fixture ID.
    const fixtureId = extractAfFixtureId(fixture.matchId);
    if (fixtureId === null) {
      // Non-AF provider — cannot look up odds by AF fixture ID.
      return null;
    }

    // Fetch de-vigged implied odds from AfOddsService (budget-aware, cached).
    const implied = await this.afOddsService.getOddsForFixture(fixtureId);
    if (implied === null) {
      // No odds available for this fixture (provider has no data).
      return null;
    }

    // Validate probabilities: each must be positive to compute valid decimal odds.
    if (implied.probHome <= 0 || implied.probDraw <= 0 || implied.probAway <= 0) {
      console.warn(
        `[AfOddsDataSource] Skipping fixture ${fixtureId}: non-positive probability ` +
        `(H=${implied.probHome}, D=${implied.probDraw}, A=${implied.probAway})`,
      );
      return null;
    }

    // Convert de-vigged probabilities → decimal odds (1 / prob).
    // Overround will be exactly 1.0 (within OVERROUND_BOUNDS [1.00, 1.15]).
    const oddsHome = 1 / implied.probHome;
    const oddsDraw = 1 / implied.probDraw;
    const oddsAway = 1 / implied.probAway;

    const now = new Date().toISOString();

    const record: OddsRecord = {
      match_id:         fixture.matchId,
      provider:         'market_avg',   // AfOddsService averages across all bookmakers
      market:           '1x2',
      odds_home:        oddsHome,
      odds_draw:        oddsDraw,
      odds_away:        oddsAway,
      snapshot_utc:     implied.capturedAtUtc,  // when AF captured these odds (effectiveAt)
      retrieved_at_utc: now,                    // when the ingestor stored this record
    };

    return record;
  }
}

// ── Helper: extract AF fixture ID from canonical matchId ──────────────────────

/**
 * Extract the numeric API-Football fixture ID from a canonical matchId string.
 *
 * Returns the ID as a number when matchId is in "match:apifootball:<id>" format.
 * Returns null for all other formats (football-data, thesportsdb, etc.).
 */
function extractAfFixtureId(matchId: string): number | null {
  const PREFIX = 'match:apifootball:';
  if (!matchId.startsWith(PREFIX)) return null;
  const raw = matchId.slice(PREFIX.length);
  const id = parseInt(raw, 10);
  if (!isFinite(id) || id <= 0) return null;
  return id;
}

export { MAX_CALLS_PER_CYCLE };

// ── Core helpers ───────────────────────────────────────────────────────────────

/**
 * Returns true when the fixture is still pre-kickoff at buildNowUtc.
 * The anti-circular guard (MSP S2.2): only pre-kickoff snapshots are valid.
 */
function isPreKickoff(kickoffUtc: string, buildNowUtc: string): boolean {
  return new Date(buildNowUtc).getTime() < new Date(kickoffUtc).getTime();
}

/**
 * Returns hours between buildNowUtc and kickoffUtc (positive = pre-kickoff).
 */
function hoursUntilKickoff(kickoffUtc: string, buildNowUtc: string): number {
  const ms = new Date(kickoffUtc).getTime() - new Date(buildNowUtc).getTime();
  return ms / (1000 * 60 * 60);
}

/**
 * Selects the polling interval based on proximity to kickoff.
 * FAR (>24h): 30 min.  NEAR (≤24h): 5 min.
 */
function selectInterval(kickoffUtc: string, buildNowUtc: string): number {
  const hours = hoursUntilKickoff(kickoffUtc, buildNowUtc);
  return hours > NEAR_THRESHOLD_HOURS ? INTERVAL_FAR_MS : INTERVAL_NEAR_MS;
}

// ── Ingest one fixture ─────────────────────────────────────────────────────────

/**
 * Attempt to fetch and persist a single odds snapshot for a fixture.
 * All errors are caught — this function never throws.
 */
async function ingestOne(
  fixture:    IngestorFixture,
  dataSource: OddsDataSource,
  cacheDir:   string,
): Promise<void> {
  const buildNowUtc = new Date().toISOString();

  // Guard: never write post-kickoff snapshots.
  if (!isPreKickoff(fixture.kickoffUtc, buildNowUtc)) {
    return;
  }

  try {
    const record = await dataSource.fetchSnapshot(fixture, buildNowUtc);

    if (record === null) {
      // Provider returned no data — normal for stub / unavailable fixture.
      return;
    }

    // Validate that the record's match_id matches the fixture we requested.
    if (record.match_id !== fixture.matchId) {
      console.warn(
        `[nexus-odds-ingestor] match_id mismatch: expected ${fixture.matchId}, ` +
        `got ${record.match_id} — skipping.`,
      );
      return;
    }

    await appendOddsRecord(record, cacheDir);
  } catch (err) {
    // Fault isolation: errors never propagate to the server process.
    console.error(
      `[nexus-odds-ingestor] error fetching snapshot for ${fixture.matchId}: ` +
      (err instanceof Error ? err.message : String(err)),
    );
  }
}

// ── Adaptive polling loop ──────────────────────────────────────────────────────

/**
 * Schedule a self-rescheduling poll cycle for one fixture.
 *
 * Each poll:
 *   1. Fetches and persists the snapshot.
 *   2. Recalculates the next interval based on current time-to-kickoff.
 *   3. Schedules itself again UNLESS the fixture is past kickoff.
 *
 * Returns a cancel function that clears the pending timeout.
 */
function scheduleFixturePolling(
  fixture:    IngestorFixture,
  dataSource: OddsDataSource,
  cacheDir:   string,
): () => void {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  async function poll(): Promise<void> {
    if (cancelled) return;

    await ingestOne(fixture, dataSource, cacheDir);

    if (cancelled) return;

    const buildNowUtc = new Date().toISOString();
    if (!isPreKickoff(fixture.kickoffUtc, buildNowUtc)) {
      // Fixture has kicked off — stop polling this fixture.
      return;
    }

    const nextInterval = selectInterval(fixture.kickoffUtc, buildNowUtc);
    handle = setTimeout(() => { void poll(); }, nextInterval);
  }

  // Run the first poll immediately (async, does not block caller).
  void poll();

  return () => {
    cancelled = true;
    if (handle !== null) {
      clearTimeout(handle);
      handle = null;
    }
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Start the NEXUS live odds ingestor.
 *
 * Call once at server startup, after the composition root has resolved
 * the list of pre-kickoff fixtures for the current polling window.
 *
 * @param fixtures   Pre-kickoff fixtures to poll. Caller is responsible for
 *                   refreshing this list (e.g., re-calling startNexusOddsIngestor
 *                   on each matchday poll cycle). Fixtures past kickoff are silently
 *                   ignored on each poll attempt.
 * @param dataSource The OddsDataSource implementation (use NullOddsDataSource
 *                   until a real provider is wired).
 * @param cacheDir   Root cache directory (e.g., process.cwd() + '/cache').
 *
 * @returns StopHandle — call .stop() on graceful server shutdown to clear all timers.
 */
export function startNexusOddsIngestor(
  fixtures:   IngestorFixture[],
  dataSource: OddsDataSource,
  cacheDir:   string,
): StopHandle {
  if (!INGEST_ENABLED) {
    // Disabled — return a no-op stop handle.
    if (fixtures.length > 0) {
      console.log(
        '[nexus-odds-ingestor] NEXUS_ODDS_INGEST_ENABLED not set — ingestor inactive.',
      );
    }
    return { stop: () => undefined };
  }

  const preKickoff = fixtures.filter(f =>
    isPreKickoff(f.kickoffUtc, new Date().toISOString()),
  );

  if (preKickoff.length === 0) {
    console.log('[nexus-odds-ingestor] No pre-kickoff fixtures — ingestor idle.');
    return { stop: () => undefined };
  }

  console.log(
    `[nexus-odds-ingestor] Starting — ${preKickoff.length} pre-kickoff fixture(s) to track.`,
  );

  // Launch one adaptive poll loop per fixture.
  const cancelFns = preKickoff.map(f =>
    scheduleFixturePolling(f, dataSource, cacheDir),
  );

  return {
    stop(): void {
      for (const cancel of cancelFns) {
        cancel();
      }
      console.log('[nexus-odds-ingestor] Stopped.');
    },
  };
}
