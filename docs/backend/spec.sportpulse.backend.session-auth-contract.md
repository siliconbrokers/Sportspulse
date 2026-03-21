---
artifact_id: SPEC-SPORTPULSE-BACKEND-SESSION-AUTH-CONTRACT
title: "Backend Session and Auth Contract"
artifact_class: spec
status: draft
version: 0.2.1
project: sportpulse
domain: backend
slug: session-auth-contract
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-BACKEND-SHARED-RETURN-CONTEXT-CONTRACT
  - SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
  - SPEC-SPORTPULSE-WEB-NAVIGATION-AND-SHELL-ARCHITECTURE
  - SPEC-SPORTPULSE-WEB-FRONTEND-EXECUTION-BACKLOG
  - SPEC-SPORTPULSE-WEB-FRONTEND-MODERNIZATION
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
  - SPEC-SPORTPULSE-SHARED-ERRORS-AND-WARNINGS-TAXONOMY
canonical_path: docs/backend/spec.sportpulse.backend.session-auth-contract.md
---

# SportPulse — Backend Session and Auth Contract

Version: 0.2.1  
Status: Draft  
Scope: Minimal backend contract for session hydration, deferred magic-link auth, auth callback completion, logout, and session-state truth required by the reengineered web frontend  
Audience: Backend, Frontend, QA, Product, Ops, AI-assisted development workflows

---

## 1. Purpose

This document defines the backend contract required to support SportPulse web v1 auth and session behavior.

It exists because the web/product specs already fix these product truths:

- anonymous-first product usage,
- email magic-link auth,
- session-backed web auth,
- deferred auth only when needed,
- shell-level account/session awareness,
- post-auth restoration of the attempted user context.

This document turns those product truths into executable backend API and state rules.

This document does **not** define subscription checkout or payment-provider behavior. Those belong to the subscription/checkout contract.

---

## 2. Authority and boundaries

This document is subordinate to:

1. Constitution  
2. MVP Execution Scope  
3. Acceptance Test Matrix  
4. Web Auth and Freemium Surface  
5. Web Navigation and Shell Architecture  
6. Web Frontend Execution Backlog  
7. Web Frontend Modernization  
8. Shared Errors and Warnings Taxonomy  
9. Shared Return Context Contract

This document is authoritative for:

- current-session endpoint behavior,
- magic-link auth start behavior,
- magic-link completion behavior,
- logout behavior,
- minimal session payload exposed to the frontend,
- auth/session error semantics,
- security and freshness rules for web session truth.

This document is **not** authoritative for:

- Stripe or checkout internals,
- subscription ledger design,
- pricing strategy,
- ad-slot behavior,
- track-record computation,
- frontend component design.

---

## 3. Invariants

### 3.1 Anonymous is not an error

A user with no valid session is a valid product state. `GET /api/session` must represent this as successful truth, not as an auth failure.

### 3.2 Frontend-visible session shape is minimal

Frontend may consume only:

- `sessionStatus`,
- `userId`,
- `email`,
- `tier`,
- `isPro`,
- `sessionIssuedAt`.

No broader profile payload is part of this contract.

### 3.3 Backend truth wins

Frontend state must never become a second semantic authority. If local assumptions and backend session truth diverge, backend truth wins.

### 3.4 No optimistic Pro unlock

If session state is loading, expired, invalid, or otherwise unconfirmed, Pro-only depth remains gated.

### 3.5 Return context is shared, not duplicated

Any route restoration or attempted-action restoration used by auth must follow `SPEC-SPORTPULSE-BACKEND-SHARED-RETURN-CONTEXT-CONTRACT`. This document must not redefine `returnTo` or `intent` shapes locally.

---

## 4. Canonical frontend-consumable session model

```json
{
  "sessionStatus": "anonymous | authenticated | expired",
  "userId": "usr_123 | null",
  "email": "user@example.com | null",
  "tier": "free | pro",
  "isPro": false,
  "sessionIssuedAt": "2026-03-21T20:45:00Z | null"
}
```

Rules:

- `loading` is a frontend-only transient render state and is never emitted by backend.
- `tier=pro` must imply `isPro=true`.
- `expired` means a prior session artifact was presented but is no longer valid.
- `anonymous` and `expired` are both non-entitled for Pro gating.

---

## 5. Endpoint contract — GET /api/session

### 5.1 Purpose

Return the current minimal session truth required by the shell and any session-aware route.

### 5.2 Method and path

`GET /api/session`

### 5.3 Success response

**HTTP 200**

```json
{
  "sessionStatus": "anonymous",
  "userId": null,
  "email": null,
  "tier": "free",
  "isPro": false,
  "sessionIssuedAt": null
}
```

Authenticated example:

```json
{
  "sessionStatus": "authenticated",
  "userId": "usr_123",
  "email": "user@example.com",
  "tier": "free",
  "isPro": false,
  "sessionIssuedAt": "2026-03-21T20:45:00Z"
}
```

Expired example:

```json
{
  "sessionStatus": "expired",
  "userId": null,
  "email": null,
  "tier": "free",
  "isPro": false,
  "sessionIssuedAt": null
}
```

### 5.4 Required behavior

- no session cookie present → return `anonymous`,
- valid authenticated session present → return `authenticated`,
- stale/invalid session artifact presented → return `expired` and clear the stale artifact where applicable,
- response must use `Cache-Control: no-store`,
- endpoint must not depend on live checkout-provider availability.

### 5.5 Forbidden behavior

- do not return `401` merely because no session exists,
- do not emit `loading`,
- do not include billing or profile-detail payload here,
- do not infer entitlement from client-local data.

---

## 6. Endpoint contract — POST /api/auth/magic-link/start

### 6.1 Purpose

Initiate deferred email magic-link auth when triggered by:

- shell account action, or
- anonymous attempt to access a Pro-gated action.

### 6.2 Method and path

`POST /api/auth/magic-link/start`

### 6.3 Request body

```json
{
  "email": "user@example.com",
  "returnContext": {
    "returnTo": "/uy-primera/predicciones?matchId=abc",
    "intent": {
      "type": "pro_depth",
      "competitionId": "uy-primera",
      "matchId": "abc",
      "depthKey": "scoreline"
    }
  }
}
```

`returnContext` uses the shared return-context contract and is optional.

### 6.4 Success response

**HTTP 202**

```json
{
  "requestAccepted": true,
  "cooldownSeconds": 60
}
```

### 6.5 Required behavior

- validate email syntax,
- validate `returnContext.returnTo` as internal, allowed route,
- persist enough temporary state to restore the attempted context after completion,
- avoid user-enumeration semantics in the response.

---

## 7. Endpoint contract — POST /api/auth/magic-link/complete

### 7.1 Purpose

Consume the magic-link token, establish server-backed session state, and return enough information for safe frontend restoration.

### 7.2 Method and path

`POST /api/auth/magic-link/complete`

### 7.3 Request body

```json
{
  "token": "opaque-or-signed-token-from-email"
}
```

### 7.4 Success response

**HTTP 200**

```json
{
  "session": {
    "sessionStatus": "authenticated",
    "userId": "usr_123",
    "email": "user@example.com",
    "tier": "free",
    "isPro": false,
    "sessionIssuedAt": "2026-03-21T20:45:00Z"
  },
  "resume": {
    "returnTo": "/uy-primera/predicciones?matchId=abc",
    "intent": {
      "type": "pro_depth",
      "competitionId": "uy-primera",
      "matchId": "abc",
      "depthKey": "scoreline"
    }
  }
}
```

### 7.5 Required behavior

- set or refresh server-backed session,
- return `resume` only when valid shared return context exists,
- never leave frontend guessing whether auth succeeded,
- never return Pro entitlement here unless session truth already supports it.

### 7.6 Forbidden behavior

- do not persist browser-visible bearer tokens as the primary auth mechanism,
- do not accept already-used or expired tokens,
- do not return arbitrary redirect URLs,
- do not let callback completion mutate unrelated shell state.

---

## 8. Endpoint contract — POST /api/logout

### 8.1 Method and path

`POST /api/logout`

### 8.2 Success response

**HTTP 204**

### 8.3 Required behavior

- clear the active server-backed session artifact,
- remain idempotent,
- ensure a subsequent `GET /api/session` returns `anonymous` unless a fresh session is independently established.

### 8.4 Forbidden behavior

- do not preserve stale Pro-renderable state after logout.

---

## 9. Error envelope and endpoint reason table

All non-successful responses defined by this document must use the platform’s canonical error envelope from the shared taxonomy:

```json
{
  "error": {
    "code": "BAD_REQUEST | UNAUTHORIZED | RATE_LIMITED | NOT_FOUND | INTERNAL_ERROR",
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

### 9.1 Reason mapping table

| Endpoint | HTTP | `error.code` | `details.reason` | Retryable |
|---|---:|---|---|---|
| `POST /api/auth/magic-link/start` | 400 | `BAD_REQUEST` | `INVALID_EMAIL` | no |
| `POST /api/auth/magic-link/start` | 400 | `BAD_REQUEST` | `INVALID_RETURN_PATH` | no |
| `POST /api/auth/magic-link/start` | 429 | `RATE_LIMITED` | `MAGIC_LINK_RATE_LIMITED` | yes |
| `POST /api/auth/magic-link/start` | 503 | `INTERNAL_ERROR` | `MAGIC_LINK_DELIVERY_UNAVAILABLE` | yes |
| `POST /api/auth/magic-link/complete` | 400 | `BAD_REQUEST` | `INVALID_TOKEN` | no |
| `POST /api/auth/magic-link/complete` | 400 | `BAD_REQUEST` | `EXPIRED_TOKEN` | no |
| `POST /api/auth/magic-link/complete` | 409 | `CONFLICT` | `TOKEN_ALREADY_USED` | no |
| `POST /api/auth/magic-link/complete` | 500 | `INTERNAL_ERROR` | `AUTH_COMPLETION_FAILED` | yes |
| any endpoint in this document | 500 | `INTERNAL_ERROR` | `INTERNAL_SERVER_FAILURE` | yes |

### 9.2 Anonymous is not an auth error

`GET /api/session` returning `anonymous` is a valid success condition and must never use auth-failure semantics.

---

## 10. Frontend integration rules enforced by this backend contract

### 10.1 Single source of session summary truth

Frontend session providers, shell account state, and Pro gate rendering must consume the canonical session summary and must not fork alternate interpretations.

### 10.2 Deferred auth flow order

When an anonymous user attempts a Pro-gated action, the intended order is:

1. initiate auth,  
2. complete auth,  
3. re-read session truth,  
4. decide whether user is free or Pro,  
5. only then render gate or unlocked depth.

### 10.3 Gating-safe loading rule

If frontend is in a temporary `loading` state while waiting for backend session truth, Pro-only depth remains gated.

### 10.4 Expired-session behavior

`expired` is recoverable but not entitled. Until the user re-authenticates successfully, frontend must treat `expired` as non-Pro.

---

## 11. Security and operational requirements

- secure `httpOnly` cookie carrying opaque session reference or equivalent secure server-backed mechanism,
- rate-limit auth start,
- prevent token replay,
- reject open redirects,
- log `details.reason` values consistently for ops diagnosis.

---

## 12. Acceptance mapping

This contract is intended to satisfy or unblock:

- `K-05` where same-session post-checkout visibility depends on trustworthy shell session state,
- `K-06` registration deferral,
- `SPF-AUTH-001`,
- `SPF-AUTH-002`,
- `SPF-AUTH-003`.

---

## 13. Summary

SportPulse web v1 requires a backend session/auth contract that treats anonymous usage as normal, exposes a minimal derived session summary, supports deferred email magic-link authentication, restores user context after auth completion through a shared return-context model, and centralizes shell/session truth so the frontend does not invent entitlement state. This contract therefore defines `GET /api/session`, `POST /api/auth/magic-link/start`, `POST /api/auth/magic-link/complete`, and `POST /api/logout`, along with endpoint-specific reason mappings and integration rules needed to make anonymous-first, shell-aware, Pro-gated frontend behavior implementable without ambiguity.
