/**
 * Copa América — CompetitionProfile catalog entries.
 *
 * Catálogo inaugural: primer CompetitionProfile real fuera de los tests del PE.
 * Aplica reglamento CONMEBOL para fase de grupos y eliminatorias a partido único.
 *
 * Spec §8 (CompetitionProfile), §8.2 (GroupRankingRules, QualificationRules,
 *          TieBreakRules, KnockoutResolutionRules)
 *
 * Tiebreaker CONMEBOL (fase de grupos):
 *   1. Puntos
 *   2. H2H puntos (entre equipos empatados)
 *   3. H2H diferencia de goles
 *   4. H2H goles a favor
 *   5. Diferencia de goles global
 *   6. Goles a favor global
 *   7. Sorteo (DRAW_LOT — fallback determinista)
 */

import type {
  CompetitionProfile,
  GroupRankingRules,
  QualificationRules,
  TieBreakRules,
  KnockoutResolutionRules,
} from '../../contracts/types/competition-profile.js';

// ── Reglas reutilizables (exportadas para tests y servidor) ──────────────────

export const CA_GROUP_RANKING_RULES: GroupRankingRules = Object.freeze({
  points_win: 3,
  points_draw: 1,
  points_loss: 0,
  rank_by: Object.freeze([
    'POINTS',
    'HEAD_TO_HEAD_POINTS',
    'HEAD_TO_HEAD_GOAL_DIFFERENCE',
    'HEAD_TO_HEAD_GOALS_FOR',
    'GOAL_DIFFERENCE',
    'GOALS_FOR',
    'DRAW_LOT',
  ] as const),
});

export const CA_QUALIFICATION_RULES: QualificationRules = Object.freeze({
  qualified_count_per_group: 2,
  best_thirds_count: 0,
  allow_cross_group_third_ranking: false,
  bracket_mapping_definition: null,
});

export const CA_TIE_BREAK_RULES: TieBreakRules = Object.freeze({
  use_head_to_head: true,
  use_goal_difference: true,
  use_goals_for: true,
  use_fair_play: false,
  final_fallback: 'DRAW_LOT',
});

export const CA_KNOCKOUT_RESOLUTION_RULES: KnockoutResolutionRules = Object.freeze({
  single_leg_resolution_order: Object.freeze(['EXTRA_TIME', 'PENALTIES'] as const),
  second_leg_resolution_order: null,
  final_overrides_prior_round_rules: false,
});

// ── CompetitionProfile — Fase de Grupos ──────────────────────────────────────

/**
 * Perfil para partidos de la fase de grupos de Copa América.
 * group_id debe sobreescribirse por cada grupo al construir el MatchInput.
 */
export const CA_GROUP_STAGE_PROFILE: CompetitionProfile = Object.freeze({
  competition_profile_version: '1.0.0-ca-group',
  team_domain: 'NATIONAL_TEAM',
  competition_family: 'NATIONAL_TEAM_TOURNAMENT',
  stage_type: 'GROUP_STAGE',
  format_type: 'GROUP_CLASSIC',
  leg_type: 'SINGLE',
  neutral_venue: false,
  group_ranking_rules: CA_GROUP_RANKING_RULES,
  qualification_rules: CA_QUALIFICATION_RULES,
  tie_break_rules: CA_TIE_BREAK_RULES,
  knockout_resolution_rules: null,
});

// ── CompetitionProfile — Eliminatorias ───────────────────────────────────────

/**
 * Perfil base para partidos eliminatorios de Copa América.
 * stage_type debe sobreescribirse según la ronda (QUARTER_FINAL, SEMI_FINAL, etc.).
 * neutral_venue: true — Copa América se juega en sede única.
 */
export const CA_KNOCKOUT_PROFILE: CompetitionProfile = Object.freeze({
  competition_profile_version: '1.0.0-ca-knockout',
  team_domain: 'NATIONAL_TEAM',
  competition_family: 'NATIONAL_TEAM_TOURNAMENT',
  stage_type: 'QUARTER_FINAL',
  format_type: 'KNOCKOUT_SINGLE_LEG',
  leg_type: 'SINGLE',
  neutral_venue: true,
  knockout_resolution_rules: CA_KNOCKOUT_RESOLUTION_RULES,
  group_ranking_rules: null,
  qualification_rules: null,
  tie_break_rules: null,
});
