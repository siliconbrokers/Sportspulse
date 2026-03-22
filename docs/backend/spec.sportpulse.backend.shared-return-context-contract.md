---
artifact_id: SPEC-SPORTPULSE-BACKEND-SHARED-RETURN-CONTEXT-CONTRACT
title: "Shared Return Context Contract"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: backend
slug: shared-return-context-contract
owner: backend
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-API-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-SESSION-AUTH-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-SUBSCRIPTION-CHECKOUT-CONTRACT
canonical_path: docs/backend/spec.sportpulse.backend.shared-return-context-contract.md
---
# Shared Return Context Contract

Version: 1.0.0  
Status: Active

## Purpose
Single canonical payload reused by auth entry, checkout creation, and post-return resume.

## Schema

```json
{
  "returnTo": "/relative/internal/path",
  "intent": {
    "type": "pro_depth | auth_entry | checkout_return",
    "competitionId": "laliga",
    "matchId": "match_123",
    "depthKey": "scoreline"
  }
}
```

## Validation rules
- `returnTo` must start with `/`.
- no protocol, hostname, or `//` prefix.
- querystring allowed.
- hash fragment allowed.
- `intent.type` is required when `intent` exists.
- unknown top-level keys are rejected.

## Persistence rules
- auth start stores `returnContext` with the magic-link issuance record.
- checkout session creation stores `returnContext` with the checkout reconcile record.
- frontend may keep a transient copy, but backend persistence is authoritative.
