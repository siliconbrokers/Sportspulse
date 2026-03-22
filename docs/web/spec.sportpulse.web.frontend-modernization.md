---
artifact_id: SPEC-SPORTPULSE-WEB-FRONTEND-MODERNIZATION
title: "Frontend Modernization"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: web
slug: frontend-modernization
owner: frontend
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-WEB-FRONTEND-EXECUTION-BACKLOG
  - SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
  - SPEC-SPORTPULSE-EXECUTION-ORCHESTRATOR-MASTER-PLAN
canonical_path: docs/web/spec.sportpulse.web.frontend-modernization.md
---
# Frontend Modernization

Version: 1.0.0  
Status: Active execution baseline

## Ordering rules
- frontend foundations may start before auth/checkout are complete.
- public track record does not wait for auth.
- visual hardening does not precede semantic and commercial integration.

## Streams
1. foundations: shell, routing, registry, API client
2. trust surface: public track record
3. auth/session integration
4. subscription/paywall/Pro integration
5. visual hardening and K-08
