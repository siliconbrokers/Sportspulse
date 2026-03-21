# SPEC-SPORTPULSE-AUDIT-RUNTIME-STORAGE-AND-SCALING-GAP-ANALYSIS v0.2

**Audit Date:** 2026-03-20
**Auditor:** Architect (Opus)
**Scope:** Runtime topology, persistence inventory, snapshot lifecycle, cache discipline, keying/provenance, scaling risks, operational readiness.
**Codebase Commit:** 466b3b3 (main)

---

## 7.1 Runtime Topology Diagram

```
                         +-------------------------------+
                         |        Render Instance        |
                         |  (single Node.js process)     |
                         +-------------------------------+
                         |                               |
   +---------------------+          +-----------------+  |
   |  Fastify HTTP Server |          |   Scheduler     |  |
   |  :3000               |          | (setInterval)   |  |
   +-----+-------+-------+          +--------+--------+  |
         |       |                            |           |
         |       |    +---[provider calls]----+           |
         |       |    |   football-data.org               |
         |       |    |   TheSportsDB                     |
         |       |    |   API-Football v3                 |
         |       |    |   YouTube Data API                |
         |       |    |   RSS feeds                       |
         |       |    v                                   |
         |       |  +-----------+                         |
         |       |  | Data      |---> canonical models    |
         |       |  | Sources   |     (in-memory)         |
         |       |  +-----------+                         |
         |       |       |                                |
         |       |       | invalidateAll()                |
         |       |       v                                |
         |  +----+------------------+                     |
         |  | InMemorySnapshotStore |                     |
         |  | (Map<key, CacheEntry>)|  <-- RAM only       |
         |  | unbounded, no evict   |                     |
         |  +-----------+-----------+                     |
         |              ^                                 |
         |              | build on cache miss             |
         |              |                                 |
   +-----+------+  +----+------+                          |
   | /api/ui/*  |  | Snapshot  |                          |
   | endpoints  |  | Pipeline  |                          |
   +-----+------+  | signals   |                          |
         |         | scoring   |                          |
         |         | layout    |                          |
         v         +-----------+                          |
   +----------+                                           |
   | React    |   (served by Vite dev / static prod)      |
   | Frontend |                                           |
   +----------+                                           |
                                                          |
   +----- Durable Disk (Render mount: /cache) ------------+
   |                                                      |
   |  cache/                                              |
   |  +-- {provider}/{compId}/{season}/matchday-*.json    |
   |  +-- {provider}/{compId}/teams.json                  |
   |  +-- {provider}/{compId}/standings.json              |
   |  +-- {provider}/{compId}/comp-info.json              |
   |  +-- {provider}/{compId}/score-snapshot.json         |
   |  +-- portal-config.json                              |
   |  +-- portal-config-audit.jsonl                       |
   |  +-- video/{leagueKey}.json                          |
   |  +-- video/_fallback.json                            |
   |  +-- crests/{provider}_{teamId}.{ext}                |
   |  +-- raw/{key}.json                                  |
   |  +-- predictions/snapshots.json                      |
   |  +-- predictions/archive/YYYY-MM.json                |
   |  +-- predictions/evaluations.json                    |
   |  +-- api-usage.db (+WAL +SHM)                        |
   |                                                      |
   |  data/  (SEPARATE ROOT -- not under cache/)          |
   |  +-- matches/{season}/{leagueSlug}/{matchId}.json    |
   |                                                      |
   +------------------------------------------------------+

   Legend:
   ----->  HTTP / fetch
   ---->   in-process call
   =====>  file I/O (atomic .tmp->rename or SQLite WAL)
```

**Key observations:**
- Single-process architecture. No message queues, no background workers, no distributed state.
- Provider calls happen exclusively in the Scheduler path (background), never on the HTTP read path.
- Snapshot pipeline runs on the HTTP read path when cache misses or expires.
- Two filesystem roots: `cache/` (durable Render mount) and `data/` (repo-adjacent, also on disk but different management).

---

## 7.2 Persistence Inventory

| # | Artifact | Store Type | Path | Owner Module | Truth Class | Retention / TTL | Boundedness | Pruning | Classification Tag | Issues |
|---|----------|-----------|------|-------------|-------------|----------------|------------|---------|-------------------|--------|
| 1 | Snapshot (hot) | RAM (Map) | N/A | `packages/snapshot` InMemorySnapshotStore | UI (derived) | 5min (default), 60s (live) | UNBOUNDED | None; `invalidateAll()` clears all on scheduler refresh | `UNBOUNDED_STORAGE_RISK` | Stale entries never evicted; no max-size; grows with unique key permutations |
| 2 | Matchday cache | Disk JSON | `cache/{provider}/{compId}/{season}/matchday-{NN}[-{KEY}].json` | `server/matchday-cache.ts` | CANONICAL | 1yr (finished), 6h (scheduled), 60s (live), 5min (mixed) | UNBOUNDED per season; `pruneOldSeasons()` removes prior seasons | Season-level pruning only | `CACHE_POLICY_GAP` | Within a season, files accumulate indefinitely; no per-file max-age cleanup |
| 3 | Teams cache | Disk JSON | `cache/{provider}/{compId}/teams.json` | `server/matchday-cache.ts` | CANONICAL | 7 days | Bounded (1 file per comp) | Overwritten on refresh | `NOT_AN_ISSUE` | Single file per competition; self-limiting |
| 4 | Standings cache | Disk JSON | `cache/{provider}/{compId}/standings.json` | `server/matchday-cache.ts` | UI | 1 day | Bounded (1 file per comp) | Overwritten on refresh | `NOT_AN_ISSUE` | Single file per competition |
| 5 | CompInfo cache | Disk JSON | `cache/{provider}/{compId}/comp-info.json` | `server/matchday-cache.ts` | CANONICAL | 7 days | Bounded (1 file per comp) | Overwritten on refresh | `NOT_AN_ISSUE` | Migration-on-read for old format (minor debt, not a risk) |
| 6 | Score snapshot | Disk JSON | `cache/{provider}/{compId}/score-snapshot.json` | `server/matchday-cache.ts` | CANONICAL | 7 days | Bounded (1 file per comp) | Overwritten on refresh | `STALE_FALLBACK_RISK` | If file lost, regression guard degrades silently; no alert |
| 7 | Portal config | Disk JSON | `cache/portal-config.json` | `server/portal-config-store.ts` | CONFIG | Indefinite (admin-updated) | Bounded (1 file) | N/A | `NOT_AN_ISSUE` | Atomic write; single file |
| 8 | Portal config audit | Append JSONL | `cache/portal-config-audit.jsonl` | `server/portal-config-store.ts` | AUDIT | INDEFINITE | UNBOUNDED | None | `UNBOUNDED_STORAGE_RISK` | Append-only, never truncated; grows without bound over years |
| 9 | News cache | RAM only | N/A | `server/news/news-cache.ts` | UI | 30min (URU), 60min (others) | Bounded (small key set) | Day-rolled on TZ boundary | `EPHEMERAL_DISK_RISK` | Lost on restart; 30-60min cold start; no disk fallback |
| 10 | Video cache | RAM + Disk | `cache/video/{leagueKey}.json` | `server/video/video-cache.ts` | UI | 6h (success), 2min (error) | Bounded (small key set) | Overwritten per league | `NOT_AN_ISSUE` | Warms from disk on restart |
| 11 | Video fallback record | Disk JSON | `cache/video/_fallback.json` | `server/video/video-cache.ts` | CONFIG | Day-rolled | Bounded (1 file) | Overwritten daily | `NOT_AN_ISSUE` | |
| 12 | Crest cache | Disk images | `cache/crests/{provider}_{teamId}.{ext}` | `server/crest-cache.ts` | UI | INDEFINITE | UNBOUNDED | None | `UNBOUNDED_STORAGE_RISK` | One image per team; grows with team count; low growth rate in practice (~200 teams) |
| 13 | Raw response cache | Disk JSON | `cache/raw/{key}.json` | `server/raw-response-cache.ts` | CANONICAL | Configurable | UNBOUNDED | None visible | `CACHE_POLICY_GAP` | Key collision risk if namespacing is insufficient; no max-file-count |
| 14 | Prediction snapshots (hot) | Disk JSON | `cache/predictions/snapshots.json` | `server/prediction/prediction-store.ts` | PE OUTPUT | 90 days then archive | Bounded (1 file, pruned) | 90d archive rotation | `NOT_AN_ISSUE` | Well-managed lifecycle |
| 15 | Prediction archive | Disk JSON | `cache/predictions/archive/YYYY-MM.json` | `server/prediction/prediction-store.ts` | PE OUTPUT | INDEFINITE (write-once) | UNBOUNDED | None | `UNBOUNDED_STORAGE_RISK` | ~12 files/year; very slow growth; low practical risk |
| 16 | Prediction evaluations | Disk JSON | `cache/predictions/evaluations.json` | `server/prediction/evaluation-store.ts` | PE EVAL | INDEFINITE | UNBOUNDED (single file, growing) | None | `UNBOUNDED_STORAGE_RISK` | Single file grows with every evaluated match; no pruning |
| 17 | Incidents (hierarchical) | Disk JSON | `data/matches/{season}/{leagueSlug}/{matchId}.json` | `server/incidents/incident-store.ts` | UI/EVAL | INDEFINITE | UNBOUNDED | None | `UNBOUNDED_STORAGE_RISK` | Separate root from `cache/`; accumulates across seasons |
| 18 | Incidents (legacy) | Disk JSON | `cache/incidents/{matchId}.json` | `server/incidents/incident-store.ts` | UI/EVAL | INDEFINITE | UNBOUNDED | None | `UNBOUNDED_STORAGE_RISK` | Deprecated; parallel to hierarchical; no cleanup |
| 19 | API usage ledger | SQLite WAL | `cache/api-usage.db` | `packages/canonical` ledger | AUDIT | 30d (events), indefinite (rollups) | Bounded (events pruned) | `runRetentionPruner()` at startup | `SQLITE_PATTERN_RISK` | WAL/SHM files not explicitly checkpointed; pruner runs only at startup |

---

## 7.3 Snapshot Lifecycle Map

```
STAGE 1: INGESTION (Scheduler, background)
  Scheduler tick
    -> DataSource.fetchSeason() / fetchWindow()
    -> Provider HTTP calls (football-data.org / TheSportsDB / API-Football)
    -> Canonical models built in-memory (Match[], Team[], Competition)
    -> Matchday JSON persisted to disk (atomic .tmp->rename)
    -> Teams/Standings/CompInfo/ScoreSnapshot persisted to disk
    -> SnapshotService.invalidateAll() called
       [DRIFT POINT D1: invalidateAll() clears ALL entries including
        competitions not refreshed in this cycle]

STAGE 2: SNAPSHOT BUILD (HTTP read path, on cache miss)
  GET /api/ui/dashboard?competitionId=X&dateLocal=Y
    -> buildSnapshotKey(compId, seasonId, buildNowUtc, policyKey, policyVersion, matchday, subTournamentKey)
    -> InMemorySnapshotStore.get(key)
       HIT  -> return cached snapshot (X-Snapshot-Source: cache)
       MISS -> proceed to build
    -> DataSource.getMatches() [from in-memory canonical, NOT provider call]
    -> signals.computeSignals(matches, buildNowUtc)
    -> scoring.applyPolicy(signals, policyKey, policyVersion)
    -> layout.squarify(scores, viewport)
    -> snapshot.assemble(header + tiles + matchCards)
    -> InMemorySnapshotStore.set(key, snapshot, ttlMs)
       [DRIFT POINT D2: ttlMs varies (60s live, 5min default) but
        buildNowUtc is fixed per dateLocal -- same key, different
        real-time state if matches go live during the 5min window]
    -> return snapshot (X-Snapshot-Source: fresh)

  STALE FALLBACK (build failure):
    -> InMemorySnapshotStore.getStale(key)
       HIT  -> return with STALE_DATA warning (X-Snapshot-Source: stale_fallback)
       MISS -> 503 SnapshotBuildFailed
       [DRIFT POINT D3: after restart, stale fallback is empty --
        first request after restart with build failure = 503]

STAGE 3: API RESPONSE
  -> DashboardSnapshotDTO serialized to JSON
  -> Header includes: snapshotKey, buildNowUtc, computedAtUtc, policyKey, policyVersion
  -> X-Snapshot-Source header set

STAGE 4: FRONTEND RENDER
  -> React consumes DTO
  -> No recomputation of scoring/layout (constitutional constraint)
  -> Dates displayed via Intl.DateTimeFormat with America/Montevideo TZ

DRIFT POINTS SUMMARY:
  D1: Over-invalidation -- invalidateAll() is a blunt instrument; all
      competitions lose cache even if only one refreshed.
  D2: Time-of-request sensitivity -- buildNowUtc is derived from dateLocal
      (noon UTC-3), so intra-day state changes (match going live) are captured
      only when snapshot TTL expires and rebuild occurs. This is BY DESIGN
      (snapshot-first architecture) but means TTL is the only freshness
      guarantee for live state.
  D3: Cold-start vulnerability -- after process restart, RAM snapshot store
      is empty. No disk persistence means first requests always rebuild.
      Combined with empty stale fallback, a build failure on cold start = 503.
```

---

## 7.4 Cache Discipline Report

### 7.4.1 InMemorySnapshotStore

| Attribute | Assessment |
|-----------|-----------|
| **Ownership** | `packages/snapshot/src/store/snapshot-store.ts` -- single owner, clean interface |
| **Boundedness** | UNBOUNDED. `Map<string, CacheEntry>` with no max-size, no eviction policy, no LRU. Expired entries remain in map until `invalidateAll()`. |
| **Invalidation quality** | COARSE. `invalidateAll()` clears everything; no per-key or per-competition invalidation. Called on every scheduler refresh cycle. |
| **Stale semantics** | WELL-DEFINED. `getStale()` returns expired entries explicitly for fallback. `X-Snapshot-Source: stale_fallback` header communicates staleness. STALE_DATA warning injected into DTO. |
| **Observability** | WEAK. No hit/miss rate tracking. No cache size logging. No memory pressure monitoring. Only `X-Snapshot-Source` header on responses. |
| **Corruption recovery** | N/A (RAM-only). Process restart is the recovery mechanism. |
| **Classification** | `UNBOUNDED_STORAGE_RISK` (RAM growth), `READ_PATH_RECOMPUTATION` (rebuild on miss), `OBSERVABILITY_GAP` (no metrics) |

### 7.4.2 Matchday File Cache

| Attribute | Assessment |
|-----------|-----------|
| **Ownership** | `server/matchday-cache.ts` -- single owner with clear API surface |
| **Boundedness** | SEMI-BOUNDED. `pruneOldSeasons()` removes prior season directories. Within current season, files accumulate per matchday (38 matchdays x N sub-tournaments -- manageable). |
| **Invalidation quality** | GOOD. Status-based TTLs (finished=1yr, scheduled=6h, live=60s, mixed=5min). Merge-before-persist prevents partial overwrites. |
| **Stale semantics** | IMPLICIT. TTL-expired files return undefined (cache miss), triggering fresh fetch. No stale-serve-while-revalidate pattern. |
| **Observability** | GOOD. `[MatchdayCache]` log prefix with CACHE_HIT/MISS/INVALID/STALE/WRITE_SUCCESS/WRITE_ERROR events. |
| **Corruption recovery** | GOOD. Atomic `.tmp->rename` writes. `cleanupOrphanedTmpFiles()` exists but requires explicit invocation (called at startup per competition). |
| **Classification** | `NOT_AN_ISSUE` for current scale. `CACHE_POLICY_GAP` minor: no max-file-count guard. |

### 7.4.3 News Cache

| Attribute | Assessment |
|-----------|-----------|
| **Ownership** | `server/news/news-cache.ts` -- single owner |
| **Boundedness** | Bounded by league key count (small, fixed set) |
| **Invalidation quality** | GOOD. TTL-based (30min URU, 60min others). Day-rolled on Montevideo TZ boundary. |
| **Stale semantics** | ABSENT. Expired = gone. No stale fallback. |
| **Observability** | MINIMAL. No hit/miss logging observed. |
| **Corruption recovery** | N/A (RAM-only). Recovery = wait for next fetch cycle (30-60min). |
| **Classification** | `EPHEMERAL_DISK_RISK` -- RAM-only means restart loses all news cache. Recovery window is 30-60min of missing news (UI-only, non-critical). |

### 7.4.4 Video Cache

| Attribute | Assessment |
|-----------|-----------|
| **Ownership** | `server/video/video-cache.ts` -- single owner |
| **Boundedness** | Bounded by league key count |
| **Invalidation quality** | GOOD. 6h TTL for success, 2min for errors. |
| **Stale semantics** | GOOD. Warms from disk on restart -- survives process restart. |
| **Observability** | ADEQUATE for current scale. |
| **Corruption recovery** | Disk file is overwritten; corrupt file = cache miss = re-fetch. |
| **Classification** | `NOT_AN_ISSUE` |

### 7.4.5 Prediction Store (hot + archive)

| Attribute | Assessment |
|-----------|-----------|
| **Ownership** | `server/prediction/prediction-store.ts` -- single owner |
| **Boundedness** | Hot file: bounded (90d pruning). Archive: unbounded but slow growth (~12 files/year). |
| **Invalidation quality** | GOOD. Hot file rewritten each cycle. Archive is append-only (write-once). |
| **Stale semantics** | ADEQUATE. Hot file reflects latest PE cycle. |
| **Observability** | ADEQUATE. |
| **Corruption recovery** | Hot file: rewritten next cycle. Archive: write-once, immutable. |
| **Classification** | `NOT_AN_ISSUE` for current scale. `UNBOUNDED_STORAGE_RISK` at decade scale (minor). |

### 7.4.6 API Usage Ledger (SQLite)

| Attribute | Assessment |
|-----------|-----------|
| **Ownership** | `packages/canonical/src/api-usage/ledger.ts` -- single owner |
| **Boundedness** | Events: bounded (30d pruning via `runRetentionPruner`). Rollups: unbounded but 1 row/provider/date/consumer -- very slow growth. |
| **Invalidation quality** | N/A (append-only audit log). |
| **Stale semantics** | N/A. |
| **Observability** | GOOD. Every provider call logged with latency, success, cache_hit. |
| **Corruption recovery** | SQLite WAL mode provides crash recovery. However, no explicit `wal_checkpoint` call found in codebase. WAL file can grow unbounded between checkpoints. |
| **Classification** | `SQLITE_PATTERN_RISK` -- WAL growth without explicit checkpoint. |

### 7.4.7 Incident Store

| Attribute | Assessment |
|-----------|-----------|
| **Ownership** | `server/incidents/incident-store.ts` -- single owner but TWO storage paths |
| **Boundedness** | UNBOUNDED in both hierarchical and legacy paths. No pruning. |
| **Invalidation quality** | FINISHED matches sealed (immutable). LIVE/HT mutable (overwritten). |
| **Stale semantics** | N/A (write-once for finished). |
| **Observability** | MINIMAL. |
| **Corruption recovery** | Atomic writes for individual files. No bulk recovery mechanism. |
| **Classification** | `UNBOUNDED_STORAGE_RISK` -- two parallel stores, no cleanup. `WEAK_KEYING` -- `data/` root outside `cache/` mount, management asymmetry. |

---

## 7.5 Keying and Provenance Assessment

### Snapshot Key Composition

```
Format: {competitionId}|{seasonId}|{buildNowUtc}|{policyKey}@{policyVersion}[|jornada:{matchday}][|sub:{subTournamentKey}]
Example: football-data:PD|2025|2026-03-20T15:00:00Z|attention-v1@3|jornada:28
```

| Dimension | Assessment |
|-----------|-----------|
| **Collision resistance** | STRONG. All identity-bearing dimensions are included. The `|` separator combined with typed prefixes (`jornada:`, `sub:`, `@`) prevents ambiguity. |
| **Provenance visibility** | GOOD. `snapshotKey` is included in the DTO header alongside `buildNowUtc`, `computedAtUtc`, `policyKey`, `policyVersion`. Consumer can trace which policy and time anchor produced any snapshot. |
| **Rebuild reproducibility** | STRONG BY DESIGN. Same canonical data + same `buildNowUtc` + same policy = identical output (constitutional invariant). In practice, reproducibility depends on canonical data still being available (in-memory after restart = gone; must re-fetch from provider or disk cache). |
| **Key cardinality** | MODERATE CONCERN. Key includes `buildNowUtc` which is derived from `dateLocal` (noon). Each unique `dateLocal` x `competitionId` x `matchday` x `subTournamentKey` produces a unique key. With 4-6 competitions, ~38 matchdays, and ~365 dates/year, cardinality is bounded but entries accumulate in RAM until `invalidateAll()`. |
| **Classification** | `NOT_AN_ISSUE` for keying correctness. `UNBOUNDED_STORAGE_RISK` for cardinality growth in RAM store (cross-ref with 7.4.1). |

### Provenance Chain

```
Provider response -> Canonical model (in-memory) -> Matchday cache (disk, keyed by provider/comp/season/matchday)
  -> Snapshot (RAM, keyed by identity tuple) -> API response (DTO with header.snapshotKey)
```

**Gap:** No provenance link from snapshot back to the specific matchday cache files that sourced it. If a snapshot is suspected incorrect, tracing requires manual correlation of `buildNowUtc` to matchday file timestamps.

**Classification:** `OBSERVABILITY_GAP` -- no snapshot-to-source traceability link.

---

## 7.6 Scaling Risk Register

| # | Risk Name | Classification Tag | Description | Trigger | Impact | Severity | Likelihood | Recommended Action |
|---|-----------|-------------------|-------------|---------|--------|----------|-----------|-------------------|
| R1 | Unbounded RAM snapshot growth | `UNBOUNDED_STORAGE_RISK` | InMemorySnapshotStore never evicts expired entries. Map grows with every unique key until `invalidateAll()`. | Many unique dateLocal queries (bots, crawlers, or legitimate multi-day navigation) between scheduler cycles. | Memory pressure, potential OOM on constrained Render instance. | HIGH | MED | Add max-size cap (LRU or max-entries) to InMemorySnapshotStore. Evict expired entries on `get()` or periodically. |
| R2 | Cold-start snapshot unavailability | `STALE_FALLBACK_RISK` | After process restart, RAM snapshot store is empty. No disk persistence. First request must rebuild from scratch. If rebuild fails, no stale fallback exists -> 503. | Process restart (deploy, crash, Render maintenance). | Burst of 503s until first successful rebuild per competition. Latency spike on first requests. Provider quota consumed for rebuilds. | HIGH | HIGH | Persist last-good snapshot to disk. Load on startup as stale fallback seed. |
| R3 | Snapshot rebuild on read path | `READ_PATH_RECOMPUTATION` | Snapshot pipeline (signals -> scoring -> layout) runs synchronously on the HTTP request path when cache misses. | Every first request per key after `invalidateAll()` or TTL expiry. | P99 latency spike. Request blocks until full pipeline completes. | MED | HIGH | Accept as architectural trade-off (snapshot-first design). Mitigate with disk persistence (R2) and background pre-build after invalidation. |
| R4 | Portal config audit log unbounded | `UNBOUNDED_STORAGE_RISK` | `portal-config-audit.jsonl` is append-only with no retention policy. | Long-running deployment with frequent admin config changes. | Disk space consumption. Very slow growth rate (~100 bytes/entry). | LOW | LOW | Add yearly rotation or max-size truncation. Non-urgent given growth rate. |
| R5 | Incidents dual-store accumulation | `UNBOUNDED_STORAGE_RISK` | Two parallel incident stores (hierarchical under `data/` + legacy under `cache/`) both grow indefinitely with no pruning. | Seasons accumulate. Each match produces one file in each store. | Disk consumption grows ~2KB/match x 2 stores x ~2000 matches/year = ~8MB/year. Manageable but unbounded. | LOW | HIGH (accumulation certain) | Deprecate legacy store. Add season-based pruning to hierarchical store. |
| R6 | Prediction evaluations unbounded | `UNBOUNDED_STORAGE_RISK` | Single `evaluations.json` file grows with every evaluated match. No pruning. | Continuous operation over months/years. | File read/write latency increases as JSON grows. Potential multi-MB file. | MED | HIGH (accumulation certain) | Add seasonal archival (similar to prediction snapshots hot->archive pattern). |
| R7 | SQLite WAL file growth | `SQLITE_PATTERN_RISK` | No explicit `wal_checkpoint` in codebase. WAL file grows between implicit checkpoints (SQLite auto-checkpoint at 1000 pages). | High-frequency INSERT on every provider API call. | WAL file grows large between auto-checkpoints. Not dangerous with WAL mode defaults but represents uncontrolled growth between checkpoints. | LOW | MED | Add explicit periodic `PRAGMA wal_checkpoint(TRUNCATE)` after retention pruning. |
| R8 | News cache cold-start gap | `EPHEMERAL_DISK_RISK` | News cache is RAM-only. Process restart loses all cached news. Recovery requires 30-60min of RSS/API fetches. | Process restart. | News tab shows empty/stale content for up to 60 minutes post-restart. | LOW | HIGH (every restart) | Add disk persistence (warm-from-disk pattern, same as VideoCache). |
| R9 | Over-invalidation on scheduler refresh | `CACHE_POLICY_GAP` | `invalidateAll()` clears snapshots for ALL competitions when ANY competition refreshes. | Scheduler refreshes one competition; all others lose their cached snapshots. | Unnecessary rebuild cost for unaffected competitions. Latency spikes on next request for those competitions. | MED | HIGH (every scheduler cycle) | Implement per-competition invalidation: `invalidate(competitionId)` instead of `invalidateAll()`. |
| R10 | Score snapshot silent degradation | `STALE_FALLBACK_RISK` | Score regression guard depends on `score-snapshot.json` (7-day TTL). If file is lost or corrupted, guard degrades silently with no alert. | File deletion, disk corruption, manual cleanup. | Finished match scores could regress to 0-0 without detection. Data quality risk. | HIGH | LOW | Add startup health check that verifies score-snapshot files exist for active competitions. Log warning if missing. |
| R11 | Orphaned .tmp file accumulation | `CACHE_POLICY_GAP` | `cleanupOrphanedTmpFiles()` exists but requires explicit call. Only called at startup per competition. Crash during write leaves orphaned .tmp files. | Process crash during atomic write. | Disk clutter. No functional impact (orphaned .tmp files are ignored by cache reads). | LOW | LOW | Current explicit cleanup at startup is sufficient. No action needed. |
| R12 | `data/` path outside `cache/` mount | `WEAK_KEYING` | Hierarchical incidents stored under `data/matches/` which is a separate filesystem root from `cache/`. Not covered by standard cache management, backup, or monitoring. | Always active. | Incidents not included in cache-level backup or monitoring. Management asymmetry. | MED | HIGH (always true) | Either move to `cache/incidents-v2/` or explicitly document `data/` as a managed path with its own backup/monitoring. |
| R13 | Multi-instance incompatibility (deferred) | `DEPLOYMENT_TOPOLOGY_RISK` | All caches are single-process (RAM Map or local disk files). No distributed cache layer. SQLite does not support concurrent writers from multiple processes safely. | Scaling to multiple Render instances. | Cache incoherence, SQLite write conflicts, split-brain snapshots. | CRITICAL | LOW (single instance today) | Deferred. Document as constraint. If scaling needed: Redis for snapshots, PostgreSQL for SQLite replacement, shared disk or object storage for file caches. |
| R14 | Raw response cache key collision | `WEAK_KEYING` | `cache/raw/{key}.json` key generation not verified for namespace isolation between providers/endpoints. | Two different API responses produce the same cache key. | Incorrect data served from cache. Silent data corruption. | HIGH | LOW (depends on key implementation) | Audit `raw-response-cache.ts` key generation for namespace correctness. Add provider prefix if missing. |
| R15 | Training/runtime contention (PE) | `TRAINING_RUNTIME_CONTENTION` | `cache/predictions/snapshots.json` is read by portal runtime (GET /api/ui/predictions) and written by PE shadow runner (scheduler-triggered). Both run in the same process. | PE shadow runner writes while portal serves read requests. | Potential torn read if write is not atomic. Atomic .tmp->rename mitigates this for the file, but in-memory state in PredictionStore could serve partial data during write cycle. | MED | MED | Verify PredictionStore uses read-copy-update or lock-free pattern for in-memory state during write cycles. If not, add synchronization. |
| R16 | Snapshot cache observability gap | `OBSERVABILITY_GAP` | No metrics for: snapshot cache hit rate, cache size, build duration, memory usage, file descriptor count. Only `X-Snapshot-Source` header on individual responses. | Always active. Cannot detect degradation until symptoms are user-visible. | Blind to memory pressure, cache thrashing, build latency regression. | MED | HIGH (always true) | Add periodic logging: cache entry count, estimated memory, hit/miss ratio. Expose via `/api/admin/health` or similar. |

---

## 7.7 Operational Readiness Assessment

### 7.7.1 Repeatable Deploys

**GOOD.** Render deploys from `main` branch. `Dockerfile` is explicit about package inclusion. `pnpm --frozen-lockfile` ensures reproducible dependencies. `validateEnv()` fails startup on missing vars. `assertRoutingParity()` fails startup on config/route mismatch.

**Gap:** No pre-deploy smoke test in CI pipeline (manual `pnpm smoke-test` exists but is not automated on every push). Classification: `OBSERVABILITY_GAP`.

### 7.7.2 Rollback

**ADEQUATE.** Render supports instant rollback to previous deploy. Disk state (`cache/`) persists across deploys and rollbacks. No database migrations that would break backward compatibility (SQLite schema migrations are additive).

**Gap:** Rollback does not restore `cache/` state. If a bad deploy corrupted cache files, rollback restores code but not data. Classification: `STALE_FALLBACK_RISK`.

### 7.7.3 Rebuild After Failure

**PARTIAL.** After process crash:
- Disk caches survive (matchday, teams, standings, video, predictions, incidents, SQLite).
- RAM caches lost (snapshots, news). Snapshots rebuild on next request. News recovers in 30-60min.
- Score-snapshot regression guard survives (disk-based, 7d TTL).
- Portal config survives (disk-based).

**Gap:** No snapshot disk persistence means cold-start latency spike and potential 503s if rebuild fails. Classification: `STALE_FALLBACK_RISK`.

### 7.7.4 Stale Fallback Honesty

**GOOD.** Stale snapshots are explicitly marked:
- `X-Snapshot-Source: stale_fallback` header
- `STALE_DATA` warning injected into DTO
- Frontend can (and should) display staleness indicator

**Gap:** After restart, stale fallback is empty. The system goes from "stale with warning" to "503 with no fallback" -- a cliff edge rather than graceful degradation. Classification: `STALE_FALLBACK_RISK`.

### 7.7.5 Store Recovery

| Store | Recovery Path | Assessment |
|-------|--------------|-----------|
| Snapshots (RAM) | Rebuild on next request | Automatic but slow; no disk seed |
| Matchday cache (disk) | Re-fetch from provider on TTL expiry | Automatic; consumes API quota |
| News (RAM) | Re-fetch on next cycle (30-60min) | Automatic but slow |
| Video (RAM+disk) | Warm from disk on restart | Good |
| Predictions (disk) | Survive restart | Good |
| SQLite (disk) | WAL recovery on open | Good |
| Incidents (disk) | Survive restart | Good; FINISHED sealed |
| Portal config (disk) | Survive restart | Good |

### 7.7.6 Migration Path

**ADEQUATE for current scale.** The architecture is explicitly single-instance. Migration to multi-instance would require:
1. External cache (Redis) for snapshots
2. PostgreSQL for SQLite replacement
3. Shared storage for disk caches
4. Distributed invalidation mechanism

This is correctly deferred per MVP scope. The Constitution does not mandate multi-instance support.

---

## 7.8 Recommendation

### **SUFFICIENT_WITH_HARDENING**

The current architecture is sound for its declared topology (single Render instance, snapshot-first, durable disk). The pipeline correctly separates provider calls from the read path. Keying is deterministic and collision-resistant. Stale fallback semantics are well-defined when the store is populated.

However, three hardening items should be addressed before the system operates at higher traffic or with more competitions:

1. **InMemorySnapshotStore needs bounded eviction** (R1) -- the unbounded Map is the single highest-risk item in the current architecture.
2. **Snapshot disk persistence for cold-start resilience** (R2) -- eliminates the 503 cliff edge after restart.
3. **Per-competition invalidation** (R9) -- reduces unnecessary rebuild cost and latency.

All other findings are LOW severity or represent long-term debt that does not threaten current operations.

---

## 11 Verdict

#### Verdict
SUFFICIENT_WITH_HARDENING

#### Reason
The runtime storage architecture is well-designed for its single-instance topology. Provider isolation is correctly enforced (no provider calls on the read path). Snapshot keying is deterministic, collision-resistant, and includes full provenance. Disk caches use atomic writes and status-based TTLs. The stale fallback protocol is honest when the store is populated. The primary risks are: (1) the unbounded in-memory snapshot store which can grow without limit between scheduler invalidation cycles, (2) the absence of snapshot disk persistence which creates a cold-start cliff edge where restart + build failure = 503 with no fallback, and (3) coarse-grained invalidation that unnecessarily clears all competitions on every scheduler refresh. None of these are architectural defects -- they are hardening gaps in an otherwise sound design. The system is sufficient for current production load but should be hardened before scaling competition count or traffic.

#### Immediate next actions
1. **Add LRU eviction to InMemorySnapshotStore** -- cap at max entries (e.g., 200), evict least-recently-used on insert. Remove expired entries on `get()`. [R1, `UNBOUNDED_STORAGE_RISK`]
2. **Add snapshot disk persistence** -- write last-good snapshot to `cache/snapshots/{competitionId}.json` on successful build. Load as stale seed on startup. [R2, `STALE_FALLBACK_RISK`]
3. **Implement per-competition invalidation** -- replace `invalidateAll()` with `invalidate(competitionId)` that clears only keys matching the refreshed competition. [R9, `CACHE_POLICY_GAP`]
4. **Add snapshot cache observability** -- log cache entry count, hit/miss ratio, and build duration periodically (every 5min or on each build). [R16, `OBSERVABILITY_GAP`]
5. **Add disk persistence to NewsCache** -- follow the VideoCache warm-from-disk pattern to survive restarts. [R8, `EPHEMERAL_DISK_RISK`]
6. **Add explicit SQLite WAL checkpoint** -- `PRAGMA wal_checkpoint(TRUNCATE)` after `runRetentionPruner()` at startup. [R7, `SQLITE_PATTERN_RISK`]
7. **Verify PredictionStore read/write synchronization** -- confirm atomic .tmp->rename is sufficient for the in-memory state lifecycle during PE write cycles. [R15, `TRAINING_RUNTIME_CONTENTION`]
8. **Add score-snapshot health check** -- log warning at startup if `score-snapshot.json` is missing for any active competition. [R10, `STALE_FALLBACK_RISK`]

#### Deferred items
- **D1:** Deprecate legacy incident store (`cache/incidents/`) and migrate to hierarchical-only. [R5]
- **D2:** Add seasonal archival to prediction evaluations (same pattern as prediction snapshots). [R6]
- **D3:** Add retention policy to `portal-config-audit.jsonl` (yearly rotation). [R4]
- **D4:** Move hierarchical incidents from `data/` to `cache/` root or document as separately managed path. [R12]
- **D5:** Audit `raw-response-cache.ts` key generation for namespace correctness. [R14]
- **D6:** Add crest cache size monitoring (very low priority -- ~200 files, stable). [R12 from persistence table]
- **D7:** Multi-instance architecture (Redis, PostgreSQL, shared storage) -- deferred until scaling need is concrete. [R13]

---

*End of audit.*
