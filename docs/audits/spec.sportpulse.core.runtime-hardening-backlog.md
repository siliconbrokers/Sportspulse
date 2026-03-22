---
artifact_id: SPEC-SPORTPULSE-CORE-RUNTIME-HARDENING-BACKLOG
title: "Runtime Hardening Backlog"
artifact_class: backlog
status: proposed
version: 0.1.0
project: sportpulse
domain: core
slug: runtime-hardening-backlog
owner: team
created_at: 2026-03-20
updated_at: 2026-03-20
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-AUDIT-RUNTIME-STORAGE-AND-SCALING-GAP-ANALYSIS
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
  - SPEC-SPORTPULSE-CORE-NON-FUNCTIONAL-REQUIREMENTS
  - SPEC-SPORTPULSE-CORE-MVP-EXECUTION-SCOPE
canonical_path: docs/audits/spec.sportpulse.core.runtime-hardening-backlog.md
---

# SportPulse — Runtime Hardening Backlog

Version: 0.1  
Status: Proposed  
Scope: Hardening of runtime snapshot/cache/storage behavior for the declared single-instance MVP topology.  
Audience: Backend, Ops, QA, AI-assisted development workflows.

---

## 1. Purpose

This artifact defines the **runtime hardening backlog** required to close the highest-risk operational gaps identified in the runtime/storage/scaling audit **without** changing SportPulse MVP product semantics, frontend truth ownership, or active scope boundaries.

This document exists to prevent the following failure mode:

- a system that is semantically correct in steady state
- but operationally fragile under restart, cache growth, or coarse invalidation
- and therefore not honestly degraded under failure despite appearing MVP-complete

This backlog is intentionally narrow. It is not a redesign spec. It is not a multi-instance migration plan. It is not a frontend modernization artifact.

---

## 2. Authority

This document is subordinate to:

1. Constitution
2. MVP Execution Scope
3. Repo Structure and Module Boundaries
4. Non-Functional Requirements
5. Acceptance Test Matrix
6. Runtime/Storage/Scaling Gap Analysis
7. Active implementation backlog

This document is authoritative only for:

- hardening runtime snapshot/cache/storage behavior
- defining ticket decomposition for the identified gaps
- setting acceptance expectations for those hardening changes
- defining what is immediate vs deferred

This document is **not** authoritative for:

- changing scoring policy
- changing layout semantics
- redefining DTO contracts
- adding new MVP product scope
- redesigning UI/IA/navigation
- introducing multi-instance infrastructure as an implied requirement

---

## 3. Problem statement

The current architecture is valid for the declared **single-instance snapshot-first MVP topology**, but it contains three near-term runtime risks that should be closed before traffic, competition count, or operational dependence increases materially:

1. **Unbounded in-memory snapshot store**
   - expired entries do not self-bound memory growth sufficiently
   - there is no explicit max-entry cap or LRU discipline

2. **No snapshot disk persistence for cold-start stale recovery**
   - after process restart, snapshot RAM state is empty
   - if the first rebuild fails, the system falls from degraded serving to 503

3. **Coarse invalidation policy**
   - refresh of one competition currently invalidates more snapshot state than necessary
   - this raises rebuild cost, miss rate, and latency exposure

These problems do not invalidate the architecture. They invalidate the idea that the runtime is already adequately hardened.

---

## 4. Decision

### Verdict
`OPTIMIZE`

### Reason
The architecture should be **hardened, not redesigned**. The system already matches the declared single-instance topology and snapshot-first semantic model. The correct move is to close the operational cliff edges and observability gaps without opening speculative infra work or leaking compensating logic into the frontend.

---

## 5. Hard constraints

All work defined in this backlog must preserve the following:

### 5.1 Snapshot-first discipline
Do not move semantic truth into frontend or ad hoc API recomputation.

### 5.2 No provider reads on request path
Hardening must not introduce provider fetches as a fallback shortcut during snapshot serving.

### 5.3 No semantic contract drift
Do not silently change:
- `policyKey`
- `policyVersion`
- `snapshotSchemaVersion`
- layout semantics
- warning semantics
- canonical truth

### 5.4 Honest degraded behavior
If stale fallback is used, it must remain explicit and machine-observable.

### 5.5 Package boundary discipline
Changes must be implemented in the proper package/layer and must not collapse responsibilities for convenience.

---

## 6. Non-goals

This backlog does **not** do any of the following:

- redesign the UI
- implement Redis/shared cache
- replace SQLite with PostgreSQL
- make the runtime multi-instance
- widen prediction/product scope
- invent new warnings or score semantics unless explicitly required for correctness
- patch frontend behavior to compensate for backend runtime weaknesses

---

## 7. Immediate work vs deferred work

### 7.1 Immediate items (blocking hardening)
These items materially reduce risk and should be executed first:

- SP-0511 — snapshot disk persistence + warm seed
- SP-0510 — bounded LRU eviction in snapshot store
- SP-0512 — per-competition invalidation

### 7.2 Secondary immediate items (same lane, non-blocking)
These improve diagnosability and operational safety but do not justify delaying H1 completion:

- SP-0513 — snapshot cache observability
- SP-0514 — score-snapshot health verification
- SP-0515 — SQLite WAL checkpoint after retention pruner

### 7.3 Deferred items
These are valid but explicitly non-blocking for current MVP hardening:

- NewsCache disk persistence / warm-from-disk
- PredictionStore synchronization verification
- portal-config audit log rotation
- prediction evaluation archival policy
- incident-store legacy cleanup
- raw-response-cache namespace audit
- multi-instance migration architecture

---

## 8. Ticket backlog

## Phase H1 — Critical runtime hardening

### SP-0511 — Snapshot disk persistence + warm seed recovery

**Owner:** BE + Ops  
**Dependencies:** none  
**Primary package boundary:** `packages/snapshot` + startup wiring  
**Priority:** P0

#### Problem
The current runtime loses snapshot stale fallback state on restart because snapshots are RAM-only. If the first rebuild after restart fails, the request path can return `503 SNAPSHOT_BUILD_FAILED` even when a valid prior snapshot existed before the restart.

#### Objective
Persist the **last-good compatible snapshot** to disk and load it as a stale seed on process startup so cold-start failures degrade honestly instead of failing immediately.

#### Deliverables
- atomic persistence of last-good snapshot per compatibility domain
- startup warm-seed load from disk into snapshot store
- compatibility validation before seed acceptance
- structured rejection of corrupt/incompatible seed files
- stale fallback semantics preserved exactly (warning/header behavior remains explicit)

#### Must preserve
- `F-04` behavior when no valid fallback exists
- existing warning semantics for `PROVIDER_ERROR` and `STALE_DATA`
- snapshot identity discipline
- request-path provider isolation

#### Must not
- synthesize snapshot truth from unrelated cache files
- silently treat corrupt seed as valid
- mask stale serving as fresh serving
- broaden fallback across incompatible competition/season identities

#### Acceptance
Existing cases that must continue to pass:
- `F-01`
- `F-04`
- `G-01`

New required case:
- `O-01 — Cold-start stale seed recovery`
  - startup with empty RAM snapshot store
  - valid disk seed present
  - fresh rebuild forced to fail
  - response remains valid
  - `X-Snapshot-Source: stale_fallback`
  - warnings include `PROVIDER_ERROR` + `STALE_DATA`

New required negative case:
- corrupt/incompatible seed is rejected
- if no other fallback exists, response remains `503 SNAPSHOT_BUILD_FAILED`

#### Risks
- serving semantically incompatible stale seed
- creating hidden persistence coupling that bypasses snapshot identity rules

#### Version impact
None expected.

---

### SP-0510 — Bounded LRU eviction in `InMemorySnapshotStore`

**Owner:** BE  
**Dependencies:** SP-0511 may land before or after, but both are required in H1  
**Primary package boundary:** `packages/snapshot/src/store`  
**Priority:** P0

#### Problem
The current in-memory snapshot store is effectively unbounded for active process lifetime. Expired entries are not a sufficient memory-control policy, and the current design lacks explicit max-entry boundedness and deterministic eviction.

#### Objective
Introduce bounded snapshot cache behavior through explicit capacity limits and deterministic LRU-style eviction without altering snapshot identity or serving semantics.

#### Deliverables
- configurable `maxEntries`
- deterministic eviction policy
- purge of expired entries during normal access and/or maintenance path
- internal counters for hit/miss/eviction/entry count
- tests for eviction order and stale retrieval safety

#### Must preserve
- snapshot keying rules
- stale fallback semantics
- existing snapshot identity/header fields
- no frontend-visible contract drift

#### Must not
- evict entries using non-deterministic criteria
- leak implementation shortcuts into API/web code
- silently drop the only valid stale candidate for the active key without policy reasoning

#### Acceptance
Existing cases that must continue to pass:
- `E-01`
- `E-02`
- `E-03`
- `E-04`
- `G-01`
- `F-04`

New required unit/integration cases:
- bounded capacity never exceeds configured maximum
- oldest eligible entry is evicted deterministically under LRU rule
- expired entry purge does not corrupt stale behavior for the active key

#### Risks
- accidental eviction of active/high-value stale entry
- key-cardinality underestimation causing thrash instead of bounded stability

#### Version impact
None expected.

---

### SP-0512 — Per-competition snapshot invalidation

**Owner:** BE  
**Dependencies:** none, but should land in same hardening wave  
**Primary package boundary:** `packages/snapshot` + scheduler callers  
**Priority:** P1

#### Problem
Current invalidation is coarse-grained. Refreshing one competition clears more snapshot state than necessary, increasing miss rate and forcing avoidable rebuilds.

#### Objective
Constrain invalidation scope so that refresh operations invalidate only the snapshot keys that are actually affected.

#### Deliverables
- `invalidate(competitionId)` or equivalent scoped invalidation API
- retention of `invalidateAll()` only for explicit admin/reset cases
- tests proving unaffected competitions remain cached
- key matching rules documented and deterministic

#### Must preserve
- snapshot correctness for refreshed competition
- no serving of cross-competition stale state
- no semantic drift in API responses

#### Must not
- rely on string-matching hacks without defined key compatibility rules
- create partial invalidation that leaves incompatible entries live

#### Acceptance
Existing cases that must continue to pass:
- `F-01`
- `F-02`
- `G-01`

New required cases:
- refresh of competition A does not invalidate competition B
- stale fallback remains restricted to compatible key domain only

#### Risks
- over-broad invalidation preserved under a new name
- under-invalidating stale entries that should have been cleared

#### Version impact
None expected.

---

## Phase H2 — Observability and supporting safeguards

### SP-0513 — Snapshot cache observability baseline

**Owner:** BE + Ops  
**Dependencies:** SP-0510 preferred first  
**Primary package boundary:** `packages/snapshot` and optional admin/health exposure  
**Priority:** P1

#### Problem
The runtime lacks sufficient snapshot cache diagnostics. Current visibility is too weak to detect memory pressure, thrash, build regression, or fallback overuse before symptoms become user-visible.

#### Objective
Make snapshot cache behavior machine-observable with minimal but useful structured diagnostics.

#### Deliverables
- structured log fields for:
  - cache entry count
  - hit count / miss count
  - eviction count
  - stale serve count
  - build duration
- optional health summary endpoint exposure if consistent with current ops surface
- no leakage of secrets or irrelevant internals

#### Acceptance
- observability output exists and is structured
- snapshot build failures and stale serving are diagnosable without reverse-engineering UI behavior

#### Risks
- overbuilding observability into a monitoring platform project
- logging noise with no stable field naming

#### Version impact
None expected.

---

### SP-0514 — Score-snapshot health verification

**Owner:** BE + Ops  
**Dependencies:** none  
**Primary package boundary:** server startup / health checks  
**Priority:** P2

#### Problem
If `score-snapshot.json` is missing or invalid, regression protection can silently degrade.

#### Objective
Detect missing or invalid score-snapshot state at startup or health-check time and emit explicit operational warnings.

#### Deliverables
- startup check for required score snapshot artifacts where applicable
- structured warning on missing/invalid state
- non-blocking behavior unless future policy explicitly upgrades severity

#### Acceptance
- warning emitted when expected artifact is absent or invalid
- startup remains policy-consistent

#### Risks
- false alarms due to environment-specific expectations

#### Version impact
None expected.

---

### SP-0515 — SQLite WAL checkpoint after retention pruner

**Owner:** BE + Ops  
**Dependencies:** none  
**Primary package boundary:** API usage ledger maintenance path  
**Priority:** P2

#### Problem
The SQLite-based API usage ledger is reasonably controlled, but its WAL lifecycle is not explicitly checkpointed after retention cleanup.

#### Objective
Tighten maintenance behavior by adding an explicit checkpoint after retention pruning.

#### Deliverables
- explicit WAL checkpoint after retention pruning
- structured log of checkpoint result
- no change to ledger schema semantics

#### Acceptance
- ledger continues to function normally after startup maintenance
- checkpoint behavior is observable and does not corrupt usage accounting

#### Risks
- cargo-cult checkpointing without verifying actual open/close behavior

#### Version impact
None expected.

---

## 9. Acceptance matrix extension

The current acceptance matrix is strong but does not fully freeze the cold-start seeded fallback path. Add the following case:

### O-01 — Cold-start stale seed recovery

**Type:** Integration (snapshot/api/startup)  
**Inputs / Preconditions:**
- compatible last-good snapshot persisted on disk
- RAM snapshot store starts empty
- fresh rebuild is forced to fail

**Steps:**
1. start process
2. load seed into snapshot store
3. request dashboard snapshot for matching competition/date context
4. verify fresh rebuild fails
5. verify stale seed response is served

**Expected:**
- `200` response
- valid snapshot payload
- `X-Snapshot-Source: stale_fallback`
- warnings include `PROVIDER_ERROR` and `STALE_DATA`
- identity fields remain coherent and explicit

**Pass if:**
- the system degrades honestly instead of falling directly to `503`

### O-02 — Corrupt seed rejection

**Type:** Integration (snapshot/api/startup)  
**Preconditions:** corrupt or incompatible snapshot seed exists on disk

**Expected:**
- seed is rejected explicitly
- structured warning/error emitted
- if no other fallback exists, request returns `503 SNAPSHOT_BUILD_FAILED`

**Pass if:** invalid seed is never treated as product truth.

---

## 10. Recommended implementation order

The correct implementation sequence is:

1. **SP-0511** — snapshot disk persistence + warm seed
2. **SP-0510** — bounded LRU eviction
3. **SP-0512** — per-competition invalidation
4. **SP-0513** — observability baseline
5. **SP-0514** — score-snapshot health verification
6. **SP-0515** — SQLite WAL checkpoint

### Why this order
Because the highest-value closure is:

- first: remove the restart cliff edge
- second: remove the silent memory growth risk
- third: reduce avoidable rebuild churn
- then: make the resulting system diagnosable

Anything else is dependency confusion.

---

## 11. Done criteria

This backlog is considered complete only when all of the following are true:

- runtime still obeys snapshot-first architecture
- stale fallback behavior remains explicit and honest
- request path still avoids provider calls
- no frontend semantic compensation was introduced
- no DTO/scoring/layout contract drift occurred
- `F-04` still protects the no-fallback failure path
- `G-01` still protects valid degraded serving
- new cold-start seed recovery case is covered and passing
- the system is more bounded and more diagnosable than before

This backlog is **not** complete merely because:

- the process restarts successfully
- the code compiles
- memory growth is “probably fine”
- logs exist but are ad hoc
- cache invalidation changed name without changing scope

---

## 12. Deferred items

The following items remain explicitly deferred and must not be smuggled into this backlog unless re-approved as active work:

- shared/distributed snapshot cache
- Redis-based invalidation
- PostgreSQL migration
- generalized multi-instance topology
- frontend redesign or shell rewrite
- product-scope expansion in predictions or monetization
- speculative persistence of every RAM cache regardless of impact

---

## 13. One-paragraph summary

SportPulse runtime hardening should proceed as a focused optimization pass, not as a redesign. The architecture is already correct for a single-instance snapshot-first MVP, but it still contains three operational weaknesses that matter: unbounded in-memory snapshot growth, no persisted stale seed for restart resilience, and coarse invalidation that causes unnecessary rebuild churn. This backlog closes those gaps while preserving constitutional boundaries, warning honesty, testability, and product semantics.
