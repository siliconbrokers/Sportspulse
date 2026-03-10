/**
 * Operating mode and applicability level type definitions.
 *
 * Spec authority: §11 (Modos operativos y política de fallo), §12, §13
 *
 * DESIGN NOTES:
 * - These are string literal union types, NOT TypeScript enums, per task requirements.
 * - `OperatingMode` has three values, one of which ('NOT_ELIGIBLE') is shared with
 *   `EligibilityStatus`. They are kept as separate types because they appear as
 *   distinct fields in both `ValidationResult` (§12) and `PredictionResponse` (§21).
 * - `ApplicabilityLevel` in the spec §12 uses 'STRONG' | 'CAUTION' | 'WEAK'.
 *   The task instruction listed 'STRONG' | 'CAUTION' | 'WEAK' as well (named
 *   "ApplicabilityLevel" not the "COMPETITION | PHASE | ROUND | MATCH" enum from
 *   the agent system prompt header — the spec text governs, not the header). The
 *   spec §12, §13 consistently uses STRONG | CAUTION | WEAK.
 */

/**
 * Whether a match is eligible for prediction.
 *
 * - ELIGIBLE: match can be predicted (either FULL_MODE or LIMITED_MODE)
 * - NOT_ELIGIBLE: match cannot be predicted; no probabilities are exposed
 *
 * Spec §12
 */
export type EligibilityStatus = 'ELIGIBLE' | 'NOT_ELIGIBLE';

/**
 * Operating mode assigned to a match by the Validation Layer.
 *
 * - FULL_MODE: all critical fields present, profile consistent, sufficient history
 *              or prior rating, bridging valid if applicable, knockout rules valid
 *              if applicable. All v1 outputs are exposed. §11.1
 * - LIMITED_MODE: critical fields present, profile consistent, but some secondary
 *                 components are missing or context is weak. Core outputs exposed;
 *                 secondary and explainability may be partial or null. §11.1
 * - NOT_ELIGIBLE: critical fields missing, profile contradictory, insufficient
 *                 history and no utilizable prior rating, out-of-scope match,
 *                 or domain/bridging/knockout rules invalid. No probabilities
 *                 are exposed. §11.1
 *
 * Spec §11.1, §12, §21
 */
export type OperatingMode = 'FULL_MODE' | 'LIMITED_MODE' | 'NOT_ELIGIBLE';

/**
 * Confidence level of a prediction, determined by deterministic rules.
 *
 * - STRONG: full mode, domestic league or group stage, both teams with strong
 *           recent history, no neutral venue, not second leg, bridging with
 *           HIGH or MEDIUM confidence if applicable. §13.1
 * - CAUTION: full mode but not meeting all STRONG conditions, or specific
 *            stage types (playoff, knockout rounds, final, third place),
 *            neutral venue, second leg, or weak bridging. §13.1
 * - WEAK: limited mode, missing secondary components, team entering only via
 *         prior rating with weak recent history, accumulated degradations. §13.1
 *
 * Spec §12, §13
 */
export type ApplicabilityLevel = 'STRONG' | 'CAUTION' | 'WEAK';
