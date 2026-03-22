# Pull Request

## Change Summary
- Change:
- Why:
- Ticket / Ref:
- Claimed status:

## Change Classification
Select one:

- [ ] Trivial change
- [ ] Non-trivial change

A change is non-trivial if it affects behavior governed by active specs, touches user-visible flows, touches snapshot or prediction semantics, touches warnings/errors/contracts, changes tests/fixtures/expected outputs/versioned outputs, can introduce regression, or affects deploy/release behavior.

If classification is uncertain, treat it as non-trivial.

---

## Governing Specs
List the authoritative docs governing this change.

-
-
-

---

## Scope
### Changed
-

### Explicitly unchanged
-

---

## Acceptance Mapping
List the exact Acceptance Test Matrix IDs covered by this PR, or explicitly authorized manual checks where automation is impractical.

-

---

## Fixture Impact
Select all that apply:

- [ ] No fixture impact
- [ ] F1–F6 snapshot fixture family impacted
- [ ] PF-01–PF-06 prediction fixture family impacted

### Fixture detail
- Impacted fixture IDs:
- Diff classification (if any): none / implementation bug / fixture defect / intentional versioned behavior change
- Fixture update performed:
  - [ ] No
  - [ ] Yes

If any fixture was updated, explain why:

-

---

## Version Impact
Select all that apply:

- [ ] No version impact
- [ ] `policyVersion` reasoning required
- [ ] `layoutAlgorithmVersion` reasoning required
- [ ] `snapshotSchemaVersion` reasoning required
- [ ] `calibration_version` reasoning required

### Version reasoning
-

---

## Evidence
Provide reproducible evidence. "Works locally" is not acceptable.

### Commands run
```bash
# paste exact commands here
```

### Results
- Lint:
- Type check:
- Unit/integration tests:
- Acceptance tests:
- Fixture runs:
- Boundary checks:
- Legacy guard:
- Other relevant evidence:

### Manual verification (only if needed)
- Steps:
- Observed result:
- Screenshots / recording:
- Not needed because:

---

## Regression Checks
State what adjacent behavior could have been broken and what was checked to prove it was not broken.

- Adjacent surfaces checked:
- Regressions found:
- Remaining uncertainty:

---

## Risks
List the top risks that still matter.

-

---

## Unknowns / Not Verified Yet
This field is mandatory for non-trivial work.
If empty, write None.

-

---

## Required QA Lanes
Select the lanes that must run for this PR.

- [ ] `qa-lead-verification-gate`
- [ ] `qa-fixture-regression-auditor`
- [ ] `release-smoke-auditor`
- [ ] `prediction-qa-specialist`

### QA lane reasoning
-

### QA verdicts
- QA Lead / Verification Gate:
- QA Fixture & Regression Auditor:
- Release Smoke Auditor:
- Prediction QA Specialist:

Allowed verdicts only:
- `PASS`
- `PASS_WITH_NOTES`
- `FAIL`
- `BLOCKED_BY_SPEC_CONFLICT`
- `BLOCKED_BY_MISSING_EVIDENCE`

---

## Deploy / Release Impact
Select one:

- [ ] Not deploy-bound
- [ ] Deploy-bound

If deploy-bound, complete all fields below.

### Staging / Smoke / Rollback
- Staging deploy status:
- Health checks reviewed:
- Affected flow smoke result:
- Critical log review:
- Rollback path:
- Release risks:

---

## Final Checklist

Required for all PRs:

- [ ] scope matches active specs
- [ ] governing specs listed
- [ ] acceptance mapping is explicit
- [ ] fixture impact declared
- [ ] version impact declared
- [ ] evidence is reproducible
- [ ] regression checks are explicit
- [ ] risks listed
- [ ] unknowns / not verified yet declared
- [ ] no legacy constructs reintroduced
- [ ] no undocumented taxonomy codes introduced
- [ ] no frontend semantic recomputation introduced

Required for non-trivial PRs:

- [ ] Verification Package is complete
- [ ] required QA lanes were identified
- [ ] required QA verdicts are present
- [ ] required fixture family ran
- [ ] fixture diffs, if any, are classified
- [ ] required version reasoning is present
- [ ] merge is not being requested on implementer assertion alone

Required for prediction-domain PRs:

- [ ] PF-series evidence is present
- [ ] operating mode semantics were checked
- [ ] anti-lookahead discipline was preserved
- [ ] track record integrity was checked where relevant

Required for deploy-bound PRs:

- [ ] staging smoke validation is present
- [ ] rollback readiness is stated

---

## Merge Gate Reminder
A non-trivial PR is not merge-ready if any of the following is true:

- Verification Package is incomplete
- acceptance mapping is missing
- required evidence is missing or non-reproducible
- required fixture family was not run
- fixture diff is unclassified
- materially semantic change lacks required version reasoning
- known regression remains unresolved
- required QA lane did not run
- final QA verdict is `FAIL` / `BLOCKED_BY_SPEC_CONFLICT` / `BLOCKED_BY_MISSING_EVIDENCE`

CI green does not override these conditions.
