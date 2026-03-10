# Predictive Engine Auditor — Persistent Memory

## Architecture Quick Reference
- Spec: `/Users/andres/Documents/04_Flux/SportsPulse/docs/specs/SportPulse_Predictive_Engine_Spec_v1.3_Final.md`
- Package root: `/Users/andres/Documents/04_Flux/SportsPulse/packages/prediction/`
- Pipeline orchestrator: `/Users/andres/Documents/04_Flux/SportsPulse/server/prediction/prediction-service.ts`
- API route: `/Users/andres/Documents/04_Flux/SportsPulse/packages/api/src/ui/prediction-route.ts`
- Tests: `packages/prediction/test/` — 642 tests

## Critical Recurring Pattern: Validator vs Orchestrator Gap

The §20.2 prior_rating domain enforcement exists in `match-validator.ts` (correct) and is tested
thoroughly there. However, `prediction-service.ts` constructs `MatchValidationContext` WITHOUT
passing `home_prior_rating` / `away_prior_rating` records. This means the real §20.2 checks
(condition 1-5: domain, age, updates, cross-season carry) are bypassed in the live pipeline;
only the caller-supplied boolean flags in `historical_context` are checked.

This pattern — fix present in the library layer but not wired in the composition root — is the
most common compliance gap in this codebase. Always check both:
  1. Does the package implement the rule? (packages/prediction/src/validation/)
  2. Does the composition root wire the inputs needed to trigger that rule? (server/prediction/)

## CRITICAL-001 Status (as of re-audit 2026-03-09)
- Validator logic: CORRECT — domain check vs real PriorRating records implemented in match-validator.ts lines 329-360
- Composition root: INCOMPLETE — prediction-service.ts constructs context without home_prior_rating / away_prior_rating
- Net effect: in production pipeline, §20.2 conditions 1-4 are evaluated only against caller-supplied boolean, not actual PriorRating records

## CRITICAL-002 Status (as of re-audit 2026-03-09)
- CONFIRMED FIXED — response-builder.ts buildFullModeResponse() checks tailMassExceeded (line 301)
- Degrades to LIMITED_MODE and emits EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS correctly
- Both FULL_MODE and pre-LIMITED_MODE paths handled (lines 199-209 in buildLimitedModeResponse)
- Tests pass

## Spec §21.1 vs Implementation Gap: NOT_ELIGIBLE applicability_level
- Spec §21.1 says for NOT_ELIGIBLE: "predictions = null, internals = null or minimal diagnostic, reasons non-empty, operating_mode = NOT_ELIGIBLE"
- Spec §21.2 says the minimal diagnostic may include operating_mode, applicability_level, reasons
- The NOT_ELIGIBLE response includes applicability_level = 'WEAK' — this is consistent with spec (§21.2 permits it)

## Spec §21.3 LIMITED_MODE Core Probabilities
- In LIMITED_MODE, response-builder uses raw_1x2_probs for core probabilities (p_home_win, p_draw, p_away_win)
- The spec says core is mandatory in LIMITED_MODE but does not explicitly require calibrated probs
- This is a defensible interpretation: §21.3 only says "predictions.core debe seguir existiendo"
- Flag for future audit: raw probs in core may confuse consumers who expect calibrated values

## Calibration Segmentation Threshold §17.2
- Implementation uses constant thresholds (>= 1000 / >= 300) in calibration-selector.ts
- These match spec exactly (1000 for full segmented, 300 for intermediate, <300 for global)
- No invented thresholds found

## KnockoutResolutionRules §8.4
- Validator correctly enforces: no duplicate steps, ORGANIZER_DEFINED last, non-empty sequences
- Resolver correctly iterates steps in order
- No ambiguous combinations admitted

## Files Most Likely to Harbor Gaps
1. `server/prediction/prediction-service.ts` — composition root, wires context
2. `packages/prediction/src/validation/match-validator.ts` — full validation logic
3. `packages/prediction/src/response-builder.ts` — output assembly
4. `packages/prediction/src/calibration/calibration-selector.ts` — calibration selection

## Test Coverage Gaps (verified 2026-03-09)
- No integration-level test that exercises prediction-service.ts with domain-mismatch PriorRating records
- All §20.2 tests are unit tests against match-validator.ts directly (context constructed manually)
- The gap between validator and prediction-service is not covered by any test
