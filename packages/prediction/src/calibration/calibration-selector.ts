/**
 * CalibrationSelector — segment selection logic for isotonic calibration.
 *
 * Spec authority: §17.2 (Segmentación)
 *
 * Segmentation hierarchy (§17.2):
 * 1. Segment = team_domain + competition_family, if sample count >= 1000 → use segmented
 * 2. Segment has >= 300 and < 1000 → intermediate (optional, must be versioned+documented)
 * 3. Segment has < 300 → must use global calibration
 *
 * Fallback is to the global calibrator — never to uncalibrated raw probabilities.
 *
 * The selector logs the segment used and whether fallback was triggered.
 */

import type { TeamDomain, CompetitionFamily } from '../contracts/types/competition-profile.js';
import type { OneVsRestCalibrators } from './isotonic-calibrator.js';

// ── Segment thresholds (§17.2) ────────────────────────────────────────────

/** Minimum sample count for a segment to be eligible for its own calibration. */
export const MIN_SAMPLES_FOR_SEGMENTED_CALIBRATION = 1000;

/**
 * Intermediate range: 300 <= count < 1000.
 * Intermediate calibration is optional and must be explicitly documented/versioned.
 */
export const MIN_SAMPLES_FOR_INTERMEDIATE_CALIBRATION = 300;

// ── Segment ID ────────────────────────────────────────────────────────────

/**
 * Segment identifier string. Format: "{team_domain}:{competition_family}" for
 * named segments, "global" for the global fallback.
 */
export type CalibrationSegmentId = string;

/**
 * Build the canonical segment ID string for a team_domain + competition_family pair.
 */
export function buildSegmentId(
  teamDomain: TeamDomain,
  competitionFamily: CompetitionFamily,
): CalibrationSegmentId {
  return `${teamDomain}:${competitionFamily}`;
}

// ── Calibration segment record ────────────────────────────────────────────

/**
 * A calibration segment with its trained calibrators and sample count.
 */
export interface CalibrationSegmentRecord {
  readonly segment_id: CalibrationSegmentId;
  readonly calibrators: OneVsRestCalibrators;
  /** Number of valid historical samples this calibrator was trained on. */
  readonly sample_count: number;
}

// ── Calibration registry ──────────────────────────────────────────────────

/**
 * Registry of all available calibration segments plus the global calibrator.
 *
 * At runtime, one registry instance is loaded/built and reused across predictions.
 */
export interface CalibrationRegistry {
  /** Segmented calibrators indexed by segment_id. */
  readonly segments: ReadonlyMap<CalibrationSegmentId, CalibrationSegmentRecord>;
  /** Global fallback calibrator (used when segment is missing or undersized). */
  readonly global: CalibrationSegmentRecord;
}

// ── Selection result ──────────────────────────────────────────────────────

/**
 * Result of calibration segment selection.
 * Used to populate calibration_segment_id and calibration_fallback_used in
 * the prediction response.
 */
export interface CalibrationSelectionResult {
  /** The calibrators to apply. */
  readonly calibrators: OneVsRestCalibrators;
  /** Segment ID that was used (either segmented or "global"). */
  readonly calibration_segment_id: CalibrationSegmentId;
  /**
   * Whether the global calibrator was used as fallback due to insufficient
   * segment samples. §17.2
   */
  readonly calibration_fallback_used: boolean;
  /**
   * Tier of calibration applied:
   * - 'segmented': segment had >= 1000 samples
   * - 'intermediate': segment had >= 300 and < 1000 samples (optional, versioned)
   * - 'global': fallback, segment had < 300 samples or was absent
   */
  readonly calibration_tier: 'segmented' | 'intermediate' | 'global';
}

// ── Selector function ─────────────────────────────────────────────────────

/**
 * Select the appropriate calibrator set for a given match context.
 *
 * Implements §17.2 segmentation hierarchy:
 * - If segment found with count >= 1000 → use segment (tier: 'segmented')
 * - If segment found with 300 <= count < 1000 → use intermediate if available,
 *   else fall back to global (tier: 'intermediate' or 'global')
 * - If segment not found or count < 300 → use global (tier: 'global')
 *
 * Never falls back to uncalibrated raw probabilities. §17.2
 */
export function selectCalibrator(
  teamDomain: TeamDomain,
  competitionFamily: CompetitionFamily,
  registry: CalibrationRegistry,
): CalibrationSelectionResult {
  const segmentId = buildSegmentId(teamDomain, competitionFamily);
  const segment = registry.segments.get(segmentId);

  if (segment !== undefined) {
    if (segment.sample_count >= MIN_SAMPLES_FOR_SEGMENTED_CALIBRATION) {
      // Full segment: >= 1000 samples
      return {
        calibrators: segment.calibrators,
        calibration_segment_id: segmentId,
        calibration_fallback_used: false,
        calibration_tier: 'segmented',
      };
    }

    if (segment.sample_count >= MIN_SAMPLES_FOR_INTERMEDIATE_CALIBRATION) {
      // Intermediate range: 300 <= count < 1000
      // Per §17.2: "puede usarse una calibración intermedia opcional solo si
      // está versionada, documentada, y queda explícito el fallback aplicado"
      // We use it and mark the tier explicitly.
      return {
        calibrators: segment.calibrators,
        calibration_segment_id: segmentId,
        calibration_fallback_used: false,
        calibration_tier: 'intermediate',
      };
    }

    // Segment has < 300 samples — must fall back to global per §17.2
    return {
      calibrators: registry.global.calibrators,
      calibration_segment_id: 'global',
      calibration_fallback_used: true,
      calibration_tier: 'global',
    };
  }

  // Segment not found → fall back to global
  return {
    calibrators: registry.global.calibrators,
    calibration_segment_id: 'global',
    calibration_fallback_used: true,
    calibration_tier: 'global',
  };
}
