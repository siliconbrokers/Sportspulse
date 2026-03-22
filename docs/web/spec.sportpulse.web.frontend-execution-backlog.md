---
artifact_id: SPEC-SPORTPULSE-WEB-FRONTEND-EXECUTION-BACKLOG
title: "Web Frontend Execution Backlog"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: web
slug: frontend-execution-backlog
owner: frontend
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-WEB-FRONTEND-MODERNIZATION
  - SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
  - SPEC-SPORTPULSE-CORE-IMPLEMENTATION-BACKLOG
canonical_path: docs/web/spec.sportpulse.web.frontend-execution-backlog.md
---
# Web Frontend Execution Backlog

Version: 1.0.0  
Status: Active

## Ticket families

### SPF-FND
- SPF-FND-001 shell and route baseline
- SPF-FND-002 competition registry + global context
- SPF-FND-003 unified API client and contract guards

### SPF-TR
- SPF-TR-001 public track-record route and states
- SPF-TR-002 disclosure rendering for `historical_walk_forward`

### SPF-AUTH
- SPF-AUTH-001 session hydration provider
- SPF-AUTH-002 auth callback and resume flow
- SPF-AUTH-003 deferred auth entry from gated intent

### SPF-SUB
- SPF-SUB-001 paywall trigger behavior
- SPF-SUB-002 checkout return integration
- SPF-SUB-003 same-session Pro unlock + ad suppression

### SPF-VIS
- SPF-VIS-001 Level-B style propagation
- SPF-VIS-002 mobile/responsive hardening

## Dependency summary
- SPF-FND starts after corpus normalization.
- SPF-TR waits for track-record API.
- SPF-AUTH waits for session/auth API.
- SPF-SUB waits for session/auth + subscription/checkout API.
- SPF-VIS waits for semantic and commercial integration to be stable.
