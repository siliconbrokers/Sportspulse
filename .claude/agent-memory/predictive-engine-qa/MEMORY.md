# QA Agent Memory — Predictive Engine

## Test Suite Location
All QA test files are in `packages/prediction/test/`.

## Test Files (Phase 5 + Phase 6 Fixes)
| File | Spec Sections | Tests |
|------|--------------|-------|
| `test/invariants/sum-to-one.test.ts` | §19.1 | 82 |
| `test/invariants/dnb.test.ts` | §19.4, §16.4 | 31 |
| `test/invariants/matrix-bounds.test.ts` | §19.2, §14.2, §16.11 | 148 |
| `test/invariants/mode-gating.test.ts` | §19.6, §21.1, §21.3, §25.3 | 17 |
| `test/invariants/calibration-monotonicity.test.ts` | §17.1 | 15 |
| `test/invariants/no-raw-calibrated-mixing.test.ts` | §19.5, §19.7 | 12 |
| `test/invariants/totals-split.test.ts` | §16.5, §19.3 | 15 |
| `test/temporal/anti-leakage.test.ts` | §17.3, §3.6 | 12 |
| `test/suite/reconstruction.test.ts` | §25.4, §17.4 | 9 |
| `test/metrics/coverage.test.ts` | §23.2, §24.1 | 19 |

Total: 360 tests in invariant/suite/temporal/metrics. Grand total: 880 all passing (post FIX-ROUND2).

## Test Helpers
- `test/helpers/branded-factories.ts` — factory functions for branded types.
  - `buildTestRaw1x2Probs(home, draw, away)` → `Raw1x2Probs`
  - `buildTestCalibratedProbs(home, draw, away)` → `Calibrated1x2Probs`
  - `buildTestRawDistribution(cells)` → `RawMatchDistribution`
  - `buildTestSingleCellDistribution(h, a, p)` → `RawMatchDistribution`
- Tests MUST use these helpers instead of `as any` for branded types.
- `as any` bypasses contract enforcement and makes tests useless for type-safety.

## Key Architecture Facts
- Two probability families are strictly separated: `Calibrated1x2Probs` (branded) and `Raw1x2Probs` (branded). Cross-assignment is a TypeScript compile error.
- `NOT_ELIGIBLE` response has `predictions` structurally absent (not null) — enforced via discriminated union.
- `LIMITED_MODE`: calibration-derived fields in `predictions.core` are `null` (p_home_win, p_draw, p_away_win, predicted_result, etc.) per PE-FIX-F002. Only lambda-derived fields (expected_goals_home/away) are non-null. `PredictionCore` type allows `number | null` for calibrated fields.
- `FULL_MODE` uses calibrated_1x2_probs for all visible 1X2-consistent outputs.
- DNB sum = 1.0 exactly (IEEE 754) because implementation computes `dnb_away = 1 - dnb_home` (not independent division).
- `tail_mass_raw = Math.max(0, 1 - matrixSum)` — always non-negative by construction.
- Renormalization in `applyOneVsRestCalibration` guarantees calibrated sum = 1.0 exactly.

## Totals-Split Invariant (FIX #67)
- Raw distribution: `over_2_5 + under_2_5 = 1 - tail_mass_raw` (not 1.0)
- Renormalized distribution: `over_2_5 + under_2_5 = 1.0` (spec §19.3)
- The spec §19.3 statement `abs((over_2_5 + under_2_5) - 1) <= epsilon` applies ONLY to renormalized distributions.
- Tests in `totals-split.test.ts` verify both raw invariant (vs tail_mass_raw) and renormalized invariant (vs 1.0).

## CompetitionProfile in Tests (FIX #68 + FIX-ROUND2 F1)
- `stage_type: 'REGULAR_SEASON'` is NOT a valid `PredictiveStageType` — spec §8.1 uses GROUP_STAGE, LEAGUE_PHASE, etc.
- `format_type: 'LEAGUE'` is NOT a valid `FormatType` — spec §8.1 uses ROUND_ROBIN, GROUP_CLASSIC, etc.
- Use `stage_type: 'GROUP_STAGE'` and `format_type: 'ROUND_ROBIN'` for domestic league round-robin tests.
- Remove `as any` from competition_profile literals once values are corrected — valid enum values do not need cast.
- `'ROUND_ROBIN'` is a valid `FormatType` — no `as any` needed in `KnockoutMatchData` tests (FIX-ROUND2 F4).

## PredictionResponseNotEligible.internals (FIX-ROUND2 F3)
- `internals` is now required (`internals: null`) not optional (`internals?: null`).
- Spec §21.1: the field must be explicitly present and null — omission is not allowed.
- `buildNotEligibleResponse()` in `src/response-builder.ts` already assigns `internals: null`.
- All NOT_ELIGIBLE constructions go through `buildNotEligibleResponse()` — no inline literals in tests.

## RawMatchDistribution in Tests (FIX-ROUND2 F2)
- Use `buildTestRawDistribution(cells)` from `test/helpers/branded-factories.ts` instead of `{...} as any`.
- `as any` on distribution bypasses the branded type contract. Use the factory.
- File `tc-056-074-calibration-response.test.ts` now imports `buildTestRawDistribution`.

## Known Precision Pattern
The scoreline sort uses epsilon-based tie-breaking (§16.11 deterministic by score string). In rare cases two consecutive scorelines differ by sub-epsilon amounts (3 ULPs). Tests must use `>= next - EPSILON_PROBABILITY` tolerance, not strict `>=`.

## Spec Sections with Potential Ambiguity
- §19.1 says raw_1x2_probs must sum to 1 ± epsilon, but this only holds after renormalization (raw distribution has tail mass). Tests correctly verify on renormalized distributions only.
- §16.11 tie-break by score string is deterministic but can produce sub-epsilon adjacent pairs.
- §21.3 + §16.2 conflict on LIMITED_MODE: spec says core must be present AND visible 1X2 must derive from calibrated. PE-FIX-F002 resolution: calibrated fields are null in LIMITED_MODE core (not raw proxies).

## Conformance Verdict (Phase 6 — post fixes)
- Calibrated 1X2 family: PASS
- Raw Goal/Scoreline family: PASS (totals-split invariant now covered)
- DNB: PASS
- Operating Modes: PASS
- Anti-Leakage: PASS
- Reconstruction: PASS
- Metrics bundle: PASS
- Overall: CONFORMANT
