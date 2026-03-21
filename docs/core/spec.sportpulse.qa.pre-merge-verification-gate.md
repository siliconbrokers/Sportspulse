---
artifact_id: SPEC-SPORTPULSE-QA-PRE-MERGE-VERIFICATION-GATE
title: "Pre-Merge Verification Gate"
artifact_class: spec
status: proposed
version: 1.0.0
project: sportpulse
domain: qa
slug: pre-merge-verification-gate
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-QA-OPERATING-MODEL
  - SPEC-SPORTPULSE-CORE-AI-SDD-OPERATING-PROTOCOL
  - SPEC-SPORTPULSE-CORE-SUBAGENTS-DEFINITION
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
  - SPEC-SPORTPULSE-QA-GOLDEN-SNAPSHOT-FIXTURES
  - SPEC-SPORTPULSE-QA-PREDICTION-TRACK-RECORD-FIXTURES
  - SPEC-SPORTPULSE-OPS-OPERATIONAL-BASELINE
canonical_path: docs/core/spec.sportpulse.qa.pre-merge-verification-gate.md
---
# SportPulse — Pre-Merge Verification Gate

Version: 1.0
Status: Proposed
Scope: Mandatory verification gate between implementation submission and merge approval for non-trivial changes
Audience: Engineering, QA, AI-assisted development workflows, merge authority

---

## 1. Purpose

This specification defines the mandatory pre-merge verification gate for SportPulse.

Its purpose is to prevent a recurring failure mode:
- implementation is declared complete
- the change is described as working
- later review reveals missing behavior, regressions, partial delivery, broken flows, incorrect fixtures, or undeclared semantic drift

The pre-merge verification gate exists to ensure that:
- implementation is not treated as verification
- evidence is not replaced by assertion
- merge readiness is not inferred from CI alone
- required QA lanes run before merge
- silent semantic mutation is blocked
- fixture laundering is blocked

---

## 2. Relation to the QA Operating Model

This spec depends on the canonical QA Operating Model:

`docs/core/spec.sportpulse.qa.operating-model.md`

Normative rule:
- the QA Operating Model defines the QA lanes, routing rules, verification package contract, verdict model, and release-readiness interface
- this Pre-Merge Verification Gate defines when merge is blocked, what evidence is mandatory before merge, and how QA verdicts become merge decisions

This document must not be interpreted independently from the QA Operating Model.

---

## 3. Applicability

This gate applies to all non-trivial changes.

A change is non-trivial if it meets at least one of the following conditions:
- affects behavior governed by active specs
- touches user-visible flows
- touches snapshot semantics
- touches prediction semantics
- touches warnings/errors/contracts
- touches tests, fixtures, expected outputs, or versioned outputs
- can introduce regression
- affects deployment or release behavior
- spans multiple files beyond trivial text edits

This gate may be skipped only for truly trivial edits such as:
- comments-only edits
- formatting-only edits
- typo-only text edits with no semantic effect

If classification is uncertain, the gate applies.

---

## 4. Required state distinctions

The following states are distinct and must not be collapsed:

1. specified
2. in implementation
3. implementation submitted
4. verification in progress
5. verification failed / verification passed
6. merge approved
7. deployed to staging
8. post-deploy smoke passed
9. production approved

Forbidden shortcuts:
- implementation submitted -> merge approved
- implementation submitted -> production approved
- CI green -> merge approved
- merge approved -> production approved

---

## 5. Non-negotiable principles

### 5.1 No self-certification

The implementer may describe what changed and what they tested.
The implementer is not the final authority declaring non-trivial work correct.

### 5.2 Evidence over assertion

Claims such as:
- done
- tested
- fixed
- works

are invalid without reproducible evidence.

### 5.3 Acceptance before interpretation

Mergeability is governed by active specs, acceptance mapping, fixture truth, regression review, and QA verdicts.
Not by implementer confidence.

### 5.4 Fixture suspicion by default

Any change to fixtures, expected outputs, snapshots, or prediction evaluation artifacts is suspicious until classified.

### 5.5 Regression protection is mandatory

A new feature working is insufficient if adjacent behavior was not rechecked.

---

## 6. Verification Package requirement

Every non-trivial change must include a Verification Package.

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

A non-trivial change without a complete Verification Package is verification-incomplete and must not be merge-approved.

---

## 7. Required QA lanes before merge

The required QA lanes are governed by the QA Operating Model.

### 7.1 Always required for non-trivial work
- `qa-lead-verification-gate`
- `qa-fixture-regression-auditor`

### 7.2 Required conditionally
- `prediction-qa-specialist` when prediction-domain behavior is touched

### 7.3 Not a substitute for merge QA
- `release-smoke-auditor` is a release-stage lane, not a substitute for pre-merge verification
- deploy-bound work may still require pre-merge evidence plus post-merge staging validation

If a required QA lane did not run, merge approval is forbidden.

---

## 8. What the gate checks

Before merge approval, the gate must confirm all of the following.

### 8.1 Verification Package completeness
The package exists and all required fields are populated.

### 8.2 Governing spec alignment
The implementation is aligned with the active authoritative docs.
If the governing specs conflict materially, honest verification is blocked.

### 8.3 Acceptance mapping
The change maps to explicit Acceptance Test Matrix IDs or explicitly authorized manual checks.

### 8.4 Fixture-family correctness
The correct fixture family was used:
- F1–F6 for snapshot-domain changes
- PF-01–PF-06 for prediction-domain changes

These families must never be conflated.

### 8.5 Fixture diff classification
Any fixture diff is classified as exactly one of:
- implementation bug
- fixture defect
- intentional versioned behavior change

### 8.6 Version reasoning
Material semantic changes include explicit version reasoning where required, including but not limited to:
- `policyVersion`
- `layoutAlgorithmVersion`
- `snapshotSchemaVersion`
- `calibration_version`

### 8.7 Regression review
Adjacent behavior and directly impacted truth surfaces were rechecked.

### 8.8 Required QA verdicts
The required QA lanes produced valid verdicts from the allowed model:
- PASS
- PASS_WITH_NOTES
- FAIL
- BLOCKED_BY_SPEC_CONFLICT
- BLOCKED_BY_MISSING_EVIDENCE

---

## 9. Merge blocking rules

Merge is blocked if any of the following is true:
- Verification Package is incomplete
- acceptance mapping is missing
- required evidence is missing or non-reproducible
- required fixture family was not run
- fixture diff is unclassified
- wrong fixture family was used
- materially semantic change lacks required version reasoning
- known regression remains unresolved
- undocumented taxonomy/boundary violation exists
- governing spec conflict is unresolved
- required QA lane did not run
- final QA verdict is `FAIL`
- final QA verdict is `BLOCKED_BY_SPEC_CONFLICT`
- final QA verdict is `BLOCKED_BY_MISSING_EVIDENCE`

CI green does not override any of the above.

---

## 10. Merge-approvable conditions

A non-trivial change is merge-approvable only when all of the following are true:
- Verification Package is complete
- governing specs are alignable and not in unresolved conflict
- acceptance mapping exists
- required evidence is reproducible
- required fixture families were run correctly
- fixture diffs are classified correctly
- required version reasoning exists
- regression checks are explicit
- required QA lanes ran
- final QA verdict is `PASS` or `PASS_WITH_NOTES`

`PASS_WITH_NOTES` may be merge-approvable only if the notes are explicitly non-blocking.

---

## 11. Failure classification model

Every merge-blocking failure must be classified explicitly.

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
- operating-mode violation
- anti-lookahead violation
- track-record integrity violation

A gate result without failure classification is incomplete if a blocking condition exists.

---

## 12. Emergency exception path

An emergency route is allowed only when the risk of not shipping is greater than the risk of shipping with reduced verification.

Minimum requirements for emergency exception:
- incident reference
- explicit reason the normal gate cannot complete in time
- minimal reproducible evidence
- rollback plan
- named approver
- mandatory post-release verification follow-up

Emergency handling is an exception, not a second normal process.

---

## 13. Relation to release readiness

This spec governs merge readiness, not production readiness.

Production promotion for deploy-bound work is governed additionally by:
- staging deployment success
- health/readiness/provider validation
- smoke validation
- critical log review
- rollback readiness

Those checks are owned by the release-stage QA lane defined in the QA Operating Model.

Merge approval does not imply production approval.

---

## 14. Adoption rule

This gate is not considered operational until:
- it is cross-referenced from the QA Operating Model
- it is cross-referenced from the AI SDD Operating Protocol
- it is reflected in the Sub-Agents Definition through the QA role operationalization
- non-trivial work is expected to provide the Verification Package
- required QA lane verdicts are part of the review process

Without those conditions, this gate is documentation only.

---

## 15. One-paragraph summary

The SportPulse Pre-Merge Verification Gate exists to stop non-trivial changes from being merged based on implementer confidence, superficial checks, or CI green alone. Merge is allowed only when a complete Verification Package exists, governing specs align, acceptance mapping is explicit, the correct fixture families were run, diffs are classified, required version reasoning exists, adjacent regressions were checked, and the required QA lanes produced passable verdicts. It is a hard evidence gate, not a trust-based workflow.
