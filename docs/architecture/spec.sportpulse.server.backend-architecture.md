---
artifact_id: SPEC-SPORTPULSE-SERVER-BACKEND-ARCHITECTURE
title: "Server Backend Architecture"
artifact_class: spec
status: active
version: 1.1.0
project: sportpulse
domain: architecture
slug: server-backend-architecture
owner: backend
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-API-CONTRACT
  - SPEC-SPORTPULSE-CORE-REPO-STRUCTURE-AND-MODULE-BOUNDARIES
  - SPEC-SPORTPULSE-OPS-OPERATIONAL-BASELINE
canonical_path: docs/architecture/spec.sportpulse.server.backend-architecture.md
---
# SportPulse — Server Backend Architecture

Version: 1.1.0  
Status: Active  
Scope: Active backend architecture for UI API, prediction track record exposure, web session/auth, and subscription checkout integration.

## 1. Architectural principles

- backend owns semantic truth.
- frontend consumes contracts; it does not infer entitlement or recompute prediction truth.
- Postgres is authoritative for durable runtime state.
- Redis is optional and never the sole source of truth for sessions or entitlements.
- any side spec is subordinate to this document and the active API contract.

## 2. Active runtime modules

Under `packages/api/src/server/` the active backend modules are:

- `ui/` — dashboard, team, track-record routes
- `auth/` — session read, magic-link start, magic-link complete, logout
- `commerce/` — checkout session creation, reconcile, entitlement status, entitlement refresh
- `mail/` — transactional mail adapter used by magic-link delivery
- `health/` — operational health routes

Supporting runtime services:
- `services/session-store`
- `services/magic-link`
- `services/entitlement`
- `services/checkout-reconcile`
- `services/track-record-read`

## 3. Ownership boundaries

### 3.1 `auth/`
Owns:
- cookie-backed session resolution
- magic-link issuance and completion
- logout and expired-session behavior
- `returnContext` validation on auth entry points

Does not own:
- pricing catalog
- payment provider internals
- prediction track-record logic

### 3.2 `commerce/`
Owns:
- checkout session creation
- reconcile after provider return
- entitlement refresh and status read
- orphaned return handling

Does not own:
- email delivery
- UI paywall copy
- frontend post-checkout rendering decisions

### 3.3 `ui/track-record`
Owns:
- HTTP projection of track-record contract
- disclosure state returned to frontend

Prediction evidence generation remains owned by prediction packages. HTTP exposure belongs to UI API.

## 4. Durable state model

Authoritative Postgres-backed state:
- `web_sessions`
- `auth_magic_links`
- `subscription_entitlements`
- `checkout_reconciliations`

Rules:
- in-memory store is allowed only for local development and automated tests.
- Redis may cache reads or support rate limiting/locks, but writes of record go to Postgres.

## 5. Lost-session checkout return policy

Allowed policy for MVP:
- if checkout return arrives and current session is missing, backend returns `reauth_required`.
- after reauth, reconcile is retried against the same `checkoutSessionId`.
- backend must not blindly bind a paid checkout session to an arbitrary live session without ownership validation.

## 6. Magic-link email delivery architecture

- backend emits magic-link through `mail/` adapter.
- provider choice is defined in `spec.sportpulse.ops.magic-link-email-delivery.md`.
- backend never exposes provider details to frontend.

## 7. Security and runtime coupling

This architecture assumes the operational baseline is enforced:
- secure cookies
- same-origin default CORS
- rate limiting
- structured logs
- health endpoints
- migrations on deploy

## 8. Backend-owned truth required by frontend

Frontend foundations may proceed without completed auth or checkout, but the following frontend behaviors are blocked until backend routes exist and match contract:
- session hydration
- deferred auth completion
- paywall gating by live entitlement
- same-session Pro unlock
- Pro ad suppression

## 9. Merge rule

Implementation is not allowed against side drafts that conflict with this document. Once this file changes, the corresponding side-contract specs must remain consistent or be superseded.
