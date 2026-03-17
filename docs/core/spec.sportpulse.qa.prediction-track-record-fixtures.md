---
artifact_id: SPEC-SPORTPULSE-QA-PREDICTION-TRACK-RECORD-FIXTURES
title: "Prediction Track Record Fixtures"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: qa
slug: prediction-track-record-fixtures
owner: team
created_at: 2026-03-16
updated_at: 2026-03-16
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-QA-GOLDEN-SNAPSHOT-FIXTURES
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
  - SPEC-SPORTPULSE-PREDICTION-ENGINE
canonical_path: docs/core/spec.sportpulse.qa.prediction-track-record-fixtures.md
---

# Prediction Track Record Fixtures

Version: 1.0
Status: Active
Scope: Authoritative definition of the PF-* prediction fixture family — what they validate, comparison rules, versioning model, anti-lookahead rules, and the track record accuracy gate
Audience: QA / Fixture Enforcer, predictive-engine-qa agent, predictive-engine-auditor agent, engineering

---

## 1. Purpose

This spec defines the **PF-* fixture family** — the canonical truth locks for the prediction pipeline.

It is separate from `spec.sportpulse.qa.golden-snapshot-fixtures.md` (F1–F6), which governs the snapshot/attention dashboard pipeline. The two families have different comparison semantics and cannot be merged.

PF-* fixtures protect:
- determinism of the prediction engine output given the same inputs
- correctness of probability distributions (sum, calibration)
- operating mode assignment integrity
- pre-kickoff timestamp discipline (anti-lookahead)
- aggregate accuracy computation and track record display logic

---

## 2. Relation to the Acceptance Test Matrix

PF-* fixtures are the backing evidence for Acceptance Matrix series K (K-01 through K-06).

Each PF-* fixture maps to one or more K-series acceptance IDs. When a PF-* fixture fails, the corresponding K acceptance test also fails.

| Acceptance ID | Covered by fixture(s) |
|---------------|----------------------|
| K-01 | PF-01 (determinism) |
| K-02 | PF-02 (distribution integrity) |
| K-03 | PF-03 (track record threshold gate) |
| K-04 | PF-04 (calibration shape) |
| K-05 | PF-05 (operating mode integrity) |
| K-06 | PF-06 (pre-kickoff timestamp) |

---

## 3. Fixture Definitions

### PF-01 — Prediction Determinism

**What it validates:**
Given the same `MatchInput`, the same `CompetitionProfile`, and the same historical match record (prior ratings), the prediction engine must produce byte-identical output on repeated invocations.

**Comparison rule:**
Deep-equal on the full `PredictionResponse` object. No field may differ between runs.

**Why it matters:**
Non-determinism in Elo or Poisson computation causes silent divergence in the track record. Same inputs must always yield the same probabilities.

**Failure classification:** always a bug — no intentional-change path.

---

### PF-02 — Distribution Integrity (Sum = 1.0 ± ε)

**What it validates:**
- `raw_1x2_probs.home + raw_1x2_probs.draw + raw_1x2_probs.away` = 1.0 ± 0.0001
- `calibrated_1x2_probs.home + calibrated_1x2_probs.draw + calibrated_1x2_probs.away` = 1.0 ± 0.0001
- Sum of all cells in `raw_match_distribution` (8×8 matrix) + `tail_mass_raw` = 1.0 ± 0.0001
- BTTS: `yes + no` = 1.0 ± 0.0001
- Each total band in `over_under` maps: `over + under` = 1.0 ± 0.0001 per threshold

**Comparison rule:**
Numeric assertion within epsilon. Epsilon = 0.0001 (1e-4). Silent renormalization is forbidden — if the sum falls outside epsilon, it is a fixture failure, not an auto-fix.

**Why it matters:**
Probabilities that do not sum to 1 are invalid. The spec explicitly forbids silent renormalization (PE Spec §16.9).

**Failure classification:** always a bug.

---

### PF-03 — Track Record Threshold Gate

**What it validates:**
When the number of evaluated predictions for a given liga is `< 200`, the `PredictionResponse` or track record endpoint must set `belowThreshold: true` and must NOT expose numeric accuracy metrics (accuracy %, hit rate, calibration score).

When the count reaches `≥ 200`, numeric accuracy metrics may be exposed.

**Comparison rule:**
Two fixture sub-cases:
- Sub-case A (count = 50): response must have `belowThreshold: true` and `accuracy: null` (or absent).
- Sub-case B (count = 250): response may have `belowThreshold: false` and numeric `accuracy`.

**Why it matters:**
The 200-prediction threshold is a constitutional invariant (Constitution §24, BP v3.0 §11.2). Showing accuracy from a small sample is epistemically misleading and violates the track record integrity moat.

**Failure classification:** bug if threshold is not enforced; intentional change requires a spec amendment with explicit reasoning.

---

### PF-04 — Calibration Shape

**What it validates:**
The calibrated_1x2_probs must pass an isotonic consistency check: for a pre-built calibrator trained on known data, the output probabilities must fall within the expected output range for the given raw input bucket.

**Comparison rule:**
The fixture provides a pre-computed calibrator state (stored as JSON in `tools/fixtures/prediction/pf-04-calibrator-state.json`), a set of raw inputs, and expected calibrated output ranges `[min, max]` per class per input. Each calibrated value must fall within its declared range.

**Why it matters:**
Calibration transforms raw Poisson-derived probabilities into historically-grounded estimates. If the isotonic regression output drifts, the track record becomes unreliable.

**Failure classification:**
- Within epsilon of declared range: pass.
- Outside range but calibrator state unchanged: bug in application logic.
- Range shifts because calibrator state changed intentionally: requires fixture update with version bump to `calibration_version`.

---

### PF-05 — Operating Mode Integrity

**What it validates:**
Given controlled inputs:
- Valid MatchInput with ≥10 prior matches per team: `operating_mode = FULL_MODE`
- MatchInput with 5 prior matches for one team: `operating_mode = LIMITED_MODE`
- MatchInput with 0 prior matches: `operating_mode = NOT_ELIGIBLE`

**Comparison rule:**
Exact string equality on `operating_mode` field. Reasons array must contain the declared reason codes for each scenario (see PE Spec §3.6 reasons catalog).

**Why it matters:**
Operating mode is the eligibility gate. Incorrect mode assignment could expose inaccurate predictions as if they were fully calibrated.

**Failure classification:** always a bug.

---

### PF-06 — Pre-Kickoff Timestamp Discipline (Anti-Lookahead)

**What it validates:**
A prediction generated with `buildNowUtc = T` where `T < kickoffUtc` must not use any match result data with `matchDate ≥ T`. The engine must not incorporate post-kickoff information from the match being predicted or any match that has not yet been played relative to `T`.

**Comparison rule:**
Fixture provides: a `buildNowUtc`, a set of historical matches with explicit dates, one of which falls after `buildNowUtc`. The prediction output must be identical to a run where that future match was excluded from the history. If the future match affects the output, the fixture fails.

**Why it matters:**
Lookahead contamination invalidates the track record. A model that "knows" future outcomes when predicting past matches produces inflated apparent accuracy.

**Failure classification:** always a bug. No intentional-change path exists for lookahead — it is a fundamental correctness invariant.

---

## 4. Fixture File Layout

Prediction fixtures live under:

```
tools/fixtures/prediction/
  pf-01-determinism/
    input.json           # MatchInput + CompetitionProfile + history
    expected-output.json # Full PredictionResponse (golden)
  pf-02-distribution/
    input.json
    expected-sums.json   # {raw_1x2, calibrated_1x2, matrix, btts, ou}
  pf-03-threshold/
    input-below.json     # history with 50 evaluated predictions
    expected-below.json  # {belowThreshold: true, accuracy: null}
    input-above.json     # history with 250 evaluated predictions
    expected-above.json  # {belowThreshold: false, accuracy: <number>}
  pf-04-calibration/
    pf-04-calibrator-state.json  # serialized calibrator
    test-cases.json              # [{raw_input, expected_min, expected_max}]
  pf-05-operating-mode/
    case-full.json       # {input, expected_mode: "FULL_MODE", expected_reasons: [...]}
    case-limited.json    # {input, expected_mode: "LIMITED_MODE", ...}
    case-not-eligible.json # {input, expected_mode: "NOT_ELIGIBLE", ...}
  pf-06-antilookahead/
    input-with-future.json   # history includes one match after buildNowUtc
    input-without-future.json # same history, future match removed
    expected-equal.json      # PredictionResponse must be identical for both
```

---

## 5. Comparison Semantics

### 5.1 Deep equality vs. structural equality

PF-01 uses **deep equality** — every field must match. If the engine adds new fields to PredictionResponse (e.g., a new explainability field), the fixture must be updated with a version bump.

PF-02, PF-03 use **structural assertions** — specific numeric or boolean fields are checked, not the full object. Adding new fields does not break these fixtures.

PF-04, PF-05, PF-06 use **property assertions** — enumerable properties within declared ranges or exact values on a subset of fields.

### 5.2 Epsilon for floating-point comparisons

All floating-point probability comparisons use epsilon = 0.0001 unless a fixture explicitly declares a tighter epsilon.

### 5.3 Fixture update protocol

When a fixture must be updated (intentional versioned change):

1. Classify the change: bug fix / calibrator retraining / PE spec amendment
2. If classification is "calibrator retraining": bump `calibration_version` in `version-metadata.ts`
3. If classification is "PE spec amendment": bump `policyVersion` per versioning gates
4. Update the fixture file with new expected values
5. Document the reason and version in the fixture's `CHANGELOG.md` under `tools/fixtures/prediction/`
6. Never update a fixture "to make the test pass" without completing steps 1–5

---

## 6. Anti-Lookahead Rules

The anti-lookahead invariant applies to both the fixture runner and the production engine:

1. **Fixture runner**: must pass `buildNowUtc` as an explicit parameter when computing predictions for evaluation. It must never use `new Date()` or `Date.now()` as the temporal anchor.

2. **Production engine**: must filter historical matches to those with `matchDate < buildNowUtc` before computing Elo ratings.

3. **Track record computation**: a prediction is "evaluated" only when its match is FINISHED and `matchDate ≤ evaluationWindowCloseUtc`. Predictions for matches still SCHEDULED or IN_PROGRESS are excluded from accuracy metrics.

4. **Forward validation**: predictions must be generated before their respective matches kick off. Any prediction generated after `kickoffUtc` is tagged `post_kickoff: true` and excluded from track record computations.

---

## 7. Versioning Model

PF-* fixtures are versioned independently from snapshot fixtures.

```
tools/fixtures/prediction/FIXTURES-VERSION.md
```

This file tracks the current fixture suite version and changelog. Format:

```
Prediction Fixture Suite Version: 1.0.0
Last updated: 2026-03-16
Reason: Initial fixture set

Changelog:
- 1.0.0 (2026-03-16): Initial PF-01..PF-06 fixture definitions
```

Fixture suite version bumps:
- **Patch** (x.y.Z): fixing an incorrect expected value that was a defect in the fixture itself
- **Minor** (x.Y.z): adding new fixture sub-cases without changing existing ones
- **Major** (X.y.z): changing comparison semantics, adding required new fixtures that alter compliance criteria

---

## 8. Anti-Cherry-Picking Rule

The track record must include all evaluated predictions for a liga within the evaluation window, not a curated subset.

The QA fixture must verify:
- The count in the track record response matches the count of stored evaluated predictions
- The accuracy metric (when `belowThreshold = false`) is computed over the full population, not filtered by outcome

Any filtering of evaluated predictions (e.g., excluding "uncertain" matches) requires an explicit spec amendment, not a silent implementation choice.

---

## 9. Relation to Snapshot Fixtures (F1–F6)

| Dimension | Snapshot Fixtures (F1–F6) | Prediction Fixtures (PF-01–PF-06) |
|-----------|--------------------------|-----------------------------------|
| Pipeline | attention dashboard (canonical→signals→scoring→layout→snapshot) | prediction (canonical→prediction engine→PredictionResponse) |
| Truth anchor | `buildNowUtc` → DashboardSnapshotDTO | `buildNowUtc` → PredictionResponse |
| Comparison method | JSON deep-equal on DTO shape | per-fixture: deep-equal, range, or property assertion |
| Version gate trigger | snapshotSchemaVersion bump | policyVersion or calibration_version bump |
| Anti-lookahead | not applicable | mandatory (§6) |
| Track record gate | not applicable | ≥200 per liga (§3, PF-03) |

These two families are operationally independent. A PF-* failure does not affect F1–F6 pass status, and vice versa.

---

## 10. Fixture Enforcement Policy

The QA / Fixture Enforcer agent must:

1. Run the full PF-* suite as part of every PR that touches `packages/prediction/`
2. Classify any failure as: bug / intentional versioned change / fixture defect
3. Block merge if any PF-* fixture fails without full classification and version reasoning
4. Maintain `tools/fixtures/prediction/FIXTURES-VERSION.md` current after any update

The predictive-engine-qa agent owns test implementation for the PF-* suite.

The predictive-engine-auditor agent uses PF-* fixture pass/fail status as primary evidence in formal conformance audits.

---

## 11. One-Paragraph Summary

The PF-* prediction fixture family defines six canonical truth locks for the SportsPulse prediction pipeline: determinism (PF-01), distribution integrity (PF-02), track record threshold gate at ≥200 predictions per liga (PF-03), calibration shape consistency (PF-04), operating mode integrity (PF-05), and pre-kickoff anti-lookahead discipline (PF-06). These fixtures are separate from the F1–F6 snapshot fixtures, use different comparison semantics, and are governed by an independent versioning model. No fixture may be updated to make tests pass without explicit classification and version bump reasoning.
