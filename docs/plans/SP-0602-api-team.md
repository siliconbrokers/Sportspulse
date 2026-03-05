# Plan: SP-0602 — GET /api/ui/team Projection

## Spec refs
- api-contract-corrected.md §8.2 (endpoint definition)
- api-contract-corrected.md §8.2 TeamDetailDTO contract

## Design decisions

### Endpoint
```
GET /api/ui/team?competitionId=X&teamId=Y&dateLocal=YYYY-MM-DD&timezone=Z
```

### This is a PROJECTION, not a recomputation
Per spec §8.2: "Backend MUST load DashboardSnapshotDTO, extract team tile by teamId, return projection."

### TeamDetailDTO shape (from spec)
```ts
export interface TeamDetailDTO {
  header: {
    competitionId: string;
    seasonId?: string;
    dateLocal: string;
    timezone: string;
    policyKey: string;
    policyVersion: number;
    buildNowUtc: string;
    computedAtUtc: string;
    freshnessUtc?: string;
    warnings: WarningDTO[];
    snapshotKey?: string;
  };
  team: {
    teamId: string;
    teamName: string;
  };
  score: {
    rawScore: number;
    attentionScore: number;
    displayScore: number;
    layoutWeight: number;
  };
  nextMatch?: NextMatchDTO;
  explainability?: {
    topContributions: ContributionDTO[];
    signals?: SignalDTO[];
  };
}
```

### Projection function
```ts
export function projectTeamDetail(
  snapshot: DashboardSnapshotDTO,
  teamId: string,
  dateLocal: string,
  timezone: string,
): TeamDetailDTO | null
```

Returns null if teamId not found in snapshot.teams[].

### Query params
- `competitionId`: required
- `teamId` (alias `participantId`): required
- `dateLocal` (alias `date`): required
- `timezone`: optional, default 'Europe/Madrid'

### Responses
- 200: TeamDetailDTO
- 400: BAD_REQUEST (missing params)
- 404: NOT_FOUND (team not in snapshot)
- 503: SNAPSHOT_BUILD_FAILED

## Files to create
1. `packages/api/src/ui/team-route.ts` — Fastify route plugin
2. `packages/snapshot/src/project/team-detail.ts` — projectTeamDetail() pure function
3. `packages/snapshot/src/dto/team-detail.ts` — TeamDetailDTO type
4. `packages/api/test/team-route.test.ts` — tests
5. `packages/snapshot/test/team-detail-projection.test.ts` — unit tests for projection

## Tests (mapped to acceptance)
- F-01: valid request returns 200 with TeamDetailDTO
- F-02: missing teamId → 400
- F-03: unknown teamId → 404
- F-01: projection matches data from dashboard snapshot (no recomputation)
- F-01: explainability includes topContributions

## Implementation notes for Sonnet
- projectTeamDetail is a PURE function that extracts from DashboardSnapshotDTO
- The route handler: get/build snapshot for (competitionId, dateLocal, timezone), then project
- Reuse snapshotService from SP-0601 (same cache, same snapshot)
- Header projection: copy fields from snapshot.header, add dateLocal/timezone from request
- signals[] always included in projection (explainability panel needs them)
