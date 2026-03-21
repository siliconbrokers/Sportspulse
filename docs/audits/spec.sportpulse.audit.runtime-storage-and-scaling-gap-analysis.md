---
artifact_id: SPEC-SPORTPULSE-AUDIT-RUNTIME-STORAGE-AND-SCALING-GAP-ANALYSIS
title: "Runtime Storage and Scaling Gap Analysis"
artifact_class: spec
status: proposed
version: 0.2.0
project: sportpulse
domain: audit
slug: runtime-storage-and-scaling-gap-analysis
owner: team
created_at: 2026-03-20
updated_at: 2026-03-20
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-CORE-CONSTITUTION
  - SPEC-SPORTPULSE-CORE-NON-FUNCTIONAL-REQUIREMENTS
  - SPEC-SPORTPULSE-OPS-OPERATIONAL-BASELINE
  - SPEC-SPORTPULSE-CORE-REPO-STRUCTURE-AND-MODULE-BOUNDARIES
  - SPEC-SPORTPULSE-CORE-IMPLEMENTATION-BACKLOG
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
canonical_path: docs/audits/spec.sportpulse.audit.runtime-storage-and-scaling-gap-analysis.md
---

# SportPulse — Runtime Storage and Scaling Gap Analysis

Version: 0.2
Status: Proposed
Scope: Auditoría del runtime real, persistencia, cache, snapshot store, fallback, observabilidad y capacidad de crecimiento
Audience: Backend, Ops, Frontend, Product, QA, AI-assisted development workflows

> **Changelog v0.2 (2026-03-20)**
> - §1: Added definition of "training/walk-forward workloads" for SportsPulse context
> - §6: Added missing audit inputs — `server/matchday-cache.ts`, `server/af-budget.ts`, `cache/portal-config.json`, `server/news/`, `server/video/`
> - §5.8: Annotated current single-instance topology; multiple-instance scenario moved to future risk
> - §5.9: "Pro subscription flows" labeled `OUT_OF_SCOPE` (pre-MVP)
> - §7.1: Specified topology diagram format (ASCII/mermaid)
> - §8: Added disambiguation note for `TRAINING_RUNTIME_CONTENTION` vs `DEPLOYMENT_TOPOLOGY_RISK`

---

## 1. Purpose

This audit exists to determine whether the current SportPulse runtime architecture can support real product growth without violating constitutional and non-functional requirements.

It focuses on the operational substrate beneath the frontend:

- snapshot build/runtime path
- persistence choices
- cache layers
- snapshot keying and identity
- fallback behavior
- state consistency across disk / SQLite / DB / memory
- prediction-related storage interactions where relevant
- observability
- growth limits and failure modes

This document does **not** assume that the current persistence choices are wrong.

It exists to answer whether they are:
- coherent
- bounded
- diagnosable
- safe under growth
- aligned with active architecture

### Terminology — Training/walk-forward workloads

For the purposes of this audit, "training/walk-forward workloads" refers specifically to:
- Offline scripts in `tools/` (e.g., `xg-backfill-af.ts`, `download-af-historical.ts`, backtest runners)
- PE walk-forward evaluation runs in `packages/prediction/`

These are **not** assumed to run as a separate process unless there is explicit evidence to the contrary. The audit must determine whether they share stores or filesystem paths with the portal runtime, and whether that creates contention risk.

---

## 2. Authority

This audit is subordinate to:
1. Constitution
2. Non-Functional Requirements
3. Operational Baseline
4. Repo Structure and Module Boundaries
5. MVP Execution Scope
6. Implementation Backlog
7. Acceptance Test Matrix

This audit is authoritative only for:
- documenting the current runtime/storage state
- identifying structural gaps
- evaluating scaling risk
- defining preconditions for future runtime changes

It does not change active architecture by itself.

---

## 3. Why this audit is necessary

SportPulse is constitutionally snapshot-first and backend-owned in semantic truth.

That means the system must remain operationally interpretable and honest as it grows.

If persistence and cache behavior are unclear, fragmented, or weakly keyed, the system risks:
- serving semantically wrong snapshots
- stale data without explicit visibility
- duplicated or conflicting truth across stores
- rebuild inefficiency
- concurrency issues
- growth-related degradation that is not diagnosable
- invisible coupling between prediction work and portal runtime
- deployment fragility when topology changes

A product can survive an ugly UI for a while. It cannot safely survive ambiguous runtime truth.

---

## 4. Non-negotiable constraints

### 4.1 Snapshot-first operational rule

Provider/API data must flow through:
provider ingestion
→ canonical normalization
→ derived computations
→ snapshot engine
→ internal UI API
→ frontend rendering

The audit must reject patterns that violate this flow on request path.

### 4.2 Backend-owned truth

The runtime architecture must preserve backend ownership of:
- signal derivation
- prediction semantics
- scoring
- layout
- warnings
- snapshot identity

No cache or persistence shortcut may silently shift semantic truth into API or web layers.

### 4.3 Explicit failure behavior

If fresh snapshot build fails, valid outcomes are:
- explicit fallback snapshot with warnings
- explicit failure response

Silent corruption is disallowed.

### 4.4 Version discipline

Storage/runtime shortcuts must not erase or blur:
- policyVersion
- layoutAlgorithmVersion
- snapshotSchemaVersion
- buildNowUtc semantics
- snapshot identity

### 4.5 Module boundaries

The audit must preserve package responsibilities:
- `snapshot` owns snapshot build/persistence/cache/fallback
- `api` owns request validation and response shaping
- `web` owns rendering only
- `prediction` owns prediction logic/persistence inside its domain
- no provider call on UI request path

---

## 5. Audit questions

The audit must answer, explicitly and with evidence, the following questions.

### 5.1 Runtime topology reality

What is the actual runtime topology today?

At minimum, identify:
- single process or multiple processes
- where ingestion runs
- where snapshot build runs
- where API serves from
- whether frontend and API share deployment unit
- whether local disk is durable or ephemeral
- whether multiple instances exist or are planned
- whether training / walk-forward workloads (as defined in §1) share the same machine, process, DB, or filesystem as portal runtime

### 5.2 Persistence map

Where does each category of data actually live today?

The audit must build a single authoritative table covering:
- canonical source data
- normalized entities
- snapshots
- snapshot metadata
- cache artifacts (matchday, portal-config, news, video, xG)
- prediction artifacts
- training/intermediate artifacts
- track record records
- auth/subscription/session data if present
- logs / diagnostics if persisted
- budget tracking state

For each:
- store type
- path / system
- ownership package
- durability level
- semantic role
- source-of-truth or derived
- retention rule
- invalidation rule
- backup/recovery posture

### 5.3 Storage coherence

Does the current design have one clear source of truth for each artifact class?

The audit must identify:
- duplicated truths
- overlapping persistence
- disk-vs-SQLite ambiguity
- unbounded derived artifact accumulation
- stores used as convenience cache but effectively acting as source-of-truth
- data classes that should not persist but do
- data classes that should persist but only exist ephemerally

### 5.4 Snapshot identity and keying

Is snapshot persistence keyed in a way that preserves correctness?

The audit must inspect whether identity and storage keys properly incorporate relevant dimensions such as:
- competitionId
- seasonId
- buildNowUtc or equivalent semantic time anchor
- timezone or date context where relevant
- policy identity
- schema identity
- layout identity if needed
- prediction-context distinction if applicable

It must identify:
- ambiguous keys
- accidental overwrites
- stale-serving risk from loose keys
- collision risk across competitions or dates
- inability to reconstruct provenance

### 5.5 Cache policy

What cache layers exist today, and are they disciplined?

At minimum, audit:
- in-memory cache
- filesystem cache (matchday, portal-config, news, video, xG)
- SQLite-backed cache
- DB-backed cache
- HTTP/client cache if any

For each cache:
- what is cached
- who owns it
- TTL or freshness rule
- invalidation trigger
- max size / pruning rule
- corruption handling
- startup/warmup behavior
- stale serve behavior
- observability

### 5.6 Build-vs-read behavior

Does the system remain build-oriented, not interaction-oriented?

The audit must determine:
- whether expensive recomputation happens per UI interaction
- whether GET endpoints cause hidden rebuilds
- whether provider calls are triggered from UI request paths
- whether team detail projection is derived from snapshot or recomputed ad hoc
- whether prediction surfaces reuse existing materialized truth or invoke expensive logic too frequently

### 5.7 SQLite usage assessment

If SQLite is currently in use, the audit must determine:
- what exact data classes are stored there
- write/read patterns
- write concurrency assumptions
- locking risks
- file growth expectations
- backup/recovery reality
- suitability under current topology
- suitability under plausible next-stage topology

This assessment must not be based on generic "SQLite is good/bad" folklore.
It must be based on actual workload shape.

### 5.8 Filesystem usage assessment

If disk-based caching or persistence is in use, the audit must determine:
- which artifacts are written
- path conventions
- retention behavior
- cleanup behavior
- assumptions about durable local storage
- behavior under redeploy
- behavior if filesystem is ephemeral

> **Current topology note:** SportsPulse currently runs as a **single instance on Render** with a durable mounted disk (`cache/`). The multiple-instance question is therefore a **future risk scenario**, not a current operating concern. The audit must document the single-instance assumption explicitly and flag multi-instance incompatibilities as deferred risks rather than active findings, unless evidence of planned horizontal scaling is found.

### 5.9 Scaling scenarios

The audit must test the architecture conceptually against realistic growth cases, at minimum:
- current competition set
- addition of more leagues
- World Cup / structured tournament growth
- more historical data retained
- more snapshots retained
- more users hitting dashboard/detail
- track record accumulation growth
- prediction training or walk-forward jobs running in parallel

> **Out of scope:** "Active Pro subscription flows" is pre-MVP and must not generate findings. If included, classify as `OUT_OF_SCOPE` in the risk register.

For each scenario, classify:
- safe
- safe with operational discipline
- likely bottleneck
- architectural blocker

### 5.10 Observability and diagnosability

Can operators answer, for any served snapshot:
- what produced it
- when it was built
- whether it was fresh or stale
- whether fallback was used
- what warning state applied
- what store it came from
- whether the key was reconstructed correctly
- how long build/serve took
- whether runtime contention existed

If not, the architecture is operationally weak even if functionally correct.

---

## 6. Audit inputs

The audit must inspect all relevant current code/config, including at minimum:

**Snapshot pipeline**
- `packages/snapshot/src/build`
- `packages/snapshot/src/store`
- `packages/snapshot/src/cache`
- `packages/snapshot/src/projections`

**API layer**
- `packages/api/src/ui`
- `packages/api/src/middleware`
- `packages/api/src/serialization`

**Persistence and cache layers** _(required — do not skip)_
- `server/matchday-cache.ts` — primary file-based cache, matchday TTLs, atomic write, sub-tournament keying
- `server/af-budget.ts` — in-memory AF budget tracking (BRAKE_LIVE threshold, HARD_LIMIT, daily reset)
- `cache/portal-config.json` — portal config persistence (atomic write + audit log)
- `server/news/` — news cache (disk-based, TTL-driven)
- `server/video/` — video highlights cache (disk-based, 6h TTL)

**Prediction persistence**
- Prediction persistence/store modules if present in `packages/prediction/`
- Walk-forward / evaluation store if present

**Infrastructure**
- DB configuration
- SQLite access layer (`packages/canonical/src/api-usage/ledger.ts` and related)
- Filesystem write paths
- Environment/config loading
- Deployment config (Dockerfile, Render config)
- Rebuild scripts / cron jobs / workers if any

**Observability**
- Log instrumentation
- Health endpoints if any
- Any scripts used for training/walk-forward that touch operational stores

No conclusion is valid without code-path inspection.

---

## 7. Required audit outputs

The audit deliverable must include all sections below.

### 7.1 Runtime topology diagram

A concrete topology diagram of the current system, rendered as an **ASCII or Mermaid diagram in a fenced code block**, including:
- processes
- storage layers
- read paths
- build paths
- external provider touchpoints
- training/runtime overlap if any

The diagram must be self-contained and versionable as plain text.

### 7.2 Persistence inventory

A table with:
- artifact class
- store
- file/table/key pattern
- owner package
- truth class (`SOURCE`, `DERIVED`, `CACHE`, `EPHEMERAL`, `OP_LOG`)
- retention policy
- invalidation policy
- current issues

### 7.3 Snapshot lifecycle map

A lifecycle map from:
- ingestion
- normalization
- signal/scoring/layout/prediction derivation
- snapshot assembly
- persistence
- stale fallback
- API serving
- frontend consumption

This map must highlight every place where truth can drift.

### 7.4 Cache discipline report

A report per cache layer:
- ownership
- boundedness
- invalidation quality
- stale semantics
- observability
- corruption recovery posture

### 7.5 Keying and provenance assessment

A formal assessment of:
- key composition quality
- collision risk
- provenance visibility
- rebuild reproducibility
- ability to diagnose wrong-snapshot serving

### 7.6 Scaling risk register

At minimum include:
- write contention
- unbounded disk growth
- stale snapshot mis-keying
- hidden rebuild on read path
- runtime/training resource contention
- multi-instance incompatibility (deferred risk — see §5.8)
- ephemeral disk risk
- SQLite lock risk
- cache invalidation drift
- weak operational visibility

Each risk must include:
- description
- trigger
- impact
- severity
- likelihood
- recommended action

### 7.7 Operational readiness assessment

The audit must explicitly evaluate readiness for:
- repeatable deploys
- rollback
- rebuild after failure
- stale fallback honesty
- store recovery
- migration path if architecture must evolve

### 7.8 Recommendation

The audit must conclude whether the current runtime/storage layer should be classified as:
- `SUFFICIENT_NOW`
- `SUFFICIENT_WITH_HARDENING`
- `PARTIAL_REDESIGN_REQUIRED`
- `ARCHITECTURAL_MIGRATION_REQUIRED`

This classification is mandatory.

---

## 8. Classification rules

Every finding must be classified using one of:

- `AMBIGUOUS_TRUTH_SOURCE`
- `WEAK_KEYING`
- `STALE_FALLBACK_RISK`
- `CACHE_POLICY_GAP`
- `UNBOUNDED_STORAGE_RISK`
- `SQLITE_PATTERN_RISK`
- `EPHEMERAL_DISK_RISK`
- `READ_PATH_RECOMPUTATION`
- `MODULE_BOUNDARY_VIOLATION`
- `OBSERVABILITY_GAP`
- `DEPLOYMENT_TOPOLOGY_RISK`
- `TRAINING_RUNTIME_CONTENTION`
- `NOT_AN_ISSUE`
- `OUT_OF_SCOPE`

> **Disambiguation — `TRAINING_RUNTIME_CONTENTION` vs `DEPLOYMENT_TOPOLOGY_RISK`:**
> Use `TRAINING_RUNTIME_CONTENTION` only when a training or walk-forward artifact (as defined in §1) and a portal runtime artifact share the **same store or filesystem path** with an identifiable write-conflict risk. Do not use it for generic deployment topology concerns — those belong to `DEPLOYMENT_TOPOLOGY_RISK`.

No hand-wavy findings without classification.

---

## 9. Explicit non-goals of this audit

This audit must not:
- migrate the architecture
- replace SQLite/Postgres/filesystem during the audit itself
- invent infra that is not yet needed
- redesign prediction internals unrelated to persistence/runtime concerns
- redefine product scope
- turn into a performance benchmarking project without architectural interpretation
- conflate "works today" with "safe under growth"

It may recommend changes, but it is not itself the change.

---

## 10. Completion criteria

This audit is complete only when:

- current storage layers are fully inventoried
- each persisted artifact has an identified owner and truth class
- snapshot keying is assessed
- cache/fallback behavior is explicitly mapped
- SQLite/disk usage is evaluated based on actual workload shape
- read path vs build path behavior is confirmed
- scaling scenarios are classified
- observability gaps are identified
- a runtime/storage verdict is issued

Statements like "it should probably scale" are invalid.

---

## 11. Required recommendation format

The audit must end with exactly this structure:

### Verdict
One of:
- `SUFFICIENT_NOW`
- `SUFFICIENT_WITH_HARDENING`
- `PARTIAL_REDESIGN_REQUIRED`
- `ARCHITECTURAL_MIGRATION_REQUIRED`

### Reason
A short paragraph explaining the verdict.

### Immediate next actions
Maximum 10 items, dependency-ordered.

### Deferred items
Only if explicitly non-blocking.

---

## 12. Suggested follow-up artifacts

If material gaps are found, the audit should recommend one or more of:

- `spec.sportpulse.runtime.snapshot-store-and-keying.md`
- `spec.sportpulse.runtime.cache-policy-and-invalidation.md`
- `spec.sportpulse.runtime.persistence-strategy.md`
- `spec.sportpulse.runtime.operational-observability.md`
- `spec.sportpulse.runtime.training-vs-serving-isolation.md`

These are follow-up artifacts, not outputs of this audit itself.

---

## 13. One-paragraph summary

This audit determines whether the current SportPulse runtime architecture — including persistence, cache, snapshot store, fallback behavior, SQLite/disk usage, deployment assumptions, and observability — is coherent and honest enough to support product growth without semantic drift or operational fragility. It inventories where truth and derived artifacts live, how snapshots are keyed and served, whether stale fallback is safe, whether read paths are clean, and whether the system can scale to more competitions, more retained data, and more user/commercial states without collapsing into ambiguous runtime behavior.
