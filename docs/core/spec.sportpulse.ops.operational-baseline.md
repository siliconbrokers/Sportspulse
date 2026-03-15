---
artifact_id: SPEC-SPORTPULSE-OPS-OPERATIONAL-BASELINE
title: "Operational Baseline"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: ops
slug: operational-baseline
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/core/spec.sportpulse.ops.operational-baseline.md
---
# SportPulse — Operational Baseline

Version: 1.0
Status: Authoritative operational supplement for MVP
Scope: CI/CD, deployment, security hardening, observability standards, database strategy, and concrete performance targets
Audience: Backend, Frontend, Ops, QA, AI-assisted development workflows

---

## 1. Purpose

This document fills the operational gaps not covered by the Constitution, NFR, API Contract, or Errors Taxonomy.

It defines concrete, enforceable standards for:

- continuous integration and delivery gates
- deployment and rollback procedures
- security hardening (headers, CORS, rate limiting, secrets)
- logging implementation standard
- database migration strategy
- health check endpoints
- concrete performance targets
- code quality minimums

This is **not** a replacement for the NFR document. It is a companion that makes NFR operational expectations concrete and measurable.

---

## 2. Authority

This document is authoritative for operational implementation decisions.

It sits below the Constitution and alongside the NFR in the document hierarchy. If this document and the NFR appear to conflict, the NFR wins on principle; this document wins on implementation specifics.

---

## 3. Continuous Integration

### 3.1 CI pipeline definition

Every pull request must pass the following gates before merge:

1. **Lint** — `pnpm lint` (ESLint across all packages)
2. **Type check** — `pnpm -r run build` (TypeScript compilation with `noEmit` or composite build)
3. **Unit tests** — `pnpm -r run test` (Vitest across all packages)
4. **Boundary check** — automated verification that no package imports forbidden dependencies (SP-0002)
5. **Legacy guard** — grep-based or test-based verification that prohibited constructs (`SIZE_SCORE`, `PROXIMITY_BONUS`, `HOT_MATCH_SCORE`) do not appear in active code

### 3.2 Code coverage minimums

| Scope | Minimum | Target |
|-------|---------|--------|
| Global (all packages) | 80% lines | 90% |
| `scoring` package | 90% lines | 95% |
| `layout` package | 90% lines | 95% |
| `signals` package | 85% lines | 90% |
| `snapshot` package | 80% lines | 90% |

Coverage is enforced in CI. A PR that drops coverage below the minimum for any in-scope package must not be merged.

### 3.3 CI tooling

- **Runner**: GitHub Actions (or equivalent)
- **Node version**: LTS (pinned in `.node-version` or `engines` field)
- **pnpm version**: pinned in `packageManager` field of root `package.json`

### 3.4 Branch strategy

- `main` — stable, always green
- Feature branches from `main`, merged via PR
- No direct pushes to `main`
- Squash merge preferred for clean history

---

## 4. Deployment

### 4.1 MVP deployment target

The MVP deploys as a single-process Node.js application serving both the API (Fastify) and the built frontend (static assets via Fastify).

Optional: separate frontend deployment to CDN/static host if performance requires it.

### 4.2 Deployment procedure

1. Merge to `main` triggers CI pipeline
2. CI success triggers build artifact creation (`pnpm -r run build`)
3. Artifact is deployed to staging environment
4. Smoke tests run against staging (health checks + golden fixture validation)
5. Manual promotion to production (MVP — no auto-deploy to prod)

### 4.3 Rollback procedure

- Keep the **previous 3 deployment artifacts** available
- Rollback = redeploy previous artifact
- If rollback is needed due to data corruption:
  1. Redeploy previous artifact
  2. Verify health endpoints return healthy
  3. Trigger snapshot rebuild from last known good ingestion data
- Rollback must be executable in under 5 minutes

### 4.4 Environment variables

All environment-specific configuration is injected via environment variables. The application must fail to start if required variables are missing.

Required variables (MVP):

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | Postgres connection string | `postgres://user:pass@host:5432/sportpulse` |
| `FOOTBALL_DATA_API_KEY` | Provider API key | `(secret)` |
| `PORT` | Server listen port | `3000` |
| `NODE_ENV` | Environment identifier | `production` |
| `TIMEZONE_DEFAULT` | Default timezone for snapshot builds | `America/Montevideo` |
| `LOG_LEVEL` | Minimum log level | `info` |

Optional variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `REDIS_URL` | Redis connection for caching/locks | `(none — in-memory fallback)` |
| `CORS_ORIGINS` | Allowed CORS origins | `(none — same-origin only)` |
| `RATE_LIMIT_MAX` | Max requests per window per IP | `100` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in ms | `60000` |
| `SNAPSHOT_STALE_THRESHOLD_HOURS` | Hours before snapshot is marked stale | `8` |

---

## 5. Database Strategy

### 5.1 Database engine

PostgreSQL (version 15+).

### 5.2 Migration tooling

Use a migration tool that supports:

- sequential, numbered migration files
- up/down migrations
- migration lock to prevent concurrent execution
- TypeScript or SQL migration files

Recommended: **node-pg-migrate** or **drizzle-kit** (aligned with ORM choice if any).

### 5.3 Migration conventions

- Migration files live in `packages/api/migrations/` (or a dedicated `db` package if extracted)
- Naming: `NNNN_description.ts` (e.g., `0001_create_competitions.ts`)
- Every migration must have a corresponding rollback (`down`)
- Migrations run automatically on deploy before the application starts
- Never modify a migration that has been applied to staging or production — create a new one

### 5.4 Schema change rules

- Additive changes (new columns with defaults, new tables) are preferred
- Destructive changes (drop column, rename) require a two-phase migration:
  1. Add new column, deploy code that writes to both
  2. Migrate data, deploy code that reads only new, drop old
- For MVP: simple single-phase migrations are acceptable if not yet in production

### 5.5 Seed data

- Competition and season seed data for MVP (La Liga) lives in a seed script
- Seed is idempotent (safe to run multiple times)

---

## 6. Health Check Endpoints

### 6.1 Endpoint definitions

As referenced in the Backend Architecture document, the following health endpoints are required:

| Endpoint | Purpose | Response |
|----------|---------|----------|
| `GET /api/health` | Basic liveness check | `200 { "status": "ok" }` |
| `GET /api/health/ready` | Readiness (DB connected, last ingestion within threshold) | `200` or `503` |
| `GET /api/health/provider` | Provider connectivity status | `200` or `503` with last fetch metadata |

### 6.2 Health check contract

```ts
type HealthResponse = {
  status: "ok" | "degraded" | "error";
  checks?: {
    database?: { status: "ok" | "error"; latencyMs?: number };
    provider?: { status: "ok" | "error"; lastSuccessUtc?: string };
    snapshot?: { status: "ok" | "stale"; lastBuildUtc?: string };
  };
  version?: string; // application version/commit hash
  uptime?: number;  // seconds
};
```

### 6.3 Health check behavior

- `/api/health` must respond in < 50ms (no DB calls)
- `/api/health/ready` may query DB for connection check
- Health endpoints are excluded from rate limiting
- Health endpoints do not require authentication

---

## 7. Security Hardening

### 7.1 HTTP security headers

Use `@fastify/helmet` with the following configuration:

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:` | XSS prevention |
| `X-Content-Type-Options` | `nosniff` | MIME sniffing prevention |
| `X-Frame-Options` | `DENY` | Clickjacking prevention |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Force HTTPS (production only) |
| `X-XSS-Protection` | `0` | Disable legacy XSS filter (CSP is sufficient) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Referrer leakage prevention |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Feature restriction |

### 7.2 CORS configuration

- **Development**: allow `http://localhost:5173` (Vite dev server)
- **Production**: allow only the deployed frontend origin (from `CORS_ORIGINS` env var)
- **Credentials**: `credentials: true` only if cookie-based auth is implemented
- **Methods**: `GET, POST, OPTIONS`
- **Headers**: `Content-Type, Authorization`

Use `@fastify/cors` with explicit origin configuration. Wildcard (`*`) is prohibited in production.

### 7.3 Rate limiting

Use `@fastify/rate-limit`:

| Scope | Max requests | Window | Key |
|-------|-------------|--------|-----|
| Global API (`/api/ui/*`) | 100 | 1 minute | IP address |
| Provider-facing (internal ingestion) | Not rate-limited | — | — |
| Health endpoints | Not rate-limited | — | — |

When rate limit is exceeded, return `429` with error code `RATE_LIMITED` per the Errors Taxonomy.

### 7.4 Secrets management

- Provider API keys and database credentials are **environment variables only**
- Never committed to source control
- `.env` files are listed in `.gitignore`
- A `.env.example` file documents required variables with placeholder values
- In production: use the hosting platform's secret management (e.g., Railway secrets, Fly.io secrets, AWS Secrets Manager)

### 7.5 Input validation

- All API query parameters are validated using Fastify's built-in JSON Schema validation
- `competitionId`: string, non-empty
- `dateLocal`: regex `^\d{4}-\d{2}-\d{2}$`, parsed and validated as real date
- `timezone`: validated against IANA timezone list
- `teamId`: string, non-empty
- Reject unknown body properties in POST endpoints (`additionalProperties: false`)

### 7.6 Dependency security

- Run `pnpm audit` in CI pipeline
- Fail CI on `critical` or `high` severity vulnerabilities
- Review and update dependencies monthly (MVP cadence)

---

## 8. Logging Standard

### 8.1 Logger implementation

Use **pino** (Fastify's built-in logger) for all backend logging.

### 8.2 Log format

- **Development**: `pino-pretty` for human-readable output
- **Production**: structured JSON (pino default)

### 8.3 Log levels by environment

| Environment | Minimum level |
|-------------|---------------|
| Development | `debug` |
| Test | `warn` |
| Production | `info` |

### 8.4 Required log fields

Every log entry must include:

| Field | Source | Purpose |
|-------|--------|---------|
| `level` | pino | Severity |
| `time` | pino | ISO-8601 timestamp |
| `msg` | application | Human-readable message |
| `requestId` | Fastify request | Correlation for API requests |
| `service` | configuration | `sportpulse-api` |

### 8.5 Structured log events (mandatory)

The following events must be logged at the specified levels:

| Event | Level | Required context |
|-------|-------|------------------|
| Ingestion start | `info` | `competitionId`, `jobId` |
| Ingestion complete | `info` | `competitionId`, `eventsUpserted`, `durationMs` |
| Ingestion failure | `error` | `competitionId`, `error`, `retryCount` |
| Provider request | `debug` | `url`, `statusCode`, `durationMs` |
| Provider rate limit hit | `warn` | `retryAfterMs` |
| Snapshot build start | `info` | `competitionId`, `dateLocal`, `buildNowUtc` |
| Snapshot build complete | `info` | `competitionId`, `snapshotKey`, `tilesCount`, `durationMs` |
| Snapshot build failure | `error` | `competitionId`, `error` |
| Stale fallback served | `warn` | `snapshotKey`, `lastBuildUtc` |
| API request error | `error` | `requestId`, `statusCode`, `errorCode` |
| Application startup | `info` | `port`, `nodeEnv`, `version` |

### 8.6 Log safety

Per NFR section 12.3:

- Never log full provider API keys (log last 4 characters only if needed)
- Never log database credentials
- Never log full request/response bodies in production (use `debug` level for development only)
- Sanitize user input in log messages to prevent log injection

---

## 9. Performance Targets

### 9.1 API response times

| Endpoint | p50 | p95 | p99 |
|----------|-----|-----|-----|
| `GET /api/ui/dashboard` (cached snapshot) | < 30ms | < 100ms | < 200ms |
| `GET /api/ui/dashboard` (build on demand) | < 200ms | < 500ms | < 1000ms |
| `GET /api/ui/team` (projection) | < 20ms | < 80ms | < 150ms |
| `GET /api/health` | < 5ms | < 10ms | < 20ms |

### 9.2 Snapshot build performance

| Operation | Target |
|-----------|--------|
| Full snapshot build (20 teams, 2 signals each) | < 500ms |
| Treemap layout computation (20 tiles) | < 10ms |
| Signal computation (per team) | < 5ms |

### 9.3 Frontend performance

| Metric | Target |
|--------|--------|
| First Contentful Paint (FCP) | < 1.5s |
| Largest Contentful Paint (LCP) | < 2.5s |
| Cumulative Layout Shift (CLS) | < 0.1 |
| Treemap render (20 tiles) | < 16ms (one frame) |
| Snapshot payload size (gzipped) | < 15 KB |

### 9.4 Measurement

- API response times: measure via pino request logging (`responseTime` field)
- Frontend metrics: Lighthouse CI in staging (informational, not blocking for MVP)
- Snapshot build time: logged per section 8.5

---

## 10. Testing Standards

### 10.1 Test organization

| Test type | Location | Runner |
|-----------|----------|--------|
| Unit tests | `packages/<pkg>/test/*.test.ts` | Vitest |
| Integration tests | `packages/<pkg>/test/integration/*.test.ts` | Vitest |
| API contract tests | `packages/api/test/contract/*.test.ts` | Vitest + Fastify inject |
| Golden fixture tests | `tools/fixtures/golden/` | Vitest (dedicated runner) |

### 10.2 Test naming convention

```
describe('<module/function name>', () => {
  it('<expected behavior> when <condition>', () => { ... });
});
```

### 10.3 Test isolation

- Unit tests must not require a database or network
- Integration tests may use a test database (separate from development)
- API contract tests use Fastify's `inject()` method (no real HTTP server)
- All tests must be parallelizable within their package

### 10.4 Golden fixture discipline

Per the Golden_Snapshot_Fixtures_v1.0 document:

- Golden fixtures are **truth locks** — failing fixtures = regression
- Updating a golden fixture requires explicit justification and version bump where applicable
- Golden fixtures are committed to source control

---

## 11. Error Handling Standards

### 11.1 Unhandled errors

- Fastify's global error handler catches unhandled errors
- All unhandled errors are logged at `error` level with stack trace
- Response uses the canonical error envelope with code `INTERNAL_ERROR`
- Stack traces are **never** exposed in production responses

### 11.2 Process-level error handling

```ts
process.on('uncaughtException', (err) => { /* log and exit(1) */ });
process.on('unhandledRejection', (err) => { /* log and exit(1) */ });
```

- Uncaught exceptions cause graceful shutdown (close server, close DB pool, exit)
- The process manager (PM2, container orchestrator) is responsible for restart

### 11.3 Graceful shutdown

On `SIGTERM` or `SIGINT`:

1. Stop accepting new connections
2. Wait for in-flight requests to complete (timeout: 10 seconds)
3. Close database pool
4. Close Redis connection (if any)
5. Exit with code 0

---

## 12. Dependency Management

### 12.1 Package manager

pnpm (version pinned in root `package.json` `packageManager` field).

### 12.2 Lockfile

- `pnpm-lock.yaml` is committed to source control
- CI installs with `pnpm install --frozen-lockfile`

### 12.3 Dependency policy

- Prefer packages with:
  - Active maintenance (commit in last 6 months)
  - No known critical vulnerabilities
  - TypeScript types (built-in or `@types/`)
- Avoid packages that pull large transitive dependency trees for small functionality
- Utility functions that can be written in < 20 lines should not be imported as packages

---

## 13. MVP acceptance extension

In addition to the Acceptance Test Matrix, a release candidate must also demonstrate:

- CI pipeline runs green with all gates passing
- Code coverage meets minimums per section 3.2
- Health endpoints respond correctly
- Security headers are present in production responses
- Rate limiting is active and returns `429` when exceeded
- No `critical` or `high` vulnerabilities in `pnpm audit`
- Deployment and rollback procedures have been exercised at least once in staging
- Structured logs are emitted for all mandatory events per section 8.5

---

## 14. One-paragraph summary

This operational baseline makes the NFR expectations concrete: CI must enforce lint, types, tests, coverage, boundary checks, and dependency audits on every PR; the API must serve security headers, enforce CORS and rate limits, and expose health endpoints; logging must be structured JSON via pino with mandatory events for ingestion, snapshot build, and failures; the database evolves through sequential numbered migrations with rollback support; deployment follows a staged pipeline with rollback executable in under 5 minutes; and performance targets are defined as measurable p95 thresholds for API responses, snapshot builds, and frontend rendering.
