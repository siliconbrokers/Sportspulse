---
artifact_id: SPEC-SPORTPULSE-BACKEND-FRONTEND-INTEGRATION-DELTA
title: "Backend Frontend Integration Delta"
artifact_class: spec
status: draft
version: 0.2.0
project: sportpulse
domain: backend
slug: frontend-integration-delta
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-BACKEND-SESSION-AUTH-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-SHARED-RETURN-CONTEXT-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-SUBSCRIPTION-CHECKOUT-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-TRACK-RECORD-CONTRACT
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-GAP-CLOSURE-UPDATE
  - SPEC-SPORTPULSE-QA-PREDICTION-TRACK-RECORD-FIXTURES
  - SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
  - SPEC-SPORTPULSE-WEB-NAVIGATION-AND-SHELL-ARCHITECTURE
  - SPEC-SPORTPULSE-WEB-FRONTEND-EXECUTION-BACKLOG
  - SPEC-SPORTPULSE-WEB-FRONTEND-MODERNIZATION
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
  - SPEC-SPORTPULSE-SHARED-ERRORS-AND-WARNINGS-TAXONOMY
canonical_path: docs/backend/spec.sportpulse.backend.frontend-integration-delta.md
---

# SportPulse — Backend Frontend Integration Delta

Version: 0.2  
Status: Draft  
Scope: Master index and integration entrypoint for the backend contracts, QA updates, and patched fixture references required to close the current frontend reengineering gap  
Audience: Backend, Frontend, QA, Product, Ops, AI-assisted development workflows

---

## 1. Purpose

This document is the **entrypoint spec** for the backend↔frontend integration gap closure package.

It does **not** replace the detailed contracts. It exists to:

1. define the boundaries of the delta introduced by the frontend reengineering,
2. identify which backend surfaces are now contractually required,
3. point to the sub-specs that close those surfaces,
4. record the QA/fixture corrections that must ship with the backend work,
5. force a single implementation order so the team does not build checkout, shell state, or QA gates on top of missing session truth.

This document is intentionally thin on endpoint detail and thick on dependency ordering.

---

## 2. Problem Statement

The frontend reengineering introduced new user-facing requirements that cannot be satisfied safely by presentation work alone.

The system now requires explicit backend support for:

- session hydration and anonymous-first truth,
- deferred magic-link auth,
- context restoration after auth and checkout,
- Pro checkout initiation and entitlement reconciliation,
- public track record exposure with threshold and disclosure discipline,
- tier-aware commercial suppression rules,
- QA acceptance coverage aligned with those surfaces,
- fixture-family alignment so prediction/track-record evidence does not collide with commercial/auth acceptance IDs.

Without this package, the frontend can still be rendered, but several high-value surfaces would remain dependent on mocks, implied semantics, or incompatible QA identifiers.

---

## 3. Non-Goals

This package does **not** do the following:

- redesign the snapshot/dashboard API,
- redefine prediction engine internals,
- introduce runtime theming/config infrastructure beyond what existing web specs already allow,
- define billing portal, refunds, multi-tier pricing, invoicing, or account preferences,
- replace the active acceptance matrix,
- replace the active prediction/track-record fixture family in full.

It only defines the missing delta needed to support the reengineered web surface safely.

---

## 4. Package Contents

### 4.1 Backend contracts

1. **Session/Auth contract**  
   File: `spec.sportpulse.backend.session-auth-contract.md`  
   Covers: current-session truth, deferred magic-link start, callback completion, logout, auth/session error contract.

2. **Shared Return Context contract**  
   File: `spec.sportpulse.backend.shared-return-context-contract.md`  
   Covers: typed `returnContext`, internal route validation, attempted gated-action restoration payload used by both auth and checkout.

3. **Subscription/Checkout contract**  
   File: `spec.sportpulse.backend.subscription-checkout-contract.md`  
   Covers: checkout-session creation, subscription status, return reconciliation, entitlement refresh, lost-session return handling.

4. **Track Record contract**  
   File: `spec.sportpulse.backend.track-record-contract.md`  
   Covers: public competition-level track record payload, threshold gating, disclosure typing, unavailable states, anti-cherry-picking rules.

### 4.2 QA updates

5. **Acceptance gap closure update**  
   File: `spec.sportpulse.qa.acceptance-gap-closure-update.md`  
   Covers: K-07 formalization, K-08 formalization/equivalent closure, style-propagation acceptance, and corpus alignment rules.

6. **Patched prediction/track-record fixtures**  
   File: `spec.sportpulse.qa.prediction-track-record-fixtures.md`  
   Covers: PF-family responsibility boundaries and removal of the K-series collision that previously overlapped with commercial/auth acceptance identifiers.

---

## 5. Surface Map

| Surface | Why it exists | Authoritative sub-spec |
|---|---|---|
| Session truth | Shell and gated UX require a single source of truth for `anonymous / authenticated / expired` and minimal entitlement state | `spec.sportpulse.backend.session-auth-contract.md` |
| Deferred auth | Product requires anonymous-first usage and auth only when demanded by account or Pro actions | `spec.sportpulse.backend.session-auth-contract.md` |
| Return-context restoration | Auth and checkout both need to restore route + attempted gated action without duplicated payload variants | `spec.sportpulse.backend.shared-return-context-contract.md` |
| Checkout + entitlement | Pro access must unlock in the same experience and fail closed when entitlement cannot be confirmed | `spec.sportpulse.backend.subscription-checkout-contract.md` |
| Public track record | The frontend exposes aggregate predictive evidence and must do so without cherry-picking or fake operational history | `spec.sportpulse.backend.track-record-contract.md` |
| Tier-aware ad suppression | Pro must suppress configured commercial ads while leaving operational notices and warnings intact | `spec.sportpulse.qa.acceptance-gap-closure-update.md` |
| QA / fixture alignment | K-series and PF-family must not collide semantically | `spec.sportpulse.qa.acceptance-gap-closure-update.md`, `spec.sportpulse.qa.prediction-track-record-fixtures.md` |

---

## 6. Dependency Order

The team must implement and integrate this package in the following order.

### Phase A — State truth
1. `spec.sportpulse.backend.shared-return-context-contract.md`
2. `spec.sportpulse.backend.session-auth-contract.md`

Reason: checkout and post-auth restore are unstable without a shared context payload and current-session truth.

### Phase B — Commercial entitlement
3. `spec.sportpulse.backend.subscription-checkout-contract.md`

Reason: Pro-depth gating, same-session unlock, and ad suppression become testable only after session truth is real.

### Phase C — Public evidence surface
4. `spec.sportpulse.backend.track-record-contract.md`

Reason: public track record is orthogonal to commercial state but still depends on final acceptance mapping and backend error discipline.

### Phase D — QA lock-in
5. `spec.sportpulse.qa.acceptance-gap-closure-update.md`
6. `spec.sportpulse.qa.prediction-track-record-fixtures.md`

Reason: QA must not validate against the pre-delta corpus once the new backend surfaces exist.

---

## 7. Merge Preconditions

This package is **not ready to be declared active** unless all of the following are true:

1. the four backend contracts exist and reference each other consistently,
2. the acceptance update is merged or transcribed into the active acceptance matrix,
3. the patched prediction/track-record fixtures are adopted so K-series collision no longer exists,
4. canonical error-envelope usage is preserved across all newly introduced endpoints,
5. route restoration uses the shared return-context contract instead of duplicated ad hoc payloads,
6. the lost-session checkout-return case is handled exactly as specified by the subscription/checkout contract.

If any of those are missing, the package remains draft-only and cannot be represented as “covered”.

---

## 8. Implementation Rules

### 8.1 Do not fork session truth

No frontend module may derive entitlement or auth truth outside the current-session contract.

### 8.2 Do not fork return payloads

Auth and checkout must share the same typed return-context model.

### 8.3 Do not treat QA updates as optional

K-07/K-08 closure and PF-family alignment are part of the same delta. Shipping backend/frontend changes without the QA corrections preserves a false-green state.

### 8.4 Do not backdoor commercial behavior through config

Runtime config, theme, or announcement systems must not override entitlement or tier-aware ad suppression rules.

### 8.5 Do not claim operational evidence without disclosure discipline

Track record must honor threshold, unavailable states, and disclosure typing exactly as defined by the track-record contract.

---

## 9. Affected Existing Artifacts

This package depends on, but does not replace, the following already-existing artifacts:

- `spec.sportpulse.web.auth-and-freemium-surface.md`
- `spec.sportpulse.web.navigation-and-shell-architecture.md`
- `spec.sportpulse.web.frontend-execution-backlog.md`
- `spec.sportpulse.web.frontend-modernization.md`
- `spec.sportpulse.qa.acceptance-test-matrix.md`
- `spec.sportpulse.shared.errors-and-warnings-taxonomy.md`

This package additionally **patches corpus behavior** through:

- `spec.sportpulse.qa.acceptance-gap-closure-update.md`
- `spec.sportpulse.qa.prediction-track-record-fixtures.md`

The fixture patch is mandatory because it resolves the preexisting semantic collision between the commercial/auth K-series and the PF-family’s old K mappings.

---

## 10. Minimum Review Checklist

Before any artifact in this package is promoted beyond draft, review must confirm:

- session/auth and subscription/checkout do not duplicate return-context fields,
- checkout-return lost-session behavior is explicit and not implementation-defined,
- track-record disclosure state is renderable without frontend guessing,
- K-07 is hardened enough that free **must** render configured commercial output and Pro **must not** render it,
- K-08 or equivalent has a concrete pass/fail criterion,
- no sub-spec invents endpoint-local error codes outside the canonical taxonomy discipline,
- endpoint reason tables obey the canonical taxonomy's HTTP/code pairing (for example, `409` uses `CONFLICT`, not `BAD_REQUEST`),
- the patched PF-family spec is the one referenced by QA agents and not an older cached copy.

---

## 11. Status and Promotion Rule

Current status of this document: **Draft**.

Promotion path:

1. keep this master index draft while sub-specs remain under active correction,
2. promote the sub-specs first,
3. only then promote this index as the authoritative package entrypoint.

This order matters because the index cannot be more authoritative than the contracts it points to.

---

## 12. Change Summary

This package closes the backend/frontend integration gap by introducing:

- one state-truth contract,
- one shared return-context contract,
- one commercial entitlement contract,
- one public evidence contract,
- one acceptance correction layer,
- and one fixture-family correction.

That is the minimum set required to stop the frontend reengineering from becoming a shell backed by implied behavior.
