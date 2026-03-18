/**
 * NEXUS Temporal Feature Store — Anti-Lookahead Guard
 *
 * Spec authority: NEXUS-0 S3.2, S8.1.1, S8.2, S8.3, S11.2
 *
 * CORE INVARIANT (S11.2):
 *   No feature with `effectiveAt >= buildNowUtc` is ever included in a
 *   prediction's input vector.
 *
 * This is enforced via STRICT LESS-THAN (S3.2):
 *   "A feature whose effectiveAt equals buildNowUtc exactly is excluded."
 *
 * Per S8.3, anti-lookahead is not optional:
 *   - Runs in unit tests on every `pnpm -r test` invocation.
 *   - Runs as runtime assertions in the prediction pipeline.
 *   - A prediction that fails is marked CONTAMINATED and excluded from evaluation.
 *
 * This module operates on FeatureSnapshot (feature-level) and does not
 * handle match-result anti-lookahead (S8.1.2) or calibration anti-lookahead
 * (S8.1.3) — those belong to their respective pipeline stages.
 */

import { MISSING } from './types.js';
import type { FeatureSnapshot, FeatureValue } from './types.js';

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Result of the anti-lookahead guard applied to a FeatureSnapshot.
 */
export interface AntiLookaheadResult {
  /** The cleaned snapshot with all violating features replaced by MISSING. */
  readonly cleanedSnapshot: FeatureSnapshot;
  /** Keys of features that violated the as-of constraint. */
  readonly violatingKeys: readonly string[];
  /** True when at least one feature was filtered. */
  readonly hadViolations: boolean;
}

/**
 * A feature violation record — for logging and auditing.
 */
export interface FeatureLookaheadViolation {
  readonly featureKey: string;
  readonly effectiveAt: string;
  readonly buildNowUtc: string;
  readonly source: string;
}

// ── Guard implementation ───────────────────────────────────────────────────

/**
 * Apply the feature-level anti-lookahead guard to a FeatureSnapshot.
 *
 * Per NEXUS-0 S3.2, a feature `f` is eligible if and only if:
 *   `f.effectiveAt < buildNowUtc`  (strict less-than)
 *
 * Any feature with `effectiveAt >= buildNowUtc` is:
 * 1. Replaced with a MISSING FeatureValue (preserving provenance for auditing).
 * 2. Recorded in the returned `violatingKeys` list.
 *
 * The original FeatureSnapshot is never mutated. A new cleaned snapshot
 * is returned. This satisfies S11.7 (immutability per prediction).
 */
export function applyAntiLookaheadGuard(
  snapshot: FeatureSnapshot,
): AntiLookaheadResult {
  const buildNowMs = Date.parse(snapshot.buildNowUtc);

  if (isNaN(buildNowMs)) {
    throw new Error(
      `[NEXUS anti-lookahead] Invalid buildNowUtc: "${snapshot.buildNowUtc}"`,
    );
  }

  const violatingKeys: string[] = [];
  const cleanedFeatures: Record<string, FeatureValue<unknown>> = {};

  for (const [key, featureValue] of Object.entries(snapshot.features)) {
    const effectiveAtMs = Date.parse(featureValue.provenance.effectiveAt);

    if (isNaN(effectiveAtMs)) {
      // Feature with an unparseable effectiveAt is treated as a violation
      // to be safe. A feature whose temporal position cannot be verified
      // cannot satisfy the as-of constraint.
      violatingKeys.push(key);
      cleanedFeatures[key] = {
        value: MISSING,
        provenance: featureValue.provenance,
      };
      continue;
    }

    // S3.2: strict less-than. effectiveAt === buildNowUtc is also excluded.
    if (effectiveAtMs >= buildNowMs) {
      violatingKeys.push(key);
      // Replace value with MISSING but preserve provenance for auditing.
      // The provenance documents WHY this feature is missing (temporal violation).
      cleanedFeatures[key] = {
        value: MISSING,
        provenance: featureValue.provenance,
      };
    } else {
      cleanedFeatures[key] = featureValue;
    }
  }

  const cleanedSnapshot: FeatureSnapshot = {
    matchId: snapshot.matchId,
    buildNowUtc: snapshot.buildNowUtc,
    featureSnapshotId: snapshot.featureSnapshotId,
    features: cleanedFeatures,
  };

  return {
    cleanedSnapshot,
    violatingKeys,
    hadViolations: violatingKeys.length > 0,
  };
}

/**
 * Assert that a FeatureSnapshot contains no anti-lookahead violations.
 *
 * This is the runtime assertion form per S8.3. Throws a TemporalLeakageError
 * (same error class used by V3's isotonic calibrator) if any violation is found.
 *
 * Caller must call `applyAntiLookaheadGuard` first and pass the result to
 * this function, or pass the raw snapshot for an exhaustive check.
 */
export function assertNoLookahead(snapshot: FeatureSnapshot): void {
  const result = applyAntiLookaheadGuard(snapshot);

  if (result.hadViolations) {
    const details = result.violatingKeys
      .map((k) => {
        const f = snapshot.features[k];
        return `  feature="${k}" effectiveAt="${f?.provenance.effectiveAt}" buildNowUtc="${snapshot.buildNowUtc}"`;
      })
      .join('\n');

    throw new TemporalLeakageError(
      `[NEXUS anti-lookahead] CONTAMINATED: ${result.violatingKeys.length} feature(s) ` +
        `with effectiveAt >= buildNowUtc in snapshot for matchId="${snapshot.matchId}":\n${details}`,
    );
  }
}

/**
 * Collect violation records for logging without throwing.
 * Used when the pipeline wants to log and then clean rather than abort.
 */
export function collectViolations(
  snapshot: FeatureSnapshot,
): FeatureLookaheadViolation[] {
  const buildNowMs = Date.parse(snapshot.buildNowUtc);
  const violations: FeatureLookaheadViolation[] = [];

  for (const [key, featureValue] of Object.entries(snapshot.features)) {
    const effectiveAtMs = Date.parse(featureValue.provenance.effectiveAt);
    const isViolation = isNaN(effectiveAtMs) || effectiveAtMs >= buildNowMs;

    if (isViolation) {
      violations.push({
        featureKey: key,
        effectiveAt: featureValue.provenance.effectiveAt,
        buildNowUtc: snapshot.buildNowUtc,
        source: featureValue.provenance.source,
      });
    }
  }

  return violations;
}

// ── TemporalLeakageError ──────────────────────────────────────────────────

/**
 * Error class for anti-lookahead violations.
 * Mirrors the name used by V3's isotonic-calibrator.ts for consistency.
 * A prediction that triggers this error is CONTAMINATED and must be
 * excluded from evaluation (S8.3).
 */
export class TemporalLeakageError extends Error {
  public readonly name = 'TemporalLeakageError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, TemporalLeakageError.prototype);
  }
}
