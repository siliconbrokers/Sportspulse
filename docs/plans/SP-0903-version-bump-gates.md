# Plan: SP-0903 — Version Bump Regression Gates

## Spec refs
- Golden_Snapshot_Fixtures_v1.0.md §10-§11 (update discipline, version bump rules)
- Acceptance_Test_Matrix §I-02 (policy version bump), §I-03 (layout version bump), §I-04 (schema version bump)

## Design decisions

### Purpose
Tests that detect when scoring/layout/schema semantics change WITHOUT a corresponding version bump. This prevents silent drift.

### How it works
1. Store known version numbers alongside golden expected outputs
2. Re-run golden fixtures
3. If output differs from expected BUT version numbers haven't changed → FAIL
4. If output differs AND version bumped → expected (dev must update fixtures)

### Implementation: Three gate tests

**Gate 1 — Scoring version gate (I-02):**
- Run baseline fixture with current policy
- Compare scoring outputs (rawScore, attentionScore, displayScore, layoutWeight, contributions) against expected
- If different AND `policyVersion` unchanged → FAIL with message "Scoring changed without policyVersion bump"

**Gate 2 — Layout version gate (I-03):**
- Run baseline fixture with current layout
- Compare geometry (all rects) against expected
- If different AND `layout.algorithmVersion` unchanged → FAIL

**Gate 3 — Schema version gate (I-04):**
- Check DTO shape (field names, required fields) against expected shape
- If shape changed AND `snapshotSchemaVersion` unchanged → FAIL
- Shape check: extract keys from actual snapshot recursively, compare against stored key set

### Stored version expectations
File: `tools/fixtures/golden/version-expectations.json`
```json
{
  "policyKey": "sportpulse.mvp.form-agenda",
  "policyVersion": 1,
  "layoutAlgorithmKey": "treemap.squarified",
  "layoutAlgorithmVersion": 1,
  "snapshotSchemaVersion": 1
}
```

## Files to create
1. `tools/fixtures/golden/version-expectations.json` — Stored expected versions
2. `tools/fixtures/version-gates.test.ts` — Three gate tests
3. `tools/fixtures/lib/shape-check.ts` — DTO shape extraction utility

## Tests (mapped to acceptance)
- I-02: Scoring change without policyVersion bump → fails
- I-03: Geometry change without layoutAlgorithmVersion bump → fails
- I-04: DTO shape change without snapshotSchemaVersion bump → fails

## Implementation notes for Sonnet
- Use F1_baseline_normal fixture for all three gates
- Scoring comparison: deep compare score fields from teams array
- Geometry comparison: deep compare rect values from teams array
- Shape check: recursively collect all object keys + their types, stringify as sorted JSON
- On failure: log clear message about WHICH version needs bumping
- These tests run as part of the golden fixture runner suite
- Gate tests are ADDITIONAL to golden fixture comparison — they add the "why did it fail" diagnosis
