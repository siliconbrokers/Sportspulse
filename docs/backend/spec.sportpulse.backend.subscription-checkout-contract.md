---
artifact_id: SPEC-SPORTPULSE-BACKEND-SUBSCRIPTION-CHECKOUT-CONTRACT
title: "Backend Subscription and Checkout Contract"
artifact_class: spec
status: draft
version: 0.2.1
project: sportpulse
domain: backend
slug: subscription-checkout-contract
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-BACKEND-SHARED-RETURN-CONTEXT-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-SESSION-AUTH-CONTRACT
  - SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
  - SPEC-SPORTPULSE-WEB-NAVIGATION-AND-SHELL-ARCHITECTURE
  - SPEC-SPORTPULSE-WEB-FRONTEND-EXECUTION-BACKLOG
  - SPEC-SPORTPULSE-WEB-FRONTEND-MODERNIZATION
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
  - SPEC-SPORTPULSE-CORE-IMPLEMENTATION-BACKLOG
  - SPEC-SPORTPULSE-SHARED-ERRORS-AND-WARNINGS-TAXONOMY
canonical_path: docs/backend/spec.sportpulse.backend.subscription-checkout-contract.md
---

# SportPulse — Backend Subscription and Checkout Contract

Version: 0.2.1  
Status: Draft  
Scope: Minimal backend contract for Pro checkout initiation, checkout return reconciliation, subscription-status truth, and entitlement refresh required by the reengineered web frontend  
Audience: Backend, Frontend, QA, Product, Ops, AI-assisted development workflows

---

## 1. Purpose

This document defines the backend contract required to support SportPulse web v1 Pro upgrade behavior.

It exists because the web/product specs already fix these product truths:

- the product is anonymous-first,
- 1X2 predictions remain public,
- Pro depth is gated only at the moment of intent,
- checkout must unlock Pro in the same browsing session,
- authenticated Pro users do not see commercial display ads.

This document turns those truths into executable backend API and entitlement-state rules.

It assumes the session/auth contract already exists. It does **not** redefine auth or logout.

---

## 2. Invariants

### 2.1 Auth first, checkout second

Anonymous users authenticate first, then may enter checkout.

### 2.2 Fail closed on entitlement uncertainty

If entitlement state is unknown, stale, invalid, or unreconciled, Pro depth remains gated.

### 2.3 Commercial truth must align with session truth

After successful reconciliation, `GET /api/session` and `GET /api/subscription/status` must agree on effective tier.

### 2.4 Return context is shared, not duplicated

Any route restoration or attempted-action restoration used by checkout must follow `SPEC-SPORTPULSE-BACKEND-SHARED-RETURN-CONTEXT-CONTRACT`.

### 2.5 Orphaned checkout return may not silently rebind

If checkout succeeds but the return route no longer has a valid authenticated session, the system must not silently bind commercial success to an unknown browser identity. Safe recovery requires re-auth and an explicit retry of reconciliation.

---

## 3. Minimal commercial-state model

```json
{
  "subscriptionStatus": "none | active | past_due | canceled | unknown",
  "tier": "free | pro",
  "isPro": false,
  "entitlementStatus": "not_entitled | entitled | verifying | unknown",
  "checkoutState": "idle | pending_return | reconciling | reconciled | failed",
  "planCode": "pro_monthly | null",
  "currentPeriodEndAt": "2026-04-21T00:00:00Z | null",
  "lastEntitlementRefreshAt": "2026-03-21T21:05:00Z | null"
}
```

Rules:

- `tier=pro` must imply `isPro=true`,
- `entitlementStatus=entitled` must align with `tier=pro`,
- `verifying` is a valid temporary state and must not be flattened into a fake final answer.

---

## 4. Endpoint contract — POST /api/checkout/session

### 4.1 Purpose

Create a checkout session for the current authenticated user and preserve enough shared return context to recover the intended Pro-gated surface.

### 4.2 Method and path

`POST /api/checkout/session`

### 4.3 Request body

```json
{
  "planCode": "pro_monthly",
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

### 4.4 Success response

**HTTP 200**

```json
{
  "provider": "stripe",
  "checkoutUrl": "https://checkout.example.invalid/session/abc",
  "checkoutSessionId": "chk_123"
}
```

### 4.5 Required behavior

- caller must already have authenticated session,
- reject unsupported plans,
- reject invalid return context,
- do not create duplicate checkout intent for a user already effectively entitled.

---

## 5. Endpoint contract — GET /api/subscription/status

### 5.1 Purpose

Return commercial-state truth when more detail than `GET /api/session` is required.

### 5.2 Method and path

`GET /api/subscription/status`

### 5.3 Success response

**HTTP 200**

```json
{
  "subscriptionStatus": "active",
  "tier": "pro",
  "isPro": true,
  "entitlementStatus": "entitled",
  "checkoutState": "reconciled",
  "planCode": "pro_monthly",
  "currentPeriodEndAt": "2026-04-21T00:00:00Z",
  "lastEntitlementRefreshAt": "2026-03-21T21:05:00Z"
}
```

### 5.4 Required behavior

- this endpoint is protected; unauthenticated callers must receive `401 UNAUTHORIZED`,
- this endpoint does not replace `GET /api/session` as shell truth,
- output must reflect backend truth, not frontend cache,
- if reconciliation is in progress, verification must be surfaced explicitly.

---

## 6. Endpoint contract — POST /api/checkout/return/reconcile

### 6.1 Purpose

Finalize checkout return handling, reconcile provider-confirmed payment into backend entitlement truth, and make Pro state recoverable in the active session.

### 6.2 Method and path

`POST /api/checkout/return/reconcile`

### 6.3 Request body

```json
{
  "provider": "stripe",
  "checkoutSessionId": "chk_123"
}
```

### 6.4 Success response

**HTTP 200**

```json
{
  "reconciliationStatus": "reconciled | verifying",
  "session": {
    "sessionStatus": "authenticated",
    "userId": "usr_123",
    "email": "user@example.com",
    "tier": "pro",
    "isPro": true,
    "sessionIssuedAt": "2026-03-21T20:45:00Z"
  },
  "subscription": {
    "subscriptionStatus": "active",
    "tier": "pro",
    "isPro": true,
    "entitlementStatus": "entitled",
    "checkoutState": "reconciled",
    "planCode": "pro_monthly",
    "currentPeriodEndAt": "2026-04-21T00:00:00Z",
    "lastEntitlementRefreshAt": "2026-03-21T21:05:00Z"
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

### 6.5 Idempotency rules

- repeated calls with the same valid checkout session must converge on the same final commercial state,
- duplicate retries must not create duplicate subscriptions,
- previously reconciled checkout sessions must return stable final state.

### 6.6 Required behavior

- confirm provider-backed checkout outcome,
- map successful commercial outcome into backend entitlement truth,
- refresh or reissue server-backed session if needed so `GET /api/session` reflects Pro in the same browsing session,
- include `resume` metadata when available so the frontend can recover the attempted Pro-depth context,
- when provider indicates success but backend confirmation is still settling, return `reconciliationStatus=verifying` and a verifying subscription state rather than lying.

### 6.7 Orphaned return / lost-session recovery

If the user returns from checkout but the active authenticated session is missing, expired, or incompatible with the checkout owner, the contract must fail safely.

Required safe behavior:

- do **not** silently bind the successful checkout to an unknown browser session,
- return an explicit re-auth-required failure,
- preserve enough temporary provider-linked state so that, after re-authentication by the rightful user, reconciliation can be retried with the same `checkoutSessionId`,
- after successful re-auth, retrying reconciliation must remain idempotent.

Allowed recovery policy for v1: **reauth then retry reconcile**.  
Implicit cross-user rebind is forbidden.

### 6.8 Forbidden behavior

- do not grant final Pro entitlement without backend reconciliation,
- do not produce contradictory output such as `tier=free` plus `entitlementStatus=entitled`,
- do not require manual relogin after successful reconciliation in the non-orphan happy path.

---

## 7. Endpoint contract — POST /api/subscription/refresh-entitlement

### 7.1 Purpose

Allow frontend or support flows to request a fresh commercial-state read when the system is in a recoverable verification state.

### 7.2 Method and path

`POST /api/subscription/refresh-entitlement`

### 7.3 Success response

**HTTP 200**

```json
{
  "subscriptionStatus": "active | none | past_due | canceled | unknown",
  "tier": "free | pro",
  "isPro": false,
  "entitlementStatus": "not_entitled | entitled | verifying | unknown",
  "checkoutState": "idle | reconciling | reconciled | failed",
  "planCode": "pro_monthly | null",
  "currentPeriodEndAt": "2026-04-21T00:00:00Z | null",
  "lastEntitlementRefreshAt": "2026-03-21T21:05:00Z"
}
```

### 7.4 Required behavior

- this endpoint is protected; unauthenticated callers must receive `401 UNAUTHORIZED`,
- if entitlement is already fresh and final, return stable final state,
- if provider/back-office truth is still settling, return `verifying` explicitly,
- do not silently downgrade a truly active Pro subscription because of transient lookup failure without surfacing verification or operational failure.

---

## 8. Frontend flow rules

1. user enters checkout from a Pro-gated intent,  
2. provider checkout completes,  
3. return to `/checkout/return` or equivalent,  
4. call reconcile endpoint,  
5. re-read `GET /api/session` and/or consume returned session summary,  
6. if `reconciled`, remove paywall and allow Pro depth,  
7. if `verifying`, show transitional verification state and allow manual refresh,  
8. if `CHECKOUT_REAUTH_REQUIRED`, send user through auth then retry reconcile.

---

## 9. Error envelope and endpoint reason table

All non-successful responses defined by this document must use the platform’s canonical error envelope from the shared taxonomy:

```json
{
  "error": {
    "code": "BAD_REQUEST | UNAUTHORIZED | NOT_FOUND | INTERNAL_ERROR",
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
| `POST /api/checkout/session` | 401 | `UNAUTHORIZED` | `UNAUTHENTICATED_CHECKOUT_ATTEMPT` | no |
| `GET /api/subscription/status` | 401 | `UNAUTHORIZED` | `UNAUTHENTICATED_SUBSCRIPTION_STATUS` | no |
| `POST /api/checkout/session` | 400 | `BAD_REQUEST` | `INVALID_PLAN_CODE` | no |
| `POST /api/checkout/session` | 400 | `BAD_REQUEST` | `INVALID_RETURN_PATH` | no |
| `POST /api/checkout/session` | 409 | `CONFLICT` | `ALREADY_ENTITLED` | no |
| `POST /api/checkout/session` | 503 | `INTERNAL_ERROR` | `CHECKOUT_PROVIDER_UNAVAILABLE` | yes |
| `POST /api/checkout/session` | 500 | `INTERNAL_ERROR` | `CHECKOUT_CREATION_FAILED` | yes |
| `POST /api/checkout/return/reconcile` | 400 | `BAD_REQUEST` | `INVALID_CHECKOUT_SESSION` | no |
| `POST /api/checkout/return/reconcile` | 409 | `CONFLICT` | `CHECKOUT_NOT_PAID` | no |
| `POST /api/checkout/return/reconcile` | 401 | `UNAUTHORIZED` | `CHECKOUT_REAUTH_REQUIRED` | yes |
| `POST /api/checkout/return/reconcile` | 409 | `CONFLICT` | `CHECKOUT_OWNER_MISMATCH` | no |
| `POST /api/checkout/return/reconcile` | 500 | `INTERNAL_ERROR` | `RECONCILIATION_FAILED` | yes |
| `POST /api/subscription/refresh-entitlement` | 401 | `UNAUTHORIZED` | `UNAUTHENTICATED_ENTITLEMENT_REFRESH` | no |
| `POST /api/subscription/refresh-entitlement` | 500 | `INTERNAL_ERROR` | `ENTITLEMENT_REFRESH_FAILED` | yes |
| any endpoint in this document | 500 | `INTERNAL_ERROR` | `INTERNAL_SERVER_FAILURE` | yes |

### 9.2 Verification is not a hard failure

`verifying` is a valid temporary commercial state and must not be flattened into a generic fatal error when the system still has a recoverable path to final truth.

---

## 10. Acceptance mapping

This contract is intended to satisfy or unblock:

- `K-05` — Pro subscription flow,
- `K-07` — Pro commercial ad suppression,
- the commercial side of `K-04` because reliable entitlement truth drives paywall removal.

---

## 11. Summary

SportPulse web v1 requires a backend commercial contract that initiates Pro checkout only for authenticated users, preserves the user’s intended return context through the shared return-context contract, reconciles successful checkout into effective entitlement within the same browsing session, fails safely when checkout return loses session, exposes explicit subscription and verification state without optimistic Pro unlock, and keeps shell-visible session truth aligned with commercial truth so paywall removal, Pro-depth access, and Pro ad suppression all behave deterministically. This contract therefore defines `POST /api/checkout/session`, `GET /api/subscription/status`, `POST /api/checkout/return/reconcile`, and `POST /api/subscription/refresh-entitlement`, along with endpoint-specific reason mappings, idempotency rules, and lost-session recovery behavior needed to make the Pro funnel implementable without ambiguity.
