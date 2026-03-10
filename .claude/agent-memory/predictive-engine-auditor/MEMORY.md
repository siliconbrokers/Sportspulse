# Predictive Engine Auditor — Persistent Memory

## Project: SportPulse Predictive Engine
Spec: `/Users/andres/Documents/04_Flux/SportsPulse/docs/specs/SportPulse_Predictive_Engine_Spec_v1.3_Final.md`
Implementation: `/Users/andres/Documents/04_Flux/SportsPulse/packages/prediction/`

## Phase 6 Audit (completed) — Key Findings Summary

### CRITICAL findings (Phase 6 audit)
1. **§20.2 domain_mismatch not actively enforced** — `match-validator.ts` lines 287–293 compute `prior_rating_consistent` as `true` vacuously regardless of actual domain. The caller-trust model is by design but §19.6 says "prior_rating_domain_mismatch => NOT_ELIGIBLE" with no exceptions. The engine has no pathway to emit `INVALID_PRIOR_RATING` when a mismatch is actually detected in a rating record.
2. **§14.2 tail_mass policy handler gap** — `scoreline-matrix.ts` exposes `tailMassExceeded` flag correctly but NO code in `response-builder.ts` or any pipeline stage handles it to degrade to LIMITED_MODE or emit `EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS`. The policy action is structurally missing.

### HIGH findings (Phase 6 audit)
3. **§21.1 NOT_ELIGIBLE internals field not null** — The spec requires `internals = null` (or minimal diagnostic without probabilities). `buildNotEligibleResponse` in `response-builder.ts` sets `internals: null` which IS correct, but the type `PredictionResponseNotEligible` only enforces `internals?: null` (optional null). If a caller constructs a NOT_ELIGIBLE object manually they can pass non-null internals. Runtime guard only, no structural enforcement.
4. **§20.2 five conditions not validated against actual PriorRating record** — `history-validator.ts` only receives `prior_rating_available: boolean` flag from MatchInput. The 5 conditions (age, updates, domain, carry, mismatch) are never independently checked by the engine — the caller is trusted. This is a design choice documented in a comment but creates a gap: the engine cannot detect stale ratings, insufficient updates, or invalid carries.
5. **`DOMAIN_POOL_UNAVAILABLE` reason code never emitted** — Defined in `ReasonCode` type and spec §11.2, but no code path in match-validator.ts emits it. The closest condition (team_domain mismatch) falls under `prior_rating_consistent` vacuous logic.

### MEDIUM findings (Phase 6 audit)
6. **§21.3 NOT_ELIGIBLE internals field optionality** — Spec says `internals = null` for NOT_ELIGIBLE; type allows `internals?: null` (absent is also valid). Structural divergence.
7. **§17.4 wording ambiguous for NOT_ELIGIBLE** — Spec §17.4 says version fields "debe persistirse" without explicit scoping to FULL_MODE only. The implementation includes them in NOT_ELIGIBLE (which is correct per §21 schema), but the test at line 235 (response-builder.test.ts) labels this as "version fields are present (§17.4)" for NOT_ELIGIBLE responses, confirming this is intentional.
8. **No test for `DOMAIN_POOL_UNAVAILABLE` emission** — Reason code exists in the catalog but zero test coverage.
9. **No test for `INVALID_PRIOR_RATING` emission** — Same as above.
10. **No test for tail_mass policy action** — `tailMassExceeded=true` triggers no degradation in any test.

### CONFORMANT areas (Phase 6 audit)
- §3.1 raw/calibrated separation: PASS (branded types, separate fields)
- §8.4 KnockoutResolutionRules as ordered array: PASS
- §16.3 double_chance from calibrated: PASS
- §16.4 DNB from calibrated, exact invariant: PASS (dnb_away = 1 - dnb_home)
- §17.3 temporal leakage guard: PASS (TemporalLeakageError thrown correctly)
- §17.4 version fields in FULL_MODE and NOT_ELIGIBLE: PASS
- §19.5 raw vs calibrated split: PASS
- §21.1 NOT_ELIGIBLE predictions absent: PASS (structural union type)
- §21.3 LIMITED_MODE core present, secondary/explainability null: PASS
- §23.2 metrics (all 4 classification metrics + log_loss + Brier + buckets): PASS
- §4.1 constants (epsilon values): PASS
- §4.3 thresholds (all 9 constants): PASS
- §11.2 reason code catalog (all 10 codes defined): PASS (but 2 not emittable)
- §12 ValidationResult schema: PASS
- §13.1 applicability_level logic: PASS

## Architecture Notes (confirmed)
- `packages/prediction/src/` — 37 source files, 25 test files, 615 tests passing
- Branded types: `RawMatchDistribution`, `Raw1x2Probs`, `Calibrated1x2Probs` use `unique symbol` branding
- `prior_rating_available` in MatchInput is a pre-validated boolean — the 5 §20.2 conditions are NOT re-evaluated inside the engine
- `tailMassExceeded` flag is computed but NOT acted upon — policy is incomplete
- `DOMAIN_POOL_UNAVAILABLE` and `INVALID_PRIOR_RATING` are dead reason codes

## Frequently Misimplemented Areas
- §20.2: The "caller pre-validates" design pattern creates an unenforceable spec requirement. Future audits should check if the caller layer (above the engine) actually validates all 5 conditions.
- §14.2 tail_mass policy: The flag is computed but the degradation pipeline is not wired.
- §19.6: Domain mismatch check is vacuously true — this is a recurring gap.
