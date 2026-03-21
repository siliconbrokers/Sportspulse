---
artifact_id: SPEC-SPORTPULSE-CORE-IMPLEMENTATION-BACKLOG
title: "Implementation Backlog (SDD)"
artifact_class: spec
status: active
version: 2.1.0
project: sportpulse
domain: core
slug: implementation-backlog
owner: team
created_at: 2026-03-15
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/core/spec.sportpulse.core.implementation-backlog.md
---
# SportPulse — Implementation Backlog (SDD)

Version: 2.0
Status: Active — Phases 0–9 complete; Phases 10–11 in execution
Scope: Atomic implementation tickets with dependencies, outputs, tests, and version/fixture impact analysis for SportPulse MVP  
Audience: Engineering, QA, Ops, AI-assisted development workflows

---

## 1. Purpose

This document defines the **SDD implementation backlog** for SportPulse MVP.

It is a task graph designed to:

- enforce correct build order
- prevent scope creep
- keep work atomic and reviewable
- map implementation to acceptance tests and golden fixtures
- preserve version discipline

Every ticket must:
- reference authoritative documents
- define concrete outputs
- define acceptance checks (Acceptance Matrix IDs)
- state golden fixture impact

---

## 2. Backlog structure conventions

Each ticket includes:

- **ID**
- **Title**
- **Owner** (BE/FE/QA/Ops)
- **Dependencies**
- **Authoritative refs**
- **Deliverables**
- **Acceptance tests**
- **Golden fixtures impacted**
- **Version impact**
- **Risks**

---

## 3. Phases (high-level)

Phase 0 — Repo scaffolding and boundary enforcement ✅ DONE
Phase 1 — Canonical ingestion + normalization ✅ DONE
Phase 2 — Signals ✅ DONE
Phase 3 — Scoring policy execution ✅ DONE
Phase 4 — Layout geometry ✅ DONE
Phase 5 — Snapshot engine ✅ DONE
Phase 6 — UI API ✅ DONE
Phase 7 — Frontend UI ✅ DONE
Phase 8 — Degraded states + fallback ✅ DONE
Phase 9 — Golden fixtures + regression gates ✅ DONE
Phase H — Runtime hardening (snapshot/storage/ledger) ← ACTIVE
Phase 10 — Prediction UX surface + Track record ← ACTIVE
Phase 11 — Pro tier freemium funnel ← PLANNED

---

## 4. Ticket graph

### Phase 0 — Repo scaffolding and boundary enforcement

#### SP-0001 — Create repo skeleton and package structure
Owner: BE/Ops  
Dependencies: none  
Refs: Repo Structure, Constitution  
Deliverables:
- repository folders under `packages/` as defined
- baseline TS config/build
Acceptance tests: (infrastructure)  
Golden fixtures: none  
Version impact: none  
Risks: scope drift if structure deviates.

---

#### SP-0002 — Enforce dependency boundaries with tooling
Owner: BE  
Dependencies: SP-0001  
Refs: Repo Structure  
Deliverables:
- lint/tooling rule to prevent forbidden imports (web->scoring/layout, api->canonical provider adapters, etc.)
Acceptance tests: J-01, J-02 (boundary checks)  
Golden fixtures: none  
Version impact: none  
Risks: insufficient enforcement leads to creeping coupling.

---

#### SP-0003 — Implement canonical JSON serialization helper
Owner: BE  
Dependencies: SP-0001  
Refs: NFR, Golden Fixtures  
Deliverables:
- `packages/shared` canonical JSON serializer (stable key ordering, numeric formatting policy where relevant)
Acceptance tests: I-01 (supports), contract tests  
Golden fixtures: all (enabler)  
Version impact: none  
Risks: wrong canonicalization produces noisy diffs.

---

### Phase 1 — Canonical ingestion + normalization

#### SP-0101 — Define canonical domain models (Competition, Season, Team, Match)
Owner: BE  
Dependencies: SP-0001  
Refs: Glossary/Invariants, Data Normalization  
Deliverables:
- canonical model types in `packages/canonical/model`
Acceptance tests: A-01  
Golden fixtures: all (enabler)  
Version impact: none  
Risks: ID semantics drift.

---

#### SP-0102 — Implement lifecycle classifier
Owner: BE  
Dependencies: SP-0101  
Refs: Event Lifecycle, Glossary/Invariants  
Deliverables:
- lifecycle mapping functions in `packages/canonical/lifecycle`
Acceptance tests: A-03  
Golden fixtures: F1, F2, F3, F4  
Version impact: none  
Risks: incorrect finished/upcoming classification breaks scoring truth.

---

#### SP-0103 — Implement provider adapter (football-data.org) ingestion
Owner: BE  
Dependencies: SP-0101  
Refs: MVP Scope, Backend Architecture  
Deliverables:
- adapter for fetching/parsing provider data (ingestion only)
Acceptance tests: (integration scaffolding), A-01  
Golden fixtures: none (provider raw is not golden baseline)  
Version impact: none  
Risks: provider coupling leaks into canonical layer.

---

#### SP-0104 — Implement canonical normalization mapping from provider to canonical
Owner: BE  
Dependencies: SP-0102, SP-0103  
Refs: Data Normalization, Glossary/Invariants  
Deliverables:
- normalization pipeline producing canonical entities
- stable canonical IDs
Acceptance tests: A-01, A-02, A-03  
Golden fixtures: F1–F4  
Version impact: none  
Risks: unstable IDs will invalidate all snapshots.

---

### Phase 2 — Signals

#### SP-0201 — Implement Signal registry and SignalDTO primitives
Owner: BE  
Dependencies: SP-0001  
Refs: Signals Spec, Glossary/Invariants  
Deliverables:
- signal key enums/registry
- SignalDTO types and quality model
Acceptance tests: B-01..B-06 (enabler)  
Golden fixtures: all (enabler)  
Version impact: none  
Risks: missingness semantics drift.

---

#### SP-0202 — Implement FORM_POINTS_LAST_5 computation
Owner: BE  
Dependencies: SP-0104, SP-0201  
Refs: Signals Spec  
Deliverables:
- form computation based on last 5 finished matches before buildNowUtc
Acceptance tests: B-01, B-02, B-03  
Golden fixtures: F1, F2, F4  
Version impact: none  
Risks: off-by-one window mistakes.

---

#### SP-0203 — Implement NEXT_MATCH_HOURS computation
Owner: BE  
Dependencies: SP-0104, SP-0201  
Refs: Signals Spec  
Deliverables:
- next match hours computation + normalization horizon (MVP v1)
Acceptance tests: B-04, B-05, B-06  
Golden fixtures: F1, F3, F4  
Version impact: none  
Risks: time arithmetic errors, timezone misinterpretation.

---

#### SP-0204 — Implement derived helper PROXIMITY_BUCKET (non-weighted)
Owner: BE  
Dependencies: SP-0203  
Refs: Signals Spec  
Deliverables:
- helper bucket derived from NEXT_MATCH_HOURS
Acceptance tests: (optional), explainability checks  
Golden fixtures: F1–F3  
Version impact: none  
Risks: accidentally used as weighted input.

---

### Phase 3 — Scoring policy execution

#### SP-0301 — Implement scoring policy registry and policy identity
Owner: BE  
Dependencies: SP-0001  
Refs: Scoring Policy Spec, Glossary/Invariants  
Deliverables:
- policy key/version model
- policy selection mechanism for MVP v1
Acceptance tests: C-01  
Golden fixtures: all (enabler)  
Version impact: none  
Risks: policy identity confusion.

---

#### SP-0302 — Implement MVP policy execution (form + agenda weights)
Owner: BE  
Dependencies: SP-0202, SP-0203, SP-0301  
Refs: Scoring Policy Spec  
Deliverables:
- rawScore, attentionScore, displayScore, layoutWeight production
- contribution extraction and ordering tie-breaks
Acceptance tests: C-02, C-03  
Golden fixtures: F1–F4  
Version impact: none (policyVersion already defined)  
Risks: contribution mismatch, ordering instability.

---

#### SP-0303 — Add legacy-resistance guard tests
Owner: QA/BE  
Dependencies: SP-0302  
Refs: Glossary/Invariants, NFR  
Deliverables:
- tests/lints ensuring legacy constructs absent
Acceptance tests: C-04, I-02  
Golden fixtures: all  
Version impact: none  
Risks: legacy terms creep back in code.

---

### Phase 4 — Layout geometry

#### SP-0401 — Implement treemap squarified v1 solver
Owner: BE  
Dependencies: SP-0001  
Refs: Treemap Algorithm Spec  
Deliverables:
- deterministic treemap generator producing rects
Acceptance tests: D-01, D-02, D-03  
Golden fixtures: F1, F6  
Version impact: none (layoutAlgorithmVersion already defined)  
Risks: rounding nondeterminism.

---

#### SP-0402 — Implement all-zero layoutWeight fallback + warning
Owner: BE  
Dependencies: SP-0401  
Refs: Treemap Algorithm Spec, Taxonomy  
Deliverables:
- equal synthetic weights fallback for geometry
- emits LAYOUT_DEGRADED
Acceptance tests: D-04  
Golden fixtures: F6  
Version impact: none  
Risks: corrupting score vs geometry separation.

---

#### SP-0403 — Implement geometry validation utilities
Owner: BE  
Dependencies: SP-0401  
Refs: Treemap Algorithm Spec  
Deliverables:
- bounds checks, overlap checks, closure checks
Acceptance tests: D-02  
Golden fixtures: F1, F6  
Version impact: none  
Risks: false positives causing unnecessary build failure.

---

### Phase 5 — Snapshot engine

#### SP-0501 — Implement Snapshot identity and header assembly
Owner: BE  
Dependencies: SP-0302, SP-0401  
Refs: Snapshot Engine Spec, Snapshot DTO Spec  
Deliverables:
- header with competitionId/seasonId/buildNowUtc/timezone
- policy identity
- schema version
Acceptance tests: E-01  
Golden fixtures: all  
Version impact: none  
Risks: ambiguous identity semantics.

---

#### SP-0502 — Implement snapshot build pipeline orchestration
Owner: BE  
Dependencies: SP-0104, SP-0203, SP-0302, SP-0401, SP-0501  
Refs: Snapshot Engine Spec  
Deliverables:
- pipeline: canonical -> signals -> scoring -> layout -> snapshot DTO
- ordering rules
Acceptance tests: E-02, E-03, E-04  
Golden fixtures: F1–F4, F6  
Version impact: none  
Risks: pipeline leakage into API layer.

---

#### SP-0503 — Implement warning aggregation into snapshot
Owner: BE  
Dependencies: SP-0502  
Refs: Taxonomy, Data Quality  
Deliverables:
- warnings[] population based on missingness/partiality/staleness/layout fallbacks
Acceptance tests: G-02, E-01  
Golden fixtures: F2–F6  
Version impact: none  
Risks: warnings inconsistent across layers.

---

#### SP-0504 — Implement layout diagnostics (optional MVP enhancement)
Owner: BE  
Dependencies: SP-0401, SP-0502  
Refs: Layout Stability Spec  
Deliverables:
- compute movement metrics vs prior snapshot (if stored)
Acceptance tests: (optional), supports LAYOUT_SHIFT  
Golden fixtures: optional  
Version impact: none  
Risks: introduces state coupling if not careful.

---

#### SP-0505 — Implement snapshot cache/store and stale fallback
Owner: BE/Ops  
Dependencies: SP-0502, SP-0503  
Refs: Snapshot Engine Spec, Taxonomy  
Deliverables:
- snapshot store keyed by identity
- serve last snapshot if rebuild fails
- emit STALE_DATA + PROVIDER_ERROR where applicable
Acceptance tests: G-01, F-04  
Golden fixtures: F5  
Version impact: none  
Risks: serving wrong snapshot key.

---

### Phase 6 — UI API

#### SP-0601 — Implement GET /api/ui/dashboard
Owner: BE  
Dependencies: SP-0502, SP-0505  
Refs: API Contract, Snapshot DTO  
Deliverables:
- endpoint with query validation
- returns DashboardSnapshotDTO
Acceptance tests: F-01, F-03  
Golden fixtures: F1–F6  
Version impact: none  
Risks: schema drift.

---

#### SP-0602 — Implement GET /api/ui/team projection
Owner: BE  
Dependencies: SP-0601  
Refs: API Contract  
Deliverables:
- projection endpoint derived from dashboard snapshot
Acceptance tests: F-02  
Golden fixtures: F1–F4  
Version impact: none  
Risks: recomputation creeping in.

---

#### SP-0603 — Implement error envelope and error codes
Owner: BE  
Dependencies: SP-0601  
Refs: Taxonomy  
Deliverables:
- canonical error envelope for non-2xx
Acceptance tests: F-03, F-04  
Golden fixtures: F5  
Version impact: none  
Risks: ad hoc error shapes.

---

### Phase 7 — Frontend UI

#### SP-0701 — Implement dashboard page rendering from snapshot DTO
Owner: FE  
Dependencies: SP-0601  
Refs: Frontend Architecture, UI Spec  
Deliverables:
- page that fetches snapshot and renders header/warnings/treemap
Acceptance tests: H-03 (warnings display)  
Golden fixtures: F1  
Version impact: none  
Risks: FE invents scoring assumptions.

---

#### SP-0702 — Implement treemap rendering using rect
Owner: FE  
Dependencies: SP-0701  
Refs: UI Spec, Treemap Algorithm Spec (render contract)  
Deliverables:
- render tiles positioned/sized by rect
- no client treemap solving
Acceptance tests: H-01  
Golden fixtures: F1, F6  
Version impact: none  
Risks: FE falls back to local solver.

---

#### SP-0703 — Implement team selection + detail panel
Owner: FE  
Dependencies: SP-0602, SP-0702  
Refs: UI Spec  
Deliverables:
- team click opens detail projection
- show explainability (top contributions)
Acceptance tests: H-02  
Golden fixtures: F1–F4  
Version impact: none  
Risks: FE fabricates explanation strings.

---

#### SP-0704 — Implement degraded state visuals
Owner: FE  
Dependencies: SP-0701  
Refs: Taxonomy, UI Spec  
Deliverables:
- UI indicators for STALE_DATA, PARTIAL_DATA, PROVIDER_ERROR, LAYOUT_DEGRADED, etc.
Acceptance tests: H-03  
Golden fixtures: F4–F6  
Version impact: none  
Risks: warnings ignored or hidden.

---

### Phase 8 — Degraded states + fallback validation

#### SP-0801 — Create degraded-state fixture harness
Owner: QA/BE  
Dependencies: SP-0505, SP-0601  
Refs: Golden Fixtures, Acceptance Matrix  
Deliverables:
- test harness to simulate provider outage and fallback
Acceptance tests: G-01, F-04  
Golden fixtures: F5  
Version impact: none  
Risks: tests too brittle without canonical controls.

---

#### SP-0802 — Validate all-zero layout fallback end-to-end
Owner: QA/BE  
Dependencies: SP-0402, SP-0702  
Refs: Golden Fixtures  
Deliverables:
- end-to-end test verifying F6 and UI rendering
Acceptance tests: D-04, H-01  
Golden fixtures: F6  
Version impact: none  
Risks: geometry comparisons brittle without canonical serialization.

---

### Phase 9 — Golden fixtures + regression gates

#### SP-0901 — Author golden fixture directories and expected outputs
Owner: QA/BE  
Dependencies: SP-0502, SP-0601  
Refs: Golden Fixtures doc  
Deliverables:
- directories for F1–F6
- canonical input.canonical.json and context.json
- expected.signals.json and expected.snapshot.json
Acceptance tests: I-01 (enabler)  
Golden fixtures: all  
Version impact: none  
Risks: fixtures too large or not canonical-first.

---

#### SP-0902 — Implement golden fixture runner
Owner: BE/QA  
Dependencies: SP-0901, SP-0003  
Refs: Golden Fixtures doc, Acceptance Matrix  
Deliverables:
- runner that generates snapshot from canonical input + context
- compares semantic/contract/geometry expectations
Acceptance tests: I-01  
Golden fixtures: all  
Version impact: none  
Risks: comparing too strictly or too loosely.

---

#### SP-0903 — Implement version bump regression gates
Owner: QA/BE
Dependencies: SP-0902
Refs: NFR, Acceptance Matrix
Deliverables:
- tests ensuring scoring/layout/schema changes require explicit bumps
Acceptance tests: I-02, I-03, I-04
Golden fixtures: all
Version impact: none
Risks: false positives if gates not designed carefully.

---

### Phase H — Runtime hardening

*Hardening wave targeting snapshot store resilience, cold-start recovery, and storage maintenance. Independent of Phases 10–11 and executable in parallel. All work bounded to `packages/snapshot`, server startup wiring, and the API usage ledger. No product semantics, DTO contracts, scoring policy, or layout truth changed.*

*Authoritative decomposition: SPEC-SPORTPULSE-CORE-RUNTIME-HARDENING-BACKLOG (subordinate to this backlog).*

**Critical (H1 — blocking hardening):**

#### SP-0511 — Snapshot disk persistence + warm seed recovery
Owner: BE/Ops
Dependencies: none
Refs: Runtime Hardening Backlog §7.1, Snapshot Engine Spec, Taxonomy
Deliverables:
- atomic persistence of last-good snapshot per compatibility domain (`packages/snapshot` + startup wiring)
- startup warm-seed load from disk into snapshot store
- compatibility validation before seed acceptance
- structured rejection of corrupt or incompatible seed files (never silently treated as valid)
- stale fallback semantics unchanged: STALE_DATA + PROVIDER_ERROR warnings remain explicit and machine-observable
Acceptance tests: F-01, F-04, G-01 (must continue to pass); O-01 (new — cold-start stale seed recovery: startup with empty RAM store + valid disk seed + forced fresh-rebuild failure → 200 response, `X-Snapshot-Source: stale_fallback`, warnings include PROVIDER_ERROR + STALE_DATA); O-02 (new — corrupt seed rejection: corrupt/incompatible seed on disk → seed rejected explicitly, structured warning emitted, 503 SNAPSHOT_BUILD_FAILED if no other fallback)
Golden fixtures impacted: none
Version impact: none
Risks: serving semantically incompatible stale seed; hidden persistence coupling bypassing snapshot identity rules.

---

#### SP-0510 — Bounded LRU eviction in `InMemorySnapshotStore`
Owner: BE
Dependencies: SP-0511 may land before or after; both required in H1
Refs: Runtime Hardening Backlog §7.1, Snapshot Engine Spec
Deliverables:
- configurable `maxEntries` with deterministic LRU-style eviction (`packages/snapshot/src/store`)
- expired-entry purge during normal access and/or maintenance path
- internal counters: hit / miss / eviction / entry count
- unit and integration tests for eviction order and stale retrieval safety
Acceptance tests: E-01, E-02, E-03, E-04, G-01, F-04 (must continue to pass); new unit cases: capacity never exceeds configured maximum; oldest eligible entry evicted deterministically; expired-entry purge does not corrupt stale behavior for active key
Golden fixtures impacted: none
Version impact: none
Risks: accidental eviction of the only valid stale candidate for the active key; key-cardinality underestimation causing thrash.

---

#### SP-0512 — Per-competition snapshot invalidation
Owner: BE
Dependencies: none
Refs: Runtime Hardening Backlog §7.1, Snapshot Engine Spec
Deliverables:
- scoped `invalidate(competitionId)` or equivalent API on the snapshot store (`packages/snapshot` + scheduler callers)
- `invalidateAll()` retained for explicit admin/reset cases only
- key-matching rules documented and deterministic
- tests proving unaffected competitions remain cached after targeted invalidation
Acceptance tests: F-01, F-02, G-01 (must continue to pass); new: refresh of competition A does not invalidate competition B; stale fallback remains restricted to compatible key domain only
Golden fixtures impacted: none
Version impact: none
Risks: over-broad invalidation preserved under a new name; under-invalidating cross-stale entries that should have been cleared.

---

**Secondary (H2 — same hardening lane, non-blocking for H1 completion):**

#### SP-0513 — Snapshot cache observability baseline
Owner: BE/Ops
Dependencies: SP-0510 preferred first
Refs: Runtime Hardening Backlog §7.2
Deliverables:
- structured log fields: entry count, hit / miss / eviction, stale serve count, build duration (`packages/snapshot` and optional admin/health exposure)
- optional health summary if consistent with current ops surface; no secrets or irrelevant internals exposed
Acceptance tests: observability output exists and is structured; snapshot build failures and stale serving diagnosable without reverse-engineering UI behavior
Golden fixtures impacted: none
Version impact: none
Risks: logging noise without stable field naming; over-engineering observability into a monitoring platform.

---

#### SP-0514 — Score-snapshot health verification
Owner: BE/Ops
Dependencies: none
Refs: Runtime Hardening Backlog §7.2
Deliverables:
- startup check for required score-snapshot artifacts where applicable (server startup / health checks)
- structured warning on missing or invalid state; non-blocking unless policy explicitly upgrades severity
Acceptance tests: warning emitted when expected artifact is absent or invalid; startup remains policy-consistent
Golden fixtures impacted: none
Version impact: none
Risks: false alarms from environment-specific artifact expectations.

---

#### SP-0515 — SQLite WAL checkpoint after retention pruner
Owner: BE/Ops
Dependencies: none
Refs: Runtime Hardening Backlog §7.2
Deliverables:
- explicit WAL checkpoint call after retention pruning in the API usage ledger (API usage ledger maintenance path)
- structured log of checkpoint result; no ledger schema semantics changed
Acceptance tests: ledger functions normally after startup maintenance; checkpoint behavior observable and non-corrupting to usage accounting
Golden fixtures impacted: none
Version impact: none
Risks: cargo-cult checkpointing without verifying actual open/close behavior. Note: partial implementation may already exist — audit before opening new work.

---

## 5. MVP completion definition (execution)

**Phases 0–9 are complete (2026-03-16).**

- Phase 1–7 deliverables: exist and work end-to-end ✅
- Phase 8 degraded scenarios: pass ✅
- Phase 9 golden fixtures: pass ✅
- Minimum acceptance set (A-01 through J-02): satisfied ✅

Phase 10 (Prediction UX + Track record) and Phase 11 (Pro tier) are the active commercial execution phases.

---

### Phase 10 — Prediction UX surface + Track record

#### SP-1001 — Prediction detail surface in DetailPanel (free tier)
Owner: FE
Dependencies: UI API (SP-0601), Predictive Engine operational
Refs: Constitution v3 §2, MVP Execution Scope v2 §5.6, spec.sportpulse.prediction.engine.md
Deliverables:
- 1X2 calibrated probabilities visible in DetailPanel for any match with FULL_MODE or LIMITED_MODE
- Operating mode indicator ("Predicción disponible / limitada / no disponible")
- Stub model explanation (which factors drove the prediction)
- NOT_ELIGIBLE graceful state ("Datos insuficientes para predecir")
Acceptance tests: K-01, K-02
Golden fixtures: none (prediction fixtures are separate from snapshot fixtures)
Version impact: `snapshotSchemaVersion` bump if prediction fields added to DashboardSnapshotDTO
Risks: raw distribution accidentally mixed with calibrated probs; NOT_ELIGIBLE state not handled gracefully.

---

#### SP-1002 — Track record aggregate display (public)
Owner: FE + BE
Dependencies: SP-1001, track record accumulation operational
Refs: Constitution v3 §2 (track record as moat), MVP Execution Scope v2 §5.7
Deliverables:
- Backend endpoint: `GET /api/ui/track-record?competitionId=X` → accuracy%, prediction count, last_evaluated_at
- Frontend surface: static aggregate per competition visible in portal (competition info panel or dedicated section)
- Only FULL_MODE evaluated predictions included in accuracy numerator
- No user-filtering in MVP (aggregate only)
Acceptance tests: K-03
Golden fixtures: none
Version impact: new endpoint; no existing version bump required
Risks: display before minimum data threshold (gate: ≥200 evaluated predictions per liga before publishing accuracy — per Business Plan v3.0 §11.2; walk-forward historical data may be shown earlier with explicit "evaluación histórica, no historial operativo" disclosure); cherry-picking logic accidentally excludes unfavorable results.

---

#### SP-1003 — Pro depth paywall gate (scorelines, xG, derived markets)
Owner: FE + BE
Dependencies: SP-1001, auth/subscription infra decision
Refs: MVP Execution Scope v2 §5.6 (Pro-only), Business Plan v3.0 §7
Deliverables:
- Depth fields (scoreline distribution, xG, O/U, BTTS) gated behind Pro check
- Free user sees 1X2 + paywall CTA in depth section
- Pro user sees full prediction detail
- Paywall CTA links to Pro upgrade flow
Acceptance tests: K-04
Golden fixtures: none
Version impact: none (gating is presentation logic; backend always returns full payload, frontend gates display)
Risks: backend leaking Pro data to free tier; paywall CTA creating friction before user has seen value.

---

### Phase 11 — Pro tier freemium funnel

#### SP-1101 — Subscription infrastructure (minimal viable)
Owner: BE + Ops
Dependencies: SP-1003
Refs: Business Plan v3.0 §7, §11, §12
Deliverables:
- Stripe integration for Pro subscription ($5.20/mo gross)
- User auth + subscription status check
- JWT or session with Pro flag propagated to frontend
- Admin view: active subscriber count
Acceptance tests: K-05
Golden fixtures: none
Version impact: none
Risks: ARPPU leakage (store fees not accounted in reporting); mobile payment flow bypassing web Stripe.

---

#### SP-1102 — Freemium conversion funnel (registration deferral)
Owner: FE
Dependencies: SP-1101
Refs: Business Plan v3.0 §2.3, §7.3 (registration deferral principle)
Deliverables:
- Registration not required on first visit
- Registration triggered when user tries to save, bookmark, or access Pro depth
- Clear value prop shown before registration prompt
Acceptance tests: K-06
Golden fixtures: none
Version impact: none
Risks: registration prompt too early destroys conversion; too late loses the user entirely.

---

## 6. One-paragraph summary

This backlog decomposes SportPulse into a strict SDD task graph. Phases 0–9 (complete) cover repo scaffolding, canonical normalization, signal computation, scoring policy execution, deterministic layout, snapshot orchestration, UI API exposure, frontend rendering from backend geometry, degraded-state handling, and golden-fixture regression gates. Phase H (active, parallel to Phase 10) closes the three operational cliff edges identified in the runtime/storage audit: unbounded in-memory snapshot growth, no persisted stale seed for restart resilience, and coarse snapshot invalidation — without changing product semantics, DTO contracts, or scoring truth. Phases 10–11 (active) cover the commercial execution: prediction UX surface, track record accumulation and display, Pro depth paywall, and freemium conversion funnel. Each ticket defines boundaries, outputs, acceptance tests, and fixture impact to prevent scope drift and protect deterministic, explainable product truth.
