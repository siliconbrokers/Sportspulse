/**
 * NEXUS Canonical Serving View — Odds Snapshot Derivation
 *
 * Spec authority:
 *   market-signal-policy (MSP):
 *     S2.2  — Confidence by capture horizon (HIGH/MEDIUM/LOW/deactivated)
 *     S3.1  — Source precedence: Pinnacle > Bet365 > market_max > market_avg
 *     S4.1  — Feature eligibility: pinnacle or bet365 for feature role
 *     S4.2  — Benchmark eligibility: Pinnacle ONLY
 *     S6.1  — as-of semantics: snapshot_utc < buildNowUtc (strict)
 *     S6.3  — No interpolation between snapshots
 *     S7.2  — De-vigging: proportional normalization ONLY
 *     S7.3  — Post-de-vig validation invariants
 *     S7.4  — De-vigging is mandatory, never optional
 *   model-taxonomy-and-ensemble (MTE):
 *     S6.2  — Track 4 is a de-vig pass-through (no proprietary model)
 *     S6.3  — Track 4 active ↔ any snapshot available; inactive ↔ no snapshot
 *
 * DESIGN PRINCIPLES:
 *
 * 1. ALL FUNCTIONS ARE PURE AND DETERMINISTIC.
 *    Given the same records and buildNowUtc, the output is always identical.
 *    No side effects, no I/O. The store layer handles I/O; this layer
 *    transforms data only.
 *
 * 2. CANONICAL VIEW IS DERIVED FROM RAW STORE, NEVER THE REVERSE.
 *    The raw store is the source of truth. This file only reads from records
 *    passed in by the caller; it never writes to the store.
 *
 * 3. AS-OF SEMANTICS: STRICT LESS-THAN (MSP S6.1, S6.2).
 *    A snapshot is eligible as-of buildNowUtc iff snapshot_utc < buildNowUtc.
 *    Snapshots with snapshot_utc === buildNowUtc are excluded (strict <).
 *    Rationale: equality would mean the odds were captured at the exact moment
 *    of prediction, which is the boundary case that could admit future data.
 *
 * 4. NO INTERPOLATION (MSP S6.3).
 *    If two snapshots exist (e.g., at T-48h and T-2h), a prediction at T-12h
 *    uses the T-48h snapshot (most recent satisfying as-of < T-12h). No
 *    linear interpolation or averaging between snapshots.
 *
 * 5. BENCHMARK = PINNACLE ONLY (MSP S4.2).
 *    selectBenchmarkProvider returns null for any record whose provider is
 *    not 'pinnacle'. This is a hard constraint with no exceptions.
 *    getCanonicalOddsSnapshot enforces this by dispatching to the correct
 *    selector based on role.
 */

import type { OddsRecord, OddsProvider, ImpliedProbs, OddsConfidence, CanonicalOddsSnapshot, ProviderRole } from './types.js';
import { PROVIDER_PRECEDENCE, OVERROUND_BOUNDS } from './types.js';
import { FRESHNESS_THRESHOLDS_SECONDS } from '../feature-store/types.js';

// ── De-vigging (MSP S7.2) ─────────────────────────────────────────────────

/**
 * Proportional de-vigging per MSP S7.2.
 *
 * This is the ONLY permitted de-vigging method in NEXUS. Power method and
 * Shin's method are explicitly rejected by the spec (S7.2, rationale #1-3).
 *
 * Formula:
 *   rawImplied_i = 1 / odds_i
 *   overround     = sum(rawImplied_i)
 *   devigged_i    = rawImplied_i / overround
 *
 * The overround field stores the pre-normalization sum (e.g., 1.05 for 5% vig)
 * to enable well-formedness checks (MSP S4.1: overround must be in [1.00, 1.15]).
 *
 * Post-condition (MSP S7.3):
 *   abs(home + draw + away - 1.0) < 1e-9
 *   All values in [0, 1]
 *
 * @param oddsHome  Decimal odds for home win.
 * @param oddsDraw  Decimal odds for draw.
 * @param oddsAway  Decimal odds for away win.
 * @returns ImpliedProbs with de-vigged probabilities and overround.
 */
export function deVigProportional(
  oddsHome: number,
  oddsDraw: number,
  oddsAway: number,
): ImpliedProbs {
  const rawHome = 1 / oddsHome;
  const rawDraw = 1 / oddsDraw;
  const rawAway = 1 / oddsAway;
  const overround = rawHome + rawDraw + rawAway;

  return {
    home: rawHome / overround,
    draw: rawDraw / overround,
    away: rawAway / overround,
    overround,
  };
}

// ── Confidence (MSP S2.2, S6.1) ───────────────────────────────────────────

/**
 * Compute Track 4 confidence from snapshot capture distance to kickoff.
 *
 * Per MSP S2.2: confidence is a function of (kickoffUtc - snapshot_utc),
 * i.e. how far before kickoff the snapshot was captured — NOT how old the
 * snapshot is relative to buildNowUtc.
 *
 * Thresholds per MSP S2.2, aligned with FRESHNESS_THRESHOLDS_SECONDS:
 *   < 24h  → HIGH     (closing line or near-closing line)
 *   24-72h → MEDIUM   (full learned weight, per-horizon segmentation handles quality)
 *   > 72h  → LOW      (stale; FAR horizon weight vector applied by meta-ensemble)
 *
 * @param snapshotUtc ISO-8601 UTC string — the moment the odds were captured.
 * @param kickoffUtc  ISO-8601 UTC string — the scheduled match kickoff time.
 *
 * Precondition: both strings must be valid ISO-8601 UTC. The caller guarantees
 * snapshotUtc < kickoffUtc (odds captured before the match). If
 * snapshotUtc >= kickoffUtc the result is LOW (effectively post-kickoff capture
 * is treated as the farthest horizon).
 */
export function computeOddsConfidence(snapshotUtc: string, kickoffUtc: string): OddsConfidence {
  const snapshotMs = new Date(snapshotUtc).getTime();
  const kickoffMs = new Date(kickoffUtc).getTime();

  // Distance in seconds from snapshot capture to kickoff.
  // If snapshot_utc >= kickoffUtc (post-kickoff capture), distance is <= 0;
  // treat as the farthest horizon (LOW) — conservative and safe.
  const distanceSeconds = Math.max(0, (kickoffMs - snapshotMs) / 1000);

  if (distanceSeconds < FRESHNESS_THRESHOLDS_SECONDS.MARKET_ODDS_HIGH_CUTOFF) {
    return 'HIGH';
  }
  if (distanceSeconds < FRESHNESS_THRESHOLDS_SECONDS.MARKET_ODDS_MEDIUM_CUTOFF) {
    return 'MEDIUM';
  }
  return 'LOW';
}

// ── As-of filtering ────────────────────────────────────────────────────────

/**
 * Filter records to only those eligible as-of buildNowUtc.
 *
 * Per MSP S6.2: snapshot_utc must be STRICTLY LESS THAN buildNowUtc.
 * Records with snapshot_utc === buildNowUtc are excluded.
 */
function filterAsOf(records: OddsRecord[], buildNowUtc: string): OddsRecord[] {
  return records.filter((r) => r.snapshot_utc < buildNowUtc);
}

/**
 * Select the most recent record from a filtered list (snapshot_utc DESC).
 * Returns undefined if the list is empty.
 *
 * Per MSP S6.3: no interpolation. Always use the single most recent snapshot.
 */
function pickMostRecent(records: OddsRecord[]): OddsRecord | undefined {
  if (records.length === 0) return undefined;
  // Sort DESC by snapshot_utc (ISO-8601 strings are lexicographically comparable).
  return records.slice().sort((a, b) => b.snapshot_utc.localeCompare(a.snapshot_utc))[0];
}

// ── Provider selection ─────────────────────────────────────────────────────

/**
 * Select the best available provider for the FEATURE role as-of buildNowUtc.
 *
 * Source precedence per MSP S3.1 (PROVIDER_PRECEDENCE order):
 *   pinnacle → bet365 → market_max → market_avg
 *
 * For each provider in precedence order, find the most recent record with
 * snapshot_utc < buildNowUtc. Return the first provider that has a record.
 *
 * Returns null when no provider has any record as-of buildNowUtc.
 * Returning null causes Track 4 to be DEACTIVATED for this match.
 *
 * @param records      All OddsRecords for the match (from raw store).
 * @param buildNowUtc  Temporal anchor for as-of filtering.
 */
export function selectFeatureProvider(
  records: OddsRecord[],
  buildNowUtc: string,
): OddsRecord | null {
  const eligible = filterAsOf(records, buildNowUtc);
  if (eligible.length === 0) return null;

  for (const provider of PROVIDER_PRECEDENCE) {
    const providerRecords = eligible.filter((r) => r.provider === provider);
    const best = pickMostRecent(providerRecords);
    if (best !== undefined) {
      return best;
    }
  }

  return null;
}

/**
 * Select the best available provider for the BENCHMARK role as-of buildNowUtc.
 *
 * HARD CONSTRAINT (MSP S4.2): Only 'pinnacle' is eligible for benchmarking.
 * Bet365, market_max, and market_avg are NEVER used for benchmark — no
 * exceptions, regardless of availability.
 *
 * Returns the most recent Pinnacle record with snapshot_utc < buildNowUtc,
 * or null if no Pinnacle record exists as-of buildNowUtc.
 *
 * @param records      All OddsRecords for the match.
 * @param buildNowUtc  Temporal anchor for as-of filtering.
 */
export function selectBenchmarkProvider(
  records: OddsRecord[],
  buildNowUtc: string,
): OddsRecord | null {
  const eligible = filterAsOf(records, buildNowUtc);
  const pinnacleRecords = eligible.filter((r) => r.provider === 'pinnacle');
  return pickMostRecent(pinnacleRecords) ?? null;
}

// ── Main serving function ──────────────────────────────────────────────────

/**
 * Compute the canonical odds snapshot as-of buildNowUtc for the given role.
 *
 * This is the primary entry point for Track 4. The meta-ensemble calls this
 * to obtain Track 4's input for each match.
 *
 * Returns null when:
 *   - No valid odds snapshot exists as-of buildNowUtc (for the given role).
 *   - For 'benchmark' role: no Pinnacle snapshot exists.
 * In either case, Track 4 is DEACTIVATED and returns null to signal this.
 *
 * When a valid snapshot is found:
 *   1. De-vig the raw odds using proportional normalization (MSP S7.2).
 *   2. Compute snapshot_age_hours (buildNowUtc - snapshot_utc) for reference.
 *   3. Compute OddsConfidence per MSP S2.2: distance from snapshot_utc to
 *      kickoffUtc — NOT from buildNowUtc. Pass kickoffUtc to
 *      computeOddsConfidence() directly.
 *   4. Return CanonicalOddsSnapshot.
 *
 * The well-formedness check (overround within [1.00, 1.15], MSP S4.1) is
 * NOT applied here — it is the caller's responsibility at ingestion time.
 * The serving view trusts records already in the store. If callers want to
 * filter SUSPECT records, they should do so before calling this function
 * by using the OddsQuality check from types.ts.
 *
 * @param records      All OddsRecords for the match (from raw store).
 * @param buildNowUtc  Temporal anchor for as-of filtering (strict < snapshot_utc).
 * @param role         'feature' or 'benchmark' — determines provider selection.
 * @param kickoffUtc   Scheduled kickoff time used to compute capture-to-kickoff
 *                     distance per MSP S2.2. Must be a valid ISO-8601 UTC string.
 */
export function getCanonicalOddsSnapshot(
  records: OddsRecord[],
  buildNowUtc: string,
  role: ProviderRole,
  kickoffUtc: string,
): CanonicalOddsSnapshot | null {
  // Select best record for the requested role.
  const selected =
    role === 'benchmark'
      ? selectBenchmarkProvider(records, buildNowUtc)
      : selectFeatureProvider(records, buildNowUtc);

  if (selected === null) {
    // No valid snapshot — Track 4 DEACTIVATED.
    return null;
  }

  // De-vig: mandatory transformation before any use (MSP S7.4).
  const implied_probs = deVigProportional(
    selected.odds_home,
    selected.odds_draw,
    selected.odds_away,
  );

  // Compute snapshot age in hours (buildNowUtc - snapshot_utc) for reference only.
  // This field is retained in the output for diagnostics but is NOT used for
  // confidence classification per MSP S2.2.
  const snapshotMs = new Date(selected.snapshot_utc).getTime();
  const buildMs = new Date(buildNowUtc).getTime();
  const snapshot_age_hours = Math.max(0, (buildMs - snapshotMs) / (1000 * 3600));

  // Confidence per MSP S2.2: distance from snapshot capture to KICKOFF.
  // Correct reference point: (kickoffUtc - snapshot_utc), not (buildNowUtc - snapshot_utc).
  const confidence = computeOddsConfidence(selected.snapshot_utc, kickoffUtc);

  return {
    match_id: selected.match_id,
    provider: selected.provider,
    role,
    implied_probs,
    snapshot_age_hours,
    confidence,
    raw_record: selected,
  };
}
