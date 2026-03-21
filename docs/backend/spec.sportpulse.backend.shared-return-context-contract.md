---
artifact_id: SPEC-SPORTPULSE-BACKEND-SHARED-RETURN-CONTEXT-CONTRACT
title: "Backend Shared Return Context Contract"
artifact_class: spec
status: draft
version: 0.1.0
project: sportpulse
domain: backend
slug: shared-return-context-contract
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-BACKEND-SESSION-AUTH-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-SUBSCRIPTION-CHECKOUT-CONTRACT
  - SPEC-SPORTPULSE-WEB-NAVIGATION-AND-SHELL-ARCHITECTURE
canonical_path: docs/backend/spec.sportpulse.backend.shared-return-context-contract.md
---

# SportPulse — Backend Shared Return Context Contract

Version: 0.1  
Status: Draft  
Scope: Shared route-restoration and attempted-action-restoration payload used by auth and checkout flows  
Audience: Backend, Frontend, QA

---

## 1. Purpose

Auth and checkout both need to preserve the same thing:

- where the user should return,
- what gated action they originally attempted,
- enough typed metadata to restore UX without inventing duplicate payload variants.

This document defines that shared contract once so session/auth and subscription/checkout do not fork nearly-identical request/response shapes.

---

## 2. Canonical schema

```json
{
  "returnTo": "/uy-primera/predicciones?matchId=abc",
  "intent": {
    "type": "pro_depth",
    "competitionId": "uy-primera",
    "matchId": "abc",
    "depthKey": "scoreline"
  }
}
```

### 2.1 `returnTo`

- relative internal path only,
- no scheme, host, or external domain,
- must target an allowed routed surface.

### 2.2 `intent`

`intent` is optional typed metadata that explains what the user tried to do. It is not a free-form blob.

Supported v1 intent types:

- `pro_depth`
- `account_entry`

### 2.3 `pro_depth` payload

```json
{
  "type": "pro_depth",
  "competitionId": "uy-primera",
  "matchId": "abc",
  "depthKey": "scoreline"
}
```

Rules:

- `competitionId` is canonical product competition id,
- `matchId` is canonical match identifier if the attempt was match-scoped,
- `depthKey` is the requested Pro-only module or field group.

---

## 3. Validation rules

- reject external URLs,
- reject malformed relative paths,
- reject unsupported `intent.type`,
- do not accept arbitrary free-form keys as semantic truth,
- preserve only the minimum data required to restore the attempted context.

---

## 4. Persistence and echo rules

- auth start may persist validated return context temporarily,
- checkout session creation may persist validated return context temporarily,
- auth completion and checkout reconciliation may echo validated return context back in `resume`,
- if context cannot be validated safely, it must be dropped rather than guessed.

---

## 5. Security rules

- return context is UX metadata, not authorization,
- backend must re-check entitlement and session truth independently after restoration,
- `returnTo` never authorizes access to Pro-only depth by itself.

---

## 6. Summary

SportPulse must not maintain one `returnTo`/`intent` dialect for auth and another for checkout. This shared contract keeps restoration payloads aligned and eliminates a class of avoidable integration bugs.
