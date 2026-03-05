# Plan: SP-0505 — Snapshot Cache/Store & Stale Fallback

## Spec refs
- snapshot-engine-spec-corrected.md §8 (caching, staleness, rebuild)
- api-contract-corrected.md §10 (fallback behavior)
- Operational_Baseline_v1.0.md (performance: p95 <100ms cached)

## Design decisions

### MVP: in-memory Map store (no Postgres/Redis yet)
For MVP, use a simple in-memory Map keyed by snapshotKey. This satisfies:
- Cache-first serve strategy
- Stale fallback on build failure
- p95 <100ms (memory lookup is instant)

Future: replace with Postgres/Redis per Operational_Baseline when persistence is needed.

### SnapshotStore interface
```ts
export interface SnapshotStore {
  get(key: string): DashboardSnapshotDTO | undefined;
  set(key: string, snapshot: DashboardSnapshotDTO): void;
  has(key: string): boolean;
}
```

### SnapshotService (orchestrates build + cache)
```ts
export interface SnapshotServiceConfig {
  store: SnapshotStore;
  defaultPolicy: PolicyDefinition;
  defaultContainer: TreemapContainer;
}

export interface ServeSnapshotInput {
  competitionId: string;
  seasonId: string;
  dateLocal: string;
  timezone: string;
  teams: readonly Team[];
  matches: readonly Match[];
  freshnessUtc?: string;
}

export interface ServeResult {
  snapshot: DashboardSnapshotDTO;
  source: 'cache' | 'fresh' | 'stale_fallback';
}

export class SnapshotService {
  constructor(config: SnapshotServiceConfig);
  serve(input: ServeSnapshotInput): ServeResult;
}
```

### Serve strategy (per spec §8.1)
```
1. Compute snapshotKey from input
2. If store.has(key) → return { snapshot: store.get(key), source: 'cache' }
3. Try buildSnapshot(input)
4. If build succeeds → store.set(key, snapshot), return { source: 'fresh' }
5. If build throws → if store.has(key) → return stale + STALE_DATA warning, source: 'stale_fallback'
6. If build throws AND no cached → throw SnapshotBuildFailed error
```

### MVP simplification
- No TTL (every unique key is cached forever in memory for the session)
- No background rebuild
- No soft/hard TTL distinction
- These are deferred to post-MVP per spec §8.2 ("defined by config")

### Warning injection on stale
When serving stale fallback, inject `{ code: 'STALE_DATA', severity: 'WARN', message: 'Serving cached snapshot due to build failure' }` into existing warnings.

## Files to create
1. `packages/snapshot/src/store/snapshot-store.ts` — SnapshotStore interface + InMemorySnapshotStore
2. `packages/snapshot/src/service/snapshot-service.ts` — SnapshotService class
3. `packages/snapshot/test/snapshot-store.test.ts` — store tests
4. `packages/snapshot/test/snapshot-service.test.ts` — service tests with mock build

## Tests (mapped to acceptance)
- E-03: cache hit returns same snapshot without rebuild
- E-04: build failure with cached → returns stale + STALE_DATA warning
- E-04: build failure without cached → throws SnapshotBuildFailed
- G-01: stale fallback preserves valid DTO shape

## Implementation notes for Sonnet
- InMemorySnapshotStore: simple `new Map<string, DashboardSnapshotDTO>()`
- SnapshotService.serve(): wrap buildSnapshot in try/catch
- SnapshotBuildFailed: custom error class extending Error, with code = 'SNAPSHOT_BUILD_FAILED'
- Do NOT add TTL, eviction, or Redis — that's post-MVP
- Store is injected (dependency injection), making it testable
