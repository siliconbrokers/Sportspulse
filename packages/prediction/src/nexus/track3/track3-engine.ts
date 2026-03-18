/**
 * track3-engine.ts — NEXUS Track 3: Tabular Discriminative Engine.
 *
 * Spec authority:
 *   - taxonomy spec S5.1–S5.7: full Track 3 specification
 *   - taxonomy spec S5.5: Track3Output interface
 *   - taxonomy spec S5.6: degradation rules (confidence levels)
 *   - taxonomy spec S2.2: independence of tracks — no import from engine/v3/
 *   - NEXUS-0 S3.2: strict as-of semantics (anti-lookahead)
 *   - master spec S8.4, S8.5: no shared mutable state with V3
 *
 * ISOLATION INVARIANT (master spec S8.4, S8.5):
 *   This engine does NOT import from engine/v3/ or any V3 module.
 *   Track 3 receives Track 1 strength estimates as input parameters,
 *   not by importing Track 1's runtime. This preserves the independence
 *   requirement (taxonomy spec S2.2).
 *
 * CONFIDENCE RULES (taxonomy spec S5.6):
 *   HIGH:   At least 7 of 9 features present (eloDiff + rest pair + form pairs).
 *   MEDIUM: 4 to 6 features present.
 *   LOW:    Fewer than 4 features present.
 *
 * INVARIANT: output.probs.home + output.probs.draw + output.probs.away = 1.0.
 *
 * @module nexus/track3/track3-engine
 */

import type { HistoricalMatch } from '../track1/types.js';
import { buildTrack3FeatureVector } from './context-features.js';
import { predictLogistic, DEFAULT_LOGISTIC_WEIGHTS } from './logistic-model.js';
import type { LogisticWeights } from './logistic-model.js';
import type { Track3Output, Track3Confidence } from './types.js';

// ── Version identifiers (taxonomy spec S5.7) ─────────────────────────────

/**
 * Context model version — bumped when algorithm or hyperparameters change.
 * taxonomy spec S5.7.
 */
export const CONTEXT_MODEL_VERSION = '1.0.0';

/**
 * Feature schema version — bumped when feature set changes.
 * taxonomy spec S5.7.
 */
export const FEATURE_SCHEMA_VERSION = '1.0.0';

// ── Confidence thresholds ─────────────────────────────────────────────────

const HIGH_CONFIDENCE_THRESHOLD = 7;  // out of 9 total features
const MEDIUM_CONFIDENCE_THRESHOLD = 4; // out of 9 total features

/**
 * Determine Track3Confidence from the count of present features.
 *
 * taxonomy spec S5.6: degradation rules.
 *   HIGH:   >= 7 of 9 critical features present (elo always present → >=8 effective)
 *   MEDIUM: 4-6 features present
 *   LOW:    < 4 features present
 */
function deriveConfidence(featuresPresent: number): Track3Confidence {
  if (featuresPresent >= HIGH_CONFIDENCE_THRESHOLD) return 'HIGH';
  if (featuresPresent >= MEDIUM_CONFIDENCE_THRESHOLD) return 'MEDIUM';
  return 'LOW';
}

// ── Main engine function ──────────────────────────────────────────────────

/**
 * Compute Track 3 prediction from contextual features.
 *
 * taxonomy spec S5.1–S5.7: full Track 3 pipeline.
 *
 * Steps:
 *   1. Build the Track 3 feature vector (anti-lookahead enforced internally).
 *   2. Apply logistic regression (softmax multiclass).
 *   3. Determine confidence from feature completeness.
 *   4. Return Track3Output with probs, features, and metadata.
 *
 * PURE FUNCTION: no side effects, no Date.now(), no Math.random(), no IO.
 *
 * @param homeTeamId         - Canonical home team ID.
 * @param awayTeamId         - Canonical away team ID.
 * @param buildNowUtc        - Temporal anchor (ISO-8601 UTC with Z).
 * @param history            - Full canonical match history (will be filtered by as-of).
 * @param eloHome            - Track 1 effective Elo for home team.
 * @param eloAway            - Track 1 effective Elo for away team.
 * @param homePosition       - Home team table position (1 = top; 0 = unavailable).
 * @param awayPosition       - Away team table position (1 = top; 0 = unavailable).
 * @param totalTeams         - Total teams in the competition.
 * @param matchday           - Current matchday number (0 = unknown).
 * @param weights            - Optional logistic weights. Defaults to DEFAULT_LOGISTIC_WEIGHTS.
 * @returns Track3Output — 1X2 probs, confidence, features, version metadata.
 */
export function computeTrack3(
  homeTeamId: string,
  awayTeamId: string,
  buildNowUtc: string,
  history: HistoricalMatch[],
  eloHome: number,
  eloAway: number,
  homePosition: number,
  awayPosition: number,
  totalTeams: number,
  matchday: number,
  weights: LogisticWeights = DEFAULT_LOGISTIC_WEIGHTS,
): Track3Output {
  // Step 1: Build feature vector (anti-lookahead enforced inside)
  const features = buildTrack3FeatureVector(
    homeTeamId,
    awayTeamId,
    buildNowUtc,
    history,
    eloHome,
    eloAway,
    homePosition,
    awayPosition,
    totalTeams,
    matchday,
  );

  // Step 2: Apply logistic model
  const { probs, featuresPresent } = predictLogistic(features, weights);

  // Step 3: Determine confidence
  const confidence = deriveConfidence(featuresPresent);

  // Step 4: Compose output
  return {
    probs,
    confidence,
    features_used: features,
    model_type: 'logistic',
    contextModelVersion: CONTEXT_MODEL_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
  };
}
