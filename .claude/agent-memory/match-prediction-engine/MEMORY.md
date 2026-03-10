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
- `packages/prediction/src/engine/` — Phase 2a+2c (all computation)
- `packages/prediction/src/validation/` — Phase 2b (validators)
- `packages/prediction/src/calibration/` — Phase 2c (calibration)
- `packages/prediction/test/engine/` — all engine tests (190 total, all pass)

## Key Design Decisions

- `Raw1x2Probs` brand isolation: created via `as unknown as Raw1x2Probs` cast in aggregator (unique symbol cannot be imported cross-module — this is intentional; TypeScript enforces brand at type-check time).
- `tail_mass_raw > MAX_TAIL_MASS_RAW` policy: engine returns `tailMassExceeded: true` flag — policy action (degrade/expand/audit) is the CALLER's responsibility, not the engine's.
- Pool separation is via factory functions, not a global registry — callers manage pool lifecycle.

## Test Coverage

- 190 tests total in `packages/prediction/test/`
- `test/engine/elo-rating.test.ts` — 19 tests (Phase 2a)
- `test/engine/scoreline-matrix.test.ts` — 23 tests (Phase 2a)
- `test/engine/raw-aggregator.test.ts` — 8 tests (Phase 2a)
- `test/engine/derived-raw.test.ts` — 17 tests (Phase 2a)
- All Phase 2b and 2c tests also pass (11 test files total)
