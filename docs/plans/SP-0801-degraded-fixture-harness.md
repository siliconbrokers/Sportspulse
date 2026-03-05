# Plan: SP-0801 — Degraded-State Fixture Harness

## Spec refs
- Acceptance_Test_Matrix §G-01 (provider outage fallback), §G-02 (partial data)
- Golden_Snapshot_Fixtures §6.4 (F4 partial), §6.5 (F5 stale fallback)
- Errors_and_Warnings_Taxonomy_v1.0.md

## Design decisions

### Purpose
Create test fixtures and harness that validate the system behaves correctly under degraded conditions:
1. Stale fallback (build fails, serve cached)
2. Partial data (some signals missing)
3. Provider error (error propagation through warnings)

### Approach
Integration tests in packages/snapshot and packages/api that:
- Pre-populate cache with a known snapshot
- Force a build failure (invalid input or mock throwing)
- Verify stale fallback returns cached + STALE_DATA warning
- Verify partial data builds succeed with MISSING_SIGNAL + PARTIAL_DATA warnings

### No mocking framework
Use simple function replacement and invalid inputs to trigger failures.
For stale fallback: call serve() once (fresh), then corrupt teams/matches input, call again.

## Files to create
1. `packages/snapshot/test/degraded-states.test.ts` — Tests for:
   - Stale fallback: serve fresh → corrupt input → serve again → source: 'stale_fallback'
   - Partial data: teams with no matches → MISSING_SIGNAL warnings
   - Provider error simulation: empty teams array → still builds but with warnings
2. `packages/api/test/degraded-states.test.ts` — API-level tests:
   - Dashboard endpoint with stale fallback → 200 + STALE_DATA warning
   - Dashboard endpoint with empty competition → 503

## Tests (mapped to acceptance)
- G-01: Provider outage → stale snapshot served with warnings
- G-02: Partial data → snapshot built with PARTIAL_DATA/MISSING_SIGNAL

## Implementation notes for Sonnet
- InMemorySnapshotStore makes stale fallback testable without Redis
- For API test: create custom DataSource that returns empty/corrupted data on second call
- Verify warning codes AND severity match taxonomy
- Stale fallback test must verify the snapshot shape remains valid DTO
