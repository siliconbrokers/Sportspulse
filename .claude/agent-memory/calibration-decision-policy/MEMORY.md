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

## Confidence Margin Downgrade (2026-03-17)
- `MARGIN_FOR_HIGH_CONFIDENCE = 0.12` in `constants.ts`
- `computeConfidence` has optional 5th param `favoriteMargin?` — if HIGH but margin < 0.12, degrades to MEDIUM
- `v3-engine.ts §15`: `prelimMargin = sortedProbs[0] - sortedProbs[1]` from final 1X2 probs, passed to `computeConfidence`
- Backward-compatible: callers without `favoriteMargin` still return HIGH unchanged
- `decision_policy_version` NOT bumped — confidence is metadata label, not policy-gated output

## §Cal Phase 5 — V3 Isotonic Calibration (2026-03-17)

### New types (engine/v3/types.ts)
- `CalibrationPoint { rawProb, calProb }` — piecewise-linear interpolation node
- `CalibrationTable { home, draw, away, nCalibrationMatches, fittedAt }` — disk-persisted table
- `V3EngineInput.calibrationTable?: CalibrationTable` — optional, backward-compatible

### New module (calibration/iso-calibrator.ts)
- `fitIsotonicRegression(pairs)` — PAVA, returns CalibrationPoint[]
- `interpolateCalibration(rawProb, points)` — piecewise-linear, clamps
- `applyIsoCalibration(p_home, p_draw, p_away, table)` — OvR + renorm §16.3

### v3-engine.ts wiring
- `finalProbHome/Draw/Away` changed from `const` to `let`
- Calibration step inserted after market-blend, before §15 confidence
- Import: `import { applyIsoCalibration } from '../../calibration/iso-calibrator.js'`

### tools/gen-calibration.ts
- Walk-forward on 2024-25 (prev-season.json), prevSeason = 2023.json historical
- Saves table to `cache/calibration/v3-iso-calibration.json`
- Run: `npx tsx --tsconfig tsconfig.server.json tools/gen-calibration.ts`

### Calibration empirical results (2026-03-17)
- Calibration set: 977 matches (PD=349, PL=350, BL1=278)
- DRAW table: only 10 points — max raw=0.374 → cal=0.284
- **DRAW recall with calibration: 0%** — calibration WORSENS draw recall
- Root cause: model's raw p_draw averaging 0.281 is already above empirical rate (~26%)
  After renorm, calibrated p_draw loses to p_home because HOME table pushes up
  at high raw values. Calibration is honest — fixing DRAW recall requires
  structural changes to the model (lambda bias, threshold lowering), NOT calibration.
- Global accuracy unchanged: 52.4% → 52.4% (no improvement, no regression)
- **Recommendation**: use calibration table cautiously in production; may reduce DRAW recall to 0

### Production integration path
- v3-shadow-runner.ts would load `cache/calibration/v3-iso-calibration.json`
  and pass as `calibrationTable` to `runV3Engine` — NOT YET WIRED in production
- The table is available but not auto-loaded; activation is explicit

## Build Verification
- `pnpm --filter @sportpulse/prediction build` — compile check
- `pnpm --filter @sportpulse/prediction test` — 1158/1159 pass (1 pre-existing unrelated failure: match-validator catalog size)
