# SP-API-USAGE-GOVERNANCE -- API Usage Governance and Quota Ledger

**Status:** PLAN COMPLETE -- ready for implementation
**Created:** 2026-03-18
**Spec:** SPEC-SPORTPULSE-OPS-API-USAGE-GOVERNANCE v0.1
**Tier:** opus (design) -> sonnet (implementation) -> haiku (CI/configs)

---

## 1. Scope Statement (v1)

### In scope for v1

- Unified `InstrumentedProviderClient` wrapper en `packages/canonical` que instrumenta cada HTTP call a providers
- Append-only event ledger en SQLite (`cache/api-usage.db`, 3 tablas del spec §11)
- Daily rollup aggregation via UPSERT síncrono en api_usage_daily_rollups
- ConsumerType tagging on every call
- Migration of `af-budget.ts` into the new system (absorb, not wrap)
- Internal ops endpoints for today's usage, per-provider stats, and event tail
- CI guard preventing raw `fetch()` to provider URLs outside the governed path
- Priority tiers (product-critical, deferrable, non-critical) as metadata -- enforcement deferred to v1.1

### Deferred to v1.1
- Automatic quota enforcement / circuit breaker per provider (v1 preserves AF's existing hard-limit logic)
- Historical event queries beyond "today + last 7 days"
- Admin UI for quota configuration
- Alert/webhook on threshold breach
- Rate limiting / backpressure by priority tier

### Explicitly out of scope

- Tracking RSS feeds (no quota, no cost)
- Tracking OpenLigaDB (free, no quota)
- Tracking `crest-cache.ts` image fetches (static assets, not API calls)
- Tracking `stream-embed-service.ts` scraping (not a metered API)
- Moving provider adapters from `server/` to `packages/canonical` (separate migration ticket)

---

## 2. Architecture Decisions

### Decision 1: Persistence -- SQLite con better-sqlite3 ✅ DECISIÓN DEL USUARIO

**Choice:** SQLite. Una única DB en `cache/api-usage.db`. WAL mode. Tablas según §11 del spec.

**Justification:**
- Los rollups y el drill-down de §14 requieren queries flexibles (GROUP BY provider, consumer_type, date). NDJSON obliga a scan completo del archivo.
- `better-sqlite3` es síncrono y zero-configuration — compatible con single-process Node.js.
- El disco persistente de Render sobrevive deploys y reinicios, igual que `cache/af-budget.json`.
- El spec §11 define explícitamente tablas relacionales. SQLite es la implementación más fiel.
- Nativo binario en Docker: resuelto agregando `better-sqlite3` como dep en `packages/canonical/package.json` y construyendo con `pnpm install --frozen-lockfile` (Render ya lo hace así).

**Schema (implementa spec §11 exactamente):**
```sql
-- §11.1: provider_quota_config
CREATE TABLE IF NOT EXISTS provider_quota_config (
  provider_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  unit_type TEXT NOT NULL DEFAULT 'REQUEST',
  daily_limit INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  warning_threshold_pct INTEGER NOT NULL DEFAULT 75,
  critical_threshold_pct INTEGER NOT NULL DEFAULT 90,
  hard_stop_threshold_pct INTEGER NOT NULL DEFAULT 95,
  allow_noncritical_when_low INTEGER NOT NULL DEFAULT 1,  -- boolean
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

-- §11.2: api_usage_events (append-only)
CREATE TABLE IF NOT EXISTS api_usage_events (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  usage_date_local TEXT NOT NULL,   -- YYYY-MM-DD in provider timezone
  unit_type TEXT NOT NULL DEFAULT 'REQUEST',
  usage_units INTEGER NOT NULL DEFAULT 1,
  consumer_type TEXT NOT NULL,
  consumer_id TEXT,
  module_key TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  request_method TEXT NOT NULL DEFAULT 'GET',
  endpoint_template TEXT NOT NULL,
  status_code INTEGER,
  success INTEGER NOT NULL DEFAULT 1,   -- boolean
  rate_limited INTEGER NOT NULL DEFAULT 0,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  started_at_utc TEXT NOT NULL,
  finished_at_utc TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  remote_limit INTEGER,
  remote_remaining INTEGER,
  remote_reset_at_utc TEXT,
  error_code TEXT,
  error_class TEXT,
  request_id TEXT,
  metadata_json TEXT,   -- JSON, no secrets
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_events_provider_date ON api_usage_events(provider_key, usage_date_local);
CREATE INDEX IF NOT EXISTS idx_usage_events_consumer ON api_usage_events(consumer_type, usage_date_local);

-- §11.3: api_usage_daily_rollups (materialized view via trigger/upsert)
CREATE TABLE IF NOT EXISTS api_usage_daily_rollups (
  provider_key TEXT NOT NULL,
  usage_date_local TEXT NOT NULL,
  consumer_type TEXT NOT NULL,
  used_units INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  rate_limited_count INTEGER NOT NULL DEFAULT 0,
  cache_hit_count INTEGER NOT NULL DEFAULT 0,
  last_remote_limit INTEGER,
  last_remote_remaining INTEGER,
  last_remote_reset_at_utc TEXT,
  last_seen_at_utc TEXT NOT NULL,
  PRIMARY KEY (provider_key, usage_date_local, consumer_type)
);
```

**File:** `cache/api-usage.db` (WAL mode, survives restarts).
**Migrations:** Run on startup via versioned migration table. No raw schema assertions.

### Decision 2: af-budget.ts -- Absorb and replace

**Choice:** The new `ApiUsageLedger` absorbs `af-budget.ts` entirely. `af-budget.ts` is deleted.

**Justification:**
- Two sources of truth for AF quota is a maintenance hazard. The ledger already tracks per-provider daily counts.
- The existing `consumeRequest()` / `isQuotaExhausted()` / `markQuotaExhausted()` / `getBudgetStats()` API surface is preserved as methods on the new ledger, scoped to AF.
- The existing `cache/af-budget.json` format is migrated on first startup: if old file exists, seed the new rollup with its count, then delete the old file.
- All 12 files that import from `af-budget.ts` are updated to import from the new ledger.

**Migration safety:** The new ledger exposes the exact same function signatures as af-budget. The migration is a search-and-replace of import paths + a thin adapter if needed during transition.

### Decision 3: Placement -- packages/canonical ✅ DECISIÓN DEL USUARIO

**Choice:** El `InstrumentedProviderClient` y el `ApiUsageLedger` viven en `packages/canonical/src/api-usage/`. Los tipos van en `packages/shared`. Las ops routes van en `packages/api`.

**Justification:**
- El spec §9.1 dice explícitamente que `packages/canonical` es el dueño del instrumented client y del provider-facing wrapper. La decisión del usuario es consistente con el spec.
- `packages/canonical` puede depender de `packages/shared` (boundary correcta). Puede importar `better-sqlite3` y `node:fs` sin problema.
- `packages/api` puede importar de `packages/canonical` para exponer los ops endpoints (boundary correcta: api → canonical está permitido en la dependency chain).
- `server/` importa `InstrumentedProviderClient` y `ApiUsageLedger` desde `@sportpulse/canonical` — igual que importa otros tipos canonicales hoy.
- Este placement ES la migración correcta: cuando los adapters de providers se muevan a `packages/canonical` (SP-AF-MIGRATION), el client ya está donde debe estar. Cero trabajo duplicado.

**Boundary chain resultante:**
```
packages/shared (tipos)
  ↑
packages/canonical (ledger + instrumented client + SQLite)
  ↑
packages/api (ops routes: GET /api/internal/ops/api-usage/*)
  ↑
server/ (composition root: importa client, lo pasa a adapters)
```

**Nota sobre tsconfig:** Al agregar `packages/canonical` como nuevo módulo exportador de estos tipos, verificar que `tsconfig.server.json` ya mapea `@sportpulse/canonical`. Si no, agregarlo (GOV-00 lo incluye).

---

## 3. Authoritative Spec References

| Spec | Relevance |
|------|-----------|
| Constitution v2.0 SS2 (Determinism) | Ledger must not affect pipeline determinism |
| Constitution v2.0 SS14 (Observability) | This feature IS the observability layer for external APIs |
| Operational Baseline SS5 (Logging) | Structured logging format must align |
| Repo Structure SS3 (Module boundaries) | Placement decision must respect boundaries |
| MVP Execution Scope | API governance is ops infrastructure, not product feature -- no UI in `web` |
| Domain Glossary | ProviderKey, ConsumerType are new domain terms -- must be added |

---

## 4. Assumptions

1. **Single-process server.** SportsPulse runs one Node.js process. No need for distributed counters or file locking beyond atomic write.
2. **Render persistent disk** at `cache/` survives restarts and deploys. Confirmed in MEMORY.md.
3. **NDJSON append is fast enough.** At peak (~200 AF calls/day + ~50 FD + ~10 YT + ~20 odds), we write ~280 lines/day. Even at 1000 lines/day, sequential scan of a day file takes <1ms.
4. **No real-time alerting in v1.** Threshold warnings are logged to stdout (picked up by Render logs). Webhook/email alerting is v1.1.
5. **The Odds API has a quota** (500 requests/month on free tier). It should be tracked even though it has no existing budget module.
6. **TheSportsDB free tier** has no hard quota but should be tracked for visibility.

---

## 5. Complete Call Site Inventory

Every file in the codebase that makes outbound HTTP calls to metered provider APIs:

### Provider: API-Football (providerKey: `api-football`)

| File | Consumer | Calls | Currently tracked? |
|------|----------|-------|--------------------|
| `server/api-football-canonical-source.ts` | CANONICAL_INGESTION | `fetch()` L678 | YES (af-budget) |
| `server/api-football-source.ts` | CANONICAL_INGESTION | `fetch()` L193 | YES (af-budget) |
| `server/apifootball-live-overlay.ts` | PORTAL_RUNTIME | `fetch()` L283 | YES (af-budget) |
| `server/api-football-cli-overlay.ts` | PORTAL_RUNTIME | `fetch()` L180 | YES (af-budget) |
| `server/incidents/apifootball-incident-source.ts` | PORTAL_RUNTIME | `fetch()` L389 | YES (af-budget) |
| `server/prediction/xg-source.ts` | PREDICTION_TRAINING | `fetch()` (multiple) | YES (af-budget) |
| `server/prediction/injury-source.ts` | PREDICTION_TRAINING | `fetch()` | YES (af-budget) |
| `server/prediction/lineup-source.ts` | PREDICTION_TRAINING | `fetch()` | YES (af-budget) |
| `server/prediction/historical-match-loader-af.ts` | BACKFILL_JOB | `fetch()` | YES (af-budget) |
| `server/prediction/af-historical-match-loader.ts` | BACKFILL_JOB | `fetch()` | YES (af-budget) |
| `server/prediction/af-team-id-bridge.ts` | PREDICTION_TRAINING | `fetch()` | YES (af-budget) |
| `server/odds/af-odds-service.ts` | PORTAL_RUNTIME | `fetch()` L150 | YES (af-budget) |
| `tools/xg-backfill-af.ts` | MANUAL_SCRIPT | `fetch()` L162 | YES (af-budget) |

### Provider: football-data.org (providerKey: `football-data`)

| File | Consumer | Calls | Currently tracked? |
|------|----------|-------|--------------------|
| `server/football-data-source.ts` | CANONICAL_INGESTION | `fetch()` L665 | **NO** |
| `server/football-data-tournament-source.ts` | CANONICAL_INGESTION | `fetch()` | **NO** |
| `server/match-events-service.ts` | PORTAL_RUNTIME | `fetch()` L254 (TheSportsDB for FD matches) | **NO** (cross-provider) |
| `tools/xg-backfill-historical.ts` | MANUAL_SCRIPT | `fetch()` L184 | **NO** |
| `tools/xg-backfill-sofascore.ts` | MANUAL_SCRIPT | `fetch()` L176 | **NO** |

### Provider: TheSportsDB (providerKey: `thesportsdb`)

| File | Consumer | Calls | Currently tracked? |
|------|----------|-------|--------------------|
| `server/the-sports-db-source.ts` | CANONICAL_INGESTION | `fetch()` L496 | **NO** |
| `server/match-events-service.ts` | PORTAL_RUNTIME | `fetch()` L254 | **NO** |
| `server/prediction/historical-match-loader-sportsdb.ts` | BACKFILL_JOB | `fetch()` | **NO** |

### Provider: YouTube Data API (providerKey: `youtube`)

| File | Consumer | Calls | Currently tracked? |
|------|----------|-------|--------------------|
| `server/video/youtube-client.ts` | PORTAL_RUNTIME | `fetch()` L48 | **NO** |

### Provider: The Odds API (providerKey: `the-odds-api`)

| File | Consumer | Calls | Currently tracked? |
|------|----------|-------|--------------------|
| `server/odds/odds-service.ts` | PORTAL_RUNTIME | `fetch()` L155 | **NO** |

### Provider: Eventos source (providerKey: `eventos`)

| File | Consumer | Calls | Currently tracked? |
|------|----------|-------|--------------------|
| `server/eventos/event-source.ts` | PORTAL_RUNTIME | `fetch()` L36 | **NO** |

### NOT tracked (excluded from governance -- see scope)

| File | Reason |
|------|--------|
| `server/news/rss-source.ts` | Uses `rss-parser` lib, not raw fetch; no quota |
| `server/news/gnews-source.ts` | Legacy/dead code (commented in .env) |
| `server/openligadb-source.ts` | Free API, no quota |
| `server/crest-cache.ts` | Static image downloads, not API |
| `server/stream-embed/stream-embed-service.ts` | Web scraping, not metered API |
| `server/incidents/flashscore-resolver.ts` | Scraping, not metered API |
| `server/incidents/flashscore-scraper.ts` | Scraping, not metered API |
| `server/prediction/historical-match-loader.ts` | Dispatches to sub-loaders (AF/SportsDB), not a direct caller |
| `server/prediction/non-fd-prev-season-loader.ts` | Dispatches to sub-loaders |
| `tools/build-odds-dataset.ts` | One-time offline script, custom fetch wrapper |
| `tools/fetch-prev-season.ts` | One-time offline script |

---

## 6. Module Placement (File-by-File)

### New files to create

```
-- Tipos en shared
packages/shared/src/domain/api-usage.ts              -- ProviderKey, ConsumerType, PriorityTier enums; ApiUsageEvent, DailyRollup, ProviderQuotaDefinition types
packages/shared/src/domain/index.ts                   -- re-export (update)

-- Ledger + client en canonical
packages/canonical/src/api-usage/                     -- NEW directory
packages/canonical/src/api-usage/ledger.ts            -- ApiUsageLedger: SQLite writes, rollup upserts, quota checks
packages/canonical/src/api-usage/migrations.ts        -- versioned schema migrations (run on startup)
packages/canonical/src/api-usage/provider-client.ts   -- InstrumentedProviderClient: wraps fetch, records event via ledger
packages/canonical/src/api-usage/quota-config.ts      -- ProviderQuotaConfig: seed defaults, load from DB
packages/canonical/src/api-usage/index.ts             -- barrel export from canonical
packages/canonical/package.json                       -- add better-sqlite3 dependency

-- Ops routes en api
packages/api/src/internal/                            -- NEW directory
packages/api/src/internal/api-usage-routes.ts         -- Fastify plugin: GET /api/internal/ops/api-usage/*

-- CI guard
scripts/check-provider-bypass.sh                      -- grep-based anti-bypass guard
```

### Files to modify

```
packages/shared/src/index.ts                          -- export new api-usage types
packages/canonical/src/index.ts                       -- export ApiUsageLedger, InstrumentedProviderClient
tsconfig.server.json                                  -- verify @sportpulse/canonical path mapping exists

-- DELETE (absorb en ledger.ts)
server/af-budget.ts

-- All AF consumers: change import from ./af-budget to @sportpulse/canonical
server/api-football-canonical-source.ts
server/api-football-source.ts
server/apifootball-live-overlay.ts
server/api-football-cli-overlay.ts
server/incidents/apifootball-incident-source.ts
server/prediction/xg-source.ts
server/prediction/injury-source.ts
server/prediction/lineup-source.ts
server/prediction/historical-match-loader-af.ts
server/prediction/af-historical-match-loader.ts
server/prediction/af-team-id-bridge.ts
server/odds/af-odds-service.ts
tools/xg-backfill-af.ts                              -- import from @sportpulse/canonical

-- Non-AF providers: wrap fetch calls through InstrumentedProviderClient
server/football-data-source.ts
server/football-data-tournament-source.ts
server/the-sports-db-source.ts
server/match-events-service.ts
server/video/youtube-client.ts
server/odds/odds-service.ts
server/eventos/event-source.ts

-- Composition root: wire ledger, register ops routes
server/index.ts

-- Status route: replace getBudgetStats with ledger.getProviderStats
packages/api/src/ui/status-route.ts
packages/api/src/ui/types.ts

-- Dockerfile: agregar better-sqlite3 build deps si es Alpine Linux
Dockerfile
```

---

## 7. Design Details

### 7.1 Types (packages/shared/src/domain/api-usage.ts)

```
ProviderKey = 'api-football' | 'football-data' | 'thesportsdb' | 'youtube' | 'the-odds-api' | 'eventos'

ConsumerType = 'PORTAL_RUNTIME' | 'CANONICAL_INGESTION' | 'PREDICTION_TRAINING' | 'BACKFILL_JOB' | 'MANUAL_SCRIPT'

PriorityTier = 'product-critical' | 'deferrable' | 'non-critical'

ApiUsageEvent = {
  id: string;                  // nanoid or uuid
  timestampUtc: string;        // ISO 8601
  providerKey: ProviderKey;
  consumerType: ConsumerType;
  priorityTier: PriorityTier;
  endpoint: string;            // URL path (no query params with keys)
  httpMethod: 'GET' | 'POST';
  httpStatus: number;
  latencyMs: number;
  quotaCost: number;           // provider-specific unit cost (YT search=100, YT list=1, others=1)
  callerFile: string;          // e.g. 'football-data-source.ts'
  errorMessage?: string;       // if request failed
  metadata?: Record<string, string>;  // optional tags (competitionId, matchId, etc.)
}

DailyRollup = {
  date: string;                // YYYY-MM-DD UTC
  providerKey: ProviderKey;
  totalRequests: number;
  totalQuotaCost: number;
  byConsumerType: Record<ConsumerType, { requests: number; quotaCost: number }>;
  byPriorityTier: Record<PriorityTier, { requests: number; quotaCost: number }>;
  errors: number;
  avgLatencyMs: number;
  lastUpdatedUtc: string;
}

ProviderQuotaDefinition = {
  providerKey: ProviderKey;
  dailyLimit: number;          // 0 = unlimited
  monthlyLimit: number;        // 0 = unlimited
  brakeLiveThreshold: number;  // AF-specific: throttle threshold (0 = no brake)
  enabled: boolean;
}
```

### 7.2 InstrumentedProviderClient (server/api-usage/provider-client.ts)

**Interface:**
```
class InstrumentedProviderClient {
  constructor(ledger: ApiUsageLedger)

  fetch(url: string, opts: RequestInit & {
    providerKey: ProviderKey;
    consumerType: ConsumerType;
    priorityTier: PriorityTier;
    callerFile: string;
    quotaCost?: number;        // default 1
    metadata?: Record<string, string>;
  }): Promise<Response>
}
```

**Behavior:**
1. Records start time
2. Executes `globalThis.fetch(url, opts)` (passes through all RequestInit options)
3. On completion (success or failure): builds ApiUsageEvent, calls `ledger.recordEvent(event)`
4. Returns the Response unchanged
5. If ledger.isQuotaExhausted(providerKey) before the call: throws QuotaExhaustedError (only for providers with dailyLimit > 0)

**Key design point:** The client does NOT strip provider-specific auth headers or modify the request. It is purely an observation + quota-gate wrapper.

### 7.3 ApiUsageLedger (packages/canonical/src/api-usage/ledger.ts)

**Interface:**
```
class ApiUsageLedger {
  constructor(dbPath: string)  // e.g. 'cache/api-usage.db'

  recordEvent(event: ApiUsageEvent): void          // INSERT evento + UPSERT rollup (síncrono, WAL mode)
  getTodayRollup(providerKey: ProviderKey): DailyRollup | null
  getAllTodayRollups(): DailyRollup[]
  getRecentEvents(providerKey: ProviderKey, limit: number): ApiUsageEvent[]
  getProviderSummary(providerKey: ProviderKey): { rollup, quota, percentUsed, warningLevel }
  isQuotaExhausted(providerKey: ProviderKey): boolean
  isLiveBrakeActive(providerKey: ProviderKey): boolean  // AF-compatible
  markQuotaExhausted(providerKey: ProviderKey): void    // escribe evento sintético de exhaustion

  // af-budget compatibility surface (thin wrappers, mantener firmas exactas)
  consumeRequest(): void   // DEPRECATED facade, llama recordEvent con providerKey='api-football', consumerType=PORTAL_RUNTIME
  getBudgetStats(): { requestsToday: number; limit: number; exhausted: boolean; brakeActive: boolean; quotaExhaustedUntil: number }
}
```

**Internal state:**
- SQLite DB en WAL mode (lectura concurrente OK, escritura single-process)
- Statements preparados en constructor (mejor-sqlite3 síncrono)
- Cache en memoria de `isQuotaExhausted` por providerKey (TTL 30s) — evita query en cada request del servidor
- `markQuotaExhausted`: inserta fila especial en api_usage_events con `error_class='QUOTA_EXHAUSTED'` + setea `quotaExhaustedUntil` en memoria hasta medianoche UTC

**af-budget migration en primer startup:**
- Si `cache/af-budget.json` existe y `date` = today: INSERT sintético en api_usage_daily_rollups para `api-football` con `used_units = requestsToday`, `consumer_type = PORTAL_RUNTIME`
- Renombrar el archivo a `cache/af-budget.json.migrated` (nunca eliminar)
- Si stale: ignorar

### 7.4 Ops Routes (packages/api/src/internal/api-usage-routes.ts)

All routes are under `/api/internal/ops/` prefix. No auth in v1 (internal only, not exposed to frontend).

```
GET /api/internal/ops/api-usage/today
  -> { date, rollups: DailyRollup[], totals: { requests, quotaCost, errors } }

GET /api/internal/ops/api-usage/providers/:providerKey
  -> { rollup: DailyRollup, quota: ProviderQuotaDefinition, percentUsed: number }

GET /api/internal/ops/api-usage/events?provider=X&limit=50
  -> { events: ApiUsageEvent[] }  // last N events, newest first
```

### 7.5 Quota Config (packages/canonical/src/api-usage/quota-config.ts)

Persisted at `cache/api-usage/quota-config.json`. Seeded with defaults on first startup:

```json
{
  "api-football":  { "dailyLimit": 7500, "monthlyLimit": 0, "brakeLiveThreshold": 6500, "enabled": true },
  "football-data": { "dailyLimit": 250,  "monthlyLimit": 0, "brakeLiveThreshold": 0,    "enabled": true },
  "youtube":       { "dailyLimit": 10000, "monthlyLimit": 0, "brakeLiveThreshold": 0,    "enabled": true },
  "the-odds-api":  { "dailyLimit": 0,    "monthlyLimit": 500, "brakeLiveThreshold": 0,   "enabled": true },
  "thesportsdb":   { "dailyLimit": 0,    "monthlyLimit": 0, "brakeLiveThreshold": 0,    "enabled": true },
  "eventos":       { "dailyLimit": 0,    "monthlyLimit": 0, "brakeLiveThreshold": 0,    "enabled": true }
}
```

---

## 8. af-budget.ts Migration Plan

### Phase 1: Create ledger with AF compatibility surface

1. Create `server/api-usage/ledger.ts` with full ApiUsageLedger class
2. Include `consumeRequest()`, `isQuotaExhausted()`, `markQuotaExhausted()`, `isLiveBrakeActive()`, `getBudgetStats()` as compatibility methods that delegate to the internal providerKey='api-football' logic
3. The compatibility methods match the EXACT signatures of the current af-budget exports

### Phase 2: Update imports (search-and-replace)

For each of the 12 files importing from `../af-budget.js` or `../../af-budget.js`:
- Change import path to `../api-usage/index.js` (or appropriate relative path)
- The function names remain identical -- no caller code changes needed

Files affected (with current import paths):
1. `server/api-football-canonical-source.ts` -- `./af-budget.js`
2. `server/api-football-source.ts` -- `./af-budget.js`
3. `server/apifootball-live-overlay.ts` -- `./af-budget.js`
4. `server/api-football-cli-overlay.ts` -- `./af-budget.js`
5. `server/incidents/apifootball-incident-source.ts` -- `../af-budget.js`
6. `server/prediction/xg-source.ts` -- `../af-budget.js`
7. `server/prediction/injury-source.ts` -- `../af-budget.js`
8. `server/prediction/lineup-source.ts` -- `../af-budget.js`
9. `server/prediction/historical-match-loader-af.ts` -- `../af-budget.js`
10. `server/prediction/af-historical-match-loader.ts` -- `../af-budget.js`
11. `server/prediction/af-team-id-bridge.ts` -- `../af-budget.js`
12. `server/odds/af-odds-service.ts` -- `../af-budget.js`
13. `tools/xg-backfill-af.ts` -- `../server/af-budget.js`
14. `server/index.ts` -- `./af-budget.js` (getBudgetStats for status route)

### Phase 3: Delete af-budget.ts

After all imports are migrated and tests pass, delete `server/af-budget.ts`.

### Phase 4: Upgrade AF callers to full instrumentation

After Phase 3, the AF callers still use the compatibility surface (just `consumeRequest()` after their own `fetch()`). Progressively update each to use `InstrumentedProviderClient.fetch()` instead, which automatically records the event. This eliminates the manual `consumeRequest()` calls.

Priority order for upgrade:
1. `api-football-canonical-source.ts` (highest volume)
2. `apifootball-live-overlay.ts` (second highest)
3. `incidents/apifootball-incident-source.ts`
4. Remaining AF callers

---

## 9. Implementation Phases (Dependency Order)

### Phase 0: Types and infrastructure (haiku tier)
**Deps:** none
**Tickets:** GOV-00

- Add ProviderKey, ConsumerType, PriorityTier enums y ApiUsageEvent, DailyRollup, ProviderQuotaDefinition types a `packages/shared`
- Update `packages/shared/src/index.ts` exports
- Agregar `better-sqlite3` + `@types/better-sqlite3` a `packages/canonical/package.json`
- Verificar que `tsconfig.server.json` tiene path alias `@sportpulse/canonical`
- Crear directory `packages/canonical/src/api-usage/`
- `pnpm install` + `pnpm build` para verificar que compila

### Phase 1: Core ledger (sonnet tier)
**Deps:** Phase 0
**Tickets:** GOV-01, GOV-02

- Implementar `migrations.ts` — versioned schema, crea las 3 tablas SQLite del spec §11
- Implementar `ApiUsageLedger` class (SQLite WAL, prepared statements, in-memory quota cache, af-budget migration en startup)
- Implementar `ProviderQuotaConfig` — seed defaults en DB, load/update
- Unit tests para ledger (record event, rollup upsert, quota check, markQuotaExhausted, af-budget migration, startup con DB existente)

### Phase 2: af-budget migration (sonnet tier)
**Deps:** Phase 1
**Tickets:** GOV-03

- Add AF compatibility surface to ledger
- Implement first-startup migration from `cache/af-budget.json`
- Update all 14 import sites from `af-budget` to `api-usage`
- Delete `server/af-budget.ts`
- Update `server/index.ts` wiring
- Update `packages/api/src/ui/status-route.ts` to use ledger's getBudgetStats
- Run existing tests -- all must still pass

### Phase 3: Instrumented provider client (sonnet tier)
**Deps:** Phase 1
**Tickets:** GOV-04

- Implementar `InstrumentedProviderClient` en `packages/canonical/src/api-usage/provider-client.ts`
- Unit tests (fetch wrapping, event recording, quota gate, error handling)
- Integration test: client + ledger end-to-end con SQLite en memoria (`:memory:` path)

### Phase 4: Provider instrumentation -- AF callers (sonnet tier)
**Deps:** Phase 2 + Phase 3
**Tickets:** GOV-05

- Migrate AF callers from manual `consumeRequest()` to `InstrumentedProviderClient.fetch()`
- Remove manual `consumeRequest()` / `isQuotaExhausted()` calls from each file
- Each file receives the client instance via constructor injection or module-level init

### Phase 5: Provider instrumentation -- non-AF callers (sonnet tier)
**Deps:** Phase 3
**Tickets:** GOV-06

- Instrument `football-data-source.ts` (providerKey: 'football-data')
- Instrument `football-data-tournament-source.ts`
- Instrument `the-sports-db-source.ts` (providerKey: 'thesportsdb')
- Instrument `match-events-service.ts` (cross-provider: tag based on target URL)
- Instrument `youtube-client.ts` (providerKey: 'youtube', quotaCost varies by endpoint)
- Instrument `odds-service.ts` (providerKey: 'the-odds-api')
- Instrument `eventos/event-source.ts` (providerKey: 'eventos')

### Phase 6: Ops routes (sonnet tier)
**Deps:** Phase 1
**Tickets:** GOV-07

- Implementar `packages/api/src/internal/api-usage-routes.ts` Fastify plugin
- Importa `ApiUsageLedger` desde `@sportpulse/canonical`
- Registrar en `server/index.ts`
- Integration tests para cada endpoint (SQLite en memoria)

### Phase 7: CI guard (haiku tier)
**Deps:** Phase 5 (all callers migrated)
**Tickets:** GOV-08

- Add ESLint rule or grep-based CI script
- Prevents `fetch()` calls to known provider base URLs outside `provider-client.ts`
- Integrated into `.github/workflows/ci.yml`

### Phase 8: Tools instrumentation (sonnet tier)
**Deps:** Phase 3
**Tickets:** GOV-09

- Instrument `tools/xg-backfill-af.ts` (already uses af-budget, upgrade to client)
- Instrument `tools/xg-backfill-historical.ts` (football-data)
- Instrument `tools/xg-backfill-sofascore.ts` (football-data)
- Instrument `tools/fetch-prev-season.ts` (football-data)
- Note: `tools/build-odds-dataset.ts` uses a custom fetch shim -- leave as-is, document exception

---

## 10. Ticket Graph

```
GOV-00 (Types + dirs)
  |
  +---> GOV-01 (Ledger core)
  |       |
  |       +---> GOV-02 (Pruner)
  |       |
  |       +---> GOV-03 (af-budget migration)
  |       |       |
  |       |       +---> GOV-05 (AF callers instrumentation)
  |       |
  |       +---> GOV-04 (Provider client)
  |       |       |
  |       |       +---> GOV-05 (AF callers instrumentation)
  |       |       |
  |       |       +---> GOV-06 (non-AF callers instrumentation)
  |       |       |       |
  |       |       |       +---> GOV-08 (CI guard)
  |       |       |
  |       |       +---> GOV-09 (Tools instrumentation)
  |       |
  |       +---> GOV-07 (Ops routes)
```

**Parallelism opportunities:**
- GOV-01 and GOV-02 can be in the same PR
- GOV-03 and GOV-04 are independent of each other (both depend on GOV-01)
- GOV-07 depends only on GOV-01, can run in parallel with GOV-03/04/05/06
- GOV-09 can run in parallel with GOV-06

### Ticket details

| ID | Title | Tier | Agent | Deps | Est. |
|----|-------|------|-------|------|------|
| GOV-00 | Types: ProviderKey, ConsumerType, ApiUsageEvent in shared | haiku | git-ops | -- | S |
| GOV-01 | Core: ApiUsageLedger (NDJSON + rollup + quota) | sonnet | backend-engineer | GOV-00 | L |
| GOV-02 | Core: RetentionPruner for event/rollup files | sonnet | backend-engineer | GOV-01 | S |
| GOV-03 | Migration: absorb af-budget into ledger | sonnet | backend-engineer | GOV-01 | M |
| GOV-04 | Core: InstrumentedProviderClient wrapper | sonnet | backend-engineer | GOV-01 | M |
| GOV-05 | Instrumentation: AF callers (13 files) | sonnet | backend-engineer | GOV-03, GOV-04 | L |
| GOV-06 | Instrumentation: non-AF callers (7 files) | sonnet | backend-engineer | GOV-04 | M |
| GOV-07 | Ops: internal API usage endpoints | sonnet | backend-engineer | GOV-01 | M |
| GOV-08 | CI: guard against untracked fetch to providers | haiku | git-ops | GOV-06 | S |
| GOV-09 | Instrumentation: tools/ scripts | sonnet | backend-engineer | GOV-04 | S |

(S = small/1-2h, M = medium/2-4h, L = large/4-8h)

---

## 11. Test Plan

### Unit tests (server/api-usage/__tests__/)

**ledger.test.ts:**
- Records event and updates in-memory rollup correctly
- Day boundary: rollover resets counts, flushes previous day rollup to disk
- Startup replay: reads today's NDJSON and rebuilds rollup
- isQuotaExhausted returns true when daily count >= dailyLimit
- isQuotaExhausted returns false for providers with dailyLimit=0
- markQuotaExhausted sets exhaustion until midnight UTC
- getBudgetStats returns AF-compatible shape
- Multiple providers tracked independently

**provider-client.test.ts:**
- Successful fetch records event with correct fields
- Failed fetch (network error) records event with errorMessage
- HTTP error status recorded correctly
- Quota exhausted throws QuotaExhaustedError before making request
- quotaCost defaults to 1 if not specified
- Passes through all RequestInit options unchanged
- Latency measurement is reasonable (mocked)

**quota-config.test.ts:**
- Loads config from JSON file
- Seeds defaults if file missing
- Validates config shape

**pruner.test.ts:**
- Deletes event files older than 7 days
- Deletes rollup dirs older than 90 days
- Does not delete today's files
- Handles empty directory gracefully

### Integration tests

**af-budget-migration.test.ts:**
- Old af-budget.json with today's date: migrates count correctly
- Old af-budget.json with stale date: ignored
- Missing af-budget.json: starts fresh
- After migration: old file renamed to .migrated

**ops-routes.test.ts:**
- GET /api/internal/ops/api-usage/today returns all provider rollups
- GET /api/internal/ops/api-usage/providers/api-football returns correct rollup + quota
- GET /api/internal/ops/api-usage/events returns recent events in descending order
- Unknown provider returns 404

### Boundary tests

**boundary.test.ts:**
- `packages/shared` exports ProviderKey, ConsumerType types correctly
- `server/api-usage/` does NOT import from packages/canonical, scoring, layout, web
- No file in `packages/web` imports from api-usage
- No file in `packages/api` imports from api-usage directly (only via deps injection)

---

## 12. CI Enforcement Design

### Approach: grep-based CI script (not ESLint)

**Rationale:** An ESLint rule requires a custom plugin, adds dev dep complexity, and only catches `.ts` files. A grep-based script is simpler, catches all file types, and aligns with the existing CI pattern.

**Script:** `scripts/check-provider-bypass.sh`

**Logic:**
1. Define list of provider base URLs:
   - `v3.football.api-sports.io`
   - `api.football-data.org`
   - `www.thesportsdb.com/api`
   - `www.googleapis.com/youtube`
   - `api.the-odds-api.com`
2. Grep all `.ts` files in `server/` and `tools/` for `fetch(` calls containing these domains
3. Exclude `server/api-usage/provider-client.ts` (the governed path)
4. If any matches found: fail with message listing offending files
5. Exit 0 if clean

**Integration:** Added as a step in `.github/workflows/ci.yml` after typecheck, before build.

**Escape hatch:** A comment `// api-usage-bypass: <reason>` on the line suppresses the check for that line. The script logs all bypasses as warnings.

---

## 13. Rollout / Rollback

### Rollout strategy: Progressive, behind existing behavior

1. **Phase 0-1:** Ledger exists but nothing writes to it. Zero production impact. Deploy freely.
2. **Phase 2 (af-budget migration):** This is the critical switchover. The compatibility surface ensures identical behavior. Rollback: revert the commit, af-budget.ts is restored.
3. **Phase 3-6:** Each provider is instrumented independently. If a provider's instrumentation causes issues, revert that single file. The ledger silently accepts or ignores.
4. **Phase 7 (CI guard):** Only affects CI, not production. Safe to deploy independently.

### Rollback plan

- All phases are individually revertable git commits.
- The ledger is append-only and never blocks requests (except AF quota, which is existing behavior).
- If NDJSON write fails (disk full, permissions): the client catches the error, logs a warning, and proceeds with the fetch. The API call is never blocked by a ledger failure.
- If the ledger crashes on startup: a try/catch in `server/index.ts` logs the error and falls back to a no-op ledger (all methods return safe defaults).

---

## 14. Fixture Impact Analysis

**Golden fixtures:** NONE affected. The API usage governance system is purely observational infrastructure. It does not touch the canonical-signals-scoring-layout-snapshot pipeline. No snapshot DTO changes, no scoring policy changes, no layout algorithm changes.

**Existing tests:** The af-budget migration (GOV-03) must not break any existing test that depends on `isQuotaExhausted()` or `consumeRequest()` behavior. The compatibility surface ensures this.

---

## 15. Version Discipline

| Artifact | Version change | Reason |
|----------|---------------|--------|
| `policyVersion` | No change | Scoring unaffected |
| `layoutAlgorithmVersion` | No change | Layout unaffected |
| `snapshotSchemaVersion` | No change | DTO shape unaffected |
| `packages/shared` package.json | Patch bump (types added) | New exports, backward compatible |

No breaking changes to any versioned artifact.

---

## 16. Definition of Done

1. Every outbound HTTP call to a metered provider API goes through `InstrumentedProviderClient.fetch()`
2. Every call is tagged with correct `providerKey`, `consumerType`, and `priorityTier`
3. Events are persisted to NDJSON and survive server restarts
4. Daily rollups are computed and queryable via ops endpoints
5. `af-budget.ts` is deleted; all its consumers use the new ledger
6. `GET /api/internal/ops/api-usage/today` returns accurate counts
7. `GET /api/ui/status` still returns AF budget stats (backward compatible)
8. CI guard prevents new untracked fetch calls to provider URLs
9. Retention pruner keeps event files to 7 days and rollup files to 90 days
10. All unit, integration, and boundary tests pass
11. `pnpm build` passes
12. `pnpm -r test` passes
13. `pnpm tsc --noEmit --project tsconfig.server.typecheck.json` passes
14. Existing golden fixtures unaffected
15. No new env vars required (quota config is in cache/ JSON, not .env)

---

## 17. Top 3 Risks and Mitigations

### Risk 1: af-budget migration breaks AF quota enforcement in production

**Severity:** HIGH -- could cause API-Football quota exhaustion and service degradation.

**Mitigation:**
- The compatibility surface preserves identical function signatures and semantics
- Phase 2 includes specific migration tests (af-budget-migration.test.ts)
- The old `cache/af-budget.json` is renamed (not deleted) so manual rollback is trivial
- Deploy Phase 2 during a low-traffic window (not matchday)

### Risk 2: better-sqlite3 native binary en Docker/Render

**Severity:** MEDIUM si el Dockerfile usa Alpine y no tiene build tools.

**Mitigation:**
- Verificar en GOV-00 que `Dockerfile` tiene `python3`, `make`, `g++` (requeridos por node-gyp para compilar better-sqlite3)
- Si el Dockerfile usa Alpine: agregar `RUN apk add --no-cache python3 make g++` antes de `RUN pnpm install`
- Si usa node:slim o node:bookworm: ya tienen build-essential, no requiere cambios
- Test de smoke post-deploy incluye un request a `/api/internal/ops/api-usage/today` para confirmar que la DB levantó correctamente

### Risk 3: CI guard has false positives on test files or comments containing provider URLs

**Severity:** LOW -- CI annoyance, not production risk.

**Mitigation:**
- Exclude `__tests__/`, `test/`, and `*.test.ts` from the grep
- The `// api-usage-bypass:` escape hatch handles legitimate exceptions
- Run the guard script during PR review with clear error messages

---

## 18. Handoff Notes

- **Phase 0 (GOV-00):** Assign to `git-ops` (Haiku). Pure type definitions and directory creation.
- **Phases 1-6, 8-9 (GOV-01 through GOV-07, GOV-09):** Assign to `backend-engineer` (Sonnet). Follow this plan's interfaces exactly.
- **Phase 7 (GOV-08):** Assign to `git-ops` (Haiku). Shell script + CI YAML modification.
- **No frontend work required.** The ops endpoints are internal and not consumed by `packages/web`.
- **No spec changes needed** for existing specs. The API usage governance spec should be finalized and placed at `docs/specs/ops/spec.sportpulse.ops.api-usage-governance.md`.
- **Domain Glossary update:** Add `ProviderKey`, `ConsumerType`, `PriorityTier`, `ApiUsageEvent`, `DailyRollup` definitions.
