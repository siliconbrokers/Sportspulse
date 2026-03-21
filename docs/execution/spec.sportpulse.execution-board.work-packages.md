---
artifact_id: SPEC-SPORTPULSE-EXECUTION-BOARD-WORK-PACKAGES
title: "Execution Board — Work Packages"
artifact_class: spec
status: draft
version: 0.2.0
project: sportpulse
domain: execution
slug: execution-board-work-packages
owner: program-orchestration
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-EXECUTION-ORCHESTRATOR-MASTER-PLAN
  - SPEC-SPORTPULSE-BACKEND-FRONTEND-INTEGRATION-DELTA
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
canonical_path: docs/execution/spec.sportpulse.execution-board.work-packages.md
---

# SportPulse — Execution Board Work Packages

Version: 0.2.0  
Status: Draft  
Scope: Program-level executable work packages for backend↔frontend gap closure and frontend reengineering delivery.

---

## 1. Purpose

This document converts the execution orchestrator into **assignable work packages** with bounded scope, explicit dependencies, concrete outputs, and rollback criteria.

It exists because waves alone are not executable. A wave says **when** a class of work may happen. A work package says:

- exactly **what** is being built or patched,
- which specs it consumes,
- which artifacts it must produce,
- which acceptance target it must satisfy,
- what counts as **done**,
- and what forces **rollback / reopen**.

This board is the operational layer between:
- `spec.sportpulse.execution-orchestrator.master-plan.md`
- active corpus specs
- implementation teams (API / prediction / frontend / QA / ops / corpus governance)

---

## 2. Non-negotiable operating rules

1. **No work package is executable from conversation alone.** It must cite the source specs it consumes.
2. **No package is done if it lacks downstream-consumable artifacts.**
3. **No package may mix more than one of these shapes:** corpus patch, backend endpoint slice, frontend integration slice, QA gate, ops/release gate.
4. **No frontend package may invent backend truth locally.**
5. **No backend package may declare completion without payload examples and canonical error mapping.**
6. **No QA package may pass contradictory UI states under the same K-case.**
7. **If active corpus and draft delta disagree, the package is blocked until corpus is patched or a frozen implementation note exists.**
8. **Anything that introduces cookie auth or checkout is also an ops concern.** App code alone is not sufficient.

---

## 3. Status model

Allowed values for `status`:
- `not_started`
- `ready`
- `in_progress`
- `blocked`
- `review`
- `done`

---

## 4. Owner model

Owners must map to corpus-recognized boundaries, not generic labels:

- **Corpus Governance** — active-doc patching, promotion, supersession, authoritative-source alignment.
- **UI API Engineer (`packages/api`)** — endpoint exposure, request validation, canonical error envelopes, response shaping.
- **PE Agent Family (`packages/prediction`)** — prediction/track-record truth, evaluation, anti-leakage, PF alignment.
- **Frontend Engineer (`packages/web`)** — shell, routing, rendering, auth/session UX integration, paywall behavior.
- **QA / Fixture Enforcer** — matrix, fixture, contradiction detection, negative paths.
- **Ops** — env wiring, migrations, CORS/credentials, rate limits, health, staging/release/rollback.
- **Program Orchestration** — package sequencing, backlog mapping, gate discipline.

No package may use owner `backend` without package-boundary clarification.

---

## 5. Package inventory

### WP-01 — Absorb frontend-integration delta into active API contract
- **Wave:** 1
- **Stream:** corpus
- **Package size:** M
- **Title:** Patch `api.contract` with Session/Auth, Track Record, Subscription/Checkout, and shared `returnContext`
- **Consumes specs:**
  - `spec.sportpulse.backend.frontend-integration-delta.md`
  - `spec.sportpulse.backend.session-auth-contract.md`
  - `spec.sportpulse.backend.subscription-checkout-contract.md`
  - `spec.sportpulse.backend.track-record-contract.md`
  - `spec.sportpulse.backend.shared-return-context-contract.md`
- **Produces artifacts:**
  - updated `spec.sportpulse.api.contract.md`
  - insertion log / diff summary
- **Depends on:** Wave 0 freeze complete
- **Blocked by:** missing insertion target or unresolved contradiction with active API sections
- **Acceptance target:** active API contract contains authoritative sections for downstream implementation; no conflicting route or payload definitions remain
- **Owner:** Corpus Governance
- **Status:** ready
- **Done when:** `api.contract` is sufficient as implementation source-of-truth for Session/Auth, Track Record, Checkout/Subscription, shared `returnContext`, and canonical errors
- **Rollback if:** route names, payload shapes, or error semantics drift from the delta package after patch

### WP-02 — Absorb frontend-integration delta into active backend architecture
- **Wave:** 1
- **Stream:** corpus
- **Package size:** M
- **Title:** Patch backend architecture with ownership, persistence, lifecycle, and boundary notes
- **Consumes specs:**
  - `spec.sportpulse.backend.frontend-integration-delta.md`
  - `spec.sportpulse.backend.session-auth-contract.md`
  - `spec.sportpulse.backend.subscription-checkout-contract.md`
  - `spec.sportpulse.backend.track-record-contract.md`
  - `spec.sportpulse.core.repo-structure-and-module-boundaries.md`
- **Produces artifacts:**
  - updated `spec.sportpulse.server.backend-architecture.md`
  - boundary notes for session/auth, track record, checkout/subscription
- **Depends on:** WP-01
- **Blocked by:** missing active architecture doc or unresolved ownership ambiguity
- **Acceptance target:** backend architecture explicitly assigns responsibility for session truth, entitlement truth, reconcile flow, track-record computation, and API exposure boundaries
- **Owner:** Corpus Governance
- **Status:** ready
- **Done when:** active backend architecture can be used as source-of-truth without fallback to side drafts
- **Rollback if:** component ownership or persistence rules conflict with repo structure, subagent boundaries, or constitution

### WP-03 — Normalize promotion state of frontend workstream specs
- **Wave:** 1
- **Stream:** corpus
- **Package size:** S
- **Title:** Resolve `proposed` vs `active` state for frontend modernization and auth/freemium specs used by execution
- **Consumes specs:**
  - `spec.sportpulse.web.frontend-modernization.md`
  - `spec.sportpulse.web.auth-and-freemium-surface.md`
  - `spec.sportpulse.web.frontend-execution-backlog.md`
  - `spec.sportpulse.execution-orchestrator.master-plan.md`
- **Produces artifacts:**
  - promotion note or updated metadata/state policy
  - explicit frozen-baseline note if specs remain proposed
- **Depends on:** Wave 0 freeze complete
- **Blocked by:** disagreement on what becomes active vs frozen input
- **Acceptance target:** no execution package relies on an undocumented promotion state
- **Owner:** Corpus Governance + Program Orchestration
- **Status:** ready
- **Done when:** each frontend execution source doc is either active or explicitly frozen as implementation input with no ambiguity
- **Rollback if:** execution starts from a doc whose authority state is still unclear

### WP-04A — Implement `GET /api/session`
- **Wave:** 2
- **Stream:** api
- **Package size:** S
- **Title:** Build canonical current-session endpoint
- **Consumes specs:**
  - `spec.sportpulse.backend.session-auth-contract.md`
  - active `spec.sportpulse.api.contract.md`
  - active `spec.sportpulse.server.backend-architecture.md`
- **Produces artifacts:**
  - `GET /api/session`
  - payload examples for anonymous/authenticated/expired
  - endpoint tests
  - canonical error mapping table in implementation docs/tests
- **Depends on:** WP-01, WP-02, WP-16, WP-17
- **Blocked by:** unresolved cookie/session persistence model
- **Acceptance target:** backend truth surface required by K-04, K-05, K-06, K-07 integrations
- **Owner:** UI API Engineer
- **Status:** not_started
- **Done when:** endpoint returns canonical session states, uses `no-store`, and can be consumed by frontend hydration without local heuristics
- **Rollback if:** frontend needs custom adaptation or endpoint truth depends on undocumented commercial calls per request

### WP-04B — Implement magic-link start/complete
- **Wave:** 2
- **Stream:** api
- **Package size:** M
- **Title:** Build deferred-auth entry and callback completion routes
- **Consumes specs:**
  - `spec.sportpulse.backend.session-auth-contract.md`
  - `spec.sportpulse.backend.shared-return-context-contract.md`
  - active `spec.sportpulse.api.contract.md`
  - active `spec.sportpulse.server.backend-architecture.md`
- **Produces artifacts:**
  - magic-link start/complete endpoints
  - `returnContext` validation helpers
  - endpoint tests for invalid token, expired token, replay, invalid return path, rate limit
- **Depends on:** WP-01, WP-02, WP-16, WP-17
- **Blocked by:** unresolved token issuance/validation path or missing credentials-safe runtime config
- **Acceptance target:** supports anonymous-first auth entry from gated actions and safe context restoration; prerequisite for K-06 behavior
- **Owner:** UI API Engineer
- **Status:** not_started
- **Done when:** start and complete routes exist, validate `returnContext`, and return canonical payloads/errors
- **Rollback if:** open redirect risk exists, token replay is possible, or context restore requires undocumented frontend duplication

### WP-04C — Implement logout + expired-session handling
- **Wave:** 2
- **Stream:** api
- **Package size:** S
- **Title:** Build idempotent logout and safe expired-session semantics
- **Consumes specs:**
  - `spec.sportpulse.backend.session-auth-contract.md`
  - active `spec.sportpulse.api.contract.md`
- **Produces artifacts:**
  - logout endpoint
  - expired-session tests
  - cookie-clearing behavior notes
- **Depends on:** WP-01, WP-16
- **Blocked by:** auth cookie handling not yet stabilized
- **Acceptance target:** safe downgrade from authenticated/pro to anonymous/expired without stale Pro leak
- **Owner:** UI API Engineer
- **Status:** not_started
- **Done when:** logout is idempotent, clears cookie state, and `GET /api/session` reflects anonymous/expired semantics correctly afterward
- **Rollback if:** Pro-only UI remains reachable after logout or expired-session behavior is ambiguous

### WP-05 — Implement public Track Record truth + API exposure
- **Wave:** 2
- **Stream:** prediction + api
- **Package size:** M
- **Title:** Build track-record computation/projection and expose `GET /api/ui/track-record`
- **Consumes specs:**
  - `spec.sportpulse.backend.track-record-contract.md`
  - `spec.sportpulse.qa.acceptance-test-matrix.md`
  - `spec.sportpulse.qa.prediction-track-record-fixtures.md`
  - active `spec.sportpulse.api.contract.md`
  - `spec.sportpulse.core.repo-structure-and-module-boundaries.md`
  - `spec.sportpulse.core.subagents-definition.md`
- **Produces artifacts:**
  - prediction-side evaluation/projection support where needed
  - API endpoint
  - PF-backed tests
  - payload examples for `available`, `below_threshold`, `unavailable`
- **Depends on:** WP-01, WP-02
- **Blocked by:** unresolved disclosure policy or PF mismatch
- **Acceptance target:** K-03 and PF-backed cases
- **Owner:** PE Agent Family + UI API Engineer
- **Status:** not_started
- **Done when:** endpoint returns stable contract for all required states and PF-backed tests pass without K/PF drift
- **Rollback if:** below-threshold, disclosure, or inclusion rules diverge from track-record contract or PF spec

### WP-06A — Implement checkout session creation
- **Wave:** 2
- **Stream:** api
- **Package size:** S
- **Title:** Build authenticated checkout-session creation endpoint
- **Consumes specs:**
  - `spec.sportpulse.backend.subscription-checkout-contract.md`
  - `spec.sportpulse.backend.shared-return-context-contract.md`
  - active `spec.sportpulse.api.contract.md`
  - active `spec.sportpulse.server.backend-architecture.md`
- **Produces artifacts:**
  - checkout-session creation endpoint
  - request/response examples
  - endpoint tests
- **Depends on:** WP-01, WP-02, WP-04A, WP-16, WP-17
- **Blocked by:** unresolved payment-provider secrets/config or entitlement source-of-truth ambiguity
- **Acceptance target:** backend precondition for K-05
- **Owner:** UI API Engineer
- **Status:** not_started
- **Done when:** authenticated checkout can be created with validated `returnContext` and canonical errors
- **Rollback if:** checkout can be created without stable auth truth or if session linkage is ambiguous

### WP-06B — Implement return reconcile + lost-session recovery
- **Wave:** 2
- **Stream:** api
- **Package size:** M
- **Title:** Build reconcile endpoint and explicit orphaned-return recovery policy
- **Consumes specs:**
  - `spec.sportpulse.backend.subscription-checkout-contract.md`
  - `spec.sportpulse.backend.shared-return-context-contract.md`
  - `spec.sportpulse.backend.session-auth-contract.md`
  - active `spec.sportpulse.api.contract.md`
- **Produces artifacts:**
  - reconcile endpoint
  - lost-session recovery tests
  - idempotency tests
- **Depends on:** WP-01, WP-02, WP-04A, WP-04B, WP-06A, WP-16
- **Blocked by:** no approved recovery path for checkout-success + missing session
- **Acceptance target:** same-session unlock and documented reauth-then-reconcile recovery for K-05
- **Owner:** UI API Engineer
- **Status:** not_started
- **Done when:** reconcile is idempotent, owner mismatch is rejected canonically, and lost-session returns follow only the documented recovery policy
- **Rollback if:** entitlement requires manual admin correction or undocumented fallback behavior

### WP-06C — Implement subscription status + entitlement refresh
- **Wave:** 2
- **Stream:** api
- **Package size:** S
- **Title:** Build read/refresh entitlement endpoints
- **Consumes specs:**
  - `spec.sportpulse.backend.subscription-checkout-contract.md`
  - `spec.sportpulse.backend.session-auth-contract.md`
  - active `spec.sportpulse.api.contract.md`
- **Produces artifacts:**
  - `GET /api/subscription/status`
  - entitlement refresh endpoint
  - endpoint tests including `401`
- **Depends on:** WP-01, WP-02, WP-04A, WP-16, WP-17
- **Blocked by:** unresolved entitlement persistence model
- **Acceptance target:** backend truth surface for K-05 and K-07 integration
- **Owner:** UI API Engineer
- **Status:** not_started
- **Done when:** subscription status and refresh are stable, canonical, and sufficient for same-session Pro unlock without heuristic polling
- **Rollback if:** Pro unlock requires page reload, manual refresh, or undocumented timing assumptions

### WP-07 — Build frontend shell, routing, registry, and unified API client
- **Wave:** 3
- **Stream:** frontend
- **Package size:** M
- **Title:** Establish frontend foundations that do not depend on unresolved commercial truth
- **Consumes specs:**
  - `spec.sportpulse.web.frontend-execution-backlog.md`
  - `spec.sportpulse.web.frontend-modernization.md`
  - `spec.sportpulse.web.navigation-and-shell-architecture.md`
  - `spec.sportpulse.web.design-system-foundation.md`
- **Produces artifacts:**
  - route map
  - app shell
  - competition context/registry
  - centralized API client
  - top-level state cleanup
  - route test harness
- **Depends on:** Wave 0 complete, WP-03
- **Blocked by:** unresolved contradiction in shell/routing specs
- **Acceptance target:** stream-1 foundations deliverables; no dependency on unfinished auth/checkout behavior
- **Owner:** Frontend Engineer
- **Status:** not_started
- **Done when:** shell/routing/API foundations are stable and can host track-record/auth/commercial work without semantic rework
- **Rollback if:** foundations hardcode provisional auth/commercial assumptions or bypass central API client

### WP-08 — Build public Track Record UI
- **Wave:** 3
- **Stream:** frontend
- **Package size:** S
- **Title:** Implement public track-record surface and all visible states
- **Consumes specs:**
  - `spec.sportpulse.web.frontend-execution-backlog.md`
  - `spec.sportpulse.backend.track-record-contract.md`
  - `spec.sportpulse.qa.acceptance-test-matrix.md`
- **Produces artifacts:**
  - track-record UI block
  - state coverage for loading/available/below-threshold/unavailable
  - UI tests
- **Depends on:** WP-05, WP-07
- **Blocked by:** track-record backend contract not yet stable
- **Acceptance target:** K-03
- **Owner:** Frontend Engineer
- **Status:** not_started
- **Done when:** public track-record renders correctly without auth dependency and without metric fabrication
- **Rollback if:** frontend invents disclosure semantics or computes values not supplied by the contract

### WP-09 — Integrate frontend session/auth behavior
- **Wave:** 4
- **Stream:** frontend
- **Package size:** M
- **Title:** Implement session provider, hydration, deferred auth entry, callback handling, and expired-session behavior
- **Consumes specs:**
  - `spec.sportpulse.web.auth-and-freemium-surface.md`
  - `spec.sportpulse.backend.session-auth-contract.md`
  - `spec.sportpulse.backend.shared-return-context-contract.md`
  - `spec.sportpulse.web.navigation-and-shell-architecture.md`
- **Produces artifacts:**
  - session provider/auth context
  - hydration flow
  - deferred auth entry from gated actions
  - `/auth/callback` handling
  - logout/expired-session UI behavior
- **Depends on:** WP-04A, WP-04B, WP-04C, WP-07
- **Blocked by:** Session/Auth backend contract not yet stable
- **Acceptance target:** K-06 prerequisites and anonymous-first behavior
- **Owner:** Frontend Engineer
- **Status:** not_started
- **Done when:** first visit does not force login, gated actions can start auth and restore context safely, and expired sessions downgrade cleanly
- **Rollback if:** first visit is gated, context is lost after auth, or frontend duplicates `returnContext` shape

### WP-10 — Integrate Pro paywall, checkout flow, verifying state, and ad suppression
- **Wave:** 5
- **Stream:** frontend
- **Package size:** M
- **Title:** Implement inline paywall, checkout handoff/return, entitlement-aware rendering, and Pro ad suppression
- **Consumes specs:**
  - `spec.sportpulse.web.auth-and-freemium-surface.md`
  - `spec.sportpulse.backend.subscription-checkout-contract.md`
  - `spec.sportpulse.backend.session-auth-contract.md`
  - `spec.sportpulse.backend.shared-return-context-contract.md`
  - `spec.sportpulse.web.frontend-execution-backlog.md`
  - `spec.sportpulse.web.site-experience-config.md`
- **Produces artifacts:**
  - Pro-depth gate behavior
  - inline paywall
  - checkout handoff and return handling
  - verifying-subscription transitional state
  - entitlement-aware ad suppression
  - UI tests
- **Depends on:** WP-06A, WP-06B, WP-06C, WP-09
- **Blocked by:** checkout/reconcile backend still unstable or session truth ambiguous
- **Acceptance target:** K-04, K-05, K-07
- **Owner:** Frontend Engineer
- **Status:** not_started
- **Done when:** free/anonymous cannot see Pro depth, checkout return restores intent and entitlement correctly, and Pro suppresses commercial ads while notices/warnings remain
- **Rollback if:** Pro depth leaks to free users, Pro state requires manual refresh, or K-07 can pass under contradictory DOM states

### WP-11 — Harden acceptance suite and integrated negative paths
- **Wave:** 6
- **Stream:** qa
- **Package size:** M
- **Title:** Run integrated validation across K-03..K-07 and negative-path journeys
- **Consumes specs:**
  - `spec.sportpulse.qa.acceptance-test-matrix.md`
  - `spec.sportpulse.qa.prediction-track-record-fixtures.md`
  - `spec.sportpulse.qa.acceptance-gap-closure-update.md`
  - `spec.sportpulse.execution-orchestrator.master-plan.md`
- **Produces artifacts:**
  - integrated test results
  - fixture validation report
  - negative-path regression set (lost session, orphaned return, expired token, unavailable track record)
- **Depends on:** WP-08, WP-10, WP-18
- **Blocked by:** unresolved mismatch between matrix and implementation or missing staging-like environment
- **Acceptance target:** K-03, K-04, K-05, K-06, K-07
- **Owner:** QA / Fixture Enforcer
- **Status:** not_started
- **Done when:** new K-series passes on integrated system and PF-backed cases remain aligned
- **Rollback if:** any K-case can pass under two contradictory UI states or fixture/matrix drift reappears

### WP-12 — Visual hardening and theme propagation validation
- **Wave:** 7
- **Stream:** frontend + qa
- **Package size:** M
- **Title:** Perform responsive hardening, Level B style propagation, and release visual verification
- **Consumes specs:**
  - `spec.sportpulse.web.frontend-modernization.md`
  - `spec.sportpulse.web.design-system-foundation.md`
  - `spec.sportpulse.web.theme-and-global-announcement-system.md`
  - `spec.sportpulse.web.site-experience-config.md`
  - `spec.sportpulse.qa.acceptance-test-matrix.md`
- **Produces artifacts:**
  - responsive fixes
  - style propagation pass report
  - release visual checklist
- **Depends on:** WP-11
- **Blocked by:** unresolved behavioral defects or K-03..K-07 not yet passing
- **Acceptance target:** K-08
- **Owner:** Frontend Engineer + QA / Fixture Enforcer
- **Status:** not_started
- **Done when:** active product surfaces pass Level B theme propagation/readiness and key responsive defects are closed
- **Rollback if:** style propagation hides semantic distinctions or release readiness depends on unresolved behavioral defects

### WP-13 — Merge acceptance update into authoritative matrix only
- **Wave:** 1
- **Stream:** corpus + qa
- **Package size:** S
- **Title:** Ensure K-07 and K-08 live only in the authoritative acceptance matrix
- **Consumes specs:**
  - `spec.sportpulse.qa.acceptance-test-matrix.md`
  - `spec.sportpulse.qa.acceptance-gap-closure-update.md`
- **Produces artifacts:**
  - authoritative matrix with integrated K-07/K-08
  - archival or supersession note for the side update
- **Depends on:** Wave 0 freeze complete
- **Blocked by:** uncertainty about which doc is authoritative
- **Acceptance target:** no K-case exists only in a side update
- **Owner:** Corpus Governance + QA / Fixture Enforcer
- **Status:** ready
- **Done when:** authoritative acceptance matrix contains the new cases and side update is either archived or marked absorbed
- **Rollback if:** future execution still cites the side update as separate truth

### WP-14 — Align backlog and execution-board mapping
- **Wave:** 1
- **Stream:** orchestration
- **Package size:** S
- **Title:** Map program packages to existing backlog IDs and streams
- **Consumes specs:**
  - `spec.sportpulse.core.implementation-backlog.md`
  - `spec.sportpulse.web.frontend-execution-backlog.md`
  - `spec.sportpulse.execution-orchestrator.master-plan.md`
  - this execution board
- **Produces artifacts:**
  - mapping table from `WP-*` to active backlog tickets/sections
  - no-gap/no-duplicate note
- **Depends on:** WP-03
- **Blocked by:** backlog sections too coarse or stale
- **Acceptance target:** every execution package is traceable to one or more active backlog streams/tickets
- **Owner:** Program Orchestration
- **Status:** ready
- **Done when:** there is an explicit mapping from `WP-*` to active backlog IDs/streams and no orphan package remains
- **Rollback if:** teams execute against `WP-*` that cannot be traced into backlog/accountability structures

### WP-15 — Promote delta package to absorbed-or-frozen state
- **Wave:** 1
- **Stream:** corpus
- **Package size:** S
- **Title:** Decide promotion state for the new backend delta package and supersession notes
- **Consumes specs:**
  - `spec.sportpulse.backend.frontend-integration-delta.md`
  - `spec.sportpulse.backend.session-auth-contract.md`
  - `spec.sportpulse.backend.shared-return-context-contract.md`
  - `spec.sportpulse.backend.subscription-checkout-contract.md`
  - `spec.sportpulse.backend.track-record-contract.md`
  - `spec.sportpulse.core.constitution.md`
- **Produces artifacts:**
  - promotion/supersession note
  - absorbed-or-frozen implementation status for each delta doc
- **Depends on:** WP-01, WP-02
- **Blocked by:** active corpus not yet patched
- **Acceptance target:** no ambiguity remains about whether implementation reads active corpus or still reads frozen delta docs
- **Owner:** Corpus Governance + Program Orchestration
- **Status:** ready
- **Done when:** each delta doc is marked either absorbed, frozen for implementation, or superseded, with no contradictory active overlap
- **Rollback if:** teams implement from both active corpus and stale draft delta in parallel

### WP-16 — Cookie/CORS/rate-limit/security hardening for auth and checkout
- **Wave:** 2
- **Stream:** ops
- **Package size:** M
- **Title:** Prepare runtime security posture required by cookie auth and checkout
- **Consumes specs:**
  - `spec.sportpulse.ops.operational-baseline.md`
  - `spec.sportpulse.shared.errors-and-warnings-taxonomy.md`
  - active `spec.sportpulse.server.backend-architecture.md`
- **Produces artifacts:**
  - CORS config with credentials policy
  - cookie/security-header configuration
  - rate-limit policy for auth/checkout endpoints
  - env variable checklist
- **Depends on:** WP-02
- **Blocked by:** missing env/source-of-truth decisions for frontend origin, auth cookies, or payment callback origin assumptions
- **Acceptance target:** operational baseline requirements for security headers, CORS, credentials, and `429 RATE_LIMITED`
- **Owner:** Ops + UI API Engineer
- **Status:** not_started
- **Done when:** staging/runtime config safely supports cookie auth and checkout without wildcard CORS, missing headers, or ad-hoc rate-limit behavior
- **Rollback if:** credentials are enabled without explicit origin control, or exceeded limits do not return canonical `RATE_LIMITED`

### WP-17 — Migrations and environment wiring for session/subscription state
- **Wave:** 2
- **Stream:** ops
- **Package size:** M
- **Title:** Prepare persistence, migrations, and required env wiring for new auth/subscription state
- **Consumes specs:**
  - `spec.sportpulse.ops.operational-baseline.md`
  - active `spec.sportpulse.server.backend-architecture.md`
  - `spec.sportpulse.backend.session-auth-contract.md`
  - `spec.sportpulse.backend.subscription-checkout-contract.md`
- **Produces artifacts:**
  - migration plan/files where required
  - `.env.example` updates / required variable list
  - startup-fail validation list
- **Depends on:** WP-02
- **Blocked by:** unresolved persistence model or ownership for session/subscription tables/state
- **Acceptance target:** ops baseline requirements for migrations, rollback support, and required env validation
- **Owner:** Ops + UI API Engineer
- **Status:** not_started
- **Done when:** required persistence changes are migration-backed, rollback-capable, and environment requirements are explicit and enforced
- **Rollback if:** implementation depends on implicit state, ad-hoc schema edits, or runtime starts with missing critical variables

### WP-18 — Staging smoke, health verification, rollback rehearsal, and release gate
- **Wave:** 6
- **Stream:** ops + qa
- **Package size:** M
- **Title:** Exercise deployment, health, smoke, and rollback gates before release readiness
- **Consumes specs:**
  - `spec.sportpulse.ops.operational-baseline.md`
  - `spec.sportpulse.qa.acceptance-test-matrix.md`
  - this execution board
- **Produces artifacts:**
  - staging deployment record
  - smoke test report
  - health verification record
  - rollback rehearsal record
  - release gate checklist
- **Depends on:** WP-04A, WP-04B, WP-04C, WP-05, WP-06A, WP-06B, WP-06C, WP-08, WP-10
- **Blocked by:** no staging-like environment or missing deploy artifact discipline
- **Acceptance target:** operational baseline release-extension checks
- **Owner:** Ops + QA / Fixture Enforcer
- **Status:** not_started
- **Done when:** staging deploy succeeds, health endpoints are green, smoke tests run, rollback is exercised under the baseline rules, and release gate evidence exists
- **Rollback if:** release promotion depends on untested rollback, missing health evidence, or absent smoke validation

---

## 6. Recommended execution order

### Batch A — Active truth and authority cleanup
1. WP-01
2. WP-02
3. WP-03
4. WP-13
5. WP-14
6. WP-15

### Batch B — Runtime prerequisites for auth/checkout truth
7. WP-16
8. WP-17

### Batch C — Backend truth surfaces
9. WP-04A
10. WP-04B
11. WP-04C
12. WP-05
13. WP-06A
14. WP-06B
15. WP-06C

### Batch D — Frontend foundations and public trust surface
16. WP-07
17. WP-08

### Batch E — Auth and commercial integration
18. WP-09
19. WP-10

### Batch F — Integrated validation and release gates
20. WP-18
21. WP-11
22. WP-12

This order preserves the intended program shape:
- active truth first,
- runtime/security prerequisites before cookie-auth/checkout code,
- backend truth surfaces before dependent integrations,
- frontend foundations early but not semantically blind,
- commercial/auth integration after truth is stable,
- ops/QA release gates before visual sign-off,
- visual hardening last.

---

## 7. Board review questions

At the start of each execution cycle, review each package against these questions:
- Is the package still on the correct wave?
- Are its dependencies truly complete, or only “mostly done”?
- Does its acceptance target still map to the active matrix?
- Does it have a package-boundary owner, not a generic team label?
- Does it produce artifacts the next package can consume without guessing?
- Is it still small enough to execute without mid-flight splitting?

If the answer to the last question is no, split the package **before** implementation starts.

---

## 8. Definition of board usefulness

This board is useful only if it prevents four failure modes:
1. teams executing large blurry “backend” or “frontend” blocks with hidden dependencies;
2. cookie-auth/checkout work shipping without ops/security/runtime hardening;
3. prediction-owned truth being reassigned to a generic backend bucket;
4. teams claiming completion without downstream-consumable artifacts and acceptance traceability.

If any of these failure modes reappears, the board must be updated immediately.
