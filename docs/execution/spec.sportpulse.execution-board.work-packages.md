---
artifact_id: SPEC-SPORTPULSE-EXECUTION-BOARD-WORK-PACKAGES
title: "Execution Board — Work Packages"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: execution
slug: execution-board-work-packages
owner: program-orchestration
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-EXECUTION-ORCHESTRATOR-MASTER-PLAN
canonical_path: docs/execution/spec.sportpulse.execution-board.work-packages.md
---
# Execution Board — Work Packages

Version: 1.0.0  
Status: Active

## Status values
`not_started | ready | in_progress | blocked | review | done`

## Work packages

| WP | Wave | Stream | Title | Depends on | Owner | Done when |
|---|---|---|---|---|---|---|
| WP-01 | 0 | corpus | absorb delta into `api.contract` | freeze | api | active API contract exists |
| WP-02 | 0 | corpus | absorb delta into `backend-architecture` | WP-01 | backend architecture | active architecture exists |
| WP-03 | 0 | corpus | normalize `active` state of frontend specs | WP-01, WP-02 | program/spec governance | no execution source remains `proposed` |
| WP-13 | 0 | qa-corpus | canonize K-07/K-08 + PF alignment | WP-03 | qa | matrix and fixtures are non-contradictory |
| WP-14 | 0 | backlog | map SPF backlog to master backlog | WP-03 | program/spec governance | master backlog references SPF families |
| WP-15 | 0 | corpus | mark interim patch docs superseded | WP-03 | program/spec governance | no patch doc remains active source-of-truth |
| WP-04A | 1 | backend | implement `GET /api/session` | WP-01, WP-02, WP-03 | api | session route passes contract tests |
| WP-04B | 1 | backend | implement magic-link start/complete | WP-04A, WP-16, WP-17 | api | auth routes pass contract tests and email sink tests |
| WP-04C | 1 | backend | implement logout + expired-session handling | WP-04A | api | logout/expired behavior is deterministic |
| WP-05 | 1 | backend | implement track-record API route | WP-01, WP-02 | prediction + api | K-03 fixtures pass |
| WP-06A | 1 | backend | implement checkout session creation | WP-04A, WP-16, WP-17 | api | authenticated checkout route works |
| WP-06B | 1 | backend | implement reconcile return | WP-06A, WP-04B | api | reconcile handles paid, pending, reauth_required |
| WP-06C | 1 | backend | implement subscription status + refresh | WP-06B | api | entitlement routes stable |
| WP-16 | 1 | ops | cookies/CORS/rate-limit/security hardening | WP-02 | ops + api | runtime security baseline enabled |
| WP-17 | 1 | ops | migrations + env wiring + state adapters | WP-02 | ops + api | DB schema, adapters, env vars wired |
| WP-07 | 2 | frontend | shell/routing/registry/API foundations | WP-03 | frontend | foundations merged without commercial coupling |
| WP-08 | 2 | frontend | public track-record UI | WP-05, WP-07 | frontend | K-03 UI states complete |
| WP-09 | 3 | frontend | session hydration + auth callback | WP-04A, WP-04B, WP-04C, WP-07 | frontend | K-06 viable |
| WP-10 | 3 | frontend | paywall + checkout return + Pro rendering + ad suppression | WP-06A, WP-06B, WP-06C, WP-09 | frontend | K-04, K-05, K-07 viable |
| WP-11 | 4 | qa | integrated K-03..K-07 QA | WP-08, WP-09, WP-10 | qa | integrated acceptance passes |
| WP-12 | 4 | frontend | visual hardening + K-08 | WP-11 | frontend | K-08 passes |
| WP-18 | 4 | ops | staging/smoke/health/rollback/release gate | WP-11, WP-16, WP-17 | ops + qa | release gate green |
