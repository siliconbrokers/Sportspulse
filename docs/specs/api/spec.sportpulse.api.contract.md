---
artifact_id: SPEC-SPORTPULSE-API-CONTRACT
title: "API Contract"
artifact_class: spec
status: active
version: 1.1.0
project: sportpulse
domain: api
slug: api-contract
owner: api
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-SERVER-BACKEND-ARCHITECTURE
  - SPEC-SPORTPULSE-BACKEND-SESSION-AUTH-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-SUBSCRIPTION-CHECKOUT-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-TRACK-RECORD-CONTRACT
  - SPEC-SPORTPULSE-SHARED-ERRORS-AND-WARNINGS-TAXONOMY
canonical_path: docs/specs/api/spec.sportpulse.api.contract.md
---
# SportPulse — API Contract

Version: 1.1.0  
Status: Active  
Scope: Authoritative HTTP contract for MVP UI API, session/auth, subscription/checkout, and public track record.

## 1. Authority

This document is the active HTTP source of truth for implementation. If a side spec disagrees with this file, this file wins.

## 2. Canonical response rules

### 2.1 Success envelope
Success responses return the resource payload directly unless a route explicitly wraps it.

### 2.2 Error envelope
All non-2xx responses use:

```json
{
  "error": {
    "code": "UPPERCASE_SNAKE_CASE",
    "message": "stable human-readable summary",
    "details": {
      "reason": "UPPERCASE_SNAKE_CASE",
      "retryable": false
    }
  }
}
```

### 2.3 Warning DTO
Warnings, when present, use the active warnings taxonomy and appear as `warnings: WarningDTO[]`.

## 3. Shared types

### 3.1 SessionDTO

```json
{
  "sessionStatus": "anonymous | authenticated | expired",
  "userId": "usr_xxx | null",
  "email": "user@example.com | null",
  "tier": "free | pro",
  "isPro": true,
  "sessionIssuedAt": "2026-03-21T21:00:00Z | null"
}
```

### 3.2 ReturnContextDTO

```json
{
  "returnTo": "/relative/internal/path",
  "intent": {
    "type": "pro_depth | auth_entry | checkout_return",
    "competitionId": "laliga",
    "matchId": "match_123",
    "depthKey": "scoreline"
  }
}
```

Rules:
- `returnTo` must be a relative internal route.
- `intent` is optional.
- no absolute URLs, no protocol prefixes, no cross-origin redirects.

## 4. UI API routes

### 4.1 `GET /api/ui/dashboard`
Existing active dashboard route. Unchanged by this delta.

### 4.2 `GET /api/ui/team`
Existing active team route. Unchanged by this delta.

### 4.3 `GET /api/ui/track-record?competitionId={id}`
Public route. No auth required.

Response:

```json
{
  "competitionId": "laliga",
  "state": "available | below_threshold | unavailable",
  "predictionCount": 243,
  "accuracy": 0.58,
  "belowThreshold": false,
  "evaluationType": "operational | historical_walk_forward",
  "disclosureMessageKey": "TRACK_RECORD_OPERATIONAL | TRACK_RECORD_HISTORICAL_WALK_FORWARD | TRACK_RECORD_UNAVAILABLE",
  "lastEvaluatedAt": "2026-03-21T18:00:00Z",
  "threshold": 200
}
```

Rules:
- `accuracy` is `null` when `state != available`.
- `belowThreshold=true` only when `state=below_threshold`.
- only FULL_MODE, pre-kickoff, resolved predictions are counted.

Canonical errors:
- `400 BAD_REQUEST / INVALID_COMPETITION_ID`
- `404 NOT_FOUND / COMPETITION_NOT_ENABLED`
- `503 SERVICE_UNAVAILABLE / TRACK_RECORD_UNAVAILABLE`

## 5. Session/Auth routes

### 5.1 `GET /api/session`
No request body.

Returns:
- `200` with `SessionDTO` for anonymous, authenticated, or expired.

Rules:
- anonymous is not an error.
- response is `Cache-Control: no-store`.
- frontend may have local `loading`; backend does not return `loading`.

### 5.2 `POST /api/auth/magic-link/start`
Request:

```json
{
  "email": "user@example.com",
  "returnContext": {
    "returnTo": "/predicciones?matchId=match_123",
    "intent": {
      "type": "pro_depth",
      "competitionId": "laliga",
      "matchId": "match_123",
      "depthKey": "scoreline"
    }
  }
}
```

Response `202`:

```json
{
  "requestAccepted": true,
  "cooldownSeconds": 60
}
```

Canonical errors:
- `400 BAD_REQUEST / INVALID_EMAIL`
- `400 BAD_REQUEST / INVALID_RETURN_CONTEXT`
- `429 TOO_MANY_REQUESTS / MAGIC_LINK_RATE_LIMITED`
- `503 SERVICE_UNAVAILABLE / EMAIL_DELIVERY_UNAVAILABLE`

### 5.3 `POST /api/auth/magic-link/complete`
Request:

```json
{
  "token": "opaque-token"
}
```

Response `200`:

```json
{
  "session": { "sessionStatus": "authenticated", "userId": "usr_123", "email": "user@example.com", "tier": "free", "isPro": false, "sessionIssuedAt": "2026-03-21T21:00:00Z" },
  "resume": {
    "returnTo": "/predicciones?matchId=match_123",
    "intent": { "type": "pro_depth", "competitionId": "laliga", "matchId": "match_123", "depthKey": "scoreline" }
  }
}
```

Canonical errors:
- `400 BAD_REQUEST / INVALID_TOKEN`
- `410 GONE / TOKEN_EXPIRED`
- `409 CONFLICT / TOKEN_ALREADY_USED`

### 5.4 `POST /api/logout`
No request body. Returns `204`.

## 6. Subscription/Checkout routes

### 6.1 `POST /api/checkout/session`
Requires authenticated session.

Request:

```json
{
  "planKey": "pro_monthly",
  "returnContext": {
    "returnTo": "/pro",
    "intent": { "type": "checkout_return" }
  }
}
```

Response `200`:

```json
{
  "checkoutSessionId": "cs_test_123",
  "checkoutUrl": "https://provider.example/checkout/..."
}
```

Canonical errors:
- `401 UNAUTHORIZED / SESSION_REQUIRED`
- `400 BAD_REQUEST / INVALID_PLAN_KEY`
- `409 CONFLICT / ALREADY_ENTITLED`
- `503 SERVICE_UNAVAILABLE / CHECKOUT_PROVIDER_UNAVAILABLE`

### 6.2 `GET /api/subscription/status`
Requires authenticated session.

Response `200`:

```json
{
  "userId": "usr_123",
  "tier": "free | pro",
  "state": "inactive | active | grace | pending_reconcile",
  "entitlementUpdatedAt": "2026-03-21T21:05:00Z"
}
```

Canonical errors:
- `401 UNAUTHORIZED / SESSION_REQUIRED`
- `503 SERVICE_UNAVAILABLE / ENTITLEMENT_STATUS_UNAVAILABLE`

### 6.3 `POST /api/checkout/return/reconcile`
Request:

```json
{
  "checkoutSessionId": "cs_test_123"
}
```

Response `200`:

```json
{
  "result": "reconciled | pending | reauth_required",
  "session": {
    "sessionStatus": "authenticated",
    "userId": "usr_123",
    "email": "user@example.com",
    "tier": "pro",
    "isPro": true,
    "sessionIssuedAt": "2026-03-21T21:00:00Z"
  }
}
```

Canonical errors:
- `400 BAD_REQUEST / INVALID_CHECKOUT_SESSION_ID`
- `401 UNAUTHORIZED / SESSION_REQUIRED`
- `409 CONFLICT / CHECKOUT_OWNER_MISMATCH`
- `409 CONFLICT / CHECKOUT_NOT_PAID`
- `503 SERVICE_UNAVAILABLE / RECONCILE_UNAVAILABLE`

### 6.4 `POST /api/subscription/refresh-entitlement`
Requires authenticated session. Returns fresh subscription status and session-aligned tier.

Canonical errors:
- `401 UNAUTHORIZED / SESSION_REQUIRED`
- `503 SERVICE_UNAVAILABLE / ENTITLEMENT_REFRESH_UNAVAILABLE`

## 7. Health and ops-facing routes

Health routes are defined in the operational baseline and backend architecture. They are out of scope for user-facing contract detail here.
