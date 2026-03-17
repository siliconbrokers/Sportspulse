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

### Calibration empirical results (2026-03-17, sesión 6 — final)
- Calibration set: 1955 matches (PD=699, PL=699, BL1=557) — 2-season training
- Mixed strategy: PD=per-liga, PL=global, BL1=global
- Pipeline: Poisson → MarketBlend → Calibration → DrawAffinity → PredictedResult
- **_skipDrawAffinity=true during calibration tuple generation** (training/inference consistency)
- Final results (MIXTA, K=3/PEG=16/β=0.20/DC_RHO=-0.15/POWER=2.0/BETA_LOW=1.00):
  acc=50.7%, DR=51.6%, DP=35.1%, AR=19.6%

### Draw Affinity Hyperparameter Sweep (2026-03-17 sesión 6)
- Grid: DRAW_AFFINITY_POWER ∈ {1.0..3.0} × DRAW_LOW_SCORING_BETA ∈ {0.0..1.0} = 25 combos
- Constraint-satisfying winner: POWER=2.0, BETA=1.00 (acc>49.5%, DR>48%, DP +0.8pp)
- Composite-score winner POWER=1.0/BETA=0.25 discarded: acc=48.4% violates floor
- DRAW_LOW_SCORING_BETA = 0.50 → 1.00 (DRAW_AFFINITY_POWER unchanged at 2.0)

### DC_RHO per-liga (2026-03-17, sesión 7 — SP-V4-03)
- `DC_RHO_PER_LEAGUE` in `constants.ts`: PD=-0.25, PL=-0.19, BL1=-0.14
- Sweep: range [-0.25, 0.00] step 0.01, base K=3/PEG=16/β=0.20/DA_POWER=2.0/DA_BETA=1.00
- `V3EngineInput.leagueCode?: string` added to `types.ts`
- Engine lookup: `(leagueCode != null && DC_RHO_PER_LEAGUE[leagueCode] != null) ? DC_RHO_PER_LEAGUE[leagueCode]! : DC_RHO`
- `dcRhoOverride` always takes precedence over per-league (backward-compatible with sweep tools)
- Global result: acc=51.4%, DR=53.8%, DP=36.5% vs baseline (50.7%/51.6%/35.1%) → composite +0.026
- Tool: `tools/sweep-rho-per-league.ts`

### Production integration path
- v3-shadow-runner.ts loads `cache/calibration/v3-iso-calibration*.json` (per-liga + global)
- `getCalTableForCompetition(competitionId)` maps to per-liga or global table
- Tables regenerated after every constants change via `npx tsx tools/gen-calibration.ts all`

## Build Verification
- `pnpm --filter @sportpulse/prediction build` — compile check
- `pnpm --filter @sportpulse/prediction test` — 1171/1172 pass (1 pre-existing unrelated failure: match-validator catalog size)

## Current V4.3 Constants State (2026-03-17 sesión 8 — SP-V4-11 + SP-V4-22)
| Constant | Value | Source |
|----------|-------|--------|
| K_SHRINK | 3 | hyperparams sweep |
| PRIOR_EQUIV_GAMES | 16 | hyperparams sweep |
| BETA_RECENT | 0.20 | hyperparams sweep |
| DC_RHO | -0.15 | global fallback |
| DC_RHO_PER_LEAGUE | PD=-0.25, PL=-0.19, BL1=-0.14 | per-liga sweep SP-V4-03 |
| SOS_SENSITIVITY | 0.0 | SoS sweep SP-V4-05 |
| DRAW_AFFINITY_ALPHA | 0.50 | alpha tuning |
| DRAW_AFFINITY_POWER | 2.0 | draw_affinity sweep |
| DRAW_LOW_SCORING_BETA | 1.00 | draw_affinity sweep |
| DRAW_FLOOR | 0.27 | floor sweep |
| DRAW_MARGIN | 0.12 | margin sweep |
| **MARKET_WEIGHT** | **0.20** | **SP-V4-11 sweep: +0.0082 composite vs 0.15** |
| ENSEMBLE_WEIGHTS_DEFAULT.w_poisson | 0.80 | SP-V4-22 3-source corrected |
| ENSEMBLE_WEIGHTS_DEFAULT.w_market | 0.20 | SP-V4-11: odds históricas activas |
| ENSEMBLE_WEIGHTS_DEFAULT.w_logistic | 0.00 | SP-V4-22: no mejora sobre Poisson+Market |

## SP-V4-11 + SP-V4-22 — Market Weight Override Architecture (2026-03-17 sesión 8)
- `_overrideConstants.MARKET_WEIGHT?: number` en `types.ts` — permite sweep sin mutar constants.ts
- `blendWithMarketOdds(... , marketWeightOverride?)` — 5to parámetro opcional en `market-blend.ts`
- `backtest-v3.ts --market-weight <val>` — flag CLI para inyectar override
- `tools/sweep-market-weight.ts` — NUEVO: grid MARKET_WEIGHT ∈ [0.00..0.30], 718 matches, 100% odds coverage
- `sweep-ensemble-weights.ts` — CORREGIDO: 3 fuentes, lee w_market óptimo de `cache/market-weight-sweep.json`
- Sweep results: MARKET_WEIGHT=0.20 óptimo | w_logistic=0.00 no añade valor sobre Poisson+Market
- Walk-forward final (--ensemble, MARKET_WEIGHT=0.20): acc=50.6%, DR=51.7%, log_loss=1.0066, RPS=0.1999

## engine_version History
- `'3.0'` — SP-PRED-V3 unified engine (sesiones 1-6)
- `'4.1'` — SP-V4 Fase 1: xG + rho per-liga + SoS + calibración post-Fase1 (2026-03-17)
- `'4.2'` — SP-V4 Fase 2: MarketBlend + InjurySource minutos + POSITION_IMPACT + calibración post-Fase2 (2026-03-17)
- `'4.3'` — SP-V4-11+V4-22: MARKET_WEIGHT=0.20, ENSEMBLE_WEIGHTS_DEFAULT 3-source corregido (2026-03-17)

## Calibration Tables (post-F2, 2026-03-17)
- Regeneradas con: 1955 tuplas (PD=699, PL=699, BL1=557), pipeline Fase 2 + xG en backtest
- Estrategia MIXTA: PD=per-liga, PL=global, BL1=global
- Walk-forward MIXTA **CON xG**: acc=49.5%, DR=68.2%, DP=31.6%, AR=22.4%
- xG efecto neto vs baseline sin xG: −1.7pp acc, +25.2pp DRAW recall — intencional trade-off
- Training/inference mismatch residual: calibración entrenada sin xG (2023-25 no tiene cache xG) es aceptable
- Tablas: `cache/calibration/v3-iso-calibration*.json` (global + PD + PL + BL1)

## Fix F2 — xG en gen-calibration.ts (CLOSED 2026-03-17)
- `loadXgByDate(afLeagueId, 2025)` — lee `cache/xg/{id}/2025/*.json`, indexa por `normalizeUtcDate` (`+00:00`→`Z`)
- `buildXgRecords(matches, xgByDate)` — cross-namespace join: usa football-data teamIds del match + xG de API-Football por fecha
- `backtestLeague2526()` pasa `historicalXg` y `leagueCode` al engine — alineado con producción
- xG 2025-26 cobertura: PD=100%, PL=~100%, BL1=~100%
- No hay xG para 2023-24 ni 2024-25 (no se pueden enriquecer las tuplas de calibración)
