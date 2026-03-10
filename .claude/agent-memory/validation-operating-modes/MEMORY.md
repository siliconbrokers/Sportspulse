# Validation & Operating Modes Agent — Persistent Memory

## Spec Location
- `/Users/andres/Documents/04_Flux/SportsPulse/docs/specs/SportPulse_Predictive_Engine_Spec_v1.3_Final.md`
- Version: 1.3 Final / Frozen for implementation

## Package Location
- `/Users/andres/Documents/04_Flux/SportsPulse/packages/prediction/`
- Validation layer: `packages/prediction/src/validation/`
- Contracts (Phase 1, frozen): `packages/prediction/src/contracts/`

## Implemented Modules (Phase 2b + CRITICAL fixes)
- `src/validation/competition-profile-validator.ts` — §8.3 + §8.4
- `src/validation/history-validator.ts` — §7.4, §20.1, §20.2 + effectivePriorAvailable overrides
- `src/validation/match-validator.ts` — main entry point, all §7–§13 rules + §19.6 + §20.2 real enforcement
- `src/validation/index.ts` — barrel
- Tests: `test/validation/` (84 tests, all passing — 642 total)

## Hard Thresholds (§4.3 constants)
- `PRIOR_RATING_MAX_AGE_DAYS = 400` — no contextual relaxation ever
- `MIN_RECENT_MATCHES_CLUB = 5` (365d window)
- `MIN_RECENT_MATCHES_NATIONAL_TEAM = 5` (730d window)
- `STRONG_RECENT_MATCHES_CLUB = 12` (365d window)
- `STRONG_RECENT_MATCHES_NATIONAL_TEAM = 8` (730d window)

## Reason Code Catalog (§11.2 — exactly these 10 codes)
- `MISSING_CRITICAL_FIELD`
- `INVALID_COMPETITION_PROFILE`
- `MISSING_AGGREGATE_STATE_FOR_SECOND_LEG`
- `INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING`
- `UNSUPPORTED_MATCH_TYPE`
- `DOMAIN_POOL_UNAVAILABLE`
- `INTERLEAGUE_FACTOR_UNAVAILABLE`
- `KNOCKOUT_RULES_UNAVAILABLE`
- `INVALID_PRIOR_RATING`
- `EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS`

## Key Design Decisions

### MatchValidationContext
`MatchInput` (Phase 1 frozen) does not carry `LeagueStrengthFactorRecord`.
The validator accepts `MatchValidationContext` wrapping `MatchInput` plus
optional `home/away_league_strength_factor`. This avoids mutating frozen contracts.

### prior_rating_available flag semantics (UPDATED — CRITICAL-001 resolved)
Two-path design:
1. **Enforcement path** (preferred): caller passes `home_prior_rating` / `away_prior_rating`
   as `PriorRating` records in `MatchValidationContext`. The engine evaluates:
   - Condition 1 (domain_matches): checked via `pr.conditions?.domain_matches === false`
     OR `pr.team_domain !== competition_profile.team_domain` → NOT_ELIGIBLE + INVALID_PRIOR_RATING
   - Conditions 2+3 (age, updates): evaluated in `computeEffectivePriorRatingAvailable()`,
     returns false if stale/insufficient → not utilizable → may fall to NOT_ELIGIBLE via history check
   - If `conditions` object is present, `is_utilizable` is used directly (pre-evaluated)
2. **Fallback path** (backwards-compatible): no records provided → trust the boolean flags
   `historical_context.home_prior_rating_available` / `away_prior_rating_available`

### CRITICAL-004: DOMAIN_POOL_UNAVAILABLE
Emitted when `context.domain_pool_available === false` (explicit signal from engine).
Check happens at Step 4.5, before history/prior_rating checks. Default: pool available.

### catalog_confirms_official_senior_11v11
§7.6 prohibits inferring match type from heuristics. The validator requires an
explicit boolean `catalog_confirms_official_senior_11v11` in the context.
If absent/false/null → NOT_ELIGIBLE + UNSUPPORTED_MATCH_TYPE. No exceptions.

### LIMITED_MODE invariant
- §11.2: LIMITED_MODE with zero reasons → throws (hard invariant guard)
- §11.3: LIMITED_MODE with STRONG applicability → throws (hard invariant guard)

### applicability_level when team enters only via prior_rating
§13.1 + §20.2: if a team has 0 recent matches and only prior_rating covers it,
applicability = WEAK (not CAUTION). CAUTION requires FULL_MODE with at least
one degraded-but-not-absent condition; WEAK is for accumulated degradations
including history deficit.

## Pre-existing Test Failure (NOT introduced by Phase 2b)
- `test/engine/derived-calibrated.test.ts` — 1 DNB floating-point precision test
- Uses `.toBe(1.0)` instead of `toBeCloseTo(1.0)` — pre-existing before Phase 2b
- Do NOT "fix" this by updating expected outputs without spec/version discipline

## Spec Ambiguities Encountered

### §19.6 vs MatchInput domain mismatch detectability — RESOLVED
§19.6: `prior_rating_domain_mismatch → NOT_ELIGIBLE`. The `MatchInput` boolean flag
is the fallback when no record is provided. When the engine provides actual `PriorRating`
records via `MatchValidationContext`, domain mismatch is now enforced directly in Step 5.
Ambiguity resolved: two-path design (enforcement path + fallback path). See design note above.

### §7.4 history range for CLUB
Spec §7.4 says "5+ completed official matches in last 365 days" for CLUB.
But `MatchInputHistoricalContext` has `home_completed_official_matches_last_365d` AND
`home_completed_official_matches_last_730d`. For CLUB domain, only the 365d field
is used. For NATIONAL_TEAM domain, only the 730d field is used. Confirmed by §7.4.
