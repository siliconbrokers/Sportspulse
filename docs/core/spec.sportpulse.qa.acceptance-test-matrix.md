---
artifact_id: SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
title: "Acceptance Test Matrix"
artifact_class: spec
status: active
version: 1.2.0
project: sportpulse
domain: qa
slug: acceptance-test-matrix
owner: team
created_at: 2026-03-15
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/core/spec.sportpulse.qa.acceptance-test-matrix.md
---
# SportPulse — Acceptance Test Matrix (MVP)

Version: 1.2
Status: Authoritative acceptance matrix for MVP validation
Scope: Executable acceptance criteria and test cases for deterministic, explainable, snapshot-first SportPulse MVP  
Audience: QA, Backend, Frontend, Ops, AI-assisted development workflows

---

## 1. Purpose

This document defines the **acceptance test matrix** for the SportPulse MVP.

It converts the product constitution and active specifications into:

- concrete test scenarios
- inputs and preconditions
- expected outputs and invariants
- warning/error expectations
- pass/fail gates

The goal is to prevent:
- “it works on my machine”
- “it looks right”
- silent semantic drift
- accidental reintroduction of legacy logic
- AI-generated implementations that compile but do not meet the contract

---

## 2. Authority

This matrix is authoritative for MVP acceptance.

A build is not considered MVP-complete unless this matrix can be satisfied with:
- automated tests (preferred)
- and/or documented manual verification (only where automation is impractical for MVP)

---

## 3. Test classes

The MVP acceptance suite is divided into:

1. **Domain and normalization tests**
2. **Signal computation tests**
3. **Scoring policy execution tests**
4. **Layout geometry tests**
5. **Snapshot assembly tests**
6. **API contract tests**
7. **Frontend rendering and interaction tests**
8. **Degraded-state and fallback tests**
9. **Determinism and regression tests**
10. **Security/boundary tests (MVP baseline)**

---

## 4. Conventions

### 4.1 Fixtures

Tests reference fixture sets by ID.

Fixture sets should live under:
- `tools/fixtures/golden/<fixtureId>/`

### 4.2 Canonical JSON

Where JSON comparisons occur:
- use canonical serialization rules
- compare either:
  - full canonical JSON (strict)
  - or semantic equality checks (where permitted)

### 4.3 Required identifiers

Where applicable, tests must assert:
- `policyKey` and `policyVersion`
- `buildNowUtc`
- `layout.algorithmKey` and `layout.algorithmVersion`
- `snapshotSchemaVersion`

---

## 5. Acceptance matrix

Each test case includes:

- **ID**
- **Name**
- **Type**
- **Inputs / Preconditions**
- **Steps**
- **Expected outputs**
- **Warnings/Errors**
- **Notes**

---

## A) Domain and canonical normalization

### A-01 — Canonical entity identity mapping

**Type:** Unit / Integration (canonical)  
**Inputs:** fixture `F_CANON_BASELINE` raw provider payloads  
**Steps:**
1. ingest provider payloads
2. normalize into canonical model

**Expected:**
- stable canonical ids exist for competition, season, teams, matches
- team identity does not depend on display name
- match ids stable across re-ingestion of same payload

**Warnings/Errors:** none (baseline)  
**Pass if:** canonical IDs match golden fixture mapping output.

---

### A-02 — Timestamp normalization correctness

**Type:** Unit (canonical/time)  
**Inputs:** fixture with multiple timestamps/timezones  
**Expected:**
- all canonical timestamps stored as UTC
- `dateLocal` interpretation requires timezone
- no UI-only timezone heuristics

**Warnings/Errors:** none  
**Pass if:** all normalized times match expected UTC values.

---

### A-03 — Lifecycle classification correctness

**Type:** Unit (canonical/lifecycle)  
**Inputs:** fixture containing scheduled, finished, postponed/cancelled examples  
**Expected:**
- lifecycle states map to canonical states deterministically
- finished matches are eligible for form; scheduled for upcoming
- postponed/cancelled are not treated as valid upcoming by default

**Warnings/Errors:** may emit `PARTIAL_DATA` if provider lacks fields in fixture variant  
**Pass if:** lifecycle states match expected mapping.

---

## B) Signal computation

### B-01 — FORM_POINTS_LAST_5 computation (normal)

**Type:** Unit (signals)  
**Inputs:** canonical team with >= 5 finished matches; `buildNowUtc` fixed  
**Steps:**
1. compute FORM_POINTS_LAST_5 signal for team

**Expected:**
- rawPoints computed from last 5 finished matches before buildNowUtc
- norm = rawPoints / (3*5)
- `matchesUsed=5`
- `quality.missing=false`

**Warnings/Errors:** none  
**Pass if:** signal equals golden expected value.

---

### B-02 — FORM_POINTS_LAST_5 computation (insufficient history)

**Type:** Unit (signals)  
**Inputs:** canonical team with 3 finished matches; `buildNowUtc` fixed  
**Expected:**
- `matchesUsed=3`
- norm = rawPoints/(3*3)
- signal still computed
- signal not missing
- warning `INSUFFICIENT_HISTORY` present at entity or snapshot-level policy (depending on design)

**Warnings:** `INSUFFICIENT_HISTORY` (INFO)  
**Pass if:** computation and warning match expected.

---

### B-03 — FORM_POINTS_LAST_5 computation (zero history)

**Type:** Unit (signals)  
**Inputs:** canonical team with 0 finished matches  
**Expected:**
- signal is missing: `quality.missing=true`
- value placeholder is 0
- warning `MISSING_SIGNAL` emitted (entity-scoped)

**Warnings:** `MISSING_SIGNAL` (INFO/WARN)  
**Pass if:** missingness is explicit and stable.

---

### B-04 — NEXT_MATCH_HOURS computation (normal)

**Type:** Unit (signals)  
**Inputs:** canonical team with next scheduled match; `buildNowUtc` fixed  
**Expected:**
- hours computed relative to buildNowUtc
- norm uses horizon (min=0, max=168 for MVP v1)
- `quality.missing=false`
- params include `nextMatchId`, `hours`, horizon

**Warnings/Errors:** none  
**Pass if:** values match golden expectations.

---

### B-05 — NEXT_MATCH_HOURS computation (no upcoming match)

**Type:** Unit (signals)  
**Inputs:** team with no scheduled match  
**Expected:**
- signal missing: `quality.missing=true`
- value placeholder 0
- warning `NO_UPCOMING_MATCH` (INFO) emitted
- warning `MISSING_SIGNAL` may also be emitted if required by policy

**Warnings:** `NO_UPCOMING_MATCH` (INFO), optionally `MISSING_SIGNAL`  
**Pass if:** missingness and warnings consistent with taxonomy.

---

### B-06 — buildNowUtc determinism anchor

**Type:** Unit (signals)  
**Inputs:** identical canonical data; two computations with different computedAtUtc but same buildNowUtc  
**Expected:**
- identical signal values across runs

**Warnings/Errors:** none  
**Pass if:** signal outputs identical.

---

## C) Scoring policy execution

### C-01 — Policy identity propagation

**Type:** Unit (scoring)  
**Inputs:** signals + policy config  
**Expected:**
- outputs include `policyKey`, `policyVersion`, `buildNowUtc`
- identity values match configured policy

**Pass if:** identity present and correct.

---

### C-02 — Weighted contribution correctness

**Type:** Unit (scoring)  
**Inputs:** known signal values for form + next match  
**Expected:**
- contribution = weight * normValue (per MVP v1)
- `topContributions` sorted by abs(contribution) desc, tie by signalKey asc

**Pass if:** computed contributions match expected ordering and numeric values.

---

### C-03 — DisplayScore and layoutWeight mapping (MVP v1)

**Type:** Unit (scoring)  
**Inputs:** rawScore  
**Expected:**
- for MVP v1, mapping is identity unless policy says otherwise
- `displayScore` and `layoutWeight` exist and are backend-produced

**Pass if:** mapping matches policy v1 expectations.

---

### C-04 — Legacy resistance (scoring)

**Type:** Static/Unit  
**Expected:**
- no active code paths use legacy constructs:
  - SIZE_SCORE
  - PROXIMITY_BONUS
  - HOT_MATCH_SCORE

**Pass if:** search/lint/test ensures absence in active modules.

---

## D) Layout geometry

### D-01 — Deterministic treemap output

**Type:** Unit (layout)  
**Inputs:** ordered list of team weights + fixed container config  
**Expected:**
- identical `rect` outputs across repeated runs

**Pass if:** canonical geometry equals golden fixture.

---

### D-02 — Bounds and non-overlap validation

**Type:** Unit (layout)  
**Inputs:** generated geometry  
**Expected:**
- all rects within container bounds (respect padding)
- rects do not overlap except shared boundaries/gutters
- no negative width/height

**Pass if:** validation passes.

---

### D-03 — Rounding/residual determinism

**Type:** Unit (layout)  
**Inputs:** weights producing fractional areas  
**Expected:**
- rounding rules produce stable integer px outputs
- residual distribution is deterministic in input order
- last-tile closure rule holds

**Pass if:** geometry matches golden expected.

---

### D-04 — All-zero layoutWeight fallback

**Type:** Unit (layout/snapshot)  
**Inputs:** N teams with layoutWeight=0  
**Expected:**
- layout uses equal synthetic weights for geometry generation
- warning `LAYOUT_DEGRADED` emitted (WARN)
- score values remain unchanged (still 0)

**Pass if:** geometry valid and warning present.

---

### D-05 — Layout metadata presence

**Type:** Contract (snapshot)  
**Expected:**
- snapshot includes `layout.algorithmKey`, `layout.algorithmVersion`, `layout.container`

**Pass if:** metadata present and correct.

---

## E) Snapshot assembly

### E-01 — Snapshot identity completeness

**Type:** Integration (snapshot)  
**Expected:**
- header contains competitionId, seasonId, buildNowUtc, timezone
- header contains policyKey, policyVersion
- snapshot contains snapshotSchemaVersion
- layout metadata exists
- warnings list exists (may be empty)

**Pass if:** all required identity fields exist.

---

### E-02 — Deterministic team ordering

**Type:** Integration (snapshot)  
**Expected:**
- teams sorted by layoutWeight desc, teamId asc
- ordering stable across runs under same inputs

**Pass if:** ordering matches expected.

---

### E-03 — Snapshot contains rect for every rendered team tile

**Type:** Contract (snapshot)  
**Expected:**
- each team tile has `rect`
- rect values are numbers, not null
- rect respects container

**Pass if:** all tiles have rect.

---

### E-04 — Explainability presence and correctness

**Type:** Integration (snapshot/scoring)  
**Expected:**
- topContributions exists for each tile
- topContributions corresponds to policy execution
- optional signals are present only when requested or configured

**Pass if:** explainability matches expected.

---

## F) API contract

### F-01 — GET /dashboard contract

**Type:** Contract (api)  
**Inputs:** valid competitionId + dateLocal + timezone  
**Expected:**
- 200 response
- payload matches DashboardSnapshotDTO schema
- includes header/layout/warnings/teams with rect

**Pass if:** schema validation passes and basic invariants hold.

---

### F-02 — GET /team projection contract

**Type:** Contract (api)  
**Inputs:** competitionId + teamId + dateLocal  
**Expected:**
- 200 response
- payload is projection of dashboard snapshot
- includes same policy identity + buildNowUtc as the dashboard snapshot
- does not recompute provider data on request path

**Pass if:** projection matches snapshot-derived truth.

---

### F-03 — Invalid params error envelope

**Type:** Contract (api)  
**Inputs:** malformed dateLocal  
**Expected:**
- 400
- error envelope with code BAD_REQUEST

**Pass if:** envelope matches taxonomy.

---

### F-04 — Snapshot build failure with no fallback

**Type:** Integration (api/snapshot)  
**Inputs:** force snapshot build fail and no cached snapshot  
**Expected:**
- 503 with code SNAPSHOT_BUILD_FAILED

**Pass if:** correct error code and envelope.

---

## G) Degraded states and fallback

### G-01 — Provider outage fallback

**Type:** Integration (snapshot/api)  
**Preconditions:** cached snapshot exists  
**Inputs:** provider fetch fails for rebuild  
**Expected:**
- snapshot served from cache
- warnings include PROVIDER_ERROR (ERROR) and STALE_DATA (WARN)
- payload remains valid

**Pass if:** valid response + warnings correct.

---

### G-02 — Partial provider data snapshot

**Type:** Integration (snapshot)  
**Inputs:** fixture with missing provider fields but still renderable  
**Expected:**
- snapshot built
- PARTIAL_DATA warning present (WARN)
- missing signals flagged explicitly where relevant

**Pass if:** snapshot valid and warnings correct.

---

## H) Frontend rendering and behavior

### H-01 — Renders using rect (no treemap solving)

**Type:** UI integration  
**Inputs:** dashboard snapshot payload  
**Expected:**
- UI renders tiles using returned rect coordinates
- UI does not run treemap solver
- UI does not recompute weights

**Pass if:** instrumentation or code inspection confirms no client-side layout.

---

### H-02 — Detail view uses snapshot/projection only

**Type:** UI integration  
**Expected:**
- selecting a team shows detail based on snapshot/projection
- explanation uses returned contributions/signals
- UI does not invent reasons

**Pass if:** UI behavior matches contract.

---

### H-03 — Warning display

**Type:** UI integration  
**Inputs:** snapshot with warnings  
**Expected:**
- warning indicators appear in header and/or relevant surfaces
- warnings do not break UI
- severity influences presentation appropriately

**Pass if:** warnings visible and stable.

---

## I) Determinism and regression

### I-01 — Golden snapshot end-to-end

**Type:** End-to-end fixture  
**Inputs:** golden fixture set `F_GOLDEN_BASELINE`  
**Expected:**
- dashboard snapshot equals golden expected output (canonical JSON or semantic equivalent)
- differences are treated as regression unless explicitly versioned

**Pass if:** diff is empty (or matches allowed deltas).

---

### I-02 — Policy version bump detection

**Type:** Regression guard  
**Expected:**
- any change in scoring semantics requires explicit policyVersion bump
- tests fail if scoring changed without policy version bump

**Pass if:** version discipline enforced.

---

### I-03 — Layout version bump detection

**Type:** Regression guard  
**Expected:**
- any change in geometry semantics requires layoutAlgorithmVersion bump
- tests fail if geometry changed without bump

**Pass if:** version discipline enforced.

---

### I-04 — Schema version bump detection

**Type:** Regression guard  
**Expected:**
- payload shape change requires snapshotSchemaVersion bump

**Pass if:** schema discipline enforced.

---

## J) Security and boundary baseline

### J-01 — Provider isolation

**Type:** Static/Integration  
**Expected:**
- frontend does not call provider
- provider secrets not exposed to web bundle
- api does not call provider on request path

**Pass if:** boundary checks hold.

---

### J-02 — No raw provider payload leakage

**Type:** Contract  
**Expected:**
- API responses contain canonical DTOs only, not provider raw blobs

**Pass if:** no provider payloads in response.

---

## 6. Minimum acceptance set (must-pass for MVP)

The MVP cannot be considered complete unless these tests pass:

- A-01, A-03
- B-01, B-04, B-05
- C-01, C-02, C-04
- D-01, D-02, D-04, D-05
- E-01, E-02, E-03
- F-01, F-02, F-03, F-04
- G-01, G-02
- H-01, H-02, H-03
- I-01
- J-01, J-02
- K-01, K-02, K-03, K-04, K-05, K-06, K-07, K-08

---

---

## K — Prediction surface + Track record

These tests cover the prediction UX surface, track record integrity, and freemium gating introduced in MVP Execution Scope v2.0 §5.6–5.7 and Implementation Backlog v2.0 Phase 10–11.

### K-01 — Prediction display for FULL_MODE match
**Precondition:** match with `operatingMode = FULL_MODE`, `calibrated_1x2_probs` populated.
**Expected:** DetailPanel shows home / draw / away calibrated probabilities and an operating mode indicator.
**Must not:** display raw scoreline distribution to free-tier users.
**Pass gate:** probabilities sum within floating-point tolerance of 1.0; no raw distribution fields exposed to free user.

### K-02 — NOT_ELIGIBLE graceful state
**Precondition:** match with `operatingMode = NOT_ELIGIBLE`.
**Expected:** DetailPanel shows "Predicción no disponible" (or equivalent) indicator.
**Must not:** show any probability value (including zeros); must not show an empty numeric field.
**Pass gate:** prediction block renders with explicit unavailability message; no numeric probability values in DOM.

### K-03 — Track record aggregate correctness
**Precondition:** ≥200 evaluated predictions with `operatingMode = FULL_MODE` and known outcomes for the queried competition (per Business Plan v3.0 §11.2 credibility threshold). Below this threshold the endpoint must return `{ accuracy: null, predictionCount: N, lastEvaluatedAt, belowThreshold: true }` — it must not show a numeric accuracy figure.
**Expected:** at ≥200, `GET /api/ui/track-record?competitionId=X` returns `{ accuracy, predictionCount, lastEvaluatedAt, belowThreshold: false }`.
**Invariant:** only pre-kickoff predictions included; accuracy independently verifiable from raw data; `belowThreshold: true` suppresses numeric display.
**Pass gate:** accuracy value matches manual computation from the same prediction corpus; below-threshold response hides accuracy and shows appropriate message; no fabricated accuracy surfaced before the 200-prediction gate.

### K-04 — Pro depth paywall gate
**Precondition (free tier):** authenticated user without Pro subscription.
**Expected:** scoreline distribution, xG, O/U, BTTS fields not visible; paywall CTA visible.
**Precondition (Pro tier):** authenticated user with active Pro subscription.
**Expected:** all depth fields visible; no paywall block.
**Invariant:** backend returns full payload in both cases; gating is presentation-only.
**Pass gate:** free user DOM contains no depth field values; Pro user DOM contains all depth fields.

### K-05 — Pro subscription flow
**Precondition:** user completes Stripe Pro subscription checkout.
**Expected:** Pro flag propagates to frontend within same session; depth predictions visible without paywall block.
**Pass gate:** subscription status reflected in session; no paywall after confirmed payment.

### K-06 — Registration deferral
**Precondition:** new anonymous user arrives on dashboard.
**Expected:** no registration prompt on first visit.
**Expected:** registration prompt appears only when user attempts a Pro-gated action or explicit save/bookmark.
**Pass gate:** first 5 interactions produce no registration modal; Pro-gated action triggers registration prompt.

### K-07 — Pro commercial ad suppression
**Precondition (free tier):** at least one active commercial display ad slot is configured for the tested surface.
**Expected:** the configured commercial display ad slot must render for anonymous or authenticated free users.
**Precondition (Pro tier):** authenticated user with active Pro subscription on the same tested surface.
**Expected:** configured commercial display ad slot must not render.
**Invariant:** the system must preserve semantic distinction between commercial ads, operational notices, degraded-state warnings, mandatory legal/compliance notices, and product-owned informational notices.
**Must not:** suppress operational notices for Pro; suppress system warnings for Pro; leave broken placeholder chrome where a Pro-suppressed ad would have rendered; reclassify an ad as an "announcement" to evade suppression.
**Pass gate:** free/anonymous DOM contains configured commercial ad slot output; Pro DOM contains no commercial ad output; operational/system notices remain visible when active; layout remains structurally intact after ad suppression.

### K-08 — Level B style-propagation readiness
**Precondition:** Level A critical-surface style safety has already been reached; the active product surface inventory for the current release is explicitly listed; at least two approved theme states are available for verification; any temporary exceptions are documented.
**Expected:** all active release surfaces render without broken contrast, missing semantic tokens, unreadable focus states, or theme-dependent layout breakage in both approved theme states.
**Surface minimum:** dashboard shell; competition selector; prediction card/detail surface; track record surface; Pro/paywall surface; auth shell action and callback/return states; global notices/announcements.
**Must not:** claim Level B readiness on a partial surface sample; hide broken states behind ad hoc per-route overrides; require manual post-render patching for one theme only.
**Pass gate:** the declared active-surface inventory passes the approved Level B verification suite across both theme states, with documented exceptions equal to zero or explicitly waived before release.

---

## 7. Notes on automation

Automation priority:
1. unit tests for signals/scoring/layout
2. snapshot contract tests
3. API contract tests
4. golden fixture tests
5. basic UI integration tests

Manual verification is acceptable only for:
- subjective UI legibility checks
- interactive behavior nuances

But semantic correctness must be automated.

---

## 8. One-paragraph summary

This acceptance matrix defines the concrete pass/fail conditions for SportPulse across canonical normalization, signal computation, scoring policy execution, deterministic treemap geometry, snapshot assembly, UI API contracts, degraded-state handling, frontend rendering, regression/version discipline (A–J), and the prediction, trust, freemium, and style-readiness surface family (K). The product is considered real only when deterministic, explainable, snapshot-first behavior is verified under both normal and degraded conditions, prediction probabilities are correctly gated by operating mode and subscription tier, track record data is accurate and cherry-pick-proof, commercial suppression for Pro behaves without mutating operational truth, Level B style propagation is honestly verified, and golden fixtures prevent silent semantic drift.
