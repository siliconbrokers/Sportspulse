---
artifact_id: SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
title: "Acceptance Test Matrix"
artifact_class: spec
status: active
version: 1.3.0
project: sportpulse
domain: qa
slug: acceptance-test-matrix
owner: qa
created_at: 2026-03-15
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-API-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-TRACK-RECORD-CONTRACT
  - SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
canonical_path: docs/core/spec.sportpulse.qa.acceptance-test-matrix.md
---
# SportPulse — Acceptance Test Matrix (MVP)

Version: 1.3.0  
Status: Active

## Scope note
Sections A–J from the baseline MVP acceptance suite remain active and unchanged unless explicitly overridden here. This revision canonizes the K-series required by frontend reengineering and commercial readiness.

## K-series

| ID | Name | Pass gate |
|---|---|---|
| K-01 | Public prediction surface integrity | 1X2 surface renders from backend payload with no frontend semantic recomputation |
| K-02 | Operating-mode integrity | `NOT_ELIGIBLE` and `LIMITED_MODE` render exactly per backend payload |
| K-03 | Public track record integrity | `available/below_threshold/unavailable` states behave exactly per track-record contract |
| K-04 | Pro depth paywall | free/anonymous never see Pro depth; paywall triggers only on intent |
| K-05 | Subscription flow correctness | checkout + reconcile + entitlement refresh can unlock Pro in the same end-to-end journey |
| K-06 | Registration deferral | first visit remains anonymous-first; auth occurs only on shell action or gated intent |
| K-07 | Pro ad suppression | configured commercial ad renders for free/anonymous and must not render for Pro; operational notices remain visible |
| K-08 | Level-B style propagation readiness | style/token/theme propagation reaches required frontend surfaces without semantic regressions |

## Explicit overrides to older drift
- K-04..K-06 are not prediction-fixture IDs.
- PF fixtures validate prediction/track-record only.
- commercial/auth flow acceptance lives in K-04..K-08 and frontend/API integration tests.
