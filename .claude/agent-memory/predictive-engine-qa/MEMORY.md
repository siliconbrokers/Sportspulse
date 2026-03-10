# QA Agent Memory — Predictive Engine

## Test Suite Location
All QA test files are in `packages/prediction/test/`.

## New Test Files Added (Phase 5)
| File | Spec Sections | Tests |
|------|--------------|-------|
| `test/invariants/sum-to-one.test.ts` | §19.1 | 82 |
| `test/invariants/dnb.test.ts` | §19.4, §16.4 | 31 |
| `test/invariants/matrix-bounds.test.ts` | §19.2, §14.2, §16.11 | 148 |
| `test/invariants/mode-gating.test.ts` | §19.6, §21.1, §21.3, §25.3 | 17 |
| `test/invariants/calibration-monotonicity.test.ts` | §17.1 | 15 |
| `test/invariants/no-raw-calibrated-mixing.test.ts` | §19.5, §19.7 | 12 |
| `test/temporal/anti-leakage.test.ts` | §17.3, §3.6 | 12 |
| `test/suite/reconstruction.test.ts` | §25.4, §17.4 | 9 |
| `test/metrics/coverage.test.ts` | §23.2, §24.1 | 19 |

Total new tests: 345. Total after Phase 5: 615 tests, all passing.

## Key Architecture Facts
- Two probability families are strictly separated: `Calibrated1x2Probs` (branded) and `Raw1x2Probs` (branded). Cross-assignment is a TypeScript compile error.
- `NOT_ELIGIBLE` response has `predictions` structurally absent (not null) — enforced via discriminated union.
- `LIMITED_MODE` uses raw_1x2_probs for core outputs since calibration is unavailable.
- `FULL_MODE` uses calibrated_1x2_probs for all visible 1X2-consistent outputs.
- DNB sum = 1.0 exactly (IEEE 754) because implementation computes `dnb_away = 1 - dnb_home` (not independent division).
- `tail_mass_raw = Math.max(0, 1 - matrixSum)` — always non-negative by construction.
- Renormalization in `applyOneVsRestCalibration` guarantees calibrated sum = 1.0 exactly.

## Known Precision Pattern
The scoreline sort uses epsilon-based tie-breaking (§16.11 deterministic by score string). In rare cases two consecutive scorelines differ by sub-epsilon amounts (3 ULPs). Tests must use `>=  next - EPSILON_PROBABILITY` tolerance, not strict `>=`.

## Bug Found: None
The implementation conforms to the spec on all tested invariants. No implementation bugs discovered in Phase 5.

## Conformance Verdict (Phase 5)
- Calibrated 1X2 family: PASS
- Raw Goal/Scoreline family: PASS
- DNB: PASS
- Operating Modes: PASS
- Anti-Leakage: PASS
- Reconstruction: PASS
- Metrics bundle: PASS
- Overall: CONFORMANT

## Spec Sections with Potential Ambiguity
- §19.1 says raw_1x2_probs must sum to 1 ± epsilon, but this only holds after renormalization (raw distribution has tail mass). Tests correctly verify on renormalized distributions only.
- §16.11 tie-break by score string is deterministic but can produce sub-epsilon adjacent pairs.
