# Plan: SP-0502 — Snapshot Build Pipeline Orchestration

## Spec refs
- snapshot-engine-spec-corrected.md §7 (full build pipeline)
- dashboard-snapshot-dto-corrected-v1.2.md §3.8 (DashboardSnapshotDTO)
- scoring-policy.md (policy execution)
- treemap-algorithm-spec-corrected.md (layout generation)

## Design decisions

### Pipeline function signature
```ts
export interface BuildSnapshotInput {
  competitionId: string;
  seasonId: string;
  dateLocal: string;
  timezone: string;
  teams: readonly Team[];
  matches: readonly Match[];
  policy: PolicyDefinition;
  container: TreemapContainer;
  freshnessUtc?: string;
}

export interface BuildSnapshotResult {
  snapshot: DashboardSnapshotDTO;
  warnings: WarningDTO[];
}

export function buildSnapshot(input: BuildSnapshotInput): BuildSnapshotResult
```

### Pipeline steps (per spec §7)
```
1. Compute buildNowUtc from dateLocal + timezone (identity/snapshot-key.ts)
2. For each team:
   a. computeFormPointsLast5(teamId, matches, buildNowUtc) → SignalDTO
   b. computeNextMatchHours(teamId, matches, buildNowUtc) → SignalDTO
   c. executePolicy(teamId, [formSignal, nextMatchSignal], policy) → ScoringResult
   d. Collect warnings for missing signals
3. Sort teams by layoutWeight desc, teamId asc (deterministic ordering spec §2.2)
4. Build TreemapInput[] from sorted teams
5. squarify(inputs, container) → TreemapTile[]
6. Merge scoring + geometry + signals into TeamScoreDTO[]
7. Detect all-zero weights → add LAYOUT_DEGRADED warning
8. Assemble header
9. Return DashboardSnapshotDTO
```

### Ordering rule
Per spec §2.2: `teams[]` sorted by `layoutWeight desc, teamId asc`.
This order MUST be applied before treemap input AND preserved in output.

### NextMatch extraction
For each team, find the next match with `startTimeUtc > buildNowUtc` and `status = SCHEDULED`. Extract opponent info from the teams array.

### Warning aggregation (feeds into SP-0503)
Collect warnings during build:
- `MISSING_SIGNAL` (WARN) per team with missing signals
- `LAYOUT_DEGRADED` (WARN) if isAllZeroWeights
- `PARTIAL_DATA` (WARN) if some teams have no matches at all

## Files to create
1. `packages/snapshot/src/build/build-snapshot.ts` — main pipeline function
2. `packages/snapshot/src/build/team-tile-builder.ts` — per-team signal+score+nextMatch assembly
3. `packages/snapshot/src/build/sort-teams.ts` — deterministic sort function
4. `packages/snapshot/test/build-snapshot.test.ts` — integration tests

## Tests (mapped to acceptance)
- E-01: pipeline produces valid DashboardSnapshotDTO with all required fields
- E-02: determinism — same inputs → identical output (excluding computedAtUtc)
- E-03: ordering — teams sorted by layoutWeight desc, teamId asc
- E-02: geometry — rects fit inside container, no overlap
- G-01: missing signals → MISSING_SIGNAL warning, team still in output
- G-02: all-zero weights → LAYOUT_DEGRADED warning, equal-area tiles

## Dependencies (imports)
- `@sportpulse/canonical`: Team, Match, EventStatus
- `@sportpulse/signals`: computeFormPointsLast5, computeNextMatchHours, SignalDTO
- `@sportpulse/scoring`: executePolicy, MVP_POLICY, ScoringResult
- `@sportpulse/layout`: squarify, TreemapContainer, TreemapInput, isAllZeroWeights, LAYOUT_ALGORITHM_KEY, LAYOUT_ALGORITHM_VERSION

## Implementation notes for Sonnet
- `buildSnapshot` is a PURE function — no IO, no fetching, no caching
- Caching is handled by SP-0505 (separate layer)
- `computedAtUtc` = `new Date().toISOString()` at start of build
- Team name comes from `teams` array input (lookup by teamId)
- NextMatch: find match where (homeTeamId === teamId || awayTeamId === teamId) AND startTimeUtc > buildNowUtc AND status === SCHEDULED, sort by startTimeUtc asc, take first
- Opponent: if team is home, opponent is away team and vice versa
- Venue: if team is homeTeamId → 'HOME', if awayTeamId → 'AWAY'
