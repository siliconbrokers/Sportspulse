/**
 * competition-profile-validator.ts
 *
 * Validates a CompetitionProfile for internal consistency.
 *
 * Spec authority:
 *   §8.3 — Consistency rules for CompetitionProfile fields
 *   §8.4 — KnockoutResolutionRules deterministic rules
 *   §7.3 — Conditionally required fields by format_type / leg_type
 *
 * This validator is PURE — it accepts a CompetitionProfile and returns
 * a typed result. It does NOT assign operating mode; that is done by
 * match-validator.ts which calls this as a sub-check.
 *
 * Package boundary: @sportpulse/prediction only.
 * MUST NOT import from @sportpulse/scoring, @sportpulse/signals,
 * @sportpulse/layout, packages/web, or packages/api.
 */

import type {
  CompetitionProfile,
  FormatType,
  LegType,
  SingleLegResolutionStep,
  SecondLegResolutionStep,
} from '../contracts/types/competition-profile.js';
import type { ReasonCode } from '../contracts/types/validation-result.js';

// ── Result type ────────────────────────────────────────────────────────────

/**
 * Result of validating a CompetitionProfile.
 *
 * `valid = true` means the profile passed all §8.3 and §8.4 checks.
 * `valid = false` always carries at least one reason code.
 */
export interface CompetitionProfileValidationResult {
  valid: boolean;
  /**
   * Populated only when valid = false. Each code is drawn from the §11.2
   * catalog.
   */
  reasons: ReasonCode[];
  /**
   * Human-readable description of the first failure found (for debug/logging).
   * Must not be used for programmatic branching — use reasons[] for that.
   */
  description?: string;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Check that a resolution step array has no duplicate elements.
 * §8.4: "no pueden repetirse pasos dentro del mismo arreglo"
 */
function hasNoDuplicateSteps(
  steps: readonly (SecondLegResolutionStep | SingleLegResolutionStep)[],
): boolean {
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step)) return false;
    seen.add(step);
  }
  return true;
}

/**
 * Check that ORGANIZER_DEFINED, if present, is the LAST element.
 * §8.4: "si aparece ORGANIZER_DEFINED, debe ser el último elemento del arreglo"
 */
function organizerDefinedIsLast(
  steps: readonly (SecondLegResolutionStep | SingleLegResolutionStep)[],
): boolean {
  const orgIdx = steps.indexOf(
    'ORGANIZER_DEFINED' as SecondLegResolutionStep & SingleLegResolutionStep,
  );
  if (orgIdx === -1) return true; // not present — no violation
  return orgIdx === steps.length - 1;
}

// ── Stage-type / format-type consistency table (§8.3) ─────────────────────

/**
 * Allowed format_type values per stage_type per §8.3.
 *
 * §8.3 states "stage_type debe ser consistente con format_type".
 * The spec does not enumerate an exhaustive cross-table, but based on
 * §8.1 definitions and §9 family descriptions, the following constraints
 * can be derived structurally:
 *
 * - GROUP_STAGE  → only GROUP_CLASSIC
 * - LEAGUE_PHASE → only LEAGUE_PHASE_SWISS_STYLE
 * - QUALIFYING / PLAYOFF / ROUND_OF_* / QUARTER_FINAL / SEMI_FINAL /
 *   THIRD_PLACE / FINAL → only KNOCKOUT_SINGLE_LEG or KNOCKOUT_TWO_LEG
 *   (ROUND_ROBIN also possible in QUALIFYING per §9.3)
 * - (no stage_type restriction on ROUND_ROBIN beyond the above)
 *
 * Assumption (minimal safe): if a group-related stage has a non-group
 * format, that is a consistency failure. Knockout stages cannot use
 * ROUND_ROBIN or GROUP_CLASSIC.
 */
const KNOCKOUT_STAGE_TYPES = new Set([
  'QUALIFYING',
  'PLAYOFF',
  'ROUND_OF_32',
  'ROUND_OF_16',
  'QUARTER_FINAL',
  'SEMI_FINAL',
  'THIRD_PLACE',
  'FINAL',
] as const);

const KNOCKOUT_FORMAT_TYPES = new Set<FormatType>(['KNOCKOUT_SINGLE_LEG', 'KNOCKOUT_TWO_LEG']);

// ── Main validator ─────────────────────────────────────────────────────────

/**
 * Validates a CompetitionProfile against §8.3 consistency rules and
 * §8.4 KnockoutResolutionRules deterministic rules.
 *
 * Returns { valid: true, reasons: [] } on success.
 * Returns { valid: false, reasons: [...] } with at least one code on failure.
 */
export function validateCompetitionProfile(
  profile: CompetitionProfile,
): CompetitionProfileValidationResult {
  const reasons: ReasonCode[] = [];
  const descriptions: string[] = [];

  const fmt: FormatType = profile.format_type;
  const leg: LegType = profile.leg_type;

  // ── §8.3 check 1: GROUP_CLASSIC requires group_ranking_rules ──────────
  // "GROUP_CLASSIC no puede venir sin reglas de grupo"
  if (fmt === 'GROUP_CLASSIC' && !profile.group_ranking_rules) {
    reasons.push('INVALID_COMPETITION_PROFILE');
    descriptions.push('GROUP_CLASSIC format_type requires group_ranking_rules (§8.3)');
  }

  // ── §8.3 check 2: GROUP_CLASSIC requires qualification_rules ──────────
  // §7.3 and §8.3 both mandate this
  if (fmt === 'GROUP_CLASSIC' && !profile.qualification_rules) {
    if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
      reasons.push('INVALID_COMPETITION_PROFILE');
    }
    descriptions.push('GROUP_CLASSIC format_type requires qualification_rules (§7.3, §8.3)');
  }

  // ── §8.3 check 3: GROUP_CLASSIC requires tie_break_rules ──────────────
  if (fmt === 'GROUP_CLASSIC' && !profile.tie_break_rules) {
    if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
      reasons.push('INVALID_COMPETITION_PROFILE');
    }
    descriptions.push('GROUP_CLASSIC format_type requires tie_break_rules (§7.3, §8.3)');
  }

  // ── §8.3 check 4: LEAGUE_PHASE_SWISS_STYLE requires league_phase_rules ─
  // "LEAGUE_PHASE_SWISS_STYLE no puede venir sin reglas de league phase"
  if (fmt === 'LEAGUE_PHASE_SWISS_STYLE' && !profile.league_phase_rules) {
    if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
      reasons.push('INVALID_COMPETITION_PROFILE');
    }
    descriptions.push('LEAGUE_PHASE_SWISS_STYLE format_type requires league_phase_rules (§8.3)');
  }

  // ── §8.3 check 5: LEAGUE_PHASE_SWISS_STYLE requires qualification_rules
  if (fmt === 'LEAGUE_PHASE_SWISS_STYLE' && !profile.qualification_rules) {
    if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
      reasons.push('INVALID_COMPETITION_PROFILE');
    }
    descriptions.push(
      'LEAGUE_PHASE_SWISS_STYLE format_type requires qualification_rules (§7.3, §8.3)',
    );
  }

  // ── §8.3 check 6: LEAGUE_PHASE_SWISS_STYLE requires tie_break_rules ──
  if (fmt === 'LEAGUE_PHASE_SWISS_STYLE' && !profile.tie_break_rules) {
    if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
      reasons.push('INVALID_COMPETITION_PROFILE');
    }
    descriptions.push('LEAGUE_PHASE_SWISS_STYLE format_type requires tie_break_rules (§7.3, §8.3)');
  }

  // ── §8.3 check 7: THIRD_PLACE_DEPENDENT mapping requires mapping_table
  // "si strategy = THIRD_PLACE_DEPENDENT, debe existir mapping_table"
  const bmd = profile.qualification_rules?.bracket_mapping_definition;
  if (bmd?.strategy === 'THIRD_PLACE_DEPENDENT' && !bmd.mapping_table) {
    if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
      reasons.push('INVALID_COMPETITION_PROFILE');
    }
    descriptions.push(
      'qualification_rules.bracket_mapping_definition.strategy = THIRD_PLACE_DEPENDENT requires mapping_table (§8.3)',
    );
  }

  // ── §8.3 check 8: leg_type = SECOND_LEG requires aggregate_state ────
  // "leg_type = SECOND_LEG requiere agregado previo"
  // NOTE: match-validator also checks this at the MatchInput level (§7.3).
  // This check is kept here for profile-level consistency per §8.3.
  if (leg === 'SECOND_LEG' && !profile.aggregate_state_before_match) {
    reasons.push('MISSING_AGGREGATE_STATE_FOR_SECOND_LEG');
    descriptions.push('leg_type = SECOND_LEG requires aggregate_state_before_match (§8.3, §7.3)');
  }

  // ── §8.3 check 9: stage_type consistent with format_type ─────────────
  // §8.3: "stage_type debe ser consistente con format_type"
  // LEAGUE_PHASE stage must use LEAGUE_PHASE_SWISS_STYLE format
  if (profile.stage_type === 'LEAGUE_PHASE' && fmt !== 'LEAGUE_PHASE_SWISS_STYLE') {
    if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
      reasons.push('INVALID_COMPETITION_PROFILE');
    }
    descriptions.push(
      'stage_type = LEAGUE_PHASE is inconsistent with format_type != LEAGUE_PHASE_SWISS_STYLE (§8.3)',
    );
  }

  // GROUP_STAGE must use GROUP_CLASSIC format
  if (profile.stage_type === 'GROUP_STAGE' && fmt !== 'GROUP_CLASSIC') {
    if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
      reasons.push('INVALID_COMPETITION_PROFILE');
    }
    descriptions.push(
      'stage_type = GROUP_STAGE is inconsistent with format_type != GROUP_CLASSIC (§8.3)',
    );
  }

  // Knockout stage types must not use ROUND_ROBIN or GROUP_CLASSIC formats
  // §8.3, §9: knockout stages require knockout resolution formats
  const stageIsKnockout = KNOCKOUT_STAGE_TYPES.has(
    profile.stage_type as typeof KNOCKOUT_STAGE_TYPES extends Set<infer T> ? T : never,
  );
  const formatIsNonKnockout =
    fmt === 'ROUND_ROBIN' || fmt === 'GROUP_CLASSIC' || fmt === 'LEAGUE_PHASE_SWISS_STYLE';
  // QUALIFYING is an exception: it can use ROUND_ROBIN (§9.3: "fases previas / qualifying rounds")
  // Safe assumption: only QUALIFYING may use ROUND_ROBIN among knockout-family stages
  if (stageIsKnockout && formatIsNonKnockout && profile.stage_type !== 'QUALIFYING') {
    if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
      reasons.push('INVALID_COMPETITION_PROFILE');
    }
    descriptions.push(
      `stage_type = ${profile.stage_type} is inconsistent with format_type = ${fmt} (§8.3)`,
    );
  }

  // ── §8.4 KnockoutResolutionRules checks ─────────────────────────────
  const krr = profile.knockout_resolution_rules;

  if (fmt === 'KNOCKOUT_TWO_LEG') {
    if (!krr) {
      reasons.push('KNOCKOUT_RULES_UNAVAILABLE');
      descriptions.push(
        'format_type = KNOCKOUT_TWO_LEG requires knockout_resolution_rules (§7.3, §8.4)',
      );
    } else {
      const order = krr.second_leg_resolution_order;
      if (!order || order.length === 0) {
        if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
          reasons.push('INVALID_COMPETITION_PROFILE');
        }
        descriptions.push(
          'KNOCKOUT_TWO_LEG requires a non-empty second_leg_resolution_order (§8.4)',
        );
      } else {
        // §8.4: no duplicate steps
        if (!hasNoDuplicateSteps(order)) {
          if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
            reasons.push('INVALID_COMPETITION_PROFILE');
          }
          descriptions.push('second_leg_resolution_order contains duplicate steps (§8.4)');
        }
        // §8.4: ORGANIZER_DEFINED must be last
        if (!organizerDefinedIsLast(order)) {
          if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
            reasons.push('INVALID_COMPETITION_PROFILE');
          }
          descriptions.push(
            'ORGANIZER_DEFINED must be the last element in second_leg_resolution_order (§8.4)',
          );
        }
      }
    }
  }

  if (fmt === 'KNOCKOUT_SINGLE_LEG') {
    if (!krr) {
      reasons.push('KNOCKOUT_RULES_UNAVAILABLE');
      descriptions.push(
        'format_type = KNOCKOUT_SINGLE_LEG requires knockout_resolution_rules (§7.3, §8.4)',
      );
    } else {
      const order = krr.single_leg_resolution_order;
      if (!order || order.length === 0) {
        if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
          reasons.push('INVALID_COMPETITION_PROFILE');
        }
        descriptions.push(
          'KNOCKOUT_SINGLE_LEG requires a non-empty single_leg_resolution_order (§8.4)',
        );
      } else {
        // §8.4: no duplicate steps
        if (!hasNoDuplicateSteps(order)) {
          if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
            reasons.push('INVALID_COMPETITION_PROFILE');
          }
          descriptions.push('single_leg_resolution_order contains duplicate steps (§8.4)');
        }
        // §8.4: ORGANIZER_DEFINED must be last
        if (!organizerDefinedIsLast(order)) {
          if (!reasons.includes('INVALID_COMPETITION_PROFILE')) {
            reasons.push('INVALID_COMPETITION_PROFILE');
          }
          descriptions.push(
            'ORGANIZER_DEFINED must be the last element in single_leg_resolution_order (§8.4)',
          );
        }
      }
    }
  }

  // Non-knockout formats must NOT supply knockout_resolution_rules — benign if
  // present (spec §8.4 does not prohibit it explicitly), so we do not flag it.

  if (reasons.length > 0) {
    return {
      valid: false,
      reasons,
      description: descriptions.join('; '),
    };
  }

  return { valid: true, reasons: [] };
}
