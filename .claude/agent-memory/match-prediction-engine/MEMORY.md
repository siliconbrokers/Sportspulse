# Match Prediction Engine — Agent Memory

## Spec → Implementation Mapping

| Spec Section | File(s) | Key Notes |
|---|---|---|
| §10.1 | `store/rating-pool.ts` | Two separate pools: ClubRatingPool, NationalTeamRatingPool. DEFAULT_ELO=1500 |
| §6.1, §20 | `engine/elo-rating.ts` | K_FACTOR_BASE=20, HOME_ADVANTAGE_ELO_DELTA=100, ELO_SCALE=400 |
| §10.2, §10.3 | `engine/bridging.ts` | BridgingResult discriminated union (canBeFull: true/false) |
| §14.1, §6.1 | `engine/lambda-computer.ts` | BASE_GOALS_PER_TEAM=1.35, log-linear formula via exp(diff/400) |
| §14.2, §19.2 | `engine/scoreline-matrix.ts` | 8×8 matrix (0..7), tail_mass_raw, no silent renorm |
| §16.1 | `engine/raw-aggregator.ts` | Aggregates home/draw/away from distribution cells |
| §16.5–§16.11 | `engine/derived-raw.ts` | All goal markets from raw distribution only |
| §15.3, §16.11 | `engine/scoreline-explainer.ts` | top_scorelines consistent with coverage metric |
| §17 (Phase 2c) | `calibration/` | Already implemented — isotonic calibration, version metadata |
| §5.3, §11–§13 (Phase 2b) | `validation/` | Already implemented — match, history, profile validators |
| §16.3–§16.4 (Phase 2c) | `engine/derived-calibrated.ts` | Double chance + DNB from calibrated probs |
| §16.12–§16.13 (Phase 2c) | `engine/decision-policy.ts` | predicted_result, favorite_margin from calibrated |

## Hard Invariants (implemented and tested)

1. `expected_goals_home = lambda_home` — direct assignment, no transform (§15.1)
2. `expected_goals_away = lambda_away` — same
3. Matrix is always (maxGoal+1)^2 cells, default 8×8 = 64 (§14.2)
4. `tail_mass_raw` must be calculated and persisted — never optional (§14.3)
5. No silent renormalization when `tail_mass_raw > MAX_TAIL_MASS_RAW` (§14.2)
6. `lambda_home > 0` and `lambda_away > 0` — epsilon floor applied (§14.1)
7. All goal/scoreline outputs come from `raw_match_distribution` (§19.5)
8. `btts_yes + btts_no = 1` invariant holds on renormalized distribution (§19.3)
9. `over_2_5 + under_2_5 = 1` invariant holds on renormalized distribution (§19.3)
10. `top_scorelines` ordering is consistent with `top_5_scoreline_coverage` metric (§23.2)

## Constants and their spec sources

| Constant | Value | Spec Source |
|---|---|---|
| `DEFAULT_ELO_RATING` | 1500 | §20.1 (minimal safe assumption — standard Elo origin) |
| `K_FACTOR_BASE` | 20 | §6.1 (minimal safe assumption — standard club football K) |
| `HOME_ADVANTAGE_ELO_DELTA` | 100 | §6.1 (minimal safe assumption — ~64% home win probability) |
| `ELO_SCALE` | 400 | §6.1 (standard Elo scale factor) |
| `BASE_GOALS_PER_TEAM` | 1.35 | §6.1 (minimal safe assumption — European football average) |
| `ELO_LAMBDA_SCALE` | 400 | §14.1 (same as ELO_SCALE for consistency) |
| `MAX_TAIL_MASS_RAW` | 0.01 | §4.3 (from contracts/constants.ts) |
| `MATRIX_MAX_GOAL_DEFAULT` | 7 | §14.2 (from contracts/constants.ts) |
| `EPSILON_PROBABILITY` | 1e-9 | §4.1 (from contracts/constants.ts) |

## Spec Ambiguities Resolved

1. **K-factor value**: Spec §6.1 lists K-factor as a required adjustment category but gives no value.
   - Resolution: K=20 (industry standard for club domestic leagues). Assumption is isolated — changing it requires only updating `K_FACTOR_BASE`.
   - Risk: LOW — formula structure is correct; only tuning needed.

2. **Lambda conversion formula**: Spec mandates "Elo extendido + Poisson" but gives no explicit formula.
   - Resolution: `lambda = BASE_GOALS * exp(eloDiff / ELO_LAMBDA_SCALE)` (log-linear, symmetric).
   - Risk: LOW — preserves invariants (lambda > 0, symmetric for equal teams).

3. **Home advantage Elo delta**: Spec §6.1 says "localía" is required but gives no value.
   - Resolution: 100 Elo points (standard, ~64% home win for equal teams).
   - Risk: LOW — value affects calibration, not structural correctness.

4. **policyVersion**: `CURRENT_MODEL_VERSION = 'v1.0'` (from calibration/version-metadata.ts).

## Package Structure

- `packages/prediction/src/contracts/` — Phase 1 (types, constants)
- `packages/prediction/src/store/` — Phase 2a (rating pools)
- `packages/prediction/src/engine/` — Phase 2a+2c+T3 (all computation)
- `packages/prediction/src/engine/v3/` — V3 engine modules
- `packages/prediction/src/validation/` — Phase 2b (validators)
- `packages/prediction/src/calibration/` — Phase 2c (calibration)
- `packages/prediction/test/engine/` — all engine tests

## V3 Engine — T3 Tier Modules (MKT-T3-00, 2026-03-15)

| Module | File | Purpose |
|--------|------|---------|
| xg-augment | `engine/v3/xg-augment.ts` | `augmentMatchesWithXg`, `computeXgCoverage` |
| absence-adjustment | `engine/v3/absence-adjustment.ts` | `computeAbsenceMultiplier` — injuries + lineup |
| market-blend | `engine/v3/market-blend.ts` | `blendWithMarketOdds` — post-Poisson 1X2 blend |

T3 constants: `XG_PARTIAL_COVERAGE_THRESHOLD=0.5`, `ABSENCE_IMPACT_FACTOR=0.04`, `ABSENCE_MULT_MIN=0.85`, `LINEUP_MISSING_STARTER_IMPORTANCE=0.4`, `DOUBTFUL_WEIGHT=0.5`, `MARKET_WEIGHT=0.15`, `MARKET_WEIGHT_MAX=0.30`, `MARKET_ODDS_SUM_TOLERANCE=1e-4`

**SP-V4-12/13 new constants:** `MIN_IMPORTANCE_THRESHOLD=0.3`, `POSITION_IMPACT: {GK: {atk:0.01, def:0.06}, DEF: {atk:0.01, def:0.035}, MID: {atk:0.03, def:0.02}, FWD: {atk:0.05, def:0.01}}`

T3 pipeline order: anti-lookahead → [T3-01 xG augment] → baselines/stats → lambdas → rest → H2H → [T3-02/03 absence mult] → clamp → Poisson → [T3-04 market blend] → computeMarkets (original matrix)

**SP-V4-13 absence cross-team application:**
```
lambda_home *= mult_home (home attack) * mult_defense_away (away defense absent)
lambda_away *= mult_away (away attack) * mult_defense_home (home defense absent)
```

T3 retrocompatibilidad: all T3 fields undefined → bit-exact output to pre-T3 engine (T3-REG invariant)

**SP-V4-12 injury-source.ts enrichment:** Player stats disk cache (30d TTL) at `cache/player-stats/{season}/{playerId}.json`. `importance = minutesPlayed / (games × 90)`. Players with `importance < 0.3` filtered out (squad depth). Fallback to static (GK=0.75, else=0.60) on API error. Position extracted from `player.type` field in injuries response.

## Key Design Decisions

- `Raw1x2Probs` brand isolation: created via `as unknown as Raw1x2Probs` cast in aggregator (unique symbol cannot be imported cross-module — this is intentional; TypeScript enforces brand at type-check time).
- `tail_mass_raw > MAX_TAIL_MASS_RAW` policy: engine returns `tailMassExceeded: true` flag — policy action (degrade/expand/audit) is the CALLER's responsibility, not the engine's.
- Pool separation is via factory functions, not a global registry — callers manage pool lifecycle.
- T3-04 market blend: ONLY affects top-level 1X2 and predicted_result. `computeMarkets` always uses the original Poisson matrix (not blended) to preserve O/U, BTTS, scoreline structural integrity.

## V4 Fase 3 — SP-V4-20/21 (Logistic + Ensemble)

| Module | File | Purpose |
|--------|------|---------|
| logistic-model | `engine/v3/logistic-model.ts` | `extractLogisticFeatures`, `predictLogistic`, `DEFAULT_LOGISTIC_COEFFICIENTS` |
| ensemble | `engine/v3/ensemble.ts` | `combineEnsemble` — weighted avg of Poisson + Market + Logistic |
| train-logistic | `tools/train-logistic.ts` | CLI: walk-forward data → gradient descent → `cache/logistic-coefficients.json` |

V4-20/21 constants: `ENSEMBLE_WEIGHTS_DEFAULT={w_poisson:0.70, w_market:0.15, w_logistic:0.15}`

`collectIntermediates=true` in V3EngineInput → populates `output._intermediates` (only for train-logistic.ts — never in production).

**SP-V4-23 INTEGRATED** (2026-03-17). `ENSEMBLE_ENABLED=false` default → T3-REG invariant preserved. Activate via `_overrideConstants.ENSEMBLE_ENABLED=true`. engine_version bumped to '4.3'.

First train run (2026-03-17): 718 examples (PD+PL+BL1), in-sample accuracy 51.5%. DRAW class bias (0 draws predicted) is a known imbalanced-class behavior — SP-V4-24 calibration will address.

**SP-DRAW-V1 re-train (2026-03-17):** 2673 examples (3 ligas × 3 seasons), 23 features. Draw-rate coefficients all < 0.04 (threshold 0.1). Ensemble backtest: acc −1.7pp (54.9→53.2%), DRAW recall −2.8pp. **SP-V4-33 CLOSED — no improvement. ENSEMBLE_ENABLED stays false.**

## NEXUS Fase 1B — Track 1 Injury + Lineup (2026-03-18)

| Module | File | Purpose |
|--------|------|---------|
| injury-impact | `nexus/track1/injury-impact.ts` | `computeInjuryImpact`, position weights, MISSING sentinel |
| lineup-adjuster | `nexus/track1/lineup-adjuster.ts` | `computeLineupAdjustment`, GK baseline check, MISSING when no lineup |

**CRITICAL spec corrections vs task prompt:**
- `PositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD'` — NOT 'ATK'. Prompt used 'ATK' which conflicts with entity-identity/types.ts line 101. Always use 'FWD'.
- `BaselineSquad` fields are camelCase: `baselinePlayers`, `confirmedAbsences`, `confirmedLineup` (not snake_case).
- `MAX_ABSENCE_ADJUSTMENT = 0.20` (taxonomy spec S3.2 Ext 2) — impact capped at 20%, not 1.0.
- `DOUBT_WEIGHT = 0.5` already constant in entity-identity/types.ts — import from there.

**Phase 1B constants:**
- `DEFAULT_POSITION_IMPACT_WEIGHTS`: GK=0.18, DEF=0.12, MID=0.08, FWD=0.06
- `MAX_ABSENCE_ADJUSTMENT = 0.20` (taxonomy spec S3.2 Ext 2)
- `GK_MISSING_FROM_LINEUP_DELTA = -0.18` (lineup-adjuster.ts)

**Integration:** `computeTrack1` accepts optional `phase1bOptions?: Phase1bOptions` (8th param). When absent: injury_data_available=false, MISSING sentinel. Backward-compatible — all Phase 1A tests still pass.

## NEXUS Track 3 — Tabular Discriminative Model (2026-03-18)

Spec: taxonomy spec S5.1–S5.7 (context features, logistic model, output contract)

| Module | File | Purpose |
|--------|------|---------|
| types | `nexus/track3/types.ts` | Track3FeatureVector, Track3Output, Track3Confidence, SeasonPhase, CompetitiveImportance |
| context-features | `nexus/track3/context-features.ts` | computeRestDays, computeMatchesLast4Weeks, computeFormGeneral, computeFormSplit, computeH2hFeatures, deriveCompetitiveImportance, deriveSeasonPhase, buildTrack3FeatureVector |
| logistic-model | `nexus/track3/logistic-model.ts` | predictLogistic, DEFAULT_LOGISTIC_WEIGHTS, LogisticWeights, softmax3 |
| track3-engine | `nexus/track3/track3-engine.ts` | computeTrack3, CONTEXT_MODEL_VERSION='1.0.0', FEATURE_SCHEMA_VERSION='1.0.0' |

**Track 3 isolation invariant:** track3/ has zero imports from engine/v3/ (master S8.4, S8.5).

**Anti-lookahead:** All feature functions filter `history` by `utcDate < buildNowUtc` (strict less-than, NEXUS-0 S3.2). The `filterByAsOf` helper is the single enforcement point.

**MISSING handling in logistic model:** MISSING features contribute 0 to linear combination (explicit neutral imputation, not global mean). This is documented and allowed for logistic regression per taxonomy spec S5.4b.

**H2H features:** Conditionally eligible (taxonomy spec S5.3.2). Computed and stored in feature vector but NOT included in DEFAULT_LOGISTIC_WEIGHTS until lift demonstrated.

**Confidence thresholds:**
- HIGH: >= 7 of 9 features present
- MEDIUM: 4-6 present
- LOW: < 4 present

Note: with even 1 match per team, nearly all 9 features are available (formGeneral uses own prior). Zero history → LOW confidence (only eloDiff is non-zero).

## Test Coverage

- **1371 tests total** in `packages/prediction/test/` (49 test files) — as of 2026-03-18 NEXUS Track 3
- `test/nexus/track3.test.ts` — 36 tests (T3-01..T3-15: anti-lookahead, H2H, form split, prob invariants, confidence, isolation, rest days, schedule congestion)
- `test/nexus/track1-1b.test.ts` — 27 tests (T1B-01..T1B-27: injury impact, lineup adjuster, integration)
- `test/nexus/track1.test.ts` — 39 tests (Phase 1A — all still passing)
- `test/engine/logistic-model.test.ts` — 32 tests (SP-V4-20)
- `test/engine/ensemble.test.ts` — 28 tests (SP-V4-21)
- `test/engine/tier3-signals.test.ts` — 39 tests (MKT-T3-00)
- `test/engine/sos-recency.test.ts` — 11 tests (SP-V4-05)
- `test/engine/elo-rating.test.ts` — 19 tests (Phase 2a)
- `test/engine/scoreline-matrix.test.ts` — 23 tests (Phase 2a)
- `test/engine/raw-aggregator.test.ts` — 8 tests (Phase 2a)
- `test/engine/derived-raw.test.ts` — 17 tests (Phase 2a)
- All Phase 2b and 2c tests also pass (48 test files total)
- 1 pre-existing failure: `match-validator.test.ts` F-005 (catalog size — unrelated to engine)

## SoS Invariant (SP-V4-05)

**rival_adjustment (§8) already captures SoS effect.** Adding SoS weighting on top of RA signals introduces double-counting: `attack_signal_i = goals / rival_defense_eff_i` — the signal is already amplified by rival strength. Extra weight = over-counting.

**Sweep confirmado 2026-03-17** con pipeline de producción completo (calibración + market odds + per-league rho, n=638–639):

| SoS   | acc%   | DR%   | DP%   | AR%   | composite |
|-------|--------|-------|-------|-------|-----------|
| 0.00  | 54.86  | 28.22 | 35.66 | 45.05 | 0.4111    |
| 0.05  | 54.86  | 28.22 | 35.66 | 45.05 | 0.4111    |
| 0.10  | 54.86  | 28.22 | 35.38 | 45.05 | 0.4103    |
| 0.15+ | 54.77  | 28.22 | 35.11 | 44.81 | 0.4091    |

Conclusión: **SOS_SENSITIVITY=0.0 es óptimo.** Ningún valor del grid supera el baseline en accuracy. A SoS≥0.15 hay degradación leve. `MatchSignalRA.rivalStrength` mantenido como extension point. Artefacto: `cache/sos-sweep.json`, audit: `docs/audits/PE-audit-2026-03-17.md §SP-V4-05`.
