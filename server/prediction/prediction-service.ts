/**
 * PredictionService — orchestrator for the match prediction pipeline.
 *
 * This is the composition root for prediction. It wires all prediction
 * package components into a single predict(input) method.
 *
 * Package boundary: server/ may import from packages/prediction freely.
 * packages/api MUST NOT import from packages/prediction directly (§boundary rules).
 *
 * Pipeline (§5.1–§5.3, §21):
 *   1. validateMatch(input)           → ValidationResult
 *   2. NOT_ELIGIBLE → return early (no computation)
 *   3. computeLambdas(...)            → LambdaResult
 *   4. buildRawMatchDistribution(...) → RawMatchDistributionResult
 *   5. aggregateRaw1x2(...)           → Raw1x2Probs
 *   6. computeDerivedRaw(...)         → DerivedRawOutputs
 *   7. [FULL_MODE only] selectCalibrator + applyOneVsRestCalibration → Calibrated1x2Probs
 *   8. [FULL_MODE only] computeDerivedCalibrated(...)    → DerivedCalibratedOutputs
 *   9. [FULL_MODE only] computePredictedResultFromCurrentPolicy → PredictedResultOutput
 *  10. buildPredictionResponse(...)   → PredictionResponse
 *
 * Steps 7–9 are SKIPPED in LIMITED_MODE (no calibration available).
 *
 * Spec authority:
 *   §5.1–§5.3 — pipeline stages
 *   §11.1     — operating mode determination (FULL / LIMITED / NOT_ELIGIBLE)
 *   §14.1–§14.3 — lambda + matrix computation
 *   §16.1–§16.13 — aggregation, derived outputs, decision
 *   §17.1–§17.2 — calibration + segment selection
 *   §21        — PredictionResponse assembly
 *   §22.3      — internals: Priority C, never in public API
 */

import {
  validateMatch,
  computeLambdas,
  buildRawMatchDistribution,
  aggregateRaw1x2,
  computeDerivedRaw,
  applyOneVsRestCalibration,
  computeDerivedCalibrated,
  computePredictedResultFromCurrentPolicy,
  buildCurrentVersionMetadata,
  buildPredictionResponse,
  IsotonicCalibrator,
  selectCalibrator,
} from '@sportpulse/prediction';
import { HOME_ADVANTAGE_ELO_DELTA } from '@sportpulse/prediction';

import type {
  PredictionResponse,
  Calibrated1x2Probs,
  MatchInput,
  MatchValidationContext,
  OneVsRestCalibrators,
  RawEngineOutputs,
  CalibratedOutputs,
  CalibrationRegistry,
} from '@sportpulse/prediction';

// ── Default global calibrator (identity — bootstrapping mode) ─────────────

/**
 * Identity calibration registry used when no trained calibrators are available.
 *
 * Per §17.2: "El fallback es siempre al calibrador global — nunca a
 * probabilidades raw sin calibrar." Using IsotonicCalibrator.createIdentity()
 * satisfies this: the identity calibrator returns raw_prob unchanged, which
 * is the minimal safe bootstrapping mode.
 *
 * In production, this should be replaced with trained calibrators. §17.1
 */
function createIdentityCalibrators(): OneVsRestCalibrators {
  return {
    home: IsotonicCalibrator.createIdentity(),
    draw: IsotonicCalibrator.createIdentity(),
    away: IsotonicCalibrator.createIdentity(),
  };
}

function createDefaultCalibrationRegistry(): CalibrationRegistry {
  return {
    segments: new Map(),
    global: {
      segment_id: 'global',
      calibrators: createIdentityCalibrators(),
      sample_count: 0,
    },
  };
}

// ── PredictionService ──────────────────────────────────────────────────────

export interface PredictionServiceConfig {
  /**
   * Optional calibration registry to use for FULL_MODE predictions.
   * If not provided, the identity (bootstrapping) registry is used.
   * §17.1, §17.2
   */
  calibrationRegistry?: CalibrationRegistry;
}

/**
 * Orchestrates the full prediction pipeline for a single match.
 *
 * Compose with PredictionService.predict(input) to obtain a PredictionResponse.
 *
 * Spec §5.1–§5.3, §21
 */
// ── Prediction options ──────────────────────────────────────────────────────

/**
 * Optional Elo overrides for a single predict() call.
 *
 * When provided, these replace the DEFAULT_ELO bootstrap values for lambda
 * computation. Home advantage (HOME_ADVANTAGE_ELO_DELTA) is added to
 * eloHome automatically.
 *
 * H3: used by HistoricalBacktestRunner to pass real pre-match Elo values.
 */
export interface PredictEloOverride {
  /** Raw Elo rating for home team (home advantage applied internally). */
  home: number;
  /** Raw Elo rating for away team. */
  away: number;
  /**
   * Override for HOME_ADVANTAGE_ELO_DELTA when set.
   * Used by H6a sensitivity tests only — never change the production default.
   * If omitted, uses the module-level HOME_ADVANTAGE_ELO_DELTA constant.
   */
  homeAdvantageDeltaOverride?: number;
}

export class PredictionService {
  private readonly calibrationRegistry: CalibrationRegistry;

  constructor(config: PredictionServiceConfig = {}) {
    this.calibrationRegistry = config.calibrationRegistry ?? createDefaultCalibrationRegistry();
  }

  /**
   * Run the full prediction pipeline for a MatchInput.
   *
   * Returns a PredictionResponse. Never throws — all error paths are
   * expressed as eligibility_status = 'NOT_ELIGIBLE' with reason codes.
   *
   * @param input     Match to predict.
   * @param eloOverride  Optional real Elo values; when absent, bootstrap DEFAULT_ELO is used.
   *
   * Spec §21
   */
  async predict(input: MatchInput, eloOverride?: PredictEloOverride): Promise<PredictionResponse> {
    // ── Version metadata (present in ALL responses) ──────────────────────
    const versionMetadata = buildCurrentVersionMetadata();

    // ── Step 1: Validation ───────────────────────────────────────────────
    // Construct context: for domestic league matches, no bridging factors.
    // §7.6: catalog_confirms_official_senior_11v11 must come from the catalog.
    // The MatchInput itself carries the competition_profile which was built
    // from the canonical catalog — so we assert true here. Callers providing
    // a MatchInput have already confirmed catalog eligibility.
    // §20.2: pass actual PriorRating records so the validator can enforce
    // domain_matches, age, and updates conditions directly.
    // In bootstrapping mode (no rating pool): pass null, which causes the
    // validator to fall back to historical_context.home/away_prior_rating_available.
    // In production, resolve records from the rating pool here before calling.
    const homePriorRating = null; // TODO: resolve from rating pool when available
    const awayPriorRating = null; // TODO: resolve from rating pool when available

    const context: MatchValidationContext = {
      input,
      catalog_confirms_official_senior_11v11: true,
      home_league_strength_factor: null,
      away_league_strength_factor: null,
      home_prior_rating: homePriorRating,
      away_prior_rating: awayPriorRating,
    };

    const validationResult = validateMatch(context);

    // ── Step 2: NOT_ELIGIBLE — return early ─────────────────────────────
    if (validationResult.eligibility_status === 'NOT_ELIGIBLE') {
      return buildPredictionResponse({
        matchInput: input,
        validationResult,
        versionMetadata,
      });
    }

    // ── Steps 3–6: Raw engine outputs ────────────────────────────────────
    // These are computed for both FULL_MODE and LIMITED_MODE.

    // §14.1: compute lambdas from effective Elo.
    // effectiveEloHome must already include home advantage (§6.1 "localía").
    // When eloOverride is provided (H3 historical backtest): use real pre-match
    // Elo values + HOME_ADVANTAGE_ELO_DELTA for home team.
    // When absent (bootstrap): both teams at DEFAULT_ELO, no home advantage
    // applied — symmetric lambdas at 1.35/1.35.
    const DEFAULT_ELO = 1500;
    const effectiveDelta = eloOverride?.homeAdvantageDeltaOverride ?? HOME_ADVANTAGE_ELO_DELTA;
    const eloHome = eloOverride !== undefined
      ? eloOverride.home + effectiveDelta
      : DEFAULT_ELO;
    const eloAway = eloOverride?.away ?? DEFAULT_ELO;
    const lambdaResult = computeLambdas({
      effectiveEloHome: eloHome,
      effectiveEloAway: eloAway,
      homeForm: null,
      awayForm: null,
    });

    // §14.2: build raw match distribution
    const distributionResult = buildRawMatchDistribution(
      lambdaResult.lambda_home,
      lambdaResult.lambda_away,
    );

    // §16.1: aggregate raw 1X2 probs
    const raw1x2AggResult = aggregateRaw1x2(distributionResult.distribution);

    // §16.5–§16.11: derived raw outputs
    const derivedRaw = computeDerivedRaw(distributionResult.distribution);

    const engineOutputs: RawEngineOutputs = {
      lambdaResult,
      distributionResult,
      raw1x2: raw1x2AggResult.probs,
      derivedRaw,
      effectiveElo: {
        home: eloHome,
        away: eloAway,
        homAdvantageEffect: eloOverride !== undefined ? HOME_ADVANTAGE_ELO_DELTA : 0,
      },
    };

    // ── LIMITED_MODE: skip calibration ──────────────────────────────────
    if (validationResult.operating_mode === 'LIMITED_MODE') {
      return buildPredictionResponse({
        matchInput: input,
        validationResult,
        engineOutputs,
        versionMetadata,
      });
    }

    // ── Steps 7–9: Calibration (FULL_MODE only) ──────────────────────────

    // §17.2: select calibrator for this match's domain+family
    const profile = input.competition_profile;
    const selectionResult = selectCalibrator(
      profile.team_domain,
      profile.competition_family,
      this.calibrationRegistry,
    );

    // §17.1: apply one-vs-rest isotonic calibration + renormalize
    const raw1x2 = raw1x2AggResult.probs;
    const calibratedRaw = applyOneVsRestCalibration(
      raw1x2.home,
      raw1x2.draw,
      raw1x2.away,
      selectionResult.calibrators,
    );

    // Cast to branded Calibrated1x2Probs — applyOneVsRestCalibration returns
    // a plain {home, draw, away}; brand is satisfied structurally for downstream.
    const calibrated1x2 = calibratedRaw as unknown as Calibrated1x2Probs;

    // §16.3, §16.4: derived calibrated outputs
    const derivedCalibrated = computeDerivedCalibrated(calibrated1x2);

    // §16.12, §16.13: decision policy — predicted_result + favorite_margin
    const predictedResult = computePredictedResultFromCurrentPolicy(calibrated1x2);

    const calibratedOutputs: CalibratedOutputs = {
      calibrated1x2,
      derivedCalibrated,
      predictedResult,
    };

    // ── Step 10: Assemble PredictionResponse ─────────────────────────────
    return buildPredictionResponse({
      matchInput: input,
      validationResult,
      engineOutputs,
      calibratedOutputs,
      versionMetadata,
    });
  }
}
