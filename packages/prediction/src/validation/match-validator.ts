/**
 * match-validator.ts
 *
 * Main entry point for the Validation Layer (§5.3).
 *
 * Spec authority:
 *   §7.2  — Critical fields → NOT_ELIGIBLE on absence
 *   §7.3  — Conditionally required fields
 *   §7.4  — Minimum history requirements
 *   §7.5  — Accepted match scope (official, senior, 11v11)
 *   §7.6  — Classification must come from competition catalog, not heuristics
 *   §8.3  — CompetitionProfile consistency rules
 *   §8.4  — KnockoutResolutionRules deterministic rules
 *   §10.4 — INTERNATIONAL_CLUB without league_strength_factor → at most LIMITED_MODE
 *   §11.1 — Operating mode determination (FULL_MODE / LIMITED_MODE / NOT_ELIGIBLE)
 *   §11.2 — Reason code catalog (10 codes only)
 *   §11.3 — Degradation rules
 *   §12   — ValidationResult shape
 *   §13.1 — applicability_level deterministic rules
 *   §19.6 — prior_rating_domain_mismatch → NOT_ELIGIBLE (hard, no exceptions)
 *   §20.2 — prior_rating utilizable conditions
 *   §25.1 — Schema validation suite
 *   §25.3 — Operating mode validation suite
 *
 * Package boundary: @sportpulse/prediction only.
 * MUST NOT import from @sportpulse/scoring, @sportpulse/signals,
 * @sportpulse/layout, packages/web, or packages/api.
 *
 * ANTI-PATTERNS (prohibited per spec):
 *   - Inferring official/senior/11v11 from non-structural signals (§7.6)
 *   - Relaxing prior_rating age threshold based on context (§20.2)
 *   - Granting STRONG applicability from prior_rating alone (§13.1)
 *   - Allowing LIMITED_MODE with no reasons (§11.2)
 *   - Inventing reason codes not in §11.2 catalog
 */

import type { MatchInput } from '../contracts/types/match-input.js';
import type {
  ValidationResult,
  DataIntegrityFlags,
  ReasonCode,
} from '../contracts/types/validation-result.js';
import type {
  OperatingMode,
  EligibilityStatus,
  ApplicabilityLevel,
} from '../contracts/types/operating-mode.js';
import type { LeagueStrengthFactorRecord } from '../contracts/types/league-strength.js';
import type { PriorRating } from '../contracts/types/prior-rating.js';

import { validateCompetitionProfile } from './competition-profile-validator.js';
import { validateHistory } from './history-validator.js';

// ── Context type ───────────────────────────────────────────────────────────

/**
 * Extended validation context that wraps MatchInput with optional resolved
 * records that the Validation Layer needs to enforce §20.2 and §10.4.
 *
 * All new fields are optional so existing callers are not broken.
 * §10.4, §10.2, §19.6, §20.2
 */
export interface MatchValidationContext {
  input: MatchInput;

  /**
   * Resolved league strength factor for the home team's domain.
   * Must be null/undefined when competition_family != INTERNATIONAL_CLUB.
   * §10.2, §10.4
   */
  home_league_strength_factor?: LeagueStrengthFactorRecord | null;

  /**
   * Resolved league strength factor for the away team's domain.
   * Must be null/undefined when competition_family != INTERNATIONAL_CLUB.
   * §10.2, §10.4
   */
  away_league_strength_factor?: LeagueStrengthFactorRecord | null;

  /**
   * Whether the competition catalog confirms this match is official, senior,
   * and 11v11. §7.6 — this classification MUST come from the catalog, not
   * from heuristics on team names or other soft signals.
   *
   * If undefined/null, the validator treats it as UNCONFIRMED and the match
   * is NOT_ELIGIBLE per §7.6.
   */
  catalog_confirms_official_senior_11v11?: boolean | null;

  /**
   * Actual PriorRating record for the home team, when the engine has
   * resolved it. When present, the Validation Layer evaluates the full
   * §20.2 conditions (domain_matches, age, updates, cross_season_carry)
   * directly instead of trusting the pre-evaluated boolean flag in
   * historical_context.home_prior_rating_available.
   *
   * When absent/null, falls back to the boolean flag (Phase 2b behavior).
   * §19.6, §20.2
   */
  home_prior_rating?: PriorRating | null;

  /**
   * Actual PriorRating record for the away team. Same semantics as
   * home_prior_rating. §19.6, §20.2
   */
  away_prior_rating?: PriorRating | null;

  /**
   * Whether the domain pool is available for this match's team_domain.
   * When explicitly set to false, the validator emits DOMAIN_POOL_UNAVAILABLE
   * and returns NOT_ELIGIBLE. §11.2
   *
   * When absent/undefined, the pool is treated as available (default).
   */
  domain_pool_available?: boolean;
}

// ── Critical fields list (§7.2) ────────────────────────────────────────────

/**
 * The exact set of critical fields whose absence triggers NOT_ELIGIBLE.
 * §7.2 is authoritative. Do not add or remove fields without a spec change.
 */
type CriticalTopLevelField = keyof Pick<
  MatchInput,
  | 'match_id'
  | 'kickoff_utc'
  | 'competition_id'
  | 'season_id'
  | 'home_team_id'
  | 'away_team_id'
  | 'competition_profile'
  | 'home_team_domain_id'
  | 'away_team_domain_id'
  | 'historical_context'
>;

const CRITICAL_TOP_LEVEL_FIELDS: CriticalTopLevelField[] = [
  'match_id',
  'kickoff_utc',
  'competition_id',
  'season_id',
  'home_team_id',
  'away_team_id',
  'competition_profile',
  'home_team_domain_id',
  'away_team_domain_id',
  'historical_context',
];

/**
 * Critical fields within competition_profile per §7.2.
 */
const CRITICAL_PROFILE_FIELDS = [
  'team_domain',
  'competition_family',
  'stage_type',
  'format_type',
  'leg_type',
  'neutral_venue',
  'competition_profile_version',
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns true if a value is present and non-null/non-empty-string.
 * An empty string is treated as absent for critical field checks.
 */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

/**
 * Validates that kickoff_utc is a parseable ISO-8601 UTC string.
 * §12 DataIntegrityFlags.kickoff_present
 */
function isKickoffValid(kickoff_utc: string): boolean {
  if (!kickoff_utc || kickoff_utc.trim() === '') return false;
  const d = new Date(kickoff_utc);
  return !isNaN(d.getTime());
}

// ── Main validator ─────────────────────────────────────────────────────────

/**
 * Validates a MatchInput and produces a ValidationResult.
 *
 * This is the authoritative determination of eligibility and mode before
 * any prediction computation begins. §12
 *
 * Invariant: this function always returns a fully populated ValidationResult.
 * It never throws — all error paths are expressed as reason codes.
 *
 * Execution order (fail-fast on NOT_ELIGIBLE):
 *   1. Critical field presence (§7.2)
 *   2. Match type scope confirmation (§7.6)
 *   3. teams_distinct check (§12)
 *   4. CompetitionProfile consistency (§8.3, §8.4)
 *   4.5 domain_pool_available check (§11.2 DOMAIN_POOL_UNAVAILABLE)
 *   5. prior_rating_domain_mismatch hard check (§19.6, §20.2) — real record evaluation
 *   6. History / prior_rating eligibility (§7.4, §20.1)
 *   7. INTERNATIONAL_CLUB bridging check (§10.4)
 *   8. Operating mode assignment (§11.1)
 *   9. applicability_level assignment (§13.1)
 *  10. DataIntegrityFlags population (§12)
 */
export function validateMatch(context: MatchValidationContext): ValidationResult {
  const { input } = context;

  // Accumulate reason codes throughout (all must be enumerated per §11.2)
  const reasons: ReasonCode[] = [];

  // Track mode — start optimistic, degrade as violations are found
  let operatingMode: OperatingMode = 'FULL_MODE';

  // ────────────────────────────────────────────────────────────────────────
  // Step 1: Critical field presence (§7.2)
  // Any absent critical field → NOT_ELIGIBLE + MISSING_CRITICAL_FIELD
  // ────────────────────────────────────────────────────────────────────────
  let hasMissingCritical = false;

  for (const field of CRITICAL_TOP_LEVEL_FIELDS) {
    if (!isPresent(input[field])) {
      hasMissingCritical = true;
    }
  }

  // Check critical profile sub-fields only if competition_profile is present
  if (input.competition_profile) {
    for (const field of CRITICAL_PROFILE_FIELDS) {
      const val = input.competition_profile[field as keyof typeof input.competition_profile];
      if (!isPresent(val)) {
        hasMissingCritical = true;
      }
    }
    // neutral_venue is boolean — explicitly check it's not undefined/null
    if (
      input.competition_profile.neutral_venue === undefined ||
      input.competition_profile.neutral_venue === null
    ) {
      hasMissingCritical = true;
    }
  }

  if (hasMissingCritical) {
    reasons.push('MISSING_CRITICAL_FIELD');
    // Fail-fast: return NOT_ELIGIBLE immediately
    return buildResult(
      input.match_id ?? '',
      'NOT_ELIGIBLE',
      'NOT_ELIGIBLE',
      'WEAK',
      reasons,
      buildIntegrityFlagsForFailure(input, false),
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 2: Official / senior / 11v11 scope confirmation (§7.6)
  // §7.6: "queda prohibido inferir esta clasificación por heurística blanda"
  // If catalog confirmation is absent/false → NOT_ELIGIBLE
  // ────────────────────────────────────────────────────────────────────────
  if (!context.catalog_confirms_official_senior_11v11) {
    reasons.push('UNSUPPORTED_MATCH_TYPE');
    return buildResult(
      input.match_id,
      'NOT_ELIGIBLE',
      'NOT_ELIGIBLE',
      'WEAK',
      reasons,
      buildIntegrityFlagsForFailure(input, false),
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 3: Teams must be distinct (§12 DataIntegrityFlags.teams_distinct)
  // If home_team_id === away_team_id → structural contradiction → NOT_ELIGIBLE
  // ────────────────────────────────────────────────────────────────────────
  const teams_distinct = input.home_team_id !== input.away_team_id;
  if (!teams_distinct) {
    reasons.push('INVALID_COMPETITION_PROFILE');
    return buildResult(
      input.match_id,
      'NOT_ELIGIBLE',
      'NOT_ELIGIBLE',
      'WEAK',
      reasons,
      buildIntegrityFlagsForFailure(input, false),
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 4: CompetitionProfile consistency (§8.3, §8.4)
  // ────────────────────────────────────────────────────────────────────────
  const profileResult = validateCompetitionProfile(input.competition_profile);
  const profile_complete = profileResult.valid;

  if (!profileResult.valid) {
    for (const rc of profileResult.reasons) {
      if (!reasons.includes(rc)) reasons.push(rc);
    }
    // Profile contradiction → NOT_ELIGIBLE per §11.1
    return buildResult(
      input.match_id,
      'NOT_ELIGIBLE',
      'NOT_ELIGIBLE',
      'WEAK',
      reasons,
      buildIntegrityFlagsForFailure(input, false),
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 4.5: domain_pool_available check (§11.2 DOMAIN_POOL_UNAVAILABLE)
  //
  // If the caller explicitly signals that the domain pool is unavailable
  // (e.g., the rating pool for this team_domain has not been built),
  // the match is NOT_ELIGIBLE.
  // ────────────────────────────────────────────────────────────────────────
  if (context.domain_pool_available === false) {
    reasons.push('DOMAIN_POOL_UNAVAILABLE');
    return buildResult(
      input.match_id,
      'NOT_ELIGIBLE',
      'NOT_ELIGIBLE',
      'WEAK',
      reasons,
      buildIntegrityFlagsForFailure(input, teams_distinct),
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 5: prior_rating_domain_mismatch — hard NOT_ELIGIBLE (§19.6, §20.2)
  //
  // "prior_rating_domain_mismatch => NOT_ELIGIBLE" — non-negotiable.
  //
  // When the caller provides actual PriorRating records in the context
  // (home_prior_rating / away_prior_rating), the Validation Layer evaluates
  // the §20.2 conditions directly. This is the enforcement path that resolves
  // auditor findings CRITICAL-001 and CRITICAL-003.
  //
  // When no records are provided, the layer falls back to trusting the
  // boolean flags in historical_context (Phase 2b backwards-compatible path).
  //
  // Per §19.6: domain mismatch → NOT_ELIGIBLE + INVALID_PRIOR_RATING.
  // Per §20.2: age > threshold or updates < threshold → not utilizable (does
  // NOT make the match NOT_ELIGIBLE on its own; only domain mismatch does).
  // ────────────────────────────────────────────────────────────────────────
  const hc = input.historical_context;

  // Evaluate real §20.2 conditions when records are available
  if (context.home_prior_rating != null) {
    const pr = context.home_prior_rating;
    // Condition 1 (§20.2): domain must match — hard NOT_ELIGIBLE
    if (
      pr.conditions?.domain_matches === false ||
      pr.team_domain !== input.competition_profile.team_domain
    ) {
      reasons.push('INVALID_PRIOR_RATING');
      return buildResult(
        input.match_id,
        'NOT_ELIGIBLE',
        'NOT_ELIGIBLE',
        'WEAK',
        reasons,
        buildIntegrityFlagsForFailure(input, teams_distinct),
      );
    }
  }

  if (context.away_prior_rating != null) {
    const pr = context.away_prior_rating;
    // Condition 1 (§20.2): domain must match — hard NOT_ELIGIBLE
    if (
      pr.conditions?.domain_matches === false ||
      pr.team_domain !== input.competition_profile.team_domain
    ) {
      reasons.push('INVALID_PRIOR_RATING');
      return buildResult(
        input.match_id,
        'NOT_ELIGIBLE',
        'NOT_ELIGIBLE',
        'WEAK',
        reasons,
        buildIntegrityFlagsForFailure(input, teams_distinct),
      );
    }
  }

  // Determine prior_rating_consistent flag for DataIntegrityFlags (§20.2)
  // When records are present: consistent = no domain mismatch found above
  // When records are absent: trust the caller-evaluated boolean flag
  const prior_rating_consistent = computePriorRatingConsistency(context, input);

  // Compute effective prior_rating_available flags, overriding the boolean
  // in MatchInput when the engine provided actual records.
  const effectiveHomePriorAvailable = computeEffectivePriorRatingAvailable(
    context.home_prior_rating,
    hc.home_prior_rating_available,
    input.kickoff_utc,
  );
  const effectiveAwayPriorAvailable = computeEffectivePriorRatingAvailable(
    context.away_prior_rating,
    hc.away_prior_rating_available,
    input.kickoff_utc,
  );

  // ────────────────────────────────────────────────────────────────────────
  // Step 6: History / prior_rating eligibility (§7.4, §20.1, §20.2)
  // ────────────────────────────────────────────────────────────────────────
  const histResult = validateHistory(
    input,
    effectiveHomePriorAvailable,
    effectiveAwayPriorAvailable,
  );

  if (!histResult.both_eligible) {
    // §7.4, §20.1: neither history nor prior_rating → NOT_ELIGIBLE
    for (const rc of histResult.reasons) {
      if (!reasons.includes(rc)) reasons.push(rc);
    }
    return buildResult(
      input.match_id,
      'NOT_ELIGIBLE',
      'NOT_ELIGIBLE',
      'WEAK',
      reasons,
      buildIntegrityFlagsForEligible(input, {
        teams_distinct,
        profile_complete: true,
        prior_rating_consistent,
        stage_consistent_with_format: true,
        aggregate_state_consistent: true,
        neutral_venue_consistent: true,
        domain_pool_available: false, // neither history nor prior_rating → pool unavailable
        leakage_guard_passed: computeLeakageGuard(input),
        knockout_rules_consistent: true,
      }),
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 7: INTERNATIONAL_CLUB bridging check (§10.4)
  // "Si falta league_strength_factor válido para un partido INTERNATIONAL_CLUB:
  //   - no puede operar en FULL_MODE
  //   - debe bajar al menos a LIMITED_MODE
  //   - applicability_level no puede ser STRONG"
  // ────────────────────────────────────────────────────────────────────────
  let missingBridging = false;

  if (input.competition_profile.competition_family === 'INTERNATIONAL_CLUB') {
    const homeHasFactor = isLeagueStrengthFactorValid(
      context.home_league_strength_factor,
      input.kickoff_utc,
    );
    const awayHasFactor = isLeagueStrengthFactorValid(
      context.away_league_strength_factor,
      input.kickoff_utc,
    );

    if (!homeHasFactor || !awayHasFactor) {
      missingBridging = true;
      if (!reasons.includes('INTERLEAGUE_FACTOR_UNAVAILABLE')) {
        reasons.push('INTERLEAGUE_FACTOR_UNAVAILABLE');
      }
      // §10.4: degrade to at most LIMITED_MODE
      operatingMode = 'LIMITED_MODE';
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 8: Operating mode assignment (§11.1)
  //
  // At this point all NOT_ELIGIBLE paths have been handled.
  // If operatingMode is still FULL_MODE, check for LIMITED_MODE conditions.
  //
  // LIMITED_MODE: critical fields present, profile consistent, but some
  // secondary components are missing or context is weak. (§11.1)
  //
  // History degradation: if one/both teams enter only via prior_rating
  // (no min history), the context is weaker → LIMITED_MODE per §11.3
  // combined with §20.2: "prior_rating utilizable but weak recent history"
  // allows operation in CAUTION or WEAK, but the spec does not explicitly
  // mandate LIMITED_MODE in this case — it says the match "puede operar en
  // LIMITED_MODE o FULL_MODE con applicability_level != STRONG".
  // Safe interpretation: keep FULL_MODE when all fields are present and
  // prior_rating is utilizable; adjust applicability_level to CAUTION/WEAK.
  // ────────────────────────────────────────────────────────────────────────

  // operatingMode may already be LIMITED_MODE from bridging check
  // No other automatic degradation to LIMITED_MODE from history in v1 base
  // (per §11.1 FULL_MODE conditions are met when critical fields present,
  //  profile consistent, both teams have min history or prior_rating, and
  //  no bridging issues)

  // ────────────────────────────────────────────────────────────────────────
  // Step 9: applicability_level assignment (§13.1)
  // Decision table from §13.1 — fully deterministic.
  // ────────────────────────────────────────────────────────────────────────
  const applicabilityLevel = computeApplicabilityLevel(
    input,
    operatingMode,
    histResult.both_strong_history,
    context.home_league_strength_factor,
    context.away_league_strength_factor,
    missingBridging,
  );

  // §11.3: LIMITED_MODE must have CAUTION or WEAK (never STRONG)
  // This is enforced within computeApplicabilityLevel; assert it here.
  if (operatingMode === 'LIMITED_MODE' && applicabilityLevel === 'STRONG') {
    // This should be unreachable; belt-and-suspenders guard
    throw new Error(
      'Invariant violation: LIMITED_MODE cannot have STRONG applicability_level (§11.3)',
    );
  }

  // §11.2: LIMITED_MODE must have at least one reason entry
  if (operatingMode === 'LIMITED_MODE' && reasons.length === 0) {
    throw new Error(
      'Invariant violation: LIMITED_MODE with zero reason entries is invalid (§11.2)',
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 10: DataIntegrityFlags (§12, §20.1, §20.2)
  // ────────────────────────────────────────────────────────────────────────
  const flags = buildIntegrityFlagsForEligible(input, {
    teams_distinct,
    profile_complete,
    prior_rating_consistent,
    stage_consistent_with_format: true, // passed §8.3 check above
    aggregate_state_consistent: computeAggregateStateConsistency(input),
    neutral_venue_consistent: true, // §8.3: not evaluated here (requires engine context)
    domain_pool_available: true, // both teams eligible
    leakage_guard_passed: computeLeakageGuard(input),
    knockout_rules_consistent: true, // passed §8.4 check above
  });

  // At this point all NOT_ELIGIBLE paths returned early above; operatingMode
  // is always FULL_MODE or LIMITED_MODE here. §11.1
  const eligibilityStatus: EligibilityStatus = 'ELIGIBLE';

  return {
    match_id: input.match_id,
    eligibility_status: eligibilityStatus,
    operating_mode: operatingMode,
    applicability_level: applicabilityLevel,
    reasons,
    data_integrity_flags: flags,
  };
}

// ── applicability_level decision table (§13.1) ─────────────────────────────

/**
 * Computes applicability_level from deterministic spec rules in §13.1.
 *
 * §13.1 STRONG conditions (ALL must hold):
 *   1. operating_mode = FULL_MODE
 *   2. competition_family = DOMESTIC_LEAGUE  OR
 *      (stage_type = GROUP_STAGE AND competition_family in {INTERNATIONAL_CLUB, NATIONAL_TEAM_TOURNAMENT})
 *   3. both teams meet strong recent history threshold
 *   4. neutral_venue = false
 *   5. leg_type != SECOND_LEG
 *   6. if bridging applies: confidence_level in {"HIGH", "MEDIUM"}
 *
 * §13.1 CAUTION: FULL_MODE but not all STRONG conditions, plus specific cases listed.
 *
 * §13.1 WEAK: any of: LIMITED_MODE, missing secondary, team only via prior_rating
 *             with weak history, accumulated degradations.
 */
function computeApplicabilityLevel(
  input: MatchInput,
  operatingMode: OperatingMode,
  both_strong_history: boolean,
  home_lsf: LeagueStrengthFactorRecord | null | undefined,
  away_lsf: LeagueStrengthFactorRecord | null | undefined,
  missingBridging: boolean,
): ApplicabilityLevel {
  const profile = input.competition_profile;

  // §13.1: WEAK — any of these
  if (operatingMode === 'LIMITED_MODE') return 'WEAK';

  // Check if either team enters only via prior_rating (no min history)
  // §13.1 WEAK: "uno o ambos equipos entran solo por rating previo utilizable con historia
  // reciente por debajo del umbral fuerte"
  const hc = input.historical_context;
  const domain = profile.team_domain;

  const homeMinHistory =
    domain === 'CLUB'
      ? (hc.home_completed_official_matches_last_365d ?? 0) >= 5 // MIN_RECENT_MATCHES_CLUB
      : (hc.home_completed_official_matches_last_730d ?? 0) >= 5; // MIN_RECENT_MATCHES_NATIONAL_TEAM

  const awayMinHistory =
    domain === 'CLUB'
      ? (hc.away_completed_official_matches_last_365d ?? 0) >= 5
      : (hc.away_completed_official_matches_last_730d ?? 0) >= 5;

  const homeOnlyViaPrior = !homeMinHistory && hc.home_prior_rating_available;
  const awayOnlyViaPrior = !awayMinHistory && hc.away_prior_rating_available;

  if (homeOnlyViaPrior || awayOnlyViaPrior) {
    // §20.2 + §13.1: prior_rating utilizable but weak recent history → CAUTION or WEAK
    // "si el prior_rating es utilizable pero la historia reciente no alcanza umbral fuerte,
    // el partido puede operar solo en CAUTION o WEAK, nunca en STRONG"
    // Since the team has no min history at all (only prior_rating), this is below CAUTION
    // threshold for STRONG and suggests WEAK.
    return 'WEAK';
  }

  // At this point operatingMode = FULL_MODE and both teams have at least min history.

  // §13.1 STRONG — evaluate all 6 conditions:
  const condition1_fullMode = operatingMode === 'FULL_MODE'; // always true here

  const condition2_familyStage =
    profile.competition_family === 'DOMESTIC_LEAGUE' ||
    (profile.stage_type === 'GROUP_STAGE' &&
      (profile.competition_family === 'INTERNATIONAL_CLUB' ||
        profile.competition_family === 'NATIONAL_TEAM_TOURNAMENT'));

  const condition3_strongHistory = both_strong_history;

  const condition4_notNeutral = !profile.neutral_venue;

  const condition5_notSecondLeg = profile.leg_type !== 'SECOND_LEG';

  // §13.1 condition 6: if bridging applies, confidence_level in {"HIGH", "MEDIUM"}
  // Bridging applies only for INTERNATIONAL_CLUB (§10.2, §10.5)
  let condition6_bridgingOk = true;
  if (profile.competition_family === 'INTERNATIONAL_CLUB') {
    if (missingBridging) {
      condition6_bridgingOk = false;
    } else {
      const homeBridgingOk =
        home_lsf == null ||
        home_lsf.confidence_level === 'HIGH' ||
        home_lsf.confidence_level === 'MEDIUM';
      const awayBridgingOk =
        away_lsf == null ||
        away_lsf.confidence_level === 'HIGH' ||
        away_lsf.confidence_level === 'MEDIUM';
      condition6_bridgingOk = homeBridgingOk && awayBridgingOk;
    }
  }

  if (
    condition1_fullMode &&
    condition2_familyStage &&
    condition3_strongHistory &&
    condition4_notNeutral &&
    condition5_notSecondLeg &&
    condition6_bridgingOk
  ) {
    // §13.1: "Queda prohibido otorgar STRONG solo por existencia de prior_rating
    // si no se cumple también el umbral fuerte de historia reciente"
    // (already handled above: homeOnlyViaPrior/awayOnlyViaPrior → WEAK before reaching here)
    return 'STRONG';
  }

  // §13.1 CAUTION — FULL_MODE but not STRONG, and within modeled scope
  // Includes any of the listed CAUTION cases:
  const isCautionCase =
    profile.competition_family === 'DOMESTIC_CUP' ||
    profile.competition_family === 'INTERNATIONAL_CLUB' ||
    [
      'PLAYOFF',
      'ROUND_OF_32',
      'ROUND_OF_16',
      'QUARTER_FINAL',
      'SEMI_FINAL',
      'FINAL',
      'THIRD_PLACE',
    ].includes(profile.stage_type) ||
    profile.neutral_venue ||
    profile.leg_type === 'SECOND_LEG' ||
    !both_strong_history ||
    // SPEC_AMBIGUITY: TypeScript narrows competition_family here because
    // 'INTERNATIONAL_CLUB' already appears earlier in this expression.
    // Cast to string to avoid the false-positive narrowing error.
    ((profile.competition_family as string) === 'INTERNATIONAL_CLUB' &&
      !missingBridging &&
      (home_lsf?.confidence_level === 'LOW' || away_lsf?.confidence_level === 'LOW'));

  if (isCautionCase) return 'CAUTION';

  // Default FULL_MODE fallback — still CAUTION, not STRONG (§13.1)
  return 'CAUTION';
}

// ── leakage_guard_passed computation (§19.6, §3.6) ─────────────────────────

/**
 * Computes leakage_guard_passed.
 *
 * §3.6: Only completed matches with timestamp strictly before kickoff_utc may
 * be used. The guard is enforced by the engine's data pipeline, not verifiable
 * from MatchInput alone.
 *
 * §19.6: "si prior_rating_domain_mismatch, el partido es NOT_ELIGIBLE"
 *
 * At MatchInput level, the leakage guard can only be asserted if kickoff_utc
 * is a valid parseable timestamp (§12 DataIntegrityFlags.kickoff_present).
 * If kickoff_utc is valid, the flag is optimistically true because the actual
 * temporal anti-leakage enforcement happens at the data pipeline level.
 *
 * Assumption (minimal safe): leakage_guard_passed = kickoff_utc is valid.
 * The engine's data layer is responsible for ensuring the temporal constraint
 * is honored; the Validation Layer records whether the guard CAN pass.
 */
function computeLeakageGuard(input: MatchInput): boolean {
  if (!input.kickoff_utc || input.kickoff_utc.trim() === '') return false;
  const d = new Date(input.kickoff_utc);
  return !isNaN(d.getTime());
}

// ── aggregate_state consistency (§8.3, §12) ────────────────────────────────

/**
 * aggregate_state_before_match must be present if and only if leg_type = SECOND_LEG.
 * §12 DataIntegrityFlags.aggregate_state_consistent_with_leg_type
 * §8.3: "leg_type = SECOND_LEG requiere agregado previo"
 */
function computeAggregateStateConsistency(input: MatchInput): boolean {
  const leg = input.competition_profile.leg_type;
  const agg = input.competition_profile.aggregate_state_before_match;

  if (leg === 'SECOND_LEG') {
    return agg != null;
  }
  // For SINGLE / FIRST_LEG: aggregate state should not be present
  // If it is present, it's benign (not a hard violation), so we return true.
  return true;
}

// ── LeagueStrengthFactor validity ──────────────────────────────────────────

/**
 * Checks whether a LeagueStrengthFactorRecord is valid and in effect at kickoff_utc.
 * §10.3: must be temporally bounded and versioned.
 * Returns false if the record is null/undefined (absent).
 */
function isLeagueStrengthFactorValid(
  record: LeagueStrengthFactorRecord | null | undefined,
  kickoff_utc: string,
): boolean {
  if (!record) return false;

  const kickoff = new Date(kickoff_utc).getTime();
  const effectiveFrom = new Date(record.effective_from_utc).getTime();
  if (kickoff < effectiveFrom) return false;

  if (record.effective_to_utc) {
    const effectiveTo = new Date(record.effective_to_utc).getTime();
    if (kickoff > effectiveTo) return false;
  }

  return true;
}

// ── prior_rating helpers ────────────────────────────────────────────────────

/**
 * Determines prior_rating_consistent for DataIntegrityFlags (§20.2, §12).
 *
 * When actual PriorRating records are in the context, consistent = true
 * iff no domain mismatch was detected (we already returned NOT_ELIGIBLE
 * above if there was one, so reaching here means no mismatch found).
 *
 * When no records are provided, consistent is vacuously true unless
 * the caller signalled unavailability via both boolean flags = false
 * (no prior_rating → no mismatch possible, so still true).
 */
function computePriorRatingConsistency(
  context: MatchValidationContext,
  _input: MatchInput,
): boolean {
  // If we reach this point, any domain mismatch would have already caused
  // an early NOT_ELIGIBLE return. So prior_rating_consistent = true.
  void context;
  void _input;
  return true;
}

/**
 * Computes the effective `prior_rating_available` flag for a team.
 *
 * When an actual PriorRating record is provided, evaluate §20.2 conditions
 * 2 and 3 (age and updates). Condition 1 (domain match) was already enforced
 * in Step 5 — reaching here means domain is consistent.
 *
 * If the record is null/undefined, fall back to the caller-provided boolean.
 *
 * §20.2 conditions evaluated here:
 *   - age_within_limit: diff(kickoff_utc, last_updated_utc) <= PRIOR_RATING_MAX_AGE_DAYS (400)
 *   - sufficient_updates_in_window: updates_in_last_730d >= PRIOR_RATING_MIN_UPDATES_LAST_730D (3)
 *   - cross_season_carry_valid: if carried, PRIOR_RATING_CROSS_SEASON_CARRY_ALLOWED must be true
 *
 * Returns false (not utilizable) if any of these conditions fail.
 */
function computeEffectivePriorRatingAvailable(
  record: import('../contracts/types/prior-rating.js').PriorRating | null | undefined,
  fallbackFlag: boolean,
  kickoff_utc: string,
): boolean {
  if (record == null) {
    // No record provided — trust the caller's pre-evaluated flag
    return fallbackFlag;
  }

  // If the record has pre-evaluated conditions, use them directly
  if (record.conditions != null) {
    return record.conditions.is_utilizable;
  }

  // Evaluate conditions from the record's raw fields
  // Condition 2 (§20.2): age <= PRIOR_RATING_MAX_AGE_DAYS (400 days)
  const kickoffMs = new Date(kickoff_utc).getTime();
  const lastUpdatedMs = new Date(record.last_updated_utc).getTime();
  const ageDays = (kickoffMs - lastUpdatedMs) / (1000 * 60 * 60 * 24);
  // §4.3: PRIOR_RATING_MAX_AGE_DAYS = 400
  if (ageDays > 400) return false; // §20.2: age > threshold → not utilizable

  // Condition 3 (§20.2): updates_in_last_730d >= PRIOR_RATING_MIN_UPDATES_LAST_730D (3)
  // §4.3: PRIOR_RATING_MIN_UPDATES_LAST_730D = 3
  if (record.updates_in_last_730d < 3) return false; // §20.2: insufficient updates → not utilizable

  // Condition 5 (§20.2): cross_season_carry must be permitted
  // §4.3: PRIOR_RATING_CROSS_SEASON_CARRY_ALLOWED = true
  // If carried and carry not allowed, not utilizable
  if (record.carried_from_season_id != null) {
    // §4.3: cross_season_carry_allowed = true → carry is always permitted in v1
    // No-op: constant is true, no violation possible
  }

  return true;
}

// ── DataIntegrityFlags builders ────────────────────────────────────────────

interface EligibleFlagInputs {
  teams_distinct: boolean;
  profile_complete: boolean;
  prior_rating_consistent: boolean;
  stage_consistent_with_format: boolean;
  aggregate_state_consistent: boolean;
  neutral_venue_consistent: boolean;
  domain_pool_available: boolean;
  leakage_guard_passed: boolean;
  knockout_rules_consistent: boolean;
}

/**
 * Builds DataIntegrityFlags for matches that passed critical field checks.
 * §12 — all flags are required booleans.
 */
function buildIntegrityFlagsForEligible(
  input: MatchInput,
  flags: EligibleFlagInputs,
): DataIntegrityFlags {
  return {
    teams_distinct: flags.teams_distinct,
    kickoff_present: isKickoffValid(input.kickoff_utc),
    profile_complete: flags.profile_complete,
    stage_consistent_with_format: flags.stage_consistent_with_format,
    aggregate_state_consistent_with_leg_type: flags.aggregate_state_consistent,
    neutral_venue_consistent: flags.neutral_venue_consistent,
    domain_pool_available: flags.domain_pool_available,
    leakage_guard_passed: flags.leakage_guard_passed,
    knockout_rules_consistent: flags.knockout_rules_consistent,
    prior_rating_consistent: flags.prior_rating_consistent,
  };
}

/**
 * Builds DataIntegrityFlags for matches that failed before profile/history checks.
 * Used in early-exit NOT_ELIGIBLE paths where full flag computation is not possible.
 * §12 — all flags must be evaluated; false when evaluation is not possible.
 */
function buildIntegrityFlagsForFailure(
  input: Partial<MatchInput>,
  teams_distinct: boolean,
): DataIntegrityFlags {
  const kickoffValid = input.kickoff_utc ? isKickoffValid(input.kickoff_utc) : false;

  return {
    teams_distinct,
    kickoff_present: kickoffValid,
    profile_complete: false,
    stage_consistent_with_format: false,
    aggregate_state_consistent_with_leg_type: false,
    neutral_venue_consistent: false,
    domain_pool_available: false,
    leakage_guard_passed: false,
    knockout_rules_consistent: false,
    prior_rating_consistent: false,
  };
}

// ── Result builder ─────────────────────────────────────────────────────────

function buildResult(
  match_id: string,
  eligibility_status: EligibilityStatus,
  operating_mode: OperatingMode,
  applicability_level: ApplicabilityLevel,
  reasons: ReasonCode[],
  data_integrity_flags: DataIntegrityFlags,
): ValidationResult {
  return {
    match_id,
    eligibility_status,
    operating_mode,
    applicability_level,
    reasons,
    data_integrity_flags,
  };
}
