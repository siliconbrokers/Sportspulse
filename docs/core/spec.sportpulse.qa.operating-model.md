---
artifact_id: SPEC-SPORTPULSE-QA-OPERATING-MODEL
title: "QA Operating Model"
artifact_class: spec
status: proposed
version: 1.1.0
project: sportpulse
domain: qa
slug: operating-model
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-CORE-CONSTITUTION
  - SPEC-SPORTPULSE-CORE-AI-SDD-OPERATING-PROTOCOL
  - SPEC-SPORTPULSE-CORE-SUBAGENTS-DEFINITION
  - SPEC-SPORTPULSE-QA-PRE-MERGE-VERIFICATION-GATE
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
  - SPEC-SPORTPULSE-QA-GOLDEN-SNAPSHOT-FIXTURES
  - SPEC-SPORTPULSE-QA-PREDICTION-TRACK-RECORD-FIXTURES
  - SPEC-SPORTPULSE-OPS-OPERATIONAL-BASELINE
canonical_path: docs/core/spec.sportpulse.qa.operating-model.md
---
# SportPulse — QA Operating Model

Version: 1.0
Status: Proposed
Scope: Canonical QA operating model for non-trivial changes in SportPulse
Audience: Engineering, QA, Ops, AI agent orchestration, release authority

---

## 1. Purpose

This specification defines the canonical QA operating model for SportPulse.

Its purpose is to prevent false-green delivery by enforcing that non-trivial changes are not considered acceptable merely because:
- code compiles
- CI is green
- the implementer claims the feature works
- a fixture was updated to match new output
- a flow appears to work in one superficial manual check

QA in SportPulse exists to verify all of the following:
- conformance to governing specs
- satisfaction of acceptance criteria
- preservation of fixture truth
- containment of regressions
- release-readiness evidence for deploy-bound work

This specification rejects:
- self-certification as sufficient proof
- "works locally" as sufficient proof
- CI green as sufficient semantic proof
- production promotion based only on merge success

---

## 2. Relation to existing doctrine

This spec is subordinate to the Constitution and must be interpreted consistently with the active authoritative corpus.

This spec does not create new product truth.
It operationalizes existing truth.

This spec must be read together with:
- Constitution
- Domain Glossary and Invariants
- MVP Execution Scope
- AI SDD Operating Protocol
- Pre-Merge Verification Gate
- Acceptance Test Matrix
- Golden Snapshot Fixtures
- Prediction Track Record Fixtures
- Errors and Warnings Taxonomy
- Operational Baseline
- Sub-Agents Definition

If this spec appears to conflict with a higher-precedence governing document, the higher-precedence document wins.

This spec must not be used to weaken:
- version discipline
- fixture discipline
- prediction anti-lookahead discipline
- frontend/backend semantic boundaries
- taxonomy stability
- release readiness gates

---

## 3. Core principles

### 3.1 Evidence over assertion

A change is not verified because someone says it is verified.
A change is verified only when evidence satisfies the required QA lanes.

### 3.2 No self-certification for non-trivial work

The implementer may describe:
- what changed
- what they tested
- what they believe is complete

The implementer is not the final authority declaring the work correct.

### 3.3 Acceptance matrix is authoritative

For non-trivial work, acceptance is determined by the active Acceptance Test Matrix and its corresponding evidence, not by implementer interpretation.

### 3.4 Fixture truth is binding

Golden fixtures are truth locks.
Fixture failure is treated as regression until classified otherwise.

### 3.5 Snapshot and prediction pipelines are distinct

The snapshot/attention dashboard pipeline and the prediction pipeline are separate product pillars with distinct fixture families, invariants, and version implications.

They must never be conflated operationally.

### 3.6 Regression protection is mandatory

A change is not acceptable merely because the new path works.
Adjacent or previously working behavior must also remain correct.

### 3.7 Release readiness is not implied by merge readiness

Passing merge gates does not prove production readiness.
Deploy-bound changes require operational validation in staging.

---

## 4. Scope of application

This QA operating model applies to all non-trivial changes.

A change is non-trivial if it meets at least one of the following conditions:
- affects behavior governed by active specs
- touches user-visible flows
- touches snapshot semantics
- touches prediction semantics
- touches warnings, errors, contracts, or projections
- touches tests, fixtures, expected outputs, or versioned outputs
- can introduce regression
- affects deployment or release behavior
- spans multiple files beyond trivial text edits

This model may be skipped only for truly trivial edits such as:
- comments-only edits
- formatting-only edits
- typo-only text edits with no semantic effect

If classification is uncertain, the QA model applies.

---

## 5. QA operating model

SportPulse uses a **3+1 QA model**.

### Core QA agents
1. `qa-lead-verification-gate`
2. `qa-fixture-regression-auditor`
3. `release-smoke-auditor`

### Conditional specialist
4. `prediction-qa-specialist`

This model is intentionally small.
Do not proliferate QA roles without a genuinely new responsibility boundary.

---

## 6. Agent responsibilities

### 6.1 qa-lead-verification-gate

**Mission:** own verification intake, required-lane routing, package completeness review, and consolidated QA verdict.

**Owns:**
- intake of non-trivial changes
- verification package completeness check
- determining which QA lanes are required
- identifying missing evidence
- consolidated QA verdict before merge

**Must not:**
- implement feature code
- approve based on confidence alone
- waive missing evidence for convenience

### 6.2 qa-fixture-regression-auditor

**Mission:** enforce acceptance conformance, fixture discipline, regression containment, version-gate discipline, and cross-layer semantic safety.

**Owns:**
- Acceptance Test Matrix conformance
- F1–F6 enforcement for snapshot-domain changes
- regression review
- version-gate review
- taxonomy and boundary enforcement where relevant
- classification of fixture diffs

**Must not:**
- accept fixture changes without classification
- conflate F-series and PF-series
- treat "the UI looks fine" as semantic proof

### 6.3 release-smoke-auditor

**Mission:** validate deploy-bound changes in staging before production promotion.

**Owns:**
- staging deployment validation
- application startup validation
- health/readiness/provider endpoint checks
- smoke validation of affected runtime flows
- critical log review
- rollback-readiness review
- production promotion recommendation

**Must not:**
- treat CI green as release proof
- approve deploy-bound work without staging evidence

### 6.4 prediction-qa-specialist

**Mission:** validate prediction-domain correctness when prediction behavior is touched.

**This lane is conditional, not always on.**

**Owns:**
- PF-series verification
- operating mode correctness
- prediction contract truth
- calibration/probability semantics review
- track record integrity review
- anti-lookahead enforcement

**Must not:**
- replace the QA core
- be omitted for materially semantic prediction changes
- compete with the PE specialist family already active for `packages/prediction/`

---

## 7. Relation to existing sub-agent doctrine

This QA model refines but does not contradict the existing `QA / Fixture Enforcer` role.

Normative interpretation:
- `qa-fixture-regression-auditor` is the operationalized form of the existing QA / Fixture Enforcer responsibility
- `qa-lead-verification-gate` adds explicit verification intake and final QA gate control
- `release-smoke-auditor` adds the post-merge operational lane required for deploy-bound work
- `prediction-qa-specialist` is a conditional QA specialist and must consume prediction-domain specialist evidence rather than replace the PE family

Any task touching `packages/prediction/` still routes to the PE family for implementation and subdomain technical work.
This QA model adds verification discipline around that work; it does not replace PE specialist doctrine.

---

## 8. Routing rules

### 8.1 Default non-trivial route

Every non-trivial change requires:
- `qa-lead-verification-gate`
- `qa-fixture-regression-auditor`

### 8.2 Add release-smoke-auditor when

Add `release-smoke-auditor` when:
- the change is deploy-bound
- the change is being evaluated for production readiness
- staging validation is required by release process

### 8.3 Add prediction-qa-specialist when

Add `prediction-qa-specialist` when the change touches any of:
- `packages/prediction/*`
- prediction behavior
- calibration logic
- operating mode logic
- prediction API/UI semantics
- track record logic or display
- anti-lookahead guarantees
- prediction-domain fixtures or expected outputs

If classification is uncertain, the prediction QA lane is required.

---

## 9. Verification package contract

Every non-trivial change must include a formal Verification Package.

Required fields:
- Scope
- Governing specs
- Acceptance mapping
- Fixture impact
- Version impact
- Evidence
- Regression checks
- Risks
- Unknowns / not verified yet

A non-trivial change without this package is verification-incomplete.

A non-trivial PR without this package must not be considered merge-ready.

---

## 10. Mandatory output contract for each QA lane

Each QA lane must output:
- scope reviewed
- governing specs
- acceptance IDs or checks reviewed
- fixture families reviewed
- procedures executed
- observed results
- verdict
- failure classification if needed
- required actions before merge or production

Vague outputs such as:
- looks fine
- seems correct
- probably ok
- should work

are non-compliant.

---

## 11. Fixture discipline

### 11.1 Snapshot fixture family

Snapshot-domain changes must be validated against the F1–F6 family.

These fixtures govern:
- semantic comparison
- contract comparison
- geometry comparison

### 11.2 Prediction fixture family

Prediction-domain changes must be validated against the PF-01–PF-06 family.

These fixtures govern:
- determinism
- distribution integrity
- threshold gate behavior
- calibration shape
- operating mode integrity
- anti-lookahead discipline

### 11.3 Operational independence

F-series and PF-series are operationally independent.
They have different truth anchors, comparison semantics, and version implications.

They must never be merged into one undifferentiated fixture check.

### 11.4 Fixture diff classification

Any fixture diff must be classified as exactly one of:
- implementation bug
- fixture defect
- intentional versioned behavior change

If classification is absent, the change is non-compliant.

### 11.5 Anti-laundering rule

No fixture may be updated "to make the test pass" without:
- explicit classification
- explicit version reasoning where required
- documented rationale

---

## 12. Version-discipline integration

QA is responsible for blocking silent semantic mutation.

At minimum, QA must enforce version reasoning around:
- `policyVersion`
- `layoutAlgorithmVersion`
- `snapshotSchemaVersion`
- `calibration_version`

If a materially semantic change occurs and required version reasoning is absent, the change must not pass QA.

Version bumps must not be guessed casually.
They must be grounded in the governing specs and documented change type.

---

## 13. Boundary and taxonomy discipline

QA must reject the following:
- frontend-owned semantic recomputation
- frontend-owned scoring
- frontend-owned layout solving
- undocumented warning/error codes
- ad hoc error envelopes
- cross-layer semantic leakage
- provider semantics leaking into frontend truth
- fake fallback or degraded-state dishonesty

Warnings and errors must remain taxonomy-stable.
Logs are not warnings.
Warnings are not logs.
Errors are not UI guesses.

---

## 14. Verdict model

Allowed verdicts only:
- `PASS`
- `PASS_WITH_NOTES`
- `FAIL`
- `BLOCKED_BY_SPEC_CONFLICT`
- `BLOCKED_BY_MISSING_EVIDENCE`

No QA lane may emit vague verdict language outside this model.

---

## 15. Failure classification model

Failures must be classified explicitly.

Allowed classifications include:
- implementation bug
- regression
- missing required evidence
- missing test coverage
- incorrect or incomplete spec implementation
- fixture defect
- undocumented intentional behavior change
- versioning failure
- taxonomy violation
- boundary violation
- staging deployment failure
- smoke flow failure
- rollback-readiness failure
- anti-lookahead violation
- track-record integrity violation
- operating-mode violation

A QA report without explicit failure classification is incomplete.

---

## 16. Merge gate rule

Merge is blocked if any of the following is true:
- Verification Package is incomplete
- acceptance mapping is missing
- required fixture family was not run
- fixture diff is unclassified
- materially semantic change lacks required version reasoning
- known regression remains unresolved
- governing spec conflict is unresolved
- required QA lane did not run
- final QA verdict is `FAIL`
- final QA verdict is `BLOCKED_BY_SPEC_CONFLICT`
- final QA verdict is `BLOCKED_BY_MISSING_EVIDENCE`

CI green does not override any of the above.

---

## 17. Release gate rule

Production promotion is blocked if any of the following is true:
- staging deployment failed
- application failed to start correctly in staging
- health/readiness/provider checks fail or misreport
- affected flow fails in staging
- truth-sensitive change lacks truth evidence
- critical runtime log pattern exists
- degraded or fallback behavior is dishonest
- rollback path is unclear
- Release Smoke verdict is not passable

A deploy-bound change is not release-ready because it merged successfully.

---

## 18. Prediction-domain special rules

For prediction-domain changes, QA must additionally enforce:
- PF-series evidence exists
- operating mode semantics remain correct
- `NOT_ELIGIBLE` still yields `predictions: null` where required
- calibrated and raw probabilities are not mixed
- track record remains unfiltered and pre-kickoff honest
- anti-lookahead remains intact
- threshold gate behavior for public accuracy remains correct

Prediction changes may not pass using generic snapshot evidence alone.

---

## 19. Minimum operational expectations

The QA operating model is functioning only when all of the following are true:
- non-trivial work cannot skip Verification Package review
- acceptance mapping is enforced
- fixture discipline is enforced
- required version reasoning is enforced
- regression review is explicit
- deploy-bound work receives staging validation
- prediction changes consume prediction-specific evidence
- final QA verdict is explicit and blocking when necessary

If these conditions are absent, QA is performative and not operational.

---

## 20. Adoption rule

This spec is not considered adopted until:
- it is cross-referenced from the AI SDD Operating Protocol
- it is cross-referenced from the Sub-Agents Definition
- `docs/core/spec.sportpulse.qa.pre-merge-verification-gate.md` is present and cross-references this QA model
- QA agent prompts or equivalent orchestration entries exist for:
  - `qa-lead-verification-gate`
  - `qa-fixture-regression-auditor`
  - `release-smoke-auditor`
  - `prediction-qa-specialist`

Without those links, this document is only text, not operating control.

---

## 21. One-paragraph summary

SportPulse QA is a strict 3+1 operating model designed to stop false-green delivery. Non-trivial changes must pass verification intake, acceptance mapping, fixture-family enforcement, regression review, version-discipline review, and — when deploy-bound — staging smoke validation before they are considered acceptable. Snapshot and prediction pipelines remain operationally distinct, fixture laundering is forbidden, silent semantic mutation is blocked, and prediction-domain correctness requires dedicated specialist evidence. QA exists to protect product truth, not to accelerate merge throughput.
