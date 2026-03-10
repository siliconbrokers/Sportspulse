# Domain & Contracts Agent Memory
# SportPulse Predictive Engine v1.3

## Key Files Created (Phase 1)

All contracts live in `packages/prediction/src/contracts/`:

| File | Role |
|------|------|
| `constants.ts` | All §4 constants (epsilons, thresholds, matrix defaults) |
| `types/competition-profile.ts` | CompetitionProfile, KnockoutResolutionRules, GroupRankingRules, TieBreakRules, LeaguePhaseRules, QualificationRules + string literal types for domain/family/stage/format/leg |
| `types/match-input.ts` | MatchInput v1 with schemaVersion: 1 literal |
| `types/operating-mode.ts` | EligibilityStatus, OperatingMode, ApplicabilityLevel (string literal unions, NOT enums) |
| `types/validation-result.ts` | ValidationResult, DataIntegrityFlags, ReasonCode |
| `types/prior-rating.ts` | PriorRating, PriorRatingConditions |
| `types/league-strength.ts` | LeagueStrengthFactorRecord |
| `types/prediction-response.ts` | Full PredictionResponse discriminated union + all nested types |
| `contracts/index.ts` | Barrel re-exporting all contracts |
| `src/index.ts` | Package entry point |

## Critical Design Decisions

### Naming Conflict: StageType
`packages/canonical/src/model/enums.ts` exports `StageType` with DIFFERENT values
than spec §8.1 requires (plural QUARTER_FINALS vs singular QUARTER_FINAL, missing
QUALIFYING/THIRD_PLACE/LEAGUE_PHASE). Resolution: prediction contracts use
`PredictiveStageType` (not `StageType`) to avoid collision.

### PredictiveStageType values (spec §8.1)
`QUALIFYING | GROUP_STAGE | LEAGUE_PHASE | PLAYOFF | ROUND_OF_32 | ROUND_OF_16 |
QUARTER_FINAL | SEMI_FINAL | THIRD_PLACE | FINAL`

### Canonical StageType values (do not use in prediction contracts)
`LEAGUE | GROUP_STAGE | ROUND_OF_32 | ROUND_OF_16 | QUARTER_FINALS | SEMI_FINALS |
FINAL | PLAYOFF | CUSTOM`

### OperatingMode — string literal union, NOT TypeScript enum
Spec §11.1 values: `'FULL_MODE' | 'LIMITED_MODE' | 'NOT_ELIGIBLE'`

### CompetitionFamily — spec §8.1 values
`'DOMESTIC_LEAGUE' | 'DOMESTIC_CUP' | 'INTERNATIONAL_CLUB' | 'NATIONAL_TEAM_TOURNAMENT'`

### NOT_ELIGIBLE Discriminated Union
`PredictionResponse` is a discriminated union on `eligibility_status`.
- `PredictionResponseEligible` (eligibility_status: 'ELIGIBLE') — has `predictions: PredictionOutputs`
- `PredictionResponseNotEligible` (eligibility_status: 'NOT_ELIGIBLE') — `predictions` field is structurally absent
This makes it TYPE-IMPOSSIBLE to put probabilities in a NOT_ELIGIBLE response.

### Raw vs Calibrated Type Incompatibility
`Raw1x2Probs` and `Calibrated1x2Probs` are branded interfaces (unique symbol brands).
They cannot be assigned to each other at compile time. Enforces §19.5 separation.

### PredictionResponsePublic
`type PredictionResponsePublic = Omit<PredictionResponseEligible, 'internals'> | Omit<PredictionResponseNotEligible, 'internals'>`
API layer MUST use this type, not PredictionResponse directly.

### KnockoutResolutionRules — ordered arrays
`second_leg_resolution_order?: readonly SecondLegResolutionStep[] | null`
`single_leg_resolution_order?: readonly SingleLegResolutionStep[] | null`
Array INDEX = resolution precedence. Never a map or flags object.

### TieBreakRules — spec §8.2
Boolean flags struct (NOT an ordered array). Ordered precedence is in
`GroupRankingRules.rank_by` (a separate concept). Do not conflate them.

### MatchInput schemaVersion
`readonly schemaVersion: 1` — literal type, compile-time version gate.

## Spec Ambiguities Resolved

1. `ApplicabilityLevel` in agent system prompt header listed COMPETITION|PHASE|ROUND|MATCH
   but spec §12/§13 consistently uses STRONG|CAUTION|WEAK. Spec governs. Used STRONG|CAUTION|WEAK.

2. `reasons` field typed as `ReasonCode[]` (string literal union), not `string[]`,
   to catch catalog violations at compile time.

3. `PredictionResponseInternals` — spec §21.1 says "internals = null" for NOT_ELIGIBLE,
   but also prohibits probabilities. Structural absence on NOT_ELIGIBLE variant is
   stronger than null; type on that variant is `internals?: null` only.

## Build Verification
`pnpm --filter @sportpulse/prediction build` — zero errors.
Full `pnpm build` — zero errors, all packages compile.

## Package Dependencies
`@sportpulse/prediction` depends on `@sportpulse/shared` and `@sportpulse/canonical`
per package.json. However, Phase 1 contracts import NOTHING from either package —
all types are self-contained primitives. This is intentional and correct.
