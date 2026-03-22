---
artifact_id: SPEC-SPORTPULSE-BACKEND-TRACK-RECORD-CONTRACT
title: "Track Record Contract"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: backend
slug: track-record-contract
owner: backend
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-API-CONTRACT
  - SPEC-SPORTPULSE-QA-PREDICTION-TRACK-RECORD-FIXTURES
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
canonical_path: docs/backend/spec.sportpulse.backend.track-record-contract.md
---
# Track Record Contract

Version: 1.0.0  
Status: Active

## Rules
- public route, no auth.
- threshold for published operational accuracy: 200 predictions.
- `state` is one of `available`, `below_threshold`, `unavailable`.
- `accuracy` is `null` when state is not `available`.
- evidence pool includes only FULL_MODE, pre-kickoff, resolved predictions.
- no cherry-picking by league slice beyond the requested competition.

## Disclosure
- `evaluationType=operational` when threshold met and operational evidence is published.
- `evaluationType=historical_walk_forward` when a non-operational but explicitly disclosed historical evidence mode is used.
- `disclosureMessageKey` must be renderable without frontend heuristics.
