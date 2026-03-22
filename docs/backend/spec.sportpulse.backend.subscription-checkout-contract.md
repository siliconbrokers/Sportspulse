---
artifact_id: SPEC-SPORTPULSE-BACKEND-SUBSCRIPTION-CHECKOUT-CONTRACT
title: "Subscription and Checkout Contract"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: backend
slug: subscription-checkout-contract
owner: backend
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-API-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-SHARED-RETURN-CONTEXT-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-RUNTIME-STATE-AND-MIGRATIONS
canonical_path: docs/backend/spec.sportpulse.backend.subscription-checkout-contract.md
---
# Subscription and Checkout Contract

Version: 1.0.0  
Status: Active

## Product rules
- checkout requires authenticated session.
- entitlement truth is backend-owned.
- unlock to Pro must occur only after authoritative entitlement confirmation.
- orphaned return policy is `reauth_required`, then retry reconcile.

## Endpoint set
Authoritative HTTP shapes live in `spec.sportpulse.api.contract.md`.

- `POST /api/checkout/session`
- `GET /api/subscription/status`
- `POST /api/checkout/return/reconcile`
- `POST /api/subscription/refresh-entitlement`

## State rules
- `active` → user is Pro
- `pending_reconcile` → frontend must not optimistically unlock Pro depth
- `inactive` or `grace` do not override session semantics; frontend still consumes explicit entitlement state

## Error/code discipline
- no session → `SESSION_REQUIRED`
- invalid plan key → `INVALID_PLAN_KEY`
- already Pro → `ALREADY_ENTITLED`
- wrong session/user for checkout → `CHECKOUT_OWNER_MISMATCH`
- unpaid checkout → `CHECKOUT_NOT_PAID`
- provider/reconcile outage → `CHECKOUT_PROVIDER_UNAVAILABLE` or `RECONCILE_UNAVAILABLE`
