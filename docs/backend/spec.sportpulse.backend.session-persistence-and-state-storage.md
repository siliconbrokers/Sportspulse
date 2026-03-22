---
artifact_id: SPEC-SPORTPULSE-BACKEND-SESSION-PERSISTENCE-AND-STATE-STORAGE
title: "Session Persistence and State Storage"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: backend
slug: session-persistence-and-state-storage
owner: backend
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-SERVER-BACKEND-ARCHITECTURE
  - SPEC-SPORTPULSE-BACKEND-RUNTIME-STATE-AND-MIGRATIONS
  - SPEC-SPORTPULSE-OPS-OPERATIONAL-BASELINE
canonical_path: docs/backend/spec.sportpulse.backend.session-persistence-and-state-storage.md
---
# Session Persistence and State Storage

Version: 1.0.0  
Status: Active

## Decision

Authoritative runtime store for sessions is **PostgreSQL**.

- Production/staging: Postgres-backed sessions.
- Redis: optional cache/lock/rate-limit support only; not source of truth.
- Local development and unit tests: in-memory adapter allowed.
- SQLite is not used for active session persistence.

This aligns the session system with the operational baseline database strategy and avoids a second mandatory runtime dependency.

## Session model

### Cookie
- httpOnly: true
- secure: true in staging/prod
- sameSite: `lax`
- signed/opaque session identifier

### TTL policy
- idle TTL: 14 days
- absolute max lifetime: 30 days
- explicit logout revokes immediately
- expired records may be cleaned asynchronously

## Supporting state TTLs
- magic-link token: 15 minutes, single use
- checkout reconciliation pending record: 30 days
- entitlement record: durable, no TTL

## Adapter rules
- one adapter interface for `getSession`, `createSession`, `revokeSession`, `touchSession`.
- production adapter must be Postgres.
- in-memory adapter is test-only or local-dev only.

## Why not Redis-only
Redis-only session truth would violate the runtime baseline in environments where Redis is optional and would introduce silent loss on cache eviction. Redis may accelerate reads, not replace durable session state.
