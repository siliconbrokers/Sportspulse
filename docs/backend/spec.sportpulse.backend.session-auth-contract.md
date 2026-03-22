---
artifact_id: SPEC-SPORTPULSE-BACKEND-SESSION-AUTH-CONTRACT
title: "Session and Auth Contract"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: backend
slug: session-auth-contract
owner: backend
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-API-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-SHARED-RETURN-CONTEXT-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-SESSION-PERSISTENCE-AND-STATE-STORAGE
  - SPEC-SPORTPULSE-OPS-MAGIC-LINK-EMAIL-DELIVERY
canonical_path: docs/backend/spec.sportpulse.backend.session-auth-contract.md
---
# Session and Auth Contract

Version: 1.0.0  
Status: Active

## Product rules
- anonymous-first is mandatory.
- first visit must not force auth.
- frontend consumes `GET /api/session` and does not infer `isPro` locally.
- auth completion resumes the stored `returnContext`.

## Endpoint set
The authoritative HTTP shapes live in `spec.sportpulse.api.contract.md`.
This document defines behavior and implementation obligations.

### `GET /api/session`
Must return `anonymous`, `authenticated`, or `expired` as contract states.

### `POST /api/auth/magic-link/start`
Must validate email and `returnContext`, apply rate limiting, and persist issuance before attempting delivery.

### `POST /api/auth/magic-link/complete`
Must enforce single use and expiry, create durable session, and return resume context.

### `POST /api/logout`
Must revoke the current session and be idempotent.

## Error/code discipline
- invalid email → `INVALID_EMAIL`
- invalid return context → `INVALID_RETURN_CONTEXT`
- invalid token → `INVALID_TOKEN`
- expired token → `TOKEN_EXPIRED`
- replay token → `TOKEN_ALREADY_USED`
- delivery failure → `EMAIL_DELIVERY_UNAVAILABLE`
