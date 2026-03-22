---
artifact_id: SPEC-SPORTPULSE-CORE-IMPLEMENTATION-BACKLOG
title: "Implementation Backlog (SDD)"
artifact_class: spec
status: active
version: 2.2.0
project: sportpulse
domain: core
slug: implementation-backlog
owner: team
created_at: 2026-03-15
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-WEB-FRONTEND-EXECUTION-BACKLOG
  - SPEC-SPORTPULSE-EXECUTION-BOARD-WORK-PACKAGES
canonical_path: docs/core/spec.sportpulse.core.implementation-backlog.md
---
# SportPulse — Implementation Backlog (SDD)

Version: 2.2.0  
Status: Active

## Stability note
Phases 0–11 from the active baseline remain in force. This revision integrates the frontend reengineering stream into the master backlog so it is no longer orphaned.

## Phase 12 — Frontend reengineering integration

### SP-1201 — Canonize API contract and backend architecture for frontend delta
Maps to: WP-01, WP-02, WP-03, WP-15

### SP-1202 — Canonize acceptance and fixture alignment
Maps to: WP-13

### SP-1203 — Integrate SPF families into master backlog governance
Maps to: WP-14

### SP-1204 — Implement session/auth backend truth surfaces
Maps to: WP-04A, WP-04B, WP-04C, WP-16, WP-17
Refs: Session/Auth Contract, Session Persistence, Magic-Link Email Delivery, Runtime State and Migrations

### SP-1205 — Implement public track-record API surface
Maps to: WP-05
Refs: Track Record Contract, Acceptance Matrix, PF Fixtures

### SP-1206 — Implement checkout/subscription backend truth surfaces
Maps to: WP-06A, WP-06B, WP-06C, WP-16, WP-17

### SP-1207 — Implement frontend foundations and trust surface
Maps to: WP-07, WP-08
Refs: Frontend Modernization, Frontend Execution Backlog

### SP-1208 — Implement frontend auth/subscription integration
Maps to: WP-09, WP-10

### SP-1209 — Integrated QA, release gate, and visual hardening
Maps to: WP-11, WP-12, WP-18
