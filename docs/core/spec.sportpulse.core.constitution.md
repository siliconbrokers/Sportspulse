---
artifact_id: SPEC-SPORTPULSE-CORE-CONSTITUTION
title: "SportPulse Constitution v3.0"
artifact_class: spec
status: active
version: 3.0.1
project: sportpulse
domain: core
slug: constitution
owner: team
created_at: 2026-03-15
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/core/spec.sportpulse.core.constitution.md
---
# SportPulse — Constitution (MVP + Design Constraints)

Version: 3.0.1
Status: Authoritative constitutional document
Scope: Product constitution, architectural boundaries, MVP constraints, governance, and documentary hierarchy  
Audience: Product, Backend, Frontend, QA, Ops, Design

---

## 1. Purpose

This document is the **constitutional source of truth** for SportPulse.

It exists to define:

- what SportPulse is
- what the MVP is and is not
- which architectural decisions are non-negotiable
- which documents are authoritative for implementation
- which classes of changes require explicit versioning
- which legacy ideas are explicitly rejected for the current product line

This document is **not** a low-level implementation spec.  
It governs the system, the boundaries, and the hierarchy of more detailed specifications.

---

## 2. Product definition

SportPulse is a **snapshot-first football analytics platform** for the Spanish-speaking football fan.

It combines two co-equal product pillars:

**Pillar 1 — Attention dashboard.** Transforms normalized football competition data into a deterministic, explainable, visually stable dashboard that shows users which teams deserve attention, why, and what upcoming events are relevant.

**Pillar 2 — Match prediction engine.** Computes match outcome predictions using a versioned Elo + Poisson model, produces calibrated 1X2 probabilities and derived markets (O/U, BTTS, scorelines), and builds a verifiable public track record that constitutes the core competitive moat.

Both pillars share the same architectural principles: snapshot-first, backend-owned semantics, determinism, explainability, provider isolation, and versioned evolution.

**What SportPulse is not:** a raw scores app, a live betting engine, a tipster platform, a prediction market, a bookmaker affiliate, or a front-end-calculated visualization layer.

---

## 3. MVP definition

### 3.1 MVP scope

The current MVP is fixed to:

- **sport:** football
- **mode:** B — **Form + agenda**
- **data source for ingestion:** football-data.org
- **primary dashboard entity for treemap sizing:** `TEAM`
- **single competition snapshot per request**
- **snapshot-driven rendering**
- **backend-owned scoring**
- **backend-owned treemap geometry**
- **predictive engine:** Elo rating + Poisson lambda → scoreline matrix → calibrated 1X2 + derived markets
- **prediction operating modes:** FULL_MODE / LIMITED_MODE / NOT_ELIGIBLE per validation rules
- **track record accumulation:** predictions timestamped before kickoff, stored for accuracy evaluation
- **freemium tier separation:** 1X2 free / depth (scoreline, xG, model explanation, history) Pro-only

### 3.2 MVP scoring basis

The MVP attention model is intentionally narrow:

- team recent form
- team next scheduled match proximity

The active scoring signal set is defined in dedicated specs, but constitutionally the MVP is constrained to the **form + agenda** concept and must remain explainable and deterministic.

The prediction pipeline is architecturally distinct from the attention scoring pipeline. It does not feed the treemap layout. Both pipelines are backend-owned, deterministic, and versioned independently.

### 3.3 MVP non-goals

Out of scope for MVP unless explicitly versioned in later specs:

- bookmaker odds
- xG-driven scoring
- injuries and transfers as scoring inputs
- sentiment analysis
- live minute-by-minute stream-driven dashboard updates
- multi-provider reconciliation
- mixed TEAM/MATCH treemap sizing
- client-side scoring
- client-side layout computation
- favorites-based score mutation
- visual inertia heuristics that override canonical ordering

---

## 4. Constitutional principles

### 4.1 Snapshot-first architecture

The product is built around **materialized snapshots**, not ad-hoc per-view calculations.

Provider/API data must flow through:

provider ingestion  
→ canonical normalization  
→ derived computations  
→ snapshot engine  
→ internal UI API  
→ frontend rendering

The frontend must never depend directly on raw provider data.

### 4.2 Determinism

Given the same:

- canonical source data snapshot
- derivation rules
- `buildNowUtc`
- scoring policy identity
- layout algorithm identity
- container configuration

the resulting:

- signals
- scores
- warnings
- ordering
- treemap geometry

must be reproducible.

Determinism is a foundational quality requirement, not an optimization.

### 4.3 Explainability

Every attention outcome must be explainable.

The system must be able to expose:

- the signals used
- normalized values
- policy weights
- top contributions
- warning conditions
- the identity of the scoring policy and build context

Opaque score production is constitutionally disallowed.

### 4.4 Backend ownership of semantics

The backend owns:

- signal derivation
- metrics semantics
- score policy execution
- display score mapping
- layout weight calculation
- treemap geometry generation
- warning generation
- snapshot identity

The frontend owns:

- rendering
- interaction
- animation
- presentation
- navigation state
- theming

The frontend must not own domain semantics that affect product truth.

### 4.5 Provider isolation

External provider schemas must never leak into the product contract.

The user-facing and frontend-facing system must depend on:

- canonical ids
- canonical entities
- canonical status values
- canonical timestamps
- canonical DTOs

Provider replacement must remain feasible without rewriting the frontend contract.

### 4.6 Versioned evolution

Critical behavior must evolve through **explicit versioning**, not silent mutation.

This applies to:

- scoring policy
- layout algorithm
- snapshot schema
- canonical data semantics when materially changed

Historical snapshots must remain interpretable under the versions that produced them.

---

## 5. Authoritative document hierarchy

### 5.1 This constitution

This document is the **top-level governing document**.

It defines system principles, documentary authority, MVP boundaries, and design constraints.

### 5.2 Active canonical specifications

The following documents are the active implementation-level sources of truth:

#### Core governance
- `docs/core/spec.sportpulse.core.domain-glossary-and-invariants.md`
- `docs/core/spec.sportpulse.core.mvp-execution-scope.md`
- `docs/core/spec.sportpulse.core.non-functional-requirements.md`
- `docs/core/spec.sportpulse.core.repo-structure-and-module-boundaries.md`
- `docs/core/spec.sportpulse.shared.errors-and-warnings-taxonomy.md`
- `docs/core/spec.sportpulse.qa.acceptance-test-matrix.md`
- `docs/core/spec.sportpulse.qa.golden-snapshot-fixtures.md`
- `docs/core/spec.sportpulse.qa.prediction-track-record-fixtures.md`

#### Attention dashboard pipeline
- `docs/specs/pipeline/spec.sportpulse.signals.core.md`
- `docs/specs/pipeline/spec.sportpulse.signals.metrics.md`
- `docs/specs/pipeline/spec.sportpulse.scoring.policy.md`
- `docs/specs/pipeline/spec.sportpulse.snapshot.engine.md`
- `docs/specs/pipeline/spec.sportpulse.snapshot.dashboard-dto.md`
- `docs/specs/layout/spec.sportpulse.layout.treemap-algorithm.md`
- `docs/specs/layout/spec.sportpulse.layout.stability.md`
- `docs/specs/api/spec.sportpulse.api.contract.md`

#### Prediction engine
- `docs/specs/prediction/spec.sportpulse.prediction.engine.md`
- `docs/specs/prediction/spec.sportpulse.prediction.conformance-test-plan.md`

#### Frontend and portal
- `docs/architecture/spec.sportpulse.web.frontend-architecture.md`
- `docs/specs/portal/spec.sportpulse.web.ui.md`
- `docs/specs/portal/spec.sportpulse.portal.interaction.md`

#### Architecture and data
- `docs/architecture/spec.sportpulse.web.component-map.md`
- `docs/architecture/spec.sportpulse.server.backend-architecture.md`
- `docs/data/spec.sportpulse.data.normalization.md`
- `docs/data/spec.sportpulse.data.event-lifecycle.md`
- `docs/data/spec.sportpulse.data.quality.md`
- `docs/evolution/spec.sportpulse.product.feature-evolution.md`
- `docs/evolution/spec.sportpulse.product.product-loop.md`

#### Frontend reengineering delta package (binding for current integration work until absorbed into canonical API/backend architecture specs)
- `docs/backend/spec.sportpulse.backend.frontend-integration-delta.md`
- `docs/backend/spec.sportpulse.backend.session-auth-contract.md`
- `docs/backend/spec.sportpulse.backend.shared-return-context-contract.md`
- `docs/backend/spec.sportpulse.backend.subscription-checkout-contract.md`
- `docs/backend/spec.sportpulse.backend.track-record-contract.md`

#### Strategic reference (non-binding for implementation details)
- `docs/product/report.sportpulse.product.business-plan.2026-03-01.md`

### 5.3 Conflict resolution rule

If this constitution and a lower-level document appear to conflict:

1. this constitution wins on principle and boundary
2. the more specific corrected spec wins on implementation details
3. legacy or archived drafts never override corrected active specs

### 5.4 Archive rule

Legacy drafts may be retained for historical context but must live in an **archive** area and be marked:

- obsolete
- non-authoritative
- superseded by corrected files

No legacy draft may remain mixed into an authoritative implementation bundle.

---

## 6. Domain model and core entities

### 6.1 Primary entities

The constitutional entity types are:

- `TEAM`
- `MATCH`

### 6.2 MVP rendering entity

For the MVP dashboard treemap, the primary rendered/sized entity is:

- `TEAM`

`MATCH` remains a canonical entity in the domain model but is not the primary treemap sizing entity in MVP v1.

### 6.3 Canonical identity

All entities used by the product must have stable internal canonical ids.

Provider-native ids may exist internally during ingestion but must not be exposed as the primary product contract.

---

## 7. Canonical data model and normalization

### 7.1 Canonicalization requirement

All incoming provider data must be normalized into a canonical domain representation before:

- signal computation
- snapshot construction
- frontend exposure

### 7.2 Normalization responsibilities

Canonical normalization must address at least:

- entity identity mapping
- team and match naming normalization
- timestamp normalization
- timezone handling
- competition/season identity
- event status mapping
- score/result mapping
- missing/null handling
- provider anomaly containment

### 7.3 No raw provider truth in frontend

The frontend must not perform business logic against provider-specific raw fields.

If the frontend needs something, it must be represented in canonical DTOs.

---

## 8. Event lifecycle

### 8.1 Lifecycle as product truth

Events must move through explicit canonical lifecycle states.

The product must not infer event truth ad hoc in the frontend.

### 8.2 Lifecycle responsibilities

The event lifecycle model must determine:

- which matches count as finished
- which matches qualify as upcoming
- what is treated as postponed/cancelled
- what triggers signal invalidation or recomputation
- what affects snapshot staleness or partiality
- when agenda-related values are missing vs valid

### 8.3 Lifecycle impact on scoring

Signals such as next match proximity depend on canonical lifecycle truth.  
Lifecycle ambiguity must be surfaced through quality/warning mechanisms, not hidden.

---

## 9. Data quality and warning model

### 9.1 Quality is first-class

Data quality is not a logging concern only.  
It is part of the product contract.

### 9.2 The system must model

- freshness
- completeness
- consistency
- missing derivations
- partial snapshots
- provider outages
- stale snapshot serving

### 9.3 Warning philosophy

Warnings inform rendering and operations without corrupting score semantics.

Warnings may include conditions such as:

- stale data
- provider error
- partial data
- missing signal
- layout degraded
- layout shift

Warnings must be explicit, structured, and stable.

### 9.4 No silent fabrication

If data is missing:

- do not invent fake values
- mark missing explicitly
- degrade predictably
- preserve payload validity

---

## 10. Snapshot model

### 10.1 Snapshot as the primary product artifact

A dashboard snapshot is the core user-facing artifact.

It is a materialized, versioned, deterministic representation of:

- canonical entities
- signals
- scores
- layout
- warnings
- metadata

### 10.2 Snapshot identity

A snapshot is constitutionally anchored by:

- `competitionId`
- `seasonId`
- `buildNowUtc`
- `policyKey`
- `policyVersion`

Additional metadata may exist, but the identity semantics must remain explicit and stable.

### 10.3 Logical build time

Time-relative dashboard behavior must use an explicit logical time:

- `buildNowUtc`

`computedAtUtc` is execution metadata only.  
It is not the semantic time basis.

### 10.4 Snapshot immutability in meaning

Once materialized, a snapshot must remain interpretable according to the versions that created it.

Reinterpreting old snapshots under new scoring or layout behavior is constitutionally disallowed.

---

## 11. Signal, metric, and score model

### 11.1 Separation of layers

The scoring pipeline must keep layers distinct:

1. canonical source data
2. derived signals / metrics
3. attention scoring
4. display score mapping
5. layout weight
6. geometry generation

No layer should collapse into another without explicit specification.

### 11.2 Explainable scoring

Scoring must remain explainable through returned contributions and signal-level semantics.

### 11.3 MVP simplicity rule

The MVP must prefer a narrow, defensible scoring model over a large, noisy one.

Complexity must be earned by product evidence, not by speculation.

### 11.4 Legacy score constructs explicitly rejected

The following legacy constructs are **not constitutional** for the current MVP line:

- `SIZE_SCORE` as canonical active metric
- `PROXIMITY_BONUS` as weighted MVP scoring input
- `HOT_MATCH_SCORE` as active MVP scoring primitive
- `scoreVersion` as vague generic score identity
- any UI-owned formula that recomputes semantic importance

If any similar behavior is introduced in the future, it must be versioned explicitly and documented as a new active model.

---

## 12. Scoring policy governance

### 12.1 Policy identity

Scoring behavior must be identified through:

- `policyKey`
- `policyVersion`

### 12.2 Policy immutability

Any material change to scoring behavior requires a new policy version.

This includes changes to:

- signal participation
- normalization behavior
- weights
- transforms
- display score mapping
- layout weight mapping

### 12.3 MVP policy posture

The MVP policy must remain simple, auditable, and testable.

No hidden heuristics or post-hoc frontend adjustments are allowed.

---

## 13. Layout and treemap governance

### 13.1 Layout is product truth

Layout is not a cosmetic afterthought.  
In SportPulse, tile geometry is part of the user-facing product artifact and must therefore be versioned and deterministic.

### 13.2 Backend-owned geometry

Treemap geometry must be produced server-side and transported in the dashboard snapshot.

The frontend renders returned geometry.  
It does not solve treemap layout in MVP v1.

### 13.3 Layout identity

Layout behavior must be identified through:

- `layout.algorithmKey`
- `layout.algorithmVersion`

### 13.4 Layout inputs

Geometry must depend on:

- canonical ordered entities
- `layoutWeight`
- container dimensions
- padding/gutter semantics
- algorithm version
- rounding rules

### 13.5 Layout stability philosophy

The product values visual stability, but not at the cost of hidden heuristics that override product truth.

For MVP v1, stability comes from:

- deterministic ordering
- deterministic geometry generation
- deterministic visual identity
- controlled animation
- diagnostics for layout movement

### 13.6 Explicitly rejected layout legacy

The following are rejected in MVP v1 unless reintroduced in a future layout version:

- hash-based hidden ordering tie-breakers
- favorites anchoring
- cluster anchoring
- inertia correction that overrides canonical order
- weight smoothing for aesthetic persistence
- frontend-owned layout correction

---

## 14. Frontend constitution

### 14.1 Frontend role

The frontend is a deterministic presentation and interaction layer over snapshots.

### 14.2 Frontend may do

- render returned geometry
- animate transitions between snapshots
- expose explainability already present in payloads
- manage route/share state
- switch themes
- show warnings and degraded states

### 14.3 Frontend may not do

- derive signals
- compute scores
- compute layout weights
- solve treemap geometry
- inject urgency bonuses
- reinterpret provider data directly
- fabricate semantic meaning absent from the snapshot

### 14.4 URL state

Shareable UI state should live in the URL where appropriate, but URL state must not substitute for snapshot identity semantics.

---

## 15. Internal UI API constitution

### 15.1 Snapshot-first API

Frontend-facing APIs must expose materialized or derived projections of snapshots.

The API request path must not recompute the domain model from scratch or call external providers directly.

### 15.2 API stability

The frontend contract must remain canonical, internal, and provider-agnostic.

### 15.3 Projection rule

Entity detail views should be projections of dashboard snapshots or of closely related canonical snapshot artifacts, not separate provider-specific ad hoc constructs.

---

## 16. Design system and interaction boundaries

### 16.1 Design system is constrained by truth

Themes, labels, badges, motion, and density may vary within design rules, but they must not alter semantic product truth.

### 16.2 Badges are informational

Badges may communicate relevance, freshness, postponement, or proximity, but must not serve as hidden scoring inputs unless explicitly returned by backend as such.

### 16.3 Motion is presentational

Animation may smooth perception of change, but it must not mutate ordering, geometry, or score semantics.

---

## 17. Implementation governance

### 17.1 No undocumented behavior

If a team wants to add a meaningful new behavior, that behavior must first exist in documentation at the appropriate layer.

### 17.2 No cross-layer leakage

A lower layer must not offload unresolved semantics upward.

Examples of forbidden leakage:

- backend expecting frontend to compute size/urgency
- provider status values leaking into UI conditions
- layout solver assumptions living only in the browser
- undocumented version bumps

### 17.3 No duplicate competing truth

Two active documents may not define contradictory versions of the same contract.

If a corrected spec exists, older contradictory material must be archived or removed from the active bundle.

---

## 18. Change control and versioning rules

### 18.1 New policy version required when

A new `policyVersion` is required when any scoring semantics change materially, including:

- which signals are used
- how they are normalized
- how they are weighted
- how attention score maps to display score
- how display score maps to layout weight

### 18.2 New layout algorithm version required when

A new `layoutAlgorithmVersion` is required when any geometry semantics change materially, including:

- packing algorithm
- row construction logic
- rounding/residual distribution
- gutter semantics
- fallback layout behavior
- stability heuristics

### 18.3 New snapshot schema version required when

A new `snapshotSchemaVersion` is required when the snapshot payload shape changes materially.

### 18.4 New constitution version required when

This constitution version changes only when project-wide principles, scope boundaries, or documentary authority materially change.

---

## 19. Documentation governance

### 19.1 Document classes

SportPulse documents belong to three classes:

#### Rector
Defines principles, boundaries, and hierarchy.
- Constitution

#### Active canonical
Defines implementable contracts.
- corrected specs

#### Archive
Historical or superseded material.
- legacy drafts
- obsolete bundles
- rejected alternative models

### 19.2 Naming discipline

Corrected authoritative documents should use stable, explicit names and should not coexist ambiguously with contradictory predecessors in the same active folder.

### 19.3 Bundle discipline

If a “master bundle” is produced, it must contain only:

- the constitution
- active canonical specs
- clearly marked active supporting docs

It must not silently mix legacy drafts with authoritative content.

---

## 20. Product loop and evolution

### 20.1 Evidence-driven evolution

Future product complexity must be introduced based on observed usefulness, not speculative architectural appetite.

### 20.2 Evolution path is allowed, not preloaded

The system should remain extensible for:

- richer signals
- match-level products
- personalization
- multi-competition views
- advanced layout strategies
- richer warning/diagnostic loops

But those futures must not be smuggled into MVP contracts prematurely.

### 20.3 Product-loop responsibility

The product loop should measure whether users understand and trust the dashboard, not merely whether tiles moved or endpoints responded.

---

## 21. Quality gates

### 21.1 A build is not acceptable if

- scoring semantics are split across backend and frontend
- layout is recomputed in the client in contradiction to active specs
- snapshot identity is ambiguous
- warnings are silently dropped
- provider-specific semantics leak to the frontend
- legacy formulas are reintroduced informally
- changes are applied without versioning where required

### 21.2 A release is acceptable when

- active corrected specs are internally coherent
- the implementation matches active corrected specs
- snapshots are reproducible
- scoring is explainable
- layout is deterministic
- degraded states are visible
- documentation hierarchy is unambiguous

---

## 22. Explicit prohibitions

The following are constitutionally prohibited in the current MVP line unless reintroduced through explicit future versioned design:

- frontend-owned score computation
- frontend-owned treemap solving
- `size_score = form_points + proximity_bonus` style UI formulas
- hash-based hidden tile ordering
- provider schema leakage into frontend contract
- favorite bonuses that alter scoring/layout truth
- anchoring/inertia hacks that override canonical ordering without versioned layout semantics
- silent policy mutation
- mixed active and obsolete docs in the same authoritative bundle

---

## 23. Practical reading order

For any new engineer, designer, or reviewer, the reading order should be:

1. this constitution
2. component map
3. backend architecture
4. data normalization
5. event lifecycle
6. data quality
7. signals spec
8. metrics spec
9. scoring policy spec
10. snapshot engine spec
11. snapshot DTO
12. frontend architecture
13. API contract
14. treemap algorithm
15. layout stability
16. UI spec
17. interaction spec
18. feature evolution / product loop

---

## 24. Final constitutional stance

SportPulse must remain:

- deterministic
- explainable
- snapshot-first
- provider-isolated
- versioned
- frontend-honest
- visually stable through explicit contracts, not hidden heuristics

The product's competitive moat — the only asset that cannot be fabricated retroactively — is its **verifiable track record**: timestamped predictions, auditable methodology, public accuracy history. This moat is constitutional. It must be protected with the same discipline as scoring determinism.

The product is allowed to grow in sophistication, but every increase in sophistication must preserve these constitutional traits or explicitly version beyond them.

---

## 25. Appendix — One-paragraph operational summary

SportPulse is a snapshot-first football analytics platform with two co-equal product pillars: an attention dashboard that ingests provider data, normalizes it into canonical entities, computes deterministic signals and scores using versioned policies, generates treemap geometry server-side, and exposes the result through internal APIs for a frontend that renders and explains without recalculating semantic truth; and a match prediction engine that computes Elo-based calibrated outcome probabilities, builds a verifiable public track record, and exposes depth analytics behind a freemium Pro paywall. Both pillars share the same constitutional principles: backend ownership of semantics, provider isolation, determinism, explainability, and versioned evolution. The constitution governs these boundaries; the corrected specs implement them.
