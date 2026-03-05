# Plan: SP-0601 — GET /api/ui/dashboard

## Spec refs
- api-contract-corrected.md §8.1 (endpoint definition)
- api-contract-corrected.md §4 (error envelope)
- api-contract-corrected.md §6.2 (buildNowUtc rule)
- api-contract-corrected.md §7 (warnings contract)
- Operational_Baseline_v1.0.md (Fastify, rate limiting, security headers)

## Design decisions

### Endpoint
```
GET /api/ui/dashboard?competitionId=X&dateLocal=YYYY-MM-DD&timezone=Z&includeSignals=bool
```

### Query param validation
- `competitionId`: required string, reject if missing → 400 BAD_REQUEST
- `dateLocal` (alias `date`): required, format YYYY-MM-DD, reject invalid → 400
- `timezone`: optional, default 'Europe/Madrid' for MVP (La Liga)
- `includeSignals`: optional boolean, default false

### Response
- 200: DashboardSnapshotDTO (from snapshot service)
- 400: error envelope with BAD_REQUEST
- 404: NOT_FOUND if competitionId unknown
- 503: SNAPSHOT_BUILD_FAILED if no snapshot available

### Cache headers
Per spec §8.1: `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`

### Architecture
```
Fastify route handler
  → validate query params
  → resolve competition + season + teams + matches (MVP: hardcoded La Liga data source)
  → call snapshotService.serve(input)
  → if source === 'stale_fallback', set X-Snapshot-Source header
  → strip signals[] from teams if includeSignals !== true
  → return 200 with DashboardSnapshotDTO
```

### MVP data source
For MVP, the data source is a function that returns canonical data for La Liga. In production this will be a database query. For now:
```ts
export interface DataSource {
  getCompetition(competitionId: string): Competition | undefined;
  getSeason(competitionId: string): Season | undefined;
  getTeams(competitionId: string): Team[];
  getMatches(seasonId: string): Match[];
}
```

## Files to create
1. `packages/api/src/ui/dashboard-route.ts` — Fastify route plugin
2. `packages/api/src/validation/query-params.ts` — shared validation helpers
3. `packages/api/src/index.ts` — update with route registration
4. `packages/api/test/dashboard-route.test.ts` — tests using Fastify inject

## Files to modify
- `packages/api/src/index.ts` — replace `export {}` with app factory + route registration

## Tests (mapped to acceptance)
- F-01: valid request returns 200 with DashboardSnapshotDTO shape
- F-01: response has header with all required fields
- F-02: missing competitionId → 400 with BAD_REQUEST envelope
- F-02: invalid dateLocal format → 400
- F-03: unknown competitionId → 404 with NOT_FOUND
- F-04: snapshot build fails + no cache → 503 with SNAPSHOT_BUILD_FAILED
- F-01: cache headers present
- F-01: includeSignals=false strips signals from response

## Implementation notes for Sonnet
- Use `fastify.inject()` for testing (no real HTTP server needed)
- Create a `buildApp()` factory that registers routes and returns Fastify instance
- DataSource is injected into the route (via Fastify decorate or closure)
- Error envelope: `{ error: { code: string, message: string, details: null } }`
- For MVP, a hardcoded/mock DataSource is sufficient for tests
- Do NOT implement rate limiting or auth yet — that's separate tasks
- Date validation: regex `/^\d{4}-\d{2}-\d{2}$/` is sufficient for MVP
