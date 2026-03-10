/**
 * CalibrationVersionMetadata — versioning for calibration and decision policy.
 *
 * Spec authority: §17.4 (Versionado)
 *
 * The following must be persisted per §17.4:
 * - model_version
 * - calibration_version
 * - decision_policy_version
 * - too_close_margin_threshold
 *
 * These allow predicted_result to be reconstructed deterministically from:
 * - calibrated_1x2_probs
 * - too_close_margin_threshold
 * - decision_policy_version
 *
 * §17.4: "predicted_result debe poder reconstruirse determinísticamente"
 */

// ── Versioning types ──────────────────────────────────────────────────────

/**
 * Version metadata that must accompany every prediction response.
 *
 * Changing too_close_margin_threshold requires bumping decision_policy_version.
 * Changing the calibration algorithm/segments requires bumping calibration_version.
 * Changing the score model (Elo params, Poisson tuning) requires bumping model_version.
 *
 * Spec §17.4
 */
export interface CalibrationVersionMetadata {
  /** Version identifier for the match prediction model (Elo + Poisson). §17.4 */
  readonly model_version: string;

  /** Version identifier for the isotonic calibration models. §17.4 */
  readonly calibration_version: string;

  /**
   * Version identifier for the decision policy (predicted_result logic).
   * Controls too_close_margin_threshold and tie-breaking behavior. §17.4
   */
  readonly decision_policy_version: string;

  /**
   * The exact threshold used for too_close determination.
   * Persisted so predicted_result is reconstructable without needing the
   * policy config registry. §17.4
   */
  readonly too_close_margin_threshold: number;

  /**
   * Calibration mode for the current prediction run. §17.2
   * - 'bootstrap': identity calibrators in use — no historical training data available.
   *                The system passes raw probs through unchanged before renormalization.
   *                Must be declared explicitly so the response can surface this state.
   * - 'trained':  fitted isotonic calibrators were applied (segmented, intermediate, or global).
   *
   * This field is optional (defaults to 'trained' if absent) to preserve backward
   * compatibility with existing callers that pre-date FIX #65.
   */
  readonly calibration_mode?: 'bootstrap' | 'trained';
}

// ── Decision policy registry ──────────────────────────────────────────────

/**
 * A versioned decision policy configuration.
 * Changing threshold or logic requires a new version entry.
 * This registry prevents inline magic numbers.
 */
export interface DecisionPolicyConfig {
  readonly version: string;
  readonly too_close_margin_threshold: number;
  /** Human-readable description of changes in this version. */
  readonly description: string;
}

/**
 * Registry of all decision policy versions.
 * Add new entries here when changing the threshold or logic.
 * Never modify existing entries — they must remain stable for reconstruction.
 */
export const DECISION_POLICY_REGISTRY: ReadonlyMap<string, DecisionPolicyConfig> = new Map([
  [
    'v1.0',
    {
      version: 'v1.0',
      too_close_margin_threshold: 0.02,
      description:
        'Initial v1 policy. TOO_CLOSE when top-1 minus top-2 calibrated prob < 0.02. §16.12',
    },
  ],
]);

/**
 * The currently active decision policy version.
 * This is the version used for new predictions.
 * Update this constant (and add a registry entry) when changing policy.
 */
export const CURRENT_DECISION_POLICY_VERSION = 'v1.0';

/**
 * Get a decision policy config by version string.
 * Throws if the version is not found in the registry.
 */
export function getDecisionPolicyConfig(version: string): DecisionPolicyConfig {
  const config = DECISION_POLICY_REGISTRY.get(version);
  if (!config) {
    throw new Error(
      `Unknown decision_policy_version "${version}". ` +
        `Known versions: [${[...DECISION_POLICY_REGISTRY.keys()].join(', ')}]`,
    );
  }
  return config;
}

// ── Calibration version constants ─────────────────────────────────────────

/**
 * Current model version (Elo + Poisson).
 * Bump when changing Elo parameters, home advantage model, or Poisson base.
 */
export const CURRENT_MODEL_VERSION = 'v1.0';

/**
 * Current calibration version (isotonic calibration models).
 * Bump when retraining calibrators with new data or changing segmentation.
 */
export const CURRENT_CALIBRATION_VERSION = 'v1.0';

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Build the version metadata for the current prediction run.
 * Uses the current registered versions.
 *
 * Spec §17.4: all four fields must be present in every prediction response.
 *
 * @param calibration_mode Optional override for the calibration mode. Defaults to
 *   'bootstrap' (the current system state — no historical training data available).
 *   When a trained CalibrationRegistry is provided by the caller, pass 'trained'.
 *   This allows the response to declare its calibration state honestly per §17.2.
 */
export function buildCurrentVersionMetadata(
  calibration_mode: 'bootstrap' | 'trained' = 'bootstrap',
): CalibrationVersionMetadata {
  const policyConfig = getDecisionPolicyConfig(CURRENT_DECISION_POLICY_VERSION);
  return {
    model_version: CURRENT_MODEL_VERSION,
    calibration_version: CURRENT_CALIBRATION_VERSION,
    decision_policy_version: CURRENT_DECISION_POLICY_VERSION,
    too_close_margin_threshold: policyConfig.too_close_margin_threshold,
    calibration_mode,
  };
}
