# QA Agent Memory — SportPulse Predictive Engine v1.3

## Session context
Agent: QA / Property Testing Agent
Spec: `docs/specs/SportPulse_Predictive_Engine_Spec_v1.3_Final.md`
Test plan: `docs/specs/SportPulse_Predictive_Engine_v1.3_Conformance_Test_Plan.md`
Implementation root: `packages/prediction/src/`
Conformance suite: `packages/prediction/test/conformance/`

## Conformance test files created
| File | TC range | Gate |
|------|----------|------|
| `tc-001-012-match-input-contracts.test.ts` | TC-001–012 | G1 |
| `tc-013-024-competition-profile.test.ts` | TC-013–024 | G1 |
| `tc-025-040-eligibility-modes.test.ts` | TC-025–040 | G1 |
| `tc-041-055-raw-engine.test.ts` | TC-041–055 | G2 |
| `tc-056-074-calibration-response.test.ts` | TC-056–074 | G1+G2 |
| `tc-075-086-competition-engine.test.ts` | TC-075–086 | G3 |
| `tc-087-094-temporal-antileakage.test.ts` | TC-087–094 | G4 |
| `tc-095-105-metrics-reporting.test.ts` | TC-095–105 | G4 |

## Final test count
843 tests total (33 test files), all passing.

## Key implementation facts to remember

### Distribution type
`RawMatchDistribution` = `Record<ScorelineKey, number>` where keys are `"i-j"` strings.
Access pattern: `(distribution as Record<string, number>)['0-0']` — NOT a 2D array.

### top_scorelines shape
Each entry is `{ score: string, p: number }` — NOT `{ home_goals, away_goals, probability }`.
Spec §16.11. The `score` field is a string like `"1-0"`, `p` is the probability.

### renormalizeDistribution
Standalone exported function: `renormalizeDistribution(distribution)` from `engine/scoreline-matrix.ts`.
NOT a method on the distribution result object.

### StandingEntry fields
Uses `wins`, `draws`, `losses` — NOT `won`, `drawn`, `lost`.
Also has `draw_lot_required: boolean`.

### MatchResult
Requires `match_id: string` (mandatory). Always provide it in test fixtures.

### Bracket POSITION_SEEDED
Validates no same-group matchup. When testing bracket phase transitions, use different `group_id` values for the two qualifier teams.

### THIRD_PLACE_DEPENDENT combination key
Built from `group_id`s of qualifiers with `qualified_from_position === 3`, sorted and joined.
A single third-place qualifier from group 'B' → key is `'B'` (not `'AB'`).

### require() not valid in ESM context
This project uses ESM. Never use `require()` in tests. Use top-level `import` statements.
Dynamic imports need `async` test functions.

## Two probability families — strict separation
- **Calibrated 1X2 family**: `p_home_win`, `p_draw`, `p_away_win`, double chance, DNB, `predicted_result`, `favorite_margin`
- **Raw goal/scoreline family**: xG, over/under totals, BTTS, team totals, clean sheets, win-to-nil, low_scoring_risk, scorelines
Never assert one family's invariants against the other.

## Key conformance findings
- **ZERO bugs found** — all 843 tests pass
- Implementation is fully conformant with spec v1.3
- top_scorelines count = 5 (not 3, confirmed §16.11)
- epsilon_display: zero references (TC-072 PASS confirmed)
- DNB: computed from calibrated, sum = 1 by construction
- tail_mass_raw: properly flagged, no silent renormalization
- Family separation: enforced at TypeScript branded-type level

## Over/under invariant nuance
- For **renormalized** distributions: `over_2_5 + under_2_5 = 1.0` (§19.3)
- For **raw** (non-renormalized) distributions: `over_2_5 + under_2_5 = 1 - tail_mass_raw`
Both are tested separately. Never conflate.

## Sort order tolerance
The `top_scorelines` sort uses `EPSILON_PROBABILITY = 1e-9` for equality.
When asserting sort order, use `expect(a - b).toBeGreaterThanOrEqual(-1e-9)` not `>=`.

## Constants (§4)
- `EPSILON_PROBABILITY` = 1e-9
- `EPSILON_DNB_DENOMINATOR` = 1e-9
- `MAX_TAIL_MASS_RAW` = 0.01
- `TOO_CLOSE_MARGIN_THRESHOLD_DEFAULT` = 0.02
- `PRIOR_RATING_MAX_AGE_DAYS` = 400
- `PRIOR_RATING_MIN_UPDATES_LAST_730D` = 3
- `PRIOR_RATING_CROSS_SEASON_CARRY_ALLOWED` = true
- `MIN_BUCKET_SAMPLE_FOR_CALIBRATION_EVAL` = 100
- `MATRIX_MAX_GOAL_DEFAULT` = 7
