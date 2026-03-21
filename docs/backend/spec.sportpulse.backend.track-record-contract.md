---
artifact_id: SPEC-SPORTPULSE-BACKEND-TRACK-RECORD-CONTRACT
title: "Backend Track Record Contract"
artifact_class: spec
status: draft
version: 0.2.0
project: sportpulse
domain: backend
slug: track-record-contract
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
  - SPEC-SPORTPULSE-QA-PREDICTION-TRACK-RECORD-FIXTURES
  - SPEC-SPORTPULSE-WEB-FRONTEND-EXECUTION-BACKLOG
  - SPEC-SPORTPULSE-CORE-IMPLEMENTATION-BACKLOG
  - SPEC-SPORTPULSE-SHARED-ERRORS-AND-WARNINGS-TAXONOMY
canonical_path: docs/backend/spec.sportpulse.backend.track-record-contract.md
---

# SportPulse — Backend Track Record Contract

Version: 0.2  
Status: Draft  
Scope: Public backend contract for competition-level track record exposure in the reengineered web frontend  
Audience: Backend, Frontend, QA, Product

---

## 1. Purpose

This document defines the public backend contract for SportPulse track record.

The contract exists to expose a trustworthy aggregate without allowing:

- cherry-picking,
- lookahead pollution,
- fabricated accuracy before threshold,
- silent substitution of operational track record with historical walk-forward evidence.

---

## 2. Invariants

### 2.1 Competition-scoped aggregate only

The endpoint returns a public aggregate for one competition at a time.

### 2.2 Only eligible evaluated predictions count

Public track record includes only predictions that satisfy all of the following:

- match belongs to the queried competition,
- prediction was produced in `FULL_MODE`,
- prediction was generated before kickoff,
- match outcome is known,
- record is eligible under the active evaluation pipeline.

### 2.3 No cherry-picking

The aggregation population must not be filtered to hide unfavorable results.

### 2.4 Threshold gate remains authoritative

Operational numeric accuracy must not be shown before `predictionCount >= 200`.

### 2.5 Historical walk-forward evidence must not masquerade as operational track record

If the product chooses to expose any historical walk-forward disclosure before operational maturity, that disclosure must be explicit and structurally typed. The base endpoint must not silently blur the two concepts.

---

## 3. Endpoint contract — GET /api/ui/track-record

### 3.1 Method and path

`GET /api/ui/track-record?competitionId=X`

### 3.2 Required query parameters

- `competitionId` — canonical competition identifier used by the product routing and prediction surfaces.

### 3.3 Forbidden query parameters in v1

The endpoint must not accept arbitrary filters such as:

- date ranges,
- team filters,
- market filters,
- user filters,
- operating-mode overrides,
- pagination,
- sorting.

---

## 4. Canonical response shape

```json
{
  "competitionId": "uy-primera",
  "availabilityStatus": "available | below_threshold | unavailable",
  "accuracy": 58.4,
  "predictionCount": 250,
  "lastEvaluatedAt": "2026-03-21T18:40:00Z",
  "belowThreshold": false,
  "historicalDisclosure": {
    "state": "none | walk_forward_historical",
    "messageKey": null
  }
}
```

### 4.1 Field semantics

- `competitionId` — canonical competition identifier.
- `availabilityStatus` — explicit frontend-facing availability class.
- `accuracy` — backend-produced aggregate accuracy percentage for the eligible evaluated operational population. Nullable when threshold has not been reached or endpoint is unavailable.
- `predictionCount` — count of eligible evaluated operational predictions in the aggregate population.
- `lastEvaluatedAt` — timestamp of the most recent eligible evaluated operational prediction in this aggregate. Nullable when none exist.
- `belowThreshold` — boolean publication gate derived from `predictionCount < 200`.
- `historicalDisclosure.state` — typed disclosure flag; `walk_forward_historical` means historical evidence exists but must not be mistaken for operational aggregate.
- `historicalDisclosure.messageKey` — stable frontend key for disclosure copy; nullable when no disclosure applies.

### 4.2 Numeric conventions

- `accuracy` is a percentage in `[0, 100]`,
- `predictionCount` is a non-negative integer.

---

## 5. Success-state variants

### 5.1 Operationally available

**HTTP 200**

```json
{
  "competitionId": "uy-primera",
  "availabilityStatus": "available",
  "accuracy": 58.4,
  "predictionCount": 250,
  "lastEvaluatedAt": "2026-03-21T18:40:00Z",
  "belowThreshold": false,
  "historicalDisclosure": {
    "state": "none",
    "messageKey": null
  }
}
```

Rules:

- `predictionCount >= 200`,
- `belowThreshold=false`,
- numeric `accuracy` is required.

### 5.2 Below threshold

**HTTP 200**

```json
{
  "competitionId": "uy-primera",
  "availabilityStatus": "below_threshold",
  "accuracy": null,
  "predictionCount": 50,
  "lastEvaluatedAt": "2026-03-21T18:40:00Z",
  "belowThreshold": true,
  "historicalDisclosure": {
    "state": "none",
    "messageKey": null
  }
}
```

Rules:

- `predictionCount < 200`,
- `belowThreshold=true`,
- numeric `accuracy` must not be exposed.

### 5.3 Below threshold with historical disclosure

**HTTP 200**

```json
{
  "competitionId": "uy-primera",
  "availabilityStatus": "below_threshold",
  "accuracy": null,
  "predictionCount": 50,
  "lastEvaluatedAt": "2026-03-21T18:40:00Z",
  "belowThreshold": true,
  "historicalDisclosure": {
    "state": "walk_forward_historical",
    "messageKey": "trackRecord.walkForwardHistorical"
  }
}
```

Rules:

- operational numeric accuracy is still hidden,
- disclosure is informational only,
- this variant is the only allowed v1 shape for “walk-forward disclosure when applicable”.

### 5.4 Unavailable

**HTTP 200**

```json
{
  "competitionId": "uy-primera",
  "availabilityStatus": "unavailable",
  "accuracy": null,
  "predictionCount": 0,
  "lastEvaluatedAt": null,
  "belowThreshold": true,
  "historicalDisclosure": {
    "state": "none",
    "messageKey": null
  }
}
```

Rules:

- absence of eligible operational data is not a transport failure,
- frontend can render explicit unavailability without guessing.

---

## 6. Derived rules

- `belowThreshold` is derived from `predictionCount < 200`,
- `availabilityStatus=available` requires `belowThreshold=false`,
- `availabilityStatus=below_threshold` requires `belowThreshold=true`,
- `availabilityStatus=unavailable` requires `accuracy=null`,
- `historicalDisclosure.state=walk_forward_historical` must never authorize numeric historical accuracy in this endpoint.

---

## 7. Error envelope and endpoint reason table

All non-successful responses defined by this document must use the platform’s canonical error envelope from the shared taxonomy:

```json
{
  "error": {
    "code": "BAD_REQUEST | NOT_FOUND | INTERNAL_ERROR",
    "message": "Human-readable message",
    "details": {
      "reason": "STABLE_REASON_ENUM",
      "retryable": false
    }
  }
}
```

`error.code` must stay within the active shared taxonomy.  
`error.details.reason` is the stable endpoint-specific discriminator for this contract.

### 7.1 Reason mapping table

| Endpoint | HTTP | `error.code` | `details.reason` | Retryable |
|---|---:|---|---|---|
| `GET /api/ui/track-record` | 400 | `BAD_REQUEST` | `INVALID_COMPETITION_ID` | no |
| `GET /api/ui/track-record` | 404 | `NOT_FOUND` | `COMPETITION_NOT_ENABLED` | no |
| `GET /api/ui/track-record` | 500 | `INTERNAL_ERROR` | `TRACK_RECORD_COMPUTATION_FAILED` | yes |
| `GET /api/ui/track-record` | 500 | `INTERNAL_ERROR` | `INTERNAL_SERVER_FAILURE` | yes |

### 7.2 What is not an error

The following must remain successful `200` states rather than transport failures:

- below-threshold operational evidence,
- explicit unavailability due to no eligible operational records,
- historical walk-forward disclosure without operational maturity.

---

## 8. Frontend integration rules

- frontend must render threshold state from `belowThreshold` and `availabilityStatus`, not by duplicating threshold logic,
- frontend must render walk-forward disclosure from `historicalDisclosure`, not by heuristics,
- frontend must not infer numeric historical performance from disclosure-only states.

---

## 9. Acceptance mapping

This contract is intended to satisfy or unblock:

- `K-03` — track record aggregate correctness,
- `PF-03` — threshold gate,
- and the frontend backlog requirement for available / below-threshold / unavailable track-record states plus walk-forward disclosure when applicable.

---

## 10. Summary

SportPulse track record must expose a competition-level operational aggregate that is competition-scoped, pre-kickoff clean, threshold-gated, explicit about unavailability, and honest about any historical walk-forward disclosure. This contract therefore defines `GET /api/ui/track-record?competitionId=X` with explicit `availabilityStatus`, `belowThreshold`, and typed `historicalDisclosure` fields, while keeping numeric operational accuracy hidden until the 200-prediction threshold is met.
