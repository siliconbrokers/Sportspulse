---
artifact_id: SPEC-SPORTPULSE-API-CONTRACT
title: "API Contract"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: api
slug: contract
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/api/spec.sportpulse.api.contract.md
---
# SportPulse — API Contract Specification

Version: 1.1  
Status: Draft for review  
Scope: Internal UI API (frontend-facing) for SportPulse MVP  
Audience: Backend, Frontend, QA, Ops

---

## 1. Purpose

This document defines the **frontend-facing API contract** for SportPulse MVP.

Hard rules:

- Frontend consumes **only** these endpoints.
- API must **not** expose provider-specific identifiers, schemas, or raw provider payloads.
- Responses are **snapshot-based** and include **warnings** for staleness/partial/provider error.
- Scoring is **backend-owned**. Frontend must not compute signals, scoring, or layout.
- DTOs must align with:
  - `dashboard-snapshot-dto.md`
  - `signals-spec.md`
  - `metrics-spec.md`
  - `scoring-policy-spec.md`
  - `snapshot-engine-spec.md`

MVP mode: **football**, mode **Form + agenda**.

---

## 2. Base URL and conventions

- Base path: `/api/ui`
- Content-Type: `application/json`
- All timestamps: ISO-8601 strings
  - Server timestamps are UTC (`...Z`)
- `dateLocal` format: `YYYY-MM-DD`
- `timezone`: IANA name (e.g., `America/Montevideo`, `Europe/Madrid`)
- Unknown response fields must be ignored by the frontend (forward compatibility).
- IDs are **internal canonical IDs** (stable strings); never provider IDs.

---

## 3. Authentication model (MVP)

MVP defaults to public read for:

- dashboard snapshot
- team detail projection
- agenda projection (if exposed)

Authenticated endpoints (optional in MVP):

- favorites read/write
- “me” dashboard projection

Auth mechanism:

- cookie session **or** bearer token

If unauthenticated on protected endpoints: return `401`.

Auth must not affect snapshot determinism.

---

## 4. Standard error envelope

All non-2xx responses return:

```json
{
  "error": {
    "code": "STRING",
    "message": "Human readable message",
    "details": null
  }
}
```

Error codes (minimum set):

- `BAD_REQUEST`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `RATE_LIMITED`
- `INTERNAL_ERROR`
- `SERVICE_UNAVAILABLE`
- `SNAPSHOT_BUILD_FAILED`

---

## 5. Snapshot-first contract (non-negotiable)

- `/dashboard` returns a **materialized** `DashboardSnapshotDTO`.
- `/team` returns a **projection** derived from the dashboard snapshot.
- `/agenda` (if present) returns a **projection** derived from the dashboard snapshot.

Endpoints must **NOT**:

- recompute signals
- recompute scoring
- recompute layout/geometry
- call external providers on the request path

All computation happens in the Snapshot Engine pipeline.

---

## 6. Determinism anchor: `buildNowUtc`

### 6.1 What it means

`buildNowUtc` is the explicit logical “now” used to compute time-relative signals (e.g., next match hours).

### 6.2 MVP v1 rule (fixed)

For dashboard requests that specify `dateLocal` and `timezone`, the backend MUST compute:

- `buildNowUtc = toUtc(dateLocal + "T12:00:00" in timezone)`

This makes daily snapshots deterministic and reproducible for QA.

If you later want “live now” snapshots, that is a **new policy/versioned behavior** and must be explicitly specified (do not silently change this rule).

---

## 7. Warnings contract

Snapshot payloads must include warnings as a list (may be empty):

```ts
type WarningDTO = {
  code: string;                 // stable warning code
  severity: "INFO" | "WARN" | "ERROR";
  message?: string | null;
  entityId?: string;            // optional reference (e.g., "team:barcelona")
};
```

Common warning codes (suggested):

- `STALE_DATA`
- `PROVIDER_ERROR`
- `PARTIAL_DATA`
- `MISSING_SIGNAL`
- `LAYOUT_DEGRADED`

Warnings are informational; they must not change score semantics on the frontend.

---

## 8. Endpoints

### 8.1 GET `/api/ui/dashboard`

Returns the dashboard snapshot for a competition + local date context.

#### Query parameters

- `competitionId` (string, required)
- `dateLocal` (string `YYYY-MM-DD`, required)
  - alias accepted: `date`
- `timezone` (string IANA, optional; server default if omitted)
- `includeSignals` (boolean, optional; default `false`)
  - If `true`, backend may include `signals[]` per tile for explainability/debug.

#### Response

- `200` with `DashboardSnapshotDTO` (see `dashboard-snapshot-dto.md`)
- `400` invalid params
- `404` competition not found or not enabled
- `503` snapshot cannot be built and no cached snapshot exists (`SNAPSHOT_BUILD_FAILED`)

#### Caching

Recommended response headers:

- `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`

#### Notes

- Backend may serve a cached snapshot for the same `(competitionId, dateLocal, timezone, policyKey, policyVersion)` key.
- `header.buildNowUtc` MUST follow the rule in section 6.2 for MVP v1.

---

### 8.2 GET `/api/ui/team`

Returns a team detail payload used by the detail panel.

This endpoint is a **projection** of the dashboard snapshot for the same context.

#### Query parameters

- `competitionId` (string, required)
- `teamId` (string, required) — canonical team id
  - alias accepted: `participantId` (legacy)
- `dateLocal` (string `YYYY-MM-DD`, required)
  - alias accepted: `date`
- `timezone` (string IANA, optional)

#### Response

- `200` with `TeamDetailDTO` (defined below)
- `400` invalid params
- `404` team not found for competition
- `503` snapshot cannot be served and no cached snapshot exists (`SNAPSHOT_BUILD_FAILED`)

#### Projection rules

Backend MUST:

1) Load the `DashboardSnapshotDTO` for `(competitionId, dateLocal, timezone)`  
2) Extract the team tile by `teamId`  
3) Return the projection

Backend MUST NOT:

- call provider APIs
- recompute signals, scoring, or layout
- build a separate “team snapshot” artifact

#### TeamDetailDTO (contract)

```ts
type TeamDetailDTO = {
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

  // Optional: derived projections for UI convenience (must be derived from snapshot fields only)
  nextMatch?: {
    matchId: string;
    kickoffUtc: string;
    opponentTeamId?: string;
    opponentName?: string;
    venue?: "HOME" | "AWAY" | "NEUTRAL" | "UNKNOWN";
  };

  explainability?: {
    topContributions: ContributionDTO[];
    signals?: SignalDTO[];
  };
};
```

---

### 8.3 GET `/api/ui/agenda` (optional in MVP)

If implemented, returns agenda information as a projection of the dashboard snapshot.

#### Query parameters

- `competitionId` (string, required)
- `dateLocal` (string `YYYY-MM-DD`, required)
- `timezone` (string IANA, optional)

#### Response

- `200` with `AgendaDTO` (as defined by dashboard snapshot contract if/when included)
- `404` competition not enabled
- `503` cannot serve and no cached snapshot exists (`SNAPSHOT_BUILD_FAILED`)

If the dashboard snapshot already includes agenda, this endpoint MAY be omitted.

---

### 8.4 GET `/api/ui/favorites` (authenticated, optional in MVP)

Returns current user favorite teams.

- Auth: required

Response `200`:

```json
{
  "schemaVersion": 1,
  "favorites": ["team:barcelona", "team:real_madrid"]
}
```

---

### 8.5 POST `/api/ui/favorites` (authenticated, optional in MVP)

Toggles a favorite team.

- Auth: required

Body:

```json
{
  "teamId": "team:barcelona",
  "action": "add"
}
```

`action` enum: `add` | `remove`

Responses:

- `200` updated favorites list
- `400` invalid teamId/action
- `401` unauthenticated
- `404` team not found

---

### 8.6 GET `/api/ui/me/dashboard` (authenticated, optional in MVP)

Returns a personalized dashboard projection.

Query parameters:

- `competitionId` (required)
- `dateLocal` (required)
- `timezone` (optional)

Response `200`:

- returns `DashboardSnapshotDTO` plus optional `personalization` block:

```json
{
  "personalization": {
    "favorites": ["team:barcelona"]
  }
}
```

If not implemented in MVP, omit this endpoint.

---

## 9. DTO compliance requirements

- `/dashboard` must return exactly `DashboardSnapshotDTO` per `dashboard-snapshot-dto.md`.
- `/team` must return `TeamDetailDTO` as specified here and must be a projection of `/dashboard`.
- Signal objects (if present) must align with `signals-spec.md`.
- Metrics semantics must align with `metrics-spec.md`.
- Score fields must align with `scoring-policy-spec.md`:
  - `attentionScore`
  - `displayScore`
  - `layoutWeight`

---

## 10. Fallback behavior (staleness + provider outage)

If snapshot rebuild fails:

- return last available snapshot for the same SnapshotKey
- include warnings:
  - `STALE_DATA` (WARN)
  - `PROVIDER_ERROR` (ERROR) if ingestion/provider is the cause
- keep payload shape valid (no invented score fields)

If partial data exists:

- return snapshot
- include warning `PARTIAL_DATA` (WARN)
- do not fabricate missing fields; use `signals[].quality.missing=true` where applicable

If snapshot cannot be built and no cached snapshot exists:

- return `503` with code `SNAPSHOT_BUILD_FAILED`

---

## 11. Validation rules (backend)

- reject invalid `dateLocal` format (`400`)
- reject unknown `competitionId` (`404`)
- reject unknown `teamId` within competition (`404`)
- ensure warnings list exists on snapshot outputs (may be empty)
- ensure `policyKey`, `policyVersion`, and `buildNowUtc` exist and are consistent across payload

---

## 12. Acceptance criteria (API)

- Frontend can render dashboard using only `/dashboard`.
- Frontend can render detail panel using `/team`.
- Share links reconstruct UI state from query parameters (dateLocal/timezone/teamId), without client-side scoring.
- Provider outages do not break UI: cached snapshots still served with warnings.
- Authenticated favorites endpoints are idempotent (if implemented).
