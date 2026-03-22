---
artifact_id: SPEC-SPORTPULSE-QA-PREDICTION-TRACK-RECORD-FIXTURES
title: "Prediction and Track Record Fixtures"
artifact_class: spec
status: active
version: 1.1.0
project: sportpulse
domain: qa
slug: prediction-track-record-fixtures
owner: qa
created_at: 2026-03-15
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-BACKEND-TRACK-RECORD-CONTRACT
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
canonical_path: docs/core/spec.sportpulse.qa.prediction-track-record-fixtures.md
---
# Prediction and Track Record Fixtures

Version: 1.1.0  
Status: Active

## Purpose
Defines fixture-backed evidence for prediction surface and public track record. It does not validate paywall, auth, checkout, or ad suppression behavior.

## Mapping
- PF-01 → K-01 support
- PF-02 → K-02 support
- PF-03 → K-03 support (available)
- PF-04 → K-03 support (below_threshold)
- PF-05 → K-03 support (historical_walk_forward disclosure)
- PF-06 → K-03 support (unavailable)

## Explicit exclusion
The following are outside PF scope:
- K-04 Pro paywall
- K-05 subscription flow
- K-06 registration deferral
- K-07 Pro ad suppression
- K-08 style propagation
