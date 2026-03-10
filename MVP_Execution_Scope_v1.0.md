# SportPulse — MVP Execution Scope

Version: 1.1
Status: Authoritative execution scope for MVP delivery — amended to include Predictive Engine (v1.1)  
Scope: Executable MVP boundaries, deliverables, exclusions, workflows, and acceptance scope for AI-assisted and human development  
Audience: Product, Backend, Frontend, QA, Ops, AI-assisted development workflows

---

## 1. Purpose

This document defines the **executable scope** of the SportPulse MVP.

It exists to answer, without ambiguity:

- what must be built now
- what must not be built now
- what user-facing capabilities are in scope
- what backend capabilities are mandatory
- what supporting infrastructure is required for the MVP to be considered real
- what is explicitly deferred
- what constitutes MVP completion

This document is not a strategy note and not a constitutional document.  
It is the **operational boundary** for implementation.

---

## 2. Authority

This document is authoritative for:

- MVP feature inclusion/exclusion
- execution boundaries
- required implementation surfaces
- release readiness scope
- AI-assisted development limits

If a lower-level implementation proposal introduces scope outside this document without explicit approval, the proposal is out of scope by default.

---

## 3. MVP product statement

The MVP is a **football-only, single-competition, snapshot-first dashboard** that helps a user understand:

- which teams deserve attention right now
- why those teams are prominent
- what upcoming match context is relevant

The MVP is delivered through a treemap-based dashboard with explainable detail.

---

## 4. MVP goals

The MVP must prove, in product terms, that SportPulse can deliver:

1. **competition-wide attention prioritization**
2. **fast user orientation**
3. **explainable prominence**
4. **coherent snapshot rendering**
5. **stable enough visual behavior to be trusted**

The MVP does not need to prove advanced monetization, personalization, or predictive sophistication.

---

## 5. In-scope user-facing capabilities

## 5.1 Dashboard page

The MVP must provide a dashboard page for a single football competition and date context.

The dashboard must show:

- a treemap of teams
- tile sizing/position based on backend-produced geometry
- enough metadata to understand snapshot context
- warning state when data is stale/partial/degraded

### Dashboard invariants
- The dashboard is driven by `DashboardSnapshotDTO`.
- The frontend does not compute scoring or layout.
- The dashboard represents one coherent snapshot at a time.

---

## 5.2 Team detail / drill-down

The MVP must allow the user to inspect a selected team.

The team detail must expose, at minimum:

- team identity
- score outputs
- next match context (if available)
- explainability data:
  - top contributions
  - optionally signal-level details

### Team detail invariants
- Detail view is a projection of snapshot truth.
- Detail view does not trigger ad hoc semantic recomputation.
- Detail view does not introduce separate scoring semantics.

---

## 5.3 Explainability surface

The MVP must expose enough information for a user or tester to understand why a team is prominent.

Minimum explainability requirement:

- show top contributions
- show signal meaning in stable wording
- allow inspection of “why this team is large/prominent”

### Explainability invariants
- Explainability comes from backend-returned data.
- The UI must not invent explanations.

---

## 5.4 Warning visibility

The MVP must visibly represent degraded truth conditions when relevant.

Minimum warning categories in scope:
- stale data
- partial data
- provider error fallback
- layout degraded
- layout shift (if diagnostics included)

### Warning invariants
- Warning visibility is part of MVP scope.
- Warning support is not optional polish.
- The frontend must remain usable under degraded states.

---

## 5.5 Basic navigation state

The MVP must support minimal shareable navigation state.

In scope:
- mode state if applicable
- focused team state
- date/competition context via route or query params

### Navigation invariants
- Navigation state must not replace snapshot identity semantics.
- UI state restoration must not recompute backend truth.

---

## 6. In-scope backend capabilities

## 6.1 Provider ingestion

The backend must ingest data from the chosen MVP provider.

The provider is part of the implementation scope because the MVP is not real without live-ish source input.

### Invariants
- Provider integration is backend-only.
- Provider schemas are normalized before reaching scoring or frontend layers.

---

## 6.2 Canonical normalization

The backend must normalize provider data into canonical entities and statuses.

This includes at minimum:
- competitions
- seasons
- teams
- matches
- timestamps
- lifecycle statuses

This is not optional.  
Without canonicalization, the MVP is structurally fake.

---

## 6.3 Snapshot engine

The backend must build materialized snapshots from canonical data.

The snapshot engine must:
- derive signals
- apply scoring policy
- generate layout weights
- generate treemap geometry
- emit warnings
- produce the root dashboard artifact

### Invariants
- Snapshot build is part of MVP scope.
- Ad hoc request-time semantic assembly is not an acceptable substitute.

---

## 6.4 Scoring policy execution

The backend must execute the active MVP scoring policy.

This includes:
- signal participation
- normalization
- weighting
- score mapping
- contribution extraction

### Invariants
- Policy execution is backend-owned.
- Policy identity must be explicit in output.

---

## 6.5 Treemap geometry generation

The backend must generate treemap geometry server-side.

This includes:
- canonical ordering
- layout algorithm application
- rounding rules
- residual handling
- geometry validation

### Invariants
- `rect` generation is required in MVP v1.
- Client-side treemap solving is out of scope and not an allowed fallback.

---

## 6.7 Predictive Engine

The backend must compute match outcome predictions using the Elo extended + Poisson independent model defined in `SportPulse_Predictive_Engine_Spec_v1.3_Final.md`.

Minimum required capabilities:
- Elo rating maintenance per rating pool (club / national team)
- Per-match lambda computation (lambda_home, lambda_away)
- raw_match_distribution (8×8 scoreline matrix) as first-class output
- Isotonic calibration (one-vs-rest) producing calibrated_1x2_probs
- ValidationResult with operating_mode (FULL_MODE / LIMITED_MODE / NOT_ELIGIBLE)
- PredictionResponse envelope with strict field separation (core / secondary / explainability / internals)
- Competition structure resolution (standings, groups, knockout brackets)

### Predictive Engine invariants
- raw_match_distribution must never be mixed with calibrated_1x2_probs in any output path
- KnockoutResolutionRules is an ordered array, never a flag set
- prior_rating hard conditions are enforced, not interpreted
- LIMITED_MODE always produces predictions.core; NOT_ELIGIBLE produces predictions=null
- Calibration is trained only on data before prediction cutoff (anti-leakage)

---

## 6.6 Internal UI API

The backend must expose the internal frontend-facing API needed for the dashboard and team detail.

Minimum required endpoints in scope:
- dashboard snapshot endpoint
- team detail projection endpoint

Agenda endpoint may be included if it materially improves clarity, but it is not mandatory if dashboard/detail already cover the agenda need.

---

## 7. In-scope frontend capabilities

## 7.1 Snapshot rendering

The frontend must render the dashboard from backend snapshot data only.

Required:
- tile rendering using returned `rect`
- team interaction
- detail display
- warning display
- stable thematic rendering

---

## 7.2 Treemap interaction

The frontend must support basic interaction with treemap tiles:

- hover/focus behavior as appropriate
- click/select behavior
- opening or updating detail context

### Invariants
- Interaction must not recompute semantics.
- Interaction must preserve deterministic product truth.

---

## 7.3 Responsive behavior

The MVP must remain usable on at least:
- desktop
- mobile or narrow layout

This does not require a fully separate mobile product, but the main surfaces must remain understandable and operable.

---

## 7.4 Transition behavior

The frontend may animate transitions between snapshots or state changes.

Animation is in scope only as presentation polish that supports comprehension.

### Invariants
- Motion must not alter semantic truth.
- Motion must not become a hidden layout engine.

---

## 8. Data and quality scope

## 8.1 Freshness and staleness handling

The MVP must explicitly model whether snapshot data is fresh, stale, or partial enough to warn about.

This is in scope because trust is part of the product value.

---

## 8.2 Missing data handling

The MVP must explicitly handle:
- missing next match
- insufficient finished matches for form
- provider gaps
- partial snapshots

The product must degrade predictably.

---

## 8.3 Warning taxonomy support

The MVP must implement the active error/warning taxonomy required by API and snapshot contracts.

Warnings are not a post-MVP nice-to-have.

---

## 9. Out-of-scope capabilities

The following are explicitly out of scope for MVP v1 unless separately approved:

### 9.1 Product scope exclusions
- multi-sport support
- multi-competition comparative dashboard
- personalized recommendation engine
- odds or betting guidance
- social features
- notification system
- saved dashboards
- user comments or curation
- advanced search/discovery
- public editor/admin tooling unless strictly required for ops

### 9.2 Scoring scope exclusions
- xG-based scoring
- injuries/transfers sentiment as active inputs
- bookmaker signals
- user-preference weighting
- favorites-based score boosts
- experimental composite hotness models outside active policy

### 9.3 Layout scope exclusions
- favorites anchoring
- cluster anchoring
- inertia correction
- previous-layout-aware reordering
- client-side layout fallback
- aesthetic weight smoothing

### 9.4 Platform scope exclusions
- native mobile apps
- public external API
- self-serve competition configuration UI
- multi-tenant enterprise controls

---

## 10. MVP user workflow scope

The MVP user journey in scope is:

1. User lands on dashboard for a competition/date context
2. User understands which teams are prominent
3. User selects a team
4. User inspects explanation and next-match context
5. User optionally returns to overview or switches context/date if supported

This is the primary workflow to optimize.

Secondary workflows are not the MVP center of gravity.

---

## 11. Required outputs / deliverables

For the MVP to be considered implemented, the project must produce:

### 11.1 Product artifacts
- working dashboard UI
- working team detail/drill-down
- visible degraded-state handling

### 11.2 Backend artifacts
- ingestion flow
- canonical normalization layer
- snapshot engine
- scoring policy implementation
- layout algorithm implementation
- UI API endpoints

### 11.3 Contract artifacts
- active canonical specs
- reproducible test fixtures
- acceptance test coverage
- documented warning/error behavior

### 11.4 Operational artifacts
- configuration model
- basic observability/logging
- build/rebuild visibility
- fallback behavior for failed snapshot build

---

## 12. Non-functional scope that is mandatory for MVP

The following are in scope even if they are not “features”:

- deterministic rebuild behavior
- explainability correctness
- stable payload contracts
- warnings visibility
- graceful degradation
- basic testability
- versioned scoring/layout/schema semantics

If these are absent, the MVP is not complete even if the UI appears to work.

---

## 13. Explicit execution boundaries for AI-assisted development

Any AI-assisted implementation workflow must obey:

- do not add new scoring signals beyond active MVP set
- do not move scoring/layout into frontend
- do not remove warnings for convenience
- do not bypass canonical normalization
- do not invent new entity semantics
- do not silently reinterpret lifecycle states
- do not widen MVP scope without documented approval
- do not revive legacy constructs (`SIZE_SCORE`, `PROXIMITY_BONUS`, `HOT_MATCH_SCORE`) as active behavior

This document exists partly to stop AI scope drift.

---

## 14. Release readiness criteria

The MVP is not release-ready unless all of the following are true:

### 14.1 Dashboard readiness
- dashboard renders from a valid snapshot
- dashboard remains usable under stale/partial states
- tile geometry is rendered from backend `rect`

### 14.2 Detail readiness
- detail projection works for selected team
- explainability is available and understandable
- next-match context appears when available

### 14.3 Backend readiness
- snapshots can be built reproducibly
- scoring and layout identities are explicit
- warnings are produced correctly
- fallback behavior works when fresh rebuild fails

### 14.4 QA readiness
- deterministic test cases exist
- degraded-state cases are covered
- fixture-based validation exists
- active specs and implementation are aligned

---

## 15. Non-readiness criteria

The MVP must be considered **not ready** if any of the following is true:

- frontend computes semantic score or layout
- no warning/degraded states are visible
- snapshot identity is ambiguous
- explainability is absent or fake
- provider data leaks directly into frontend truth
- layout is unstable due to undocumented heuristics
- major scope items are replaced by mocks or hand-waving
- MVP success depends on a manual explanation from the team rather than product clarity

---

## 16. What “done” means for MVP

The MVP is done when:

- the user can load a competition dashboard
- the user can see which teams are prominent
- the user can inspect why
- the user can inspect next-match context
- the product behaves coherently under missing/stale/partial conditions
- the implementation matches the active corrected specs
- the result is deterministic and explainable enough to support product validation

The MVP is not done merely because:
- screens exist
- data loads
- tiles render
- code compiles

---

## 17. Explicit boundaries between MVP and post-MVP

### 17.1 MVP must answer
- does attention prioritization feel valuable?
- is form + agenda enough to create usefulness?
- does explainability help trust?
- does treemap work as a comprehension surface?

### 17.2 Post-MVP may answer
- should we personalize?
- should we add match-level attention?
- should we add richer signals?
- should we support more competitions?
- should we add notification loops?
- should we optimize monetization?

Those are not MVP blockers.

---

## 18. One-paragraph summary

The SportPulse MVP execution scope is a football-only, single-competition, snapshot-first product that must ingest provider data, normalize it canonically, compute a small explainable scoring model, generate deterministic treemap geometry server-side, expose the result through internal UI APIs, and render a dashboard plus team detail experience that remains trustworthy under degraded data conditions. Anything beyond that is outside the executable MVP unless explicitly approved.
