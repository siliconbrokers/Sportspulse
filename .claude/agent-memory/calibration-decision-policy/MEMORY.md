# Calibration & Decision Policy Agent — Persistent Memory

## Package Location
- Module: `packages/prediction/src/`
- Calibration: `src/calibration/` (isotonic-calibrator.ts, calibration-selector.ts, version-metadata.ts)
- Engine: `src/engine/` (derived-calibrated.ts, decision-policy.ts)
- Metrics: `src/metrics/` (calibration-metrics.ts)
- Tests: `test/calibration/`, `test/engine/`, `test/metrics/`

## Spec Authority
- Governing spec: `docs/specs/SportPulse_Predictive_Engine_Spec_v1.3_Final.md`
- Key sections: §15.1, §16.2–16.4, §16.12–16.13, §17, §19.3–19.5, §23, §24

## Decision Policy

### Version Registry (`src/calibration/version-metadata.ts`)
- `CURRENT_DECISION_POLICY_VERSION = 'v1.0'`
- `too_close_margin_threshold = 0.02` (v1.0)
- Changing threshold requires new version entry in `DECISION_POLICY_REGISTRY`

### predicted_result Values
- Spec §16.12 uses `'TOO_CLOSE'` — NOT `'CONFLICT'`
- Values: `'HOME' | 'DRAW' | 'AWAY' | 'TOO_CLOSE'`
- Condition: `decision_margin < too_close_margin_threshold` (strict less-than)

## Calibration Segment Thresholds (§17.2)
- `>= 1000` samples: 'segmented' tier — use segment calibrator
- `300 <= count < 1000`: 'intermediate' tier — optional, must be versioned
- `< 300` samples: 'global' tier — mandatory fallback to global calibrator
- Constants in `calibration-selector.ts`: `MIN_SAMPLES_FOR_SEGMENTED_CALIBRATION=1000`, `MIN_SAMPLES_FOR_INTERMEDIATE_CALIBRATION=300`

## DNB Invariant — Critical Implementation Detail
- §19.4: `dnb_home + dnb_away = 1.0 EXACTLY`
- Formula per §16.4: `dnb_home = p_home / (1 - p_draw)`, `dnb_away = 1 - dnb_home`
- NOT: `dnb_away = p_away / (1 - p_draw)` — this yields 0.9999999999999999 in IEEE 754
- The `1 - dnb_home` form guarantees exact IEEE 754 sum = 1.0

## DNB Formula (§16.4)
- Denominator = `(1 - p_draw)` — NOT `(p_home + p_away)` (though algebraically equal when probs sum to 1)
- Null when `1 - p_draw <= EPSILON_DNB_DENOMINATOR` (1e-9)

## Temporal Leakage Guard (§17.3)
- `TemporalLeakageError` thrown in `IsotonicCalibrator.fit()` when `sample.match_timestamp_ms > prediction_cutoff_ms`
- Strict greater-than: equal timestamps are allowed

## Pre-existing Phase 2b Bugs Fixed (match-validator.ts)
- Line 416: `operatingMode === 'NOT_ELIGIBLE'` comparison — fixed to `eligibilityStatus = 'ELIGIBLE'` (NOT_ELIGIBLE always returns early)
- Line 552: TypeScript false-positive narrowing on `competition_family` — cast to `string` to bypass

## Metrics Reporting Rule (§23.2)
- NEVER report `conditional_accuracy` alone
- Always include: `inclusive_accuracy` + `conditional_accuracy` + `effective_prediction_coverage` + `too_close_rate`
- `FullCalibrationMetrics` is the authoritative bundle type
- TOO_CLOSE predictions are in the denominator of coverage (not silently excluded)

## Calibration Algorithm
- PAVA (Pool Adjacent Violators) for isotonic regression
- One calibrator per class (HOME, DRAW, AWAY) — one-vs-rest
- After per-class calibration: renormalize so sum = 1.0 (§16.3)
- Degenerate case (all three calibrated = 0): uniform fallback (1/3 each)

## FIX #64 — F-002: LIMITED_MODE core calibration fields (§16.2)
- In LIMITED_MODE: `p_home_win`, `p_draw`, `p_away_win`, `predicted_result`, `predicted_result_conflict`, `favorite_margin`, `draw_risk` = `null`
- Raw probs MUST NOT substitute in calibrated slots — violates §16.2 family separation
- Only `expected_goals_home/away` (lambda-derived) remain non-null in LIMITED_MODE core
- `PredictionCore` type: all calibration-derived fields are `number | null` / `PredictedResult | null` / `boolean | null`
- `internals.calibrated_1x2_probs` = `null` in LIMITED_MODE (never raw fallback)
- `internals.calibration_mode` = `'not_applied'` in LIMITED_MODE

## FIX #65 — F-003: calibration_mode bootstrap declaration (§17.2)
- `CalibrationVersionMetadata` has optional field `calibration_mode?: 'bootstrap' | 'trained'`
- `buildCurrentVersionMetadata(mode = 'bootstrap')` — defaults to bootstrap (no training data yet)
- `PredictionResponseInternals.calibration_mode: 'bootstrap' | 'trained' | 'not_applied'`
- `buildInternals()` resolves: `null calibrated1x2` → `'not_applied'`; else `versionMetadata.calibration_mode ?? 'trained'`
- When plugging in a real trained CalibrationRegistry, pass `'trained'` to `buildCurrentVersionMetadata()`
- Architecture allows swapping calibrators without structural changes — only the mode flag changes

## Build Verification
- `pnpm --filter @sportpulse/prediction build` — compile check
- `pnpm --filter @sportpulse/prediction test` — 880 tests pass (as of FIX #64/#65)
