# Plan: SP-0501 — Snapshot Identity & Header Assembly

## Spec refs
- dashboard-snapshot-dto-corrected-v1.2.md §3.2, §3.3, §3.4, §3.8
- snapshot-engine-spec-corrected.md §5

## Design decisions

### SnapshotHeaderDTO
Per spec §3.3, exact shape:
```ts
export interface SnapshotHeaderDTO {
  snapshotSchemaVersion: number;  // 1 for MVP
  competitionId: string;
  seasonId: string;
  buildNowUtc: string;           // ISO8601
  timezone: string;              // IANA
  policyKey: string;
  policyVersion: number;
  computedAtUtc: string;         // ISO8601 — set at build time
  freshnessUtc?: string;
  snapshotKey?: string;          // derived convenience key
}
```

### SnapshotKey derivation
Per spec §5.1, key = `{competitionId}|{seasonId}|{buildNowUtc}|{policyKey}@{policyVersion}`

### WarningDTO
Per spec §3.4:
```ts
export interface WarningDTO {
  code: string;
  severity: 'INFO' | 'WARN' | 'ERROR';
  message?: string | null;
  entityId?: string;
}
```

### LayoutMetadataDTO
Per spec §3.2 — reuse from @sportpulse/layout:
```ts
export interface LayoutMetadataDTO {
  algorithmKey: string;
  algorithmVersion: number;
  container: TreemapContainerDTO;
}
```

### TeamScoreDTO
Per spec §3.7:
```ts
export interface TeamScoreDTO {
  teamId: string;
  teamName: string;
  policyKey: string;
  policyVersion: number;
  buildNowUtc: string;
  rawScore: number;
  attentionScore: number;
  displayScore: number;
  layoutWeight: number;
  rect: Rect;
  topContributions: ContributionDTO[];
  signals?: SignalDTO[];
  nextMatch?: NextMatchDTO;
}

export interface NextMatchDTO {
  matchId: string;
  kickoffUtc: string;
  opponentTeamId?: string;
  opponentName?: string;
  venue?: 'HOME' | 'AWAY' | 'NEUTRAL' | 'UNKNOWN';
}
```

### DashboardSnapshotDTO (root)
```ts
export interface DashboardSnapshotDTO {
  header: SnapshotHeaderDTO;
  layout: LayoutMetadataDTO;
  warnings: WarningDTO[];
  teams: TeamScoreDTO[];
}
```

### buildNowUtc computation (MVP v1)
Per api-contract §6.2: `buildNowUtc = toUtc(dateLocal + "T12:00:00" in timezone)`

### SNAPSHOT_SCHEMA_VERSION
Constant = 1 for MVP.

## Files to create
1. `packages/snapshot/src/dto/snapshot-header.ts` — SnapshotHeaderDTO, WarningDTO, SNAPSHOT_SCHEMA_VERSION
2. `packages/snapshot/src/dto/team-score.ts` — TeamScoreDTO, NextMatchDTO
3. `packages/snapshot/src/dto/dashboard-snapshot.ts` — DashboardSnapshotDTO (root)
4. `packages/snapshot/src/identity/snapshot-key.ts` — buildSnapshotKey(), buildNowUtcFromDate()
5. `packages/snapshot/src/identity/assemble-header.ts` — assembleHeader()
6. `packages/snapshot/src/index.ts` — update exports
7. `packages/snapshot/test/snapshot-identity.test.ts` — tests

## Files to modify
- `packages/snapshot/src/index.ts` — replace `export {}` with real exports

## Tests (mapped to acceptance)
- E-01: snapshot header has all required fields
- E-01: snapshotKey is deterministic from identity tuple
- E-01: buildNowUtc computed correctly from dateLocal + timezone
- E-01: computedAtUtc is ISO8601 and different from buildNowUtc
- Determinism: same inputs → same snapshotKey

## Implementation notes for Sonnet
- Import `Rect` from `@sportpulse/layout` (already workspace dep)
- Import `ContributionDTO` from `@sportpulse/scoring`
- Import `SignalDTO` from `@sportpulse/signals`
- SnapshotKey uses pipe separator: `competitionId|seasonId|buildNowUtc|policyKey@policyVersion`
- `buildNowUtcFromDate(dateLocal: string, timezone: string): string` — use basic date math, no heavy tz lib for MVP (midnight + 12h offset calculation)
- SNAPSHOT_SCHEMA_VERSION = 1
