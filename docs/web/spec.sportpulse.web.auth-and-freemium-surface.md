---
artifact_id: SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
title: "Web Auth and Freemium Surface"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: web
slug: auth-and-freemium-surface
owner: frontend
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-API-CONTRACT
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
canonical_path: docs/web/spec.sportpulse.web.auth-and-freemium-surface.md
---
# Web Auth and Freemium Surface

Version: 1.0.0  
Status: Active

## Product decisions
- anonymous-first sign-in model
- email magic-link only in MVP
- 1X2 public, Pro depth gated
- public track record never hidden behind auth or paywall
- commercial display ads suppressed for Pro only
- operational notices remain visible to all tiers

## Frontend obligations
- consume `GET /api/session`
- do not infer entitlement locally
- trigger auth only from shell action or gated intent
- fail closed on Pro depth while session or entitlement is unresolved
