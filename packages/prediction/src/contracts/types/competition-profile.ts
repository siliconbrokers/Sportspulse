/**
 * CompetitionProfile and related rule types.
 *
 * Spec authority: §8 (Perfil de competición — CompetitionProfile)
 *
 * DESIGN NOTES:
 *
 * 1. NAMING CONFLICT — `StageType` in canonical vs prediction contracts:
 *    `packages/canonical/src/model/enums.ts` already exports `StageType` with
 *    different values (e.g. `QUARTER_FINALS` plural, no `QUALIFYING`,
 *    no `THIRD_PLACE`, no `LEAGUE_PHASE`). The prediction contract uses
 *    `PredictiveStageType` to avoid the collision. The canonical `StageType`
 *    serves the data pipeline; `PredictiveStageType` serves the prediction
 *    engine's CompetitionProfile as defined in spec §8.1.
 *
 * 2. `KnockoutResolutionRules` uses typed ordered arrays for both
 *    `second_leg_resolution_order` and `single_leg_resolution_order`.
 *    The array ORDER is the normative resolution order. No maps, no boolean
 *    flags, no sets. Enforced by the type — you cannot accidentally reorder
 *    elements without it being explicit in source code. §8.4
 *
 * 3. `TieBreakRules` is kept as the spec defines it in §8.2 — a struct with
 *    boolean flags. The spec does NOT define it as an ordered array in §8.2;
 *    it defines the ordered criteria only in `GroupRankingRules.rank_by[]`.
 *    These are two separate concepts: tie_break_rules governs presence/absence
 *    of criteria; rank_by governs precedence order.
 *
 * 4. All types are exported individually; there is no default export.
 */

// ── String literal union types (per spec §8.1) ───────────────────────────

/**
 * Domain of the competing teams in a match.
 * "NATIONAL_TEAM" (not "NATIONAL") per spec §8.1.
 * Spec §8.1
 */
export type TeamDomain = 'CLUB' | 'NATIONAL_TEAM';

/**
 * Competition family classification.
 * Spec §8.1, §9
 */
export type CompetitionFamily =
  | 'DOMESTIC_LEAGUE'
  | 'DOMESTIC_CUP'
  | 'INTERNATIONAL_CLUB'
  | 'NATIONAL_TEAM_TOURNAMENT';

/**
 * Stage type within a competition edition.
 *
 * NOTE: This type is scoped to the prediction engine contracts. The canonical
 * package's `StageType` enum has different values. Do not conflate them.
 * See design note 1 above.
 * Spec §8.1
 */
export type PredictiveStageType =
  | 'QUALIFYING'
  | 'GROUP_STAGE'
  | 'LEAGUE_PHASE'
  | 'PLAYOFF'
  | 'ROUND_OF_32'
  | 'ROUND_OF_16'
  | 'QUARTER_FINAL'
  | 'SEMI_FINAL'
  | 'THIRD_PLACE'
  | 'FINAL';

/**
 * Match format within a stage.
 * Spec §8.1
 */
export type FormatType =
  | 'ROUND_ROBIN'
  | 'GROUP_CLASSIC'
  | 'LEAGUE_PHASE_SWISS_STYLE'
  | 'KNOCKOUT_SINGLE_LEG'
  | 'KNOCKOUT_TWO_LEG';

/**
 * Which leg of a two-legged tie this match represents, or SINGLE for one-off matches.
 * Spec §8.1
 */
export type LegType = 'SINGLE' | 'FIRST_LEG' | 'SECOND_LEG';

// ── Bracket mapping strategy ───────────────────────────────────────────────

/**
 * Strategy for mapping group/phase results to bracket slots.
 * Spec §8.2 (QualificationRules)
 */
export type BracketMappingStrategy =
  | 'FIXED'
  | 'THIRD_PLACE_DEPENDENT'
  | 'POSITION_SEEDED'
  | 'LEAGUE_TABLE_SEEDED';

// ── Ranking criteria ───────────────────────────────────────────────────────

/**
 * Criteria used in ordered ranking within a group or league phase.
 * The array order in `GroupRankingRules.rank_by` defines precedence.
 * Spec §8.2 (GroupRankingRules)
 */
export type RankByCriterion =
  | 'POINTS'
  | 'GOAL_DIFFERENCE'
  | 'GOALS_FOR'
  | 'HEAD_TO_HEAD_POINTS'
  | 'HEAD_TO_HEAD_GOAL_DIFFERENCE'
  | 'HEAD_TO_HEAD_GOALS_FOR'
  | 'FAIR_PLAY'
  | 'DRAW_LOT';

// ── Seeding strategy ──────────────────────────────────────────────────────

/**
 * How teams are seeded into the next phase from a league phase table.
 * Spec §8.2 (LeaguePhaseRules)
 */
export type SeedingStrategy = 'TABLE_POSITION' | 'BRACKET_DEFINED' | 'ORGANIZER_DEFINED';

// ── Knockout resolution step values ───────────────────────────────────────

/**
 * Possible resolution steps after 90 minutes in a two-legged knockout tie.
 * When used in `second_leg_resolution_order`, the array ORDER is normative.
 * If ORGANIZER_DEFINED appears, it must be last.
 * Spec §8.2 (KnockoutResolutionRules), §8.4
 */
export type SecondLegResolutionStep =
  | 'AWAY_GOALS_AFTER_90'
  | 'EXTRA_TIME'
  | 'PENALTIES'
  | 'ORGANIZER_DEFINED';

/**
 * Possible resolution steps after 90 minutes in a single-leg knockout match.
 * When used in `single_leg_resolution_order`, the array ORDER is normative.
 * If ORGANIZER_DEFINED appears, it must be last.
 * Spec §8.2 (KnockoutResolutionRules), §8.4
 */
export type SingleLegResolutionStep = 'EXTRA_TIME' | 'PENALTIES' | 'REPLAY' | 'ORGANIZER_DEFINED';

// ── Rule types ────────────────────────────────────────────────────────────

/**
 * Point system and ranking order for group-stage or round-robin tables.
 *
 * `rank_by` is a REQUIRED ORDERED ARRAY. The position in the array is the
 * tiebreak precedence. Position 0 is primary sort criterion.
 * Spec §8.2
 */
export interface GroupRankingRules {
  points_win: number;
  points_draw: number;
  points_loss: number;
  /** Ordered array: index 0 is primary, index 1 is first tiebreak, etc. §8.2 */
  rank_by: readonly RankByCriterion[];
}

/**
 * Rules governing slot qualification and bracket formation from a group or league phase.
 * Spec §8.2
 */
export interface QualificationRules {
  qualified_count_per_group?: number;
  best_thirds_count?: number;
  allow_cross_group_third_ranking: boolean;

  bracket_mapping_definition?: {
    strategy: BracketMappingStrategy;
    /**
     * Required when strategy = THIRD_PLACE_DEPENDENT.
     * §8.3: "si strategy = THIRD_PLACE_DEPENDENT, debe existir mapping_table"
     */
    mapping_table?: object | null;
  } | null;
}

/**
 * Tiebreak rule flags for standing resolution.
 *
 * NOTE: This is a struct of boolean flags as specified in §8.2. The ordered
 * ranking criteria (precedence) are defined separately in `GroupRankingRules.rank_by`.
 * These two are distinct concepts — do not conflate them.
 * Spec §8.2
 */
export interface TieBreakRules {
  use_head_to_head: boolean;
  use_goal_difference: boolean;
  use_goals_for: boolean;
  use_fair_play: boolean;
  final_fallback: 'DRAW_LOT' | 'ORGANIZER_DEFINED';
}

/**
 * Rules for a league phase (Swiss-style, single table).
 * Spec §8.2
 */
export interface LeaguePhaseRules {
  table_type: 'SINGLE_TABLE';
  matches_per_team: number;

  direct_qualification_positions?: {
    start: number;
    end: number;
  } | null;

  playoff_positions?: {
    start: number;
    end: number;
  } | null;

  eliminated_positions?: {
    start: number;
    end: number;
  } | null;

  seeding_strategy: SeedingStrategy;
}

/**
 * Ordered knockout resolution rules after 90 minutes.
 *
 * INVARIANT (§8.4):
 * - `second_leg_resolution_order` applies ONLY when format_type = KNOCKOUT_TWO_LEG.
 * - `single_leg_resolution_order` applies ONLY when format_type = KNOCKOUT_SINGLE_LEG.
 * - Array element ORDER defines normative resolution precedence.
 * - No step may be repeated within the same array (enforced at runtime by Validation Layer).
 * - ORGANIZER_DEFINED, if present, must be the last element (runtime-enforced).
 * - Using a plain `readonly` array makes reordering explicit in source and auditable.
 *
 * Spec §8.2, §8.4
 */
export interface KnockoutResolutionRules {
  /**
   * Ordered resolution sequence for two-legged knockout ties (second leg only).
   * Array index 0 is the first step applied after 90-minute aggregate equality.
   * §8.4
   */
  second_leg_resolution_order?: readonly SecondLegResolutionStep[] | null;

  /**
   * Ordered resolution sequence for single-leg knockout matches.
   * Array index 0 is the first step applied after 90 minutes.
   * §8.4
   */
  single_leg_resolution_order?: readonly SingleLegResolutionStep[] | null;

  /**
   * If true, a specific final-specific rule definition must exist in the
   * competition/season catalog (enforced at runtime).
   * §8.4
   */
  final_overrides_prior_round_rules: boolean;
}

// ── CompetitionProfile ────────────────────────────────────────────────────

/**
 * Full competition profile embedded in every MatchInput.
 *
 * The fields listed in §7.2 are required at the type level:
 *   team_domain, competition_family, stage_type, format_type,
 *   leg_type, neutral_venue, competition_profile_version.
 *
 * All rule sub-objects are optional at the type level because their
 * required presence depends on format_type and leg_type — enforced at
 * runtime by the Validation Layer per §7.3 and §8.3.
 *
 * Spec §8.1
 */
export interface CompetitionProfile {
  /** Version identifier for this profile definition. §8.1, §26 */
  competition_profile_version: string;

  /** Whether teams are clubs or national teams. §8.1, §7.2 */
  team_domain: TeamDomain;

  /** Competition family classification. §8.1, §7.2 */
  competition_family: CompetitionFamily;

  /** Stage type within the competition edition. §8.1, §7.2 */
  stage_type: PredictiveStageType;

  /** Match format (round robin, group, league phase, knockout). §8.1, §7.2 */
  format_type: FormatType;

  /** Leg classification for this specific match. §8.1, §7.2 */
  leg_type: LegType;

  /** True if the match is played at a neutral venue. §8.1, §7.2 */
  neutral_venue: boolean;

  /**
   * Aggregate score before this match.
   * Required when leg_type = SECOND_LEG (§7.3). Enforced at runtime.
   */
  aggregate_state_before_match?: {
    home_aggregate_goals: number;
    away_aggregate_goals: number;
  } | null;

  /**
   * Knockout resolution rules.
   * Required when format_type in {KNOCKOUT_SINGLE_LEG, KNOCKOUT_TWO_LEG} (§7.3).
   * §8.2, §8.4
   */
  knockout_resolution_rules?: KnockoutResolutionRules | null;

  /**
   * Ranking rules for group-stage tables.
   * Required when format_type = GROUP_CLASSIC (§7.3).
   */
  group_ranking_rules?: GroupRankingRules | null;

  /**
   * Rules for league phase (Swiss-style single table).
   * Required when format_type = LEAGUE_PHASE_SWISS_STYLE (§7.3).
   */
  league_phase_rules?: LeaguePhaseRules | null;

  /**
   * Slot qualification and bracket mapping rules.
   * Required when format_type in {GROUP_CLASSIC, LEAGUE_PHASE_SWISS_STYLE} (§7.3).
   */
  qualification_rules?: QualificationRules | null;

  /**
   * Tiebreak resolution flags.
   * Required when format_type in {GROUP_CLASSIC, LEAGUE_PHASE_SWISS_STYLE} (§7.3).
   */
  tie_break_rules?: TieBreakRules | null;
}
